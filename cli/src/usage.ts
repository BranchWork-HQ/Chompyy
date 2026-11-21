// The usage ledger: every Claude Code request on this Mac, with its tokens and API-value cost.
// One engine for both pillars: the monitor zooms out (days, projects, models), the trace zooms in (one
// conversation). Research: research/monitoring/PICKS.md.
//
// - Reads only numbers and structure from ~/.claude/projects (usage, model, time, folder, the AI-written title),
//   never what you or Claude wrote.
// - Dedupe: Claude Code writes one row per content block, each carrying the same usage. Summing rows counts
//   2.15× the real tokens on the first Mac we measured. Rows are grouped by message.id + requestId, keeping
//   the largest (codeburn parser.ts, ccusage dedupe.rs; MIT).
// - Cost is *calculated* from LiteLLM prices (vendor/codeburn/prices.ts): the logs carry no cost. Away runs
//   come from Chompyy's own records, where Claude Code *recorded* the cost.
// - A per-file cache (size + mtime) keeps re-reads fast, and keeps rows of files Claude Code has since cleaned up.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { projectsDir } from './dream.js';
import { homePath, readJson, writeJson } from './home.js';
import { CLAUDE_PRICES, type PriceRow } from './vendor/codeburn/prices.js';

export interface UsageRow {
  /** message.id + requestId: the same request logged twice counts once. */
  key: string;
  session: string;
  /** Set for subagent requests. */
  agent?: string;
  workspace: string;
  model: string;
  at: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  costUsd: number;
  /** calculated from list prices; recorded by Claude Code (away runs); unpriced (unknown model). */
  basis: 'calculated' | 'recorded' | 'unpriced';
  /** Names of the tools the request called (never their inputs): what kind of work it was. */
  tools?: string[];
}

/** A pull request a conversation opened or pointed to (Claude Code's `pr-link` rows). */
export interface PrLink {
  session: string;
  repo: string;
  number: number;
  url: string;
  at: string;
}

interface FileEntry {
  size: number;
  mtimeMs: number;
  rows: UsageRow[];
  titles: Record<string, string>;
  prs?: PrLink[];
}

interface UsageCache {
  version: number;
  files: Record<string, FileEntry>;
}

/** Bump when parsing or pricing changes, so old cached rows are re-read. */
export const CACHE_VERSION = 3;

export function usageCachePath(): string {
  return homePath('usage-cache.json');
}

// ---------- prices ----------

/** USD for one request at list prices (codeburn models.ts calculateCost rules). Null when the model has no price. */
export function priceOf(model: string, t: Pick<UsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'>, fast = false): number | null {
  const row = priceRow(model);
  if (!row) return null;
  const [baseIn, baseOut, baseWrite, baseRead, fastMul, tier] = row;
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const long = tier && prompt > tier.threshold ? tier : null;
  const input = long?.input ?? baseIn;
  const output = long?.output ?? baseOut;
  const write = (long ? long.cacheWrite : baseWrite) ?? input * 1.25;
  const read = (long ? long.cacheRead : baseRead) ?? input * 0.1;
  const usd = t.input * input + t.output * output + t.cacheWrite5m * write + t.cacheWrite1h * write * 1.6 + t.cacheRead * read;
  return usd * (fast && fastMul ? fastMul : 1);
}

function priceRow(model: string): PriceRow | null {
  const m = model.replace(/\[.*\]$/, '');
  return CLAUDE_PRICES[m] ?? CLAUDE_PRICES[m.replace(/-\d{8}$/, '')] ?? null;
}

