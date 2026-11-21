// One conversation, turn by turn: where its tokens went (pillar A). A subset of codeburn's `sessions --why`
// (src/session-why.ts, MIT): turns → requests → tool steps, cost split by token kind, and two estimated
// findings, "carry" (a big tool result or paste re-read by every later request until a compaction) and
// "prefix" (the startup context every request re-reads). Laid out like a Langfuse trace in the app.
//
// Reads the session file on demand and keeps nothing. Your own prompts are shown only for workspaces you ticked
// for the nightly read (like titles in the usage ledger); tool output is only measured, never shown.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { projectsDir } from './dream.js';
import { priceOf, type UsageRow } from './usage.js';

/** codeburn WHY_RULES: a result this big is worth a finding; a first prompt this big is a heavy prefix. */
export const TRACE_RULES = { carryTokens: 10_000, prefixTokens: 40_000, charsPerToken: 4, imageTokens: 1_600 };

/**
 * Rough tokens of a tool result. Images count as images (~1.6k tokens at most for Claude), not as their base64
 * text: screenshots read with Read made a 600k-character result look like 150k tokens (2026-11-21).
 */
export function resultTokens(content: unknown): { tokens: number; chars: number } {
  if (typeof content === 'string') return { tokens: Math.round(content.length / TRACE_RULES.charsPerToken), chars: content.length };
  if (!Array.isArray(content)) return { tokens: 0, chars: 0 };
  let tokens = 0;
  let chars = 0;
  for (const b of content as { type?: string; text?: string }[]) {
    if (b?.type === 'image') tokens += TRACE_RULES.imageTokens;
    else if (b?.type === 'text') {
      chars += (b.text ?? '').length;
      tokens += Math.round((b.text ?? '').length / TRACE_RULES.charsPerToken);
    }
  }
  return { tokens, chars };
}

export interface Parts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TraceTool {
  id: string;
  name: string;
  /** File, command or pattern, cut short. */
  label: string;
  /** Size of what came back, in characters (the content itself is never kept). */
  resultChars: number;
  /** Rough tokens it added (images counted as images). */
  resultTokens: number;
  isError: boolean;
}

export interface TraceRequest {
  at: string;
  model: string;
  costUsd: number;
  parts: Parts;
  tokens: Parts;
  /** What the model read this time: input + cache read + cache write. Grows each step, drops at a compaction. */
  context: number;
  tools: TraceTool[];
  /** A subagent's request (its cost counts toward the turn that spawned it). */
  helper: boolean;
}

export interface TraceTurn {
  i: number;
  at: string;
  /** Your prompt, cut short; null when hidden (an unticked workspace) or when the turn began without one. */
  prompt: string | null;
  promptKind: 'text' | 'pasted' | 'continued';
  costUsd: number;
  parts: Parts;
  tokens: number;
  requests: TraceRequest[];
  contextPeak: number;
  durationMs: number;
  compactedBefore: boolean;
}

export type TraceFinding =
  | { kind: 'carry'; turn: number; tool: string; label: string; tokens: number; laterRequests: number; usd: number; estimate: true }
  | { kind: 'prefix'; turn: 1; tokens: number; laterRequests: number; usd: number; estimate: true };

export interface Trace {
  session: string;
  title: string | null;
  workspace: string;
  start: string;
  end: string;
  costUsd: number;
  parts: Parts;
  tokens: number;
  requests: number;
  cacheHitPct: number | null;
  compactions: number;
  turns: TraceTurn[];
  findings: TraceFinding[];
  promptsHidden: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const zeroParts = (): Parts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const addParts = (a: Parts, b: Parts) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite });
const sumParts = (p: Parts) => p.input + p.output + p.cacheRead + p.cacheWrite;

/** The session file (and its subagents) for an id or the start of one. */
export function findSession(query: string, root = projectsDir()): { main: string; helpers: string[] } | null {
  if (!existsSync(root)) return null;
  const q = query.trim();
  for (const dir of readdirSync(root)) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    const hit = names.find((n) => n.endsWith('.jsonl') && n.startsWith(q));
    if (!hit) continue;
    const id = basename(hit, '.jsonl');
    const sub = join(root, dir, id, 'subagents');
    const helpers = existsSync(sub) ? readdirSync(sub).filter((n) => n.endsWith('.jsonl')).map((n) => join(sub, n)) : [];
    return { main: join(root, dir, hit), helpers };
  }
  return null;
}

