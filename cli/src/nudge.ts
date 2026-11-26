// Live suggestions while you work (FEATURES.md, "live evidence-based suggestions"). The first one: coming back
// to a big conversation after its cache expired. detect's C1 counts what that cost after the fact; this stops the
// first message once, at the moment it would happen, with the price and the cheaper ways on. Send it again and it
// goes through. Runs as Claude Code's UserPromptSubmit hook (`chompyy nudge on` installs it); away runs turn
// hooks off, so it never touches them.
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatDuration } from './duration.js';
import { appendJsonl, homePath } from './home.js';

/** The main conversation's cache lives an hour (5 minutes on API keys): past an hour it's cold either way. */
export const COLD_AFTER_MS = 60 * 60_000;
/** Below this the rebuild is cheap; not worth stopping you. */
export const MIN_CONTEXT = 40_000;
const MARK = '# chompyy nudge';

export interface Reply {
  at: number;
  /** Tokens the request sent: what a cold cache writes again. */
  context: number;
  cacheWrite: number;
}

export interface NudgeEvent {
  at: string;
  kind: 'stopped' | 'sent';
  session: string;
  transcript: string;
  idleMs: number;
  context: number;
  fresh?: number;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function replyOf(line: string): Reply | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  try {
    const e = JSON.parse(line) as { type?: string; isSidechain?: boolean; timestamp?: string; message?: { usage?: Record<string, unknown> } };
    const u = e.message?.usage;
    if (e.type !== 'assistant' || e.isSidechain || !u) return null;
    const at = Date.parse(String(e.timestamp ?? ''));
    if (!at) return null;
    const cacheWrite = num(u.cache_creation_input_tokens);
    return { at, context: num(u.input_tokens) + num(u.cache_read_input_tokens) + cacheWrite, cacheWrite };
  } catch {
    return null;
  }
}

/** Bytes from the start or the end of a file, without reading all of a long transcript. */
function slice(file: string, bytes: number, fromEnd: boolean): string {
  const size = statSync(file).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, len, fromEnd ? size - len : 0);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8');
}

/** The conversation's last reply, and its first (about what a fresh conversation costs: tools, CLAUDE.md, memory). */
export function replies(transcript: string): { last: Reply | null; first: Reply | null } {
  const tail = slice(transcript, 4 << 20, true).split('\n');
  let last: Reply | null = null;
  for (let i = tail.length - 1; i >= 0 && !last; i--) last = replyOf(tail[i]!);
  let first: Reply | null = null;
  for (const line of slice(transcript, 2 << 20, false).split('\n')) if ((first = replyOf(line))) break;
  return { last, first };
}

export function loadNudges(): NudgeEvent[] {
  const path = homePath('nudges.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').flatMap((l) => {
    try {
      return l ? [JSON.parse(l) as NudgeEvent] : [];
    } catch {
      return [];
    }
  });
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  prompt?: string;
}

/**
 * What to tell Claude Code about this prompt: a block with the reason, or nothing (let it through).
 * Never throws: any doubt lets the prompt through.
 */
export function decide(input: HookInput, now: number, events = loadNudges()): { block: false } | { block: true; reason: string; event: NudgeEvent } | { block: false; event: NudgeEvent } {
  const prompt = (input.prompt ?? '').trimStart();
  const transcript = input.transcript_path;
  const session = input.session_id ?? '';
  // Commands, shell lines and messages Claude Code sends itself (scheduled tasks, agents reporting back).
  if (!transcript || /^[/!<]/.test(prompt) || process.env.CHOMPYY_NUDGE === '0') return { block: false };
  let last: Reply | null;
  let first: Reply | null;
  try {
    if (!existsSync(transcript)) return { block: false };
    ({ last, first } = replies(transcript));
  } catch {
    return { block: false };
  }
  if (!last) return { block: false };
  const idleMs = now - last.at;
  if (idleMs <= COLD_AFTER_MS || last.context < MIN_CONTEXT) return { block: false };
  const fresh = first && first.context < last.context / 2 ? first.context : undefined;
  const base = { session, transcript, idleMs, context: last.context, ...(fresh ? { fresh } : {}) };
  // Already stopped once for this break: you chose to send it.
  if (events.some((e) => e.kind === 'stopped' && e.session === session && Date.parse(e.at) > last.at)) {
    return { block: false, event: { at: new Date(now).toISOString(), kind: 'sent', ...base } };
  }
  const event: NudgeEvent = { at: new Date(now).toISOString(), kind: 'stopped', ...base };
  return { block: true, reason: reasonText(event), event };
}

export function reasonText(e: Pick<NudgeEvent, 'idleMs' | 'context' | 'fresh'>): string {
  return [
    `🍪 Chompyy: this conversation sat for ${formatDuration(e.idleMs)}, so its cache has expired.`,
    `Sending now writes all ${k(e.context)} tokens of it again${e.fresh ? ` (a new conversation starts at about ${k(e.fresh)})` : ''}.`,
    'Cheaper:',
    `  /clear, then a line or two on where you were${e.fresh ? `: about ${k(e.fresh)}` : ''}`,
    '  /compact, then carry on: one more full read, then every message after it is small',
    'Or send it again as it is: Chompyy stops a conversation only once per break.',
  ].join('\n');
}

/** The hook itself: stdin JSON in, a block decision (or nothing) out. Always exits cleanly. */
export function runHook(stdin: string, now = Date.now()): string {
  let input: HookInput;
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    return '';
  }
  const d = decide(input, now);
  if ('event' in d) {
    try {
      appendJsonl(homePath('nudges.jsonl'), d.event);
    } catch {
      /* logging never stops a prompt */
    }
  }
  return d.block ? JSON.stringify({ decision: 'block', reason: d.reason }) : '';
}