// ---------- reading ----------

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const total = (r: Pick<UsageRow, 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h'>) => r.input + r.output + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;

/** One session file → its requests (deduped within the file) and conversation titles. */
export function parseSessionFile(file: string): { rows: UsageRow[]; titles: Record<string, string>; prs: PrLink[] } {
  const byKey = new Map<string, UsageRow>();
  const titles: Record<string, string> = {};
  const prs = new Map<string, PrLink>();
  let workspace = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // Only rows that can matter are parsed; message rows are mostly text we don't read.
    const usage = line.includes('"usage"');
    if (!usage && !line.includes('"ai-title"') && !line.includes('"pr-link"')) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && typeof e.sessionId === 'string') {
      titles[e.sessionId] = e.aiTitle.slice(0, 120);
      continue;
    }
    if (e.type === 'pr-link' && typeof e.prUrl === 'string' && typeof e.sessionId === 'string') {
      // Claude Code writes the same link many times (2,084 rows, 115 distinct on the first Mac): keep the first.
      const k = `${e.sessionId} ${e.prUrl}`;
      if (!prs.has(k)) prs.set(k, { session: e.sessionId, repo: String(e.prRepository ?? ''), number: Number(e.prNumber ?? 0), url: e.prUrl, at: String(e.timestamp ?? '') });
      continue;
    }
    const msg = e.message as { id?: string; model?: string; usage?: Record<string, unknown>; content?: unknown } | undefined;
    if (e.type !== 'assistant' || !msg?.id || !msg.usage || !msg.model || msg.model === '<synthetic>') continue;
    if (!workspace && typeof e.cwd === 'string') workspace = e.cwd;
    const u = msg.usage;
    const cc = (u.cache_creation ?? {}) as Record<string, unknown>;
    const write = num(u.cache_creation_input_tokens);
    const write1h = Math.min(write, num(cc.ephemeral_1h_input_tokens));
    const row: UsageRow = {
      key: `${msg.id}:${typeof e.requestId === 'string' ? e.requestId : ''}`,
      session: String(e.sessionId ?? ''),
      ...(typeof e.agentId === 'string' ? { agent: e.agentId } : {}),
      workspace, // where the conversation started: Claude cd-ing into cli/ mid-session is still the same project
      model: msg.model,
      at: String(e.timestamp ?? ''),
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite5m: write - write1h,
      cacheWrite1h: write1h,
      costUsd: 0,
      basis: 'calculated',
      tools: Array.isArray(msg.content) ? [...new Set((msg.content as { type?: string; name?: string }[]).filter((b) => b?.type === 'tool_use' && b.name).map((b) => b.name!))] : [],
    };
    const price = priceOf(row.model, row, u.speed === 'fast');
    row.costUsd = price ?? 0;
    if (price === null) row.basis = 'unpriced';
    const had = byKey.get(row.key);
    // Keep the largest (in practice the last) copy, but the first copy's time: when the request happened.
    // One row per content block: gather every block's tools onto the kept copy.
    const tools = [...new Set([...(had?.tools ?? []), ...(row.tools ?? [])])];
    if (!had) byKey.set(row.key, row);
    else if (total(row) >= total(had)) byKey.set(row.key, { ...row, at: had.at || row.at, tools });
    else had.tools = tools;
  }
  return { rows: [...byKey.values()], titles, prs: [...prs.values()] };
}

/** Every session file: projects/<folder>/<session>.jsonl and their subagents/<agent>.jsonl. */
export function sessionFiles(root = projectsDir()): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: import('node:fs').Dirent[];
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n.name);
      if (n.isFile() && n.name.endsWith('.jsonl')) out.push(p);
      else if (n.isDirectory() && depth < 3) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export interface Ledger {
  rows: UsageRow[];
  titles: Record<string, string>;
  prs: PrLink[];
  files: number;
  /** Files read fresh this time (the rest came from the cache). */
  parsed: number;
}

/** All requests on this Mac, deduped across files, plus Chompyy's away runs. */
export function loadLedger(): Ledger {
  const cache = readJson<UsageCache>(usageCachePath(), { version: CACHE_VERSION, files: {} });
  if (cache.version !== CACHE_VERSION) cache.files = {};
  const files = sessionFiles();
  let parsed = 0;
  for (const f of files) {
    let st;
    try {
      st = statSync(f);
    } catch {
      continue;
    }
    const had = cache.files[f];
    if (had && had.size === st.size && had.mtimeMs === st.mtimeMs) continue;
    cache.files[f] = { size: st.size, mtimeMs: st.mtimeMs, ...parseSessionFile(f) };
    parsed++;
  }
  // Files Claude Code has cleaned up stay in the cache: the ledger outlives the transcripts.
  if (parsed) writeJson(usageCachePath(), { version: CACHE_VERSION, files: cache.files });
  const byKey = new Map<string, UsageRow>();
  const titles: Record<string, string> = {};
  const prs = new Map<string, PrLink>();
  for (const entry of Object.values(cache.files)) {
    Object.assign(titles, entry.titles);
    for (const p of entry.prs ?? []) {
      const k = `${p.session} ${p.url}`;
      if (!prs.has(k) || p.at < prs.get(k)!.at) prs.set(k, p);
    }
    for (const r of entry.rows) {
      const had = byKey.get(r.key);
      if (!had || total(r) > total(had)) byKey.set(r.key, r);
    }
  }
  const rows = [...byKey.values(), ...awayRows(titles)];
  return { rows, titles, prs: [...prs.values()], files: files.length, parsed };
}