type Entry = Record<string, unknown> & { type?: string; timestamp?: string; message?: { id?: string; model?: string; usage?: Record<string, unknown>; content?: unknown } };

function readEntries(file: string): Entry[] {
  const out: Entry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

function toolLabel(input: Record<string, unknown> | undefined): string {
  const i = input ?? {};
  return String(i.file_path ?? i.command ?? i.pattern ?? i.url ?? i.description ?? i.prompt ?? '').split('\n')[0]!.slice(0, 80);
}

/** One request's cost by token kind (each priced alone, so they add up to the request's cost). */
function partsCost(model: string, t: Parts & { write1h: number }): { cost: number; parts: Parts } {
  const p = (x: Partial<Pick<UsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'>>) =>
    priceOf(model, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...x }) ?? 0;
  const parts = {
    input: p({ input: t.input }),
    output: p({ output: t.output }),
    cacheRead: p({ cacheRead: t.cacheRead }),
    cacheWrite: p({ cacheWrite5m: t.cacheWrite - t.write1h, cacheWrite1h: t.write1h }),
  };
  // Long-context tiers price the whole call by its full prompt: use the full call's price as the total.
  const cost = priceOf(model, { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite5m: t.cacheWrite - t.write1h, cacheWrite1h: t.write1h }) ?? 0;
  return { cost, parts };
}

/** Assistant rows → one request per message id (the largest copy), with all its tool calls. */
function requestsOf(entries: Entry[], helper: boolean): TraceRequest[] {
  const byId = new Map<string, { req: TraceRequest; size: number }>();
  for (const e of entries) {
    const m = e.message;
    if (e.type !== 'assistant' || !m?.id || !m.usage || !m.model || m.model === '<synthetic>') continue;
    const u = m.usage;
    const write = num(u.cache_creation_input_tokens);
    const write1h = Math.min(write, num((u.cache_creation as Record<string, unknown> | undefined)?.ephemeral_1h_input_tokens));
    const tokens = { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: write };
    const { cost, parts } = partsCost(m.model, { ...tokens, write1h });
    const tools: TraceTool[] = Array.isArray(m.content)
      ? (m.content as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }[])
          .filter((b) => b?.type === 'tool_use')
          .map((b) => ({ id: String(b.id ?? ''), name: String(b.name ?? '?'), label: toolLabel(b.input), resultChars: 0, resultTokens: 0, isError: false }))
      : [];
    const key = `${m.id}:${String(e.requestId ?? '')}`;
    const had = byId.get(key);
    const size = sumParts(tokens);
    if (had) {
      // Same request logged once per content block: keep the largest usage, gather every tool call.
      for (const t of tools) if (!had.req.tools.some((x) => x.id === t.id)) had.req.tools.push(t);
      if (size >= had.size) Object.assign(had.req, { costUsd: cost, parts, tokens, context: tokens.input + tokens.cacheRead + tokens.cacheWrite });
      had.size = Math.max(had.size, size);
      continue;
    }
    byId.set(key, {
      size,
      req: { at: String(e.timestamp ?? ''), model: m.model, costUsd: cost, parts, tokens, context: tokens.input + tokens.cacheRead + tokens.cacheWrite, tools, helper },
    });
  }
  return [...byId.values()].map((x) => x.req);
}

function promptOf(e: Entry): { text: string; kind: 'text' | 'pasted' } | null {
  if (e.type !== 'user' || e.isMeta || e.isCompactSummary) return null;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((b) => (b as { type?: string })?.type === 'tool_result')) return null;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? (c as { type?: string; text?: string }[]).filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('\n') : '';
  const head = text.trimStart();
  // Commands and system notes start with a tag; a paste does too, and is yours.
  if (!head || (head.startsWith('<') && !head.startsWith('<pasted_content')) || head.startsWith('[Request interrupted')) return null;
  return { text, kind: text.length > 2000 || /<pasted_content|\[Pasted text/.test(text) ? 'pasted' : 'text' };
}