// ---------- impact: what happened after each stop ----------

export interface Outcome {
  event: NudgeEvent;
  did: 'sent' | 'compacted' | 'left';
  /** Tokens not written again (estimated). */
  saved: number;
}

/** Read each stopped conversation after the stop: sent anyway, carried on small (compacted), or left. */
export function outcomes(events = loadNudges()): Outcome[] {
  const stops = events.filter((e) => e.kind === 'stopped');
  return stops.map((event, i) => {
    const next = stops.slice(i + 1).find((s) => s.session === event.session);
    const until = next ? Date.parse(next.at) : Infinity;
    const wasSent = events.some((e) => e.kind === 'sent' && e.session === event.session && Date.parse(e.at) > Date.parse(event.at) && Date.parse(e.at) < until);
    if (wasSent) return { event, did: 'sent', saved: 0 };
    let after: Reply | null = null;
    try {
      for (const line of readFileSync(event.transcript, 'utf8').split('\n')) {
        const r = replyOf(line);
        if (r && r.at > Date.parse(event.at) && r.at < until) {
          after = r;
          break;
        }
      }
    } catch {
      /* transcript gone: count it as left */
    }
    if (after) return { event, did: after.cacheWrite < event.context / 2 ? 'compacted' : 'sent', saved: Math.max(0, event.context - after.cacheWrite) };
    return { event, did: 'left', saved: Math.max(0, event.context - (event.fresh ?? 0)) };
  });
}

export function nudgeText(on: boolean, list = outcomes(), now = Date.now()): string {
  const lines = [on ? 'Live suggestions are on: Chompyy stops the first message to a big conversation whose cache expired.' : 'Live suggestions are off. `chompyy nudge on` turns them on.'];
  const recent = list.filter((o) => now - Date.parse(o.event.at) < 30 * 86_400_000);
  if (!recent.length) {
    lines.push(on ? 'No stops yet. They come when you return to a conversation of 40k+ tokens after more than an hour.' : '');
    return lines.filter(Boolean).join('\n');
  }
  const n = (d: Outcome['did']) => recent.filter((o) => o.did === d).length;
  const saved = recent.reduce((a, o) => a + o.saved, 0);
  const rebuilt = recent.filter((o) => o.did === 'sent').reduce((a, o) => a + o.event.context, 0);
  lines.push(
    `Last 30 days: stopped ${recent.length} time${recent.length === 1 ? '' : 's'}. You compacted ${n('compacted')}, left or started fresh ${n('left')}, sent anyway ${n('sent')}.`,
    `${saved ? `About ${k(saved)} tokens not written again` : 'Nothing saved yet'}${rebuilt ? `; ${k(rebuilt)} rebuilt when you sent anyway` : ''}.`,
  );
  return lines.join('\n');
}

// ---------- installing the hook in Claude Code's settings ----------

const settingsPath = () => join(process.env.CHOMPYY_CLAUDE_SETTINGS || join(homedir(), '.claude', 'settings.json'));

type HookGroup = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };

function readSettings(path: string): { settings: Record<string, unknown>; raw: string | null } {
  if (!existsSync(path)) return { settings: {}, raw: null };
  const raw = readFileSync(path, 'utf8');
  try {
    return { settings: JSON.parse(raw) as Record<string, unknown>, raw };
  } catch {
    throw new Error(`${path} isn't valid JSON, so Chompyy left it alone.`);
  }
}

const groups = (s: Record<string, unknown>): HookGroup[] => {
  const hooks = (s.hooks ?? {}) as Record<string, unknown>;
  return Array.isArray(hooks.UserPromptSubmit) ? (hooks.UserPromptSubmit as HookGroup[]) : [];
};
const ours = (g: HookGroup) => (g.hooks ?? []).some((h) => h.command?.includes(MARK));

export function nudgeInstalled(path = settingsPath()): boolean {
  try {
    return groups(readSettings(path).settings).some(ours);
  } catch {
    return false;
  }
}

/** The command the hook runs: this CLI by absolute path. A copy npx unpacked for one run can vanish, so not that. */
export function hookCommand(script = process.argv[1] ?? '', node = process.execPath): string {
  const real = existsSync(script) ? realpathSync(script) : script;
  if (/[\\/]_npx[\\/]/.test(real)) throw new Error('This is a one-off npx copy. Install Chompyy first (npm install -g chompyy), then run chompyy nudge on.');
  return `"${node}" "${real}" hook prompt ${MARK}`;
}

/** Add (or remove) the hook in ~/.claude/settings.json, keeping every other hook. Backs the file up first. */
export function setNudge(on: boolean, command?: string, path = settingsPath()): string {
  const { settings, raw } = readSettings(path);
  const hooks = { ...((settings.hooks ?? {}) as Record<string, unknown>) };
  const kept = groups(settings).filter((g) => !ours(g));
  const list = on ? [...kept, { hooks: [{ type: 'command', command: command ?? hookCommand(), timeout: 10 }] }] : kept;
  if (list.length) hooks.UserPromptSubmit = list;
  else delete hooks.UserPromptSubmit;
  if (Object.keys(hooks).length) settings.hooks = hooks;
  else delete settings.hooks;
  if (raw !== null) writeFileSync(`${path}.chompyy-backup`, raw);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return on
    ? `On. Added a UserPromptSubmit hook to ${path.replace(homedir(), '~')} (the old file is saved next to it as .chompyy-backup). Conversations already open may need a restart to pick it up.`
    : `Off. Removed Chompyy's hook from ${path.replace(homedir(), '~')}; your other hooks are untouched.`;
}