/** Away runs aren't saved as sessions (--no-session-persistence); their tokens and cost come from Chompyy's records. */
function awayRows(titles: Record<string, string>): UsageRow[] {
  const path = homePath('runs.jsonl');
  if (!existsSync(path)) return [];
  const out: UsageRow[] = [];
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const r = JSON.parse(line) as { at: string; card: string; title: string; cwd: string; tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; models: string[] } };
      if (!r.tokens) return;
      titles[`chompyy-card-${r.card}`] = `#${r.card} ${r.title}`.slice(0, 120);
      out.push({
        key: `chompyy-run-${i}`,
        session: `chompyy-card-${r.card}`,
        workspace: r.cwd,
        model: r.tokens.models[0] ?? 'unknown',
        at: r.at,
        input: r.tokens.input,
        output: r.tokens.output,
        cacheRead: r.tokens.cacheRead,
        cacheWrite5m: r.tokens.cacheWrite,
        cacheWrite1h: 0,
        costUsd: r.tokens.costUsd,
        basis: 'recorded',
      });
    } catch {}
  });
  return out;
}

// ---------- views ----------

export interface Tally {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  costUsd: number;
}

const zero = (): Tally => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, costUsd: 0 });

function add(t: Tally, r: UsageRow): Tally {
  t.requests++;
  t.input += r.input;
  t.output += r.output;
  t.cacheRead += r.cacheRead;
  t.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;
  t.tokens += total(r);
  t.costUsd += r.costUsd;
  return t;
}

const round = (t: Tally): Tally => ({ ...t, costUsd: Math.round(t.costUsd * 100) / 100 });

/** Local calendar day (YYYY-MM-DD). */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Conversation extends Tally {
  session: string;
  title: string | null;
  workspace: string;
  start: string;
  end: string;
  models: string[];
  /** Chompyy away run (recorded cost) rather than your own session. */
  away: boolean;
  /** Title held back: the conversation is outside the workspaces you let Chompyy read (its numbers still count). */
  private: boolean;
}

export interface UsageView {
  from: string;
  days: { day: string; total: Tally }[];
  total: Tally;
  today: Tally;
  byWorkspace: { workspace: string; total: Tally }[];
  byModel: { model: string; total: Tally }[];
  conversations: Conversation[];
  /** Requests whose model has no price yet (counted as $0). */
  unpriced: number;
  files: number;
}

/**
 * `canShowTitle`: may this folder's conversation titles be shown? The CLI passes the nightly read's ticks, so a
 * desktop-app chat or a folder you left unticked shows its numbers but not what it was about.
 */