export function traceSession(query: string, opts: { showPrompts?: (workspace: string) => boolean; title?: string | null } = {}): Trace | null {
  const found = findSession(query);
  if (!found) return null;
  const entries = readEntries(found.main);
  const workspace = String(entries.find((e) => typeof e.cwd === 'string')?.cwd ?? '');
  const show = opts.showPrompts ? opts.showPrompts(workspace) : true;
  const session = basename(found.main, '.jsonl');
  const title = opts.title ?? (entries.filter((e) => e.type === 'ai-title').map((e) => String(e.aiTitle ?? '')).pop() || null);

  // Tool results: size and error, by tool_use id. Pastes: big prompts, by time.
  const results = new Map<string, { chars: number; tokens: number; isError: boolean; at: string }>();
  for (const e of entries) {
    const c = e.message?.content;
    if (e.type !== 'user' || !Array.isArray(c)) continue;
    for (const b of c as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
      if (b?.type !== 'tool_result' || !b.tool_use_id) continue;
      results.set(b.tool_use_id, { ...resultTokens(b.content), isError: b.is_error === true, at: String(e.timestamp ?? '') });
    }
  }
  const compactAt = entries.filter((e) => e.type === 'system' && e.subtype === 'compact_boundary').map((e) => String(e.timestamp ?? ''));

  // Turns: each prompt starts one; requests (yours and helpers') fall into the turn running at their time.
  const starts: { at: string; prompt: { text: string; kind: 'text' | 'pasted' } | null }[] = [];
  for (const e of entries) {
    const p = promptOf(e);
    if (p) starts.push({ at: String(e.timestamp ?? ''), prompt: p });
  }
  const requests = [...requestsOf(entries, false), ...found.helpers.flatMap((f) => requestsOf(readEntries(f), true))].sort((a, b) => a.at.localeCompare(b.at));
  for (const r of requests) for (const t of r.tools) {
    const res = results.get(t.id);
    if (res) Object.assign(t, { resultChars: res.chars, resultTokens: res.tokens, isError: res.isError });
  }
  if (!starts.length || (requests[0] && requests[0].at < starts[0]!.at)) starts.unshift({ at: requests[0]?.at ?? '', prompt: null });

  const turns: TraceTurn[] = starts.map((s, i): TraceTurn => {
    const end = starts[i + 1]?.at ?? '￿';
    const reqs = requests.filter((r) => r.at >= s.at && r.at < end);
    const parts = reqs.reduce((p, r) => addParts(p, r.parts), zeroParts());
    const last = reqs.at(-1)?.at;
    return {
      i: i + 1,
      at: s.at,
      prompt: s.prompt && show ? s.prompt.text.replace(/<\/?pasted_content[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) : null,
      promptKind: s.prompt ? s.prompt.kind : 'continued',
      costUsd: reqs.reduce((n, r) => n + r.costUsd, 0),
      parts,
      tokens: reqs.reduce((n, r) => n + sumParts(r.tokens), 0),
      requests: reqs,
      contextPeak: Math.max(0, ...reqs.filter((r) => !r.helper).map((r) => r.context)),
      durationMs: last ? Math.max(0, Date.parse(last) - Date.parse(s.at)) : 0,
      compactedBefore: compactAt.some((c) => c <= s.at && c > (starts[i - 1]?.at ?? '')),
    };
  }).filter((t) => t.requests.length > 0);

  const main = requests.filter((r) => !r.helper);
  const findings: TraceFinding[] = [];
  // Estimate (codeburn "carry"): a big tool result is written to the cache once, then re-read by every later
  // request until the next compaction.
  const carryCost = (estimate: number, at: string) => {
    const stop = compactAt.find((c) => c > at) ?? '￿';
    const later = main.filter((r) => r.at > at && r.at < stop);
    if (!later.length) return null;
    // Ground the estimate in what was recorded: a result can't add more than the next request wrote to the cache.
    const tokens = Math.min(estimate, later[0]!.tokens.cacheWrite + later[0]!.tokens.input);
    if (tokens < TRACE_RULES.carryTokens) return null;
    const write = priceOf(later[0]!.model, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: tokens }) ?? 0;
    const reads = later.slice(1).reduce((n, r) => n + (priceOf(r.model, { input: 0, output: 0, cacheRead: tokens, cacheWrite5m: 0, cacheWrite1h: 0 }) ?? 0), 0);
    return { usd: write + reads, laterRequests: later.length, tokens };
  };
  for (const t of turns) for (const r of t.requests) for (const tool of r.tools) {
    if (r.helper || tool.resultTokens < TRACE_RULES.carryTokens) continue;
    const c = carryCost(tool.resultTokens, results.get(tool.id)?.at ?? r.at);
    const label = tool.label.startsWith('/') ? tool.label.split('/').slice(-2).join('/') : tool.label;
    if (c) findings.push({ kind: 'carry', turn: t.i, tool: tool.name, label, estimate: true, ...c });
  }
  // Estimate (codeburn "prefix"): the context the very first request already carried, re-read by later ones.
  const first = main[0];
  if (first && first.context >= TRACE_RULES.prefixTokens) {
    const cached = first.tokens.cacheRead + first.tokens.cacheWrite;
    const readers = main.slice(1).filter((r) => r.tokens.cacheRead >= cached);
    const usd = first.parts.cacheWrite + readers.reduce((n, r) => n + (priceOf(r.model, { input: 0, output: 0, cacheRead: cached, cacheWrite5m: 0, cacheWrite1h: 0 }) ?? 0), 0);
    findings.push({ kind: 'prefix', turn: 1, tokens: first.context, laterRequests: readers.length, usd, estimate: true });
  }
  findings.sort((a, b) => b.usd - a.usd);

  const parts = turns.reduce((p, t) => addParts(p, t.parts), zeroParts());
  const tokens = requests.reduce((p, r) => addParts(p, r.tokens), zeroParts());
  const inputSide = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return {
    session,
    title,
    workspace,
    start: requests[0]?.at ?? '',
    end: requests.at(-1)?.at ?? '',
    costUsd: requests.reduce((n, r) => n + r.costUsd, 0),
    parts,
    tokens: sumParts(tokens),
    requests: requests.length,
    cacheHitPct: inputSide ? Math.round((tokens.cacheRead / inputSide) * 100) : null,
    compactions: compactAt.length,
    turns,
    findings: findings.slice(0, 12),
    promptsHidden: !show,
  };
}

