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
}

interface FileEntry {
  size: number;
  mtimeMs: number;
  rows: UsageRow[];
  titles: Record<string, string>;
}

interface UsageCache {
  version: number;
  files: Record<string, FileEntry>;
}

/** Bump when parsing or pricing changes, so old cached rows are re-read. */
export const CACHE_VERSION = 2;

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
export function parseSessionFile(file: string): { rows: UsageRow[]; titles: Record<string, string> } {
  const byKey = new Map<string, UsageRow>();
  const titles: Record<string, string> = {};
  let workspace = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    // Only rows that can matter are parsed; message rows are mostly text we don't read.
    const usage = line.includes('"usage"');
    if (!usage && !line.includes('"ai-title"')) continue;
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
    const msg = e.message as { id?: string; model?: string; usage?: Record<string, unknown> } | undefined;
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
    };
    const price = priceOf(row.model, row, u.speed === 'fast');
    row.costUsd = price ?? 0;
    if (price === null) row.basis = 'unpriced';
    const had = byKey.get(row.key);
    // Keep the largest (in practice the last) copy, but the first copy's time: when the request happened.
    if (!had) byKey.set(row.key, row);
    else if (total(row) >= total(had)) byKey.set(row.key, { ...row, at: had.at || row.at });
  }
  return { rows: [...byKey.values()], titles };
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
  for (const entry of Object.values(cache.files)) {
    Object.assign(titles, entry.titles);
    for (const r of entry.rows) {
      const had = byKey.get(r.key);
      if (!had || total(r) > total(had)) byKey.set(r.key, r);
    }
  }
  const rows = [...byKey.values(), ...awayRows(titles)];
  return { rows, titles, files: files.length, parsed };
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
  const all = zero();
  for (const r of inRange) {
    add(all, r);
    add(dayMap.get(localDay(r.at)) ?? zero(), r);
    add(ws.get(r.workspace) ?? ws.set(r.workspace, zero()).get(r.workspace)!, r);
    add(models.get(r.model) ?? models.set(r.model, zero()).get(r.model)!, r);
    let c = convs.get(r.session);
    if (!c) {
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