export function usageView(ledger: Ledger, now: Date, days = 7, top = 10, canShowTitle: (workspace: string) => boolean = () => true): UsageView {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const from = start.toISOString();
  const inRange = ledger.rows.filter((r) => r.at >= from && r.at <= now.toISOString());
  const dayMap = new Map<string, Tally>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dayMap.set(localDay(d.toISOString()), zero());
  }
  const ws = new Map<string, Tally>();
  const models = new Map<string, Tally>();
  const convs = new Map<string, Conversation>();
  const helperOnly = new Set<string>();
  const all = zero();
  for (const r of inRange) {
    add(all, r);
    add(dayMap.get(localDay(r.at)) ?? zero(), r);
    add(ws.get(r.workspace) ?? ws.set(r.workspace, zero()).get(r.workspace)!, r);
    add(models.get(r.model) ?? models.set(r.model, zero()).get(r.model)!, r);
    let c = convs.get(r.session);
    // A conversation's folder (and so whether its title shows) comes from the main session, never a subagent
    // working elsewhere: a helper's temp folder hid the title of a whole conversation (2026-11-21).
    if (c && !r.agent && helperOnly.has(r.session)) {
      helperOnly.delete(r.session);
      const shown = c.away || canShowTitle(r.workspace);
      Object.assign(c, { workspace: r.workspace, title: shown ? ledger.titles[r.session] ?? null : null, private: !shown });
    }
    if (!c) {
      if (r.agent) helperOnly.add(r.session);
      const away = r.basis === 'recorded';
      const shown = away || canShowTitle(r.workspace);
      c = { ...zero(), session: r.session, title: shown ? ledger.titles[r.session] ?? null : null, workspace: r.workspace, start: r.at, end: r.at, models: [], away, private: !shown };
      convs.set(r.session, c);
    }
    add(c, r);
    if (r.at < c.start) c.start = r.at;
    if (r.at > c.end) c.end = r.at;
    if (!c.models.includes(r.model)) c.models.push(r.model);
  }
  const sortTally = <T extends { total: Tally }>(xs: T[]) => xs.sort((a, b) => b.total.costUsd - a.total.costUsd);
  const today = dayMap.get(localDay(now.toISOString())) ?? zero();
  return {
    from,
    days: [...dayMap].map(([day, t]) => ({ day, total: round(t) })),
    total: round(all),
    today: round(today),
    byWorkspace: sortTally([...ws].map(([workspace, t]) => ({ workspace, total: round(t) }))),
    byModel: sortTally([...models].map(([model, t]) => ({ model, total: round(t) }))),
    conversations: [...convs.values()].sort((a, b) => b.costUsd - a.costUsd).slice(0, top).map((c) => ({ ...c, ...round(c) })),
    unpriced: inRange.filter((r) => r.basis === 'unpriced').length,
    files: ledger.files,
  };
}

export function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

const usd = (n: number) => `$${n >= 100 ? Math.round(n) : n.toFixed(2)}`;

export function formatUsage(v: UsageView, home = ''): string {
  const short = (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p) || '(unknown folder)';
  const peak = Math.max(1, ...v.days.map((d) => d.total.tokens));
  const lines = [
    `Claude Code on this Mac, last ${v.days.length} days · ${compactTokens(v.total.tokens)} tokens · ${usd(v.total.costUsd)} at API prices`,
    `(On a subscription you pay your plan, not this: it's the value you got. Cost is calculated from list prices; away runs are as Claude Code recorded them.)`,
    '',
    `Today      ${compactTokens(v.today.tokens).padStart(6)}  ${usd(v.today.costUsd).padStart(8)}  ${v.today.requests} requests`,
    '',
    'Day by day',
    ...v.days.map((d) => `  ${d.day.slice(5)}  ${'█'.repeat(Math.round((d.total.tokens / peak) * 24)).padEnd(24)} ${compactTokens(d.total.tokens).padStart(6)}  ${usd(d.total.costUsd).padStart(8)}`),
    '',
    'By project',
    ...v.byWorkspace.slice(0, 6).map((w) => `  ${usd(w.total.costUsd).padStart(8)}  ${compactTokens(w.total.tokens).padStart(6)}  ${short(w.workspace)}`),
    '',
    'By model',
    ...v.byModel.map((m) => `  ${usd(m.total.costUsd).padStart(8)}  ${compactTokens(m.total.tokens).padStart(6)}  ${m.model}`),
    '',
    'Costliest conversations',
    ...v.conversations.map((c) => `  ${usd(c.costUsd).padStart(8)}  ${compactTokens(c.tokens).padStart(6)}  ${c.away ? '[away] ' : ''}${c.private ? '(title hidden: not a workspace you ticked)' : c.title ?? c.session.slice(0, 8)} · ${short(c.workspace).split('/').pop()} · ${c.requests} request${c.requests === 1 ? '' : 's'} · ${c.start.slice(5, 10)}`),
  ];
  const cacheIn = v.total.input + v.total.cacheRead + v.total.cacheWrite;
  if (cacheIn) lines.push('', `Cache: ${Math.round((v.total.cacheRead / cacheIn) * 100)}% of input was read from the cache (cheap); ${compactTokens(v.total.cacheWrite)} written to it.`);
  if (v.unpriced) lines.push(`${v.unpriced} request(s) use a model with no price yet; counted as $0.`);
  return lines.join('\n');
}