const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;
const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export function formatTrace(t: Trace): string {
  const peak = Math.max(1e-9, ...t.turns.map((x) => x.costUsd));
  const lines = [
    `${t.title ?? t.session} · ${t.workspace.split('/').pop()}`,
    `${usd(t.costUsd)} at API prices · ${k(t.tokens)} tokens · ${t.requests} requests · ${t.turns.length} turns · cache hit ${t.cacheHitPct ?? '–'}% · ${t.compactions} compaction${t.compactions === 1 ? '' : 's'}`,
    `Where it went: output ${usd(t.parts.output)} · cache read ${usd(t.parts.cacheRead)} · cache write ${usd(t.parts.cacheWrite)} · input ${usd(t.parts.input)}`,
  ];
  if (t.findings.length) {
    lines.push('', 'What ate the tokens (estimates):');
    for (const f of t.findings) {
      lines.push(f.kind === 'carry'
        ? `  ~${usd(f.usd)}  turn ${f.turn}: ${f.tool} ${f.label ? `"${f.label}" ` : ''}brought in ~${k(f.tokens)} tokens, re-read by ${f.laterRequests} later requests`
        : `  ~${usd(f.usd)}  startup context of ~${k(f.tokens)} tokens, re-read by ${f.laterRequests} requests`);
    }
  }
  lines.push('', 'Turn by turn:');
  for (const x of t.turns) {
    const tools = new Map<string, number>();
    for (const r of x.requests) for (const tool of r.tools) tools.set(tool.name, (tools.get(tool.name) ?? 0) + 1);
    const bar = '█'.repeat(Math.max(1, Math.round((x.costUsd / peak) * 16)));
    const what = x.prompt ? `"${x.prompt.slice(0, 70)}${x.prompt.length > 70 ? '…' : ''}"` : x.promptKind === 'continued' ? '(continued)' : '(prompt hidden)';
    lines.push(`  ${String(x.i).padStart(3)} ${x.at.slice(11, 16)} ${usd(x.costUsd).padStart(7)} ${bar.padEnd(16)} ${x.requests.length} req · context ${k(x.contextPeak)}${x.compactedBefore ? ' · after compaction' : ''} · ${[...tools].map(([n, c]) => `${n}×${c}`).join(' ') || 'no tools'}  ${what}`);
  }
  if (t.promptsHidden) lines.push('', 'Prompts are hidden: this workspace is not ticked for the nightly read.');
  return lines.join('\n');
}