// ---------- kinds of work, periods, comparisons, pull requests ----------

/**
 * What a request did, from the tools it called: works in any language and reads no text (codeburn guesses
 * from the words of your prompt instead). Order is priority: a request that edits and reads is "Coding".
 */
export const KINDS = ['Coding', 'Delegating', 'Research', 'Running commands', 'Reading code', 'Planning', 'Conversation'] as const;
export type Kind = (typeof KINDS)[number];
const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const READ = new Set(['Read', 'Grep', 'Glob', 'LS']);
const WEB = new Set(['WebSearch', 'WebFetch']);
const DELEGATE = new Set(['Task', 'Agent']);
const PLAN = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'ExitPlanMode', 'AskUserQuestion']);

export function kindOf(tools: string[] | undefined): Kind {
  const t = tools ?? [];
  if (t.some((x) => EDIT.has(x))) return 'Coding';
  if (t.some((x) => DELEGATE.has(x))) return 'Delegating';
  if (t.some((x) => WEB.has(x))) return 'Research';
  if (t.includes('Bash')) return 'Running commands';
  if (t.some((x) => READ.has(x))) return 'Reading code';
  if (t.some((x) => PLAN.has(x))) return 'Planning';
  return t.length ? 'Running commands' : 'Conversation';
}

export type Period = 'today' | '7d' | '30d' | 'month';
export const PERIODS: Period[] = ['today', '7d', '30d', 'month'];

/** Days a period covers, ending today: "month" is the 1st of this month to today. */
export function periodDays(p: Period, now: Date): number {
  return p === 'today' ? 1 : p === '7d' ? 7 : p === '30d' ? 30 : now.getDate();
}

export function byKind(ledger: Ledger, from: string, to: string): { kind: Kind; total: Tally }[] {
  const m = new Map<Kind, Tally>();
  for (const r of ledger.rows) {
    if (r.at < from || r.at > to) continue;
    const k = r.basis === 'recorded' ? 'Coding' : kindOf(r.tools); // away runs: cards change code
    add(m.get(k) ?? m.set(k, zero()).get(k)!, r);
  }
  return [...m].map(([kind, t]) => ({ kind, total: round(t) })).sort((a, b) => b.total.costUsd - a.total.costUsd);
}

export interface PrCost {
  repo: string;
  number: number;
  url: string;
  session: string;
  title: string | null;
  at: string;
  /** The conversation's requests from its previous PR (or its start) up to this one: what it took to open it. */
  total: Tally;
}

/** Cost per pull request opened in [from, to]. Titles follow the same rule as conversations. */
export function prCosts(ledger: Ledger, from: string, to: string, canShowTitle: (workspace: string) => boolean = () => true): PrCost[] {
  const bySession = new Map<string, PrLink[]>();
  for (const p of ledger.prs) (bySession.get(p.session) ?? bySession.set(p.session, []).get(p.session)!).push(p);
  const rowsBySession = new Map<string, UsageRow[]>();
  for (const r of ledger.rows) (rowsBySession.get(r.session) ?? rowsBySession.set(r.session, []).get(r.session)!).push(r);
  const out: PrCost[] = [];
  for (const [session, links] of bySession) {
    links.sort((a, b) => a.at.localeCompare(b.at));
    const rows = rowsBySession.get(session) ?? [];
    const main = rows.find((r) => !r.agent);
    links.forEach((p, i) => {
      if (p.at < from || p.at > to) return;
      const since = links[i - 1]?.at ?? '';
      const t = zero();
      for (const r of rows) if (r.at > since && r.at <= p.at) add(t, r);
      if (!t.requests) return; // a PR it only mentioned, with no work before it
      out.push({ repo: p.repo, number: p.number, url: p.url, session, title: main && canShowTitle(main.workspace) ? ledger.titles[session] ?? null : null, at: p.at, total: round(t) });
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** List prices per month (USD) by the plan label the quota reader reports; override with config `planPriceUsd`. */
export const PLAN_PRICES: Record<string, number> = { Pro: 20, 'Max 5x': 100, Max: 100, 'Max 20x': 200, Ultra: 200 };

export interface Compare {
  yesterday: Tally;
  /** Average of the 7 days before today. */
  avg7: Tally;
  vsYesterdayPct: number | null;
  month: {
    toDate: Tally;
    /** The same days of last month (1st to today's date), for pace. */
    lastMonthSameDays: Tally;
    vsLastMonthPct: number | null;
    /** This month's API value if the rest of the month goes like it has so far. */
    projectedUsd: number;
    plan: { label: string; priceUsd: number; multiple: number; projectedMultiple: number } | null;
  };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

export function compare(ledger: Ledger, now: Date, plan: { label: string | null; priceUsd: number | null }): Compare {
  const dayStart = (offset: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  const sum = (from: string, to: string) => {
    const t = zero();
    for (const r of ledger.rows) if (r.at >= from && r.at < to) add(t, r);
    return t;
  };
  const today = sum(dayStart(0), now.toISOString());
  const yesterday = sum(dayStart(-1), dayStart(0));
  const week = sum(dayStart(-7), dayStart(0));
  const avg7: Tally = { ...week, requests: Math.round(week.requests / 7), input: week.input / 7, output: week.output / 7, cacheRead: week.cacheRead / 7, cacheWrite: week.cacheWrite / 7, tokens: week.tokens / 7, costUsd: week.costUsd / 7 };
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const toDate = sum(monthStart, now.toISOString());
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(lastStart);
  lastEnd.setDate(Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  lastEnd.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  const lastMonthSameDays = sum(lastStart.toISOString(), lastEnd.toISOString());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = (now.getTime() - Date.parse(monthStart)) / 86400_000;
  const projectedUsd = elapsed > 0 ? (toDate.costUsd / elapsed) * daysInMonth : 0;
  const price = plan.priceUsd ?? (plan.label ? PLAN_PRICES[plan.label] ?? null : null);
  return {
    yesterday: round(yesterday),
    avg7: round(avg7),
    vsYesterdayPct: pct(today.costUsd, yesterday.costUsd),
    month: {
      toDate: round(toDate),
      lastMonthSameDays: round(lastMonthSameDays),
      vsLastMonthPct: pct(toDate.costUsd, lastMonthSameDays.costUsd),
      projectedUsd: Math.round(projectedUsd * 100) / 100,
      plan: price && plan.label ? { label: plan.label, priceUsd: price, multiple: Math.round((toDate.costUsd / price) * 10) / 10, projectedMultiple: Math.round((projectedUsd / price) * 10) / 10 } : null,
    },
  };
}

export function formatExtras(kinds: { kind: Kind; total: Tally }[], prs: PrCost[], c: Compare): string {
  const lines = ['', 'What the work was (by the tools each request used)'];
  const all = kinds.reduce((n, k) => n + k.total.costUsd, 0) || 1;
  for (const k of kinds) lines.push(`  ${usd(k.total.costUsd).padStart(8)}  ${String(Math.round((k.total.costUsd / all) * 100)).padStart(3)}%  ${k.kind}`);
  if (prs.length) {
    lines.push('', 'Pull requests (what the conversation spent until it opened each one)');
    for (const p of prs.slice(0, 10)) lines.push(`  ${usd(p.total.costUsd).padStart(8)}  ${p.repo.split('/').pop()}#${p.number}${p.title ? ` · ${p.title}` : ''} · ${p.at.slice(5, 10)}`);
  }
  const m = c.month;
  lines.push('', `Yesterday ${usd(c.yesterday.costUsd)} · 7-day average ${usd(c.avg7.costUsd)}${c.vsYesterdayPct === null ? '' : ` · today vs yesterday ${c.vsYesterdayPct > 0 ? '+' : ''}${c.vsYesterdayPct}%`}`);
  lines.push(`This month ${usd(m.toDate.costUsd)} so far${m.vsLastMonthPct === null ? '' : ` (${m.vsLastMonthPct > 0 ? '+' : ''}${m.vsLastMonthPct}% vs the same days last month)`} · on pace for ${usd(m.projectedUsd)}`);
  if (m.plan) lines.push(`Your ${m.plan.label} plan ($${m.plan.priceUsd}/month) has done ${m.plan.multiple}× its price in API-priced work this month; on pace for ${m.plan.projectedMultiple}×.`);
  return lines.join('\n');
}
