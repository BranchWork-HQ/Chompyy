// Live suggestions while you work (FEATURES.md, "live evidence-based suggestions"). The first one: coming back
// to a big conversation after its cache expired. detect's C1 counts what that cost after the fact; this stops the
// first message once, at the moment it would happen, with the price and the cheaper ways on. Send it again and it
// goes through. Runs as Claude Code's UserPromptSubmit hook (`chompyy nudge on` installs it); away runs turn
// hooks off, so it never touches them.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { formatDuration } from './duration.js';
import { appendJsonl, homePath } from './home.js';
import { coldReturns, isAutomated, scan } from './detect.js';
import { projectsDir } from './dream.js';

/** The main conversation's cache lives an hour (5 minutes on API keys): past an hour it's cold either way. */
export const COLD_AFTER_MS = 60 * 60_000;
/** Below this the rebuild is cheap; not worth stopping you. */
export const MIN_CONTEXT = 40_000;
/** Warn this long into a pause: still time to /compact while the cache is warm (reads at a tenth of the price). */
export const WARN_AFTER_MS = 45 * 60_000;
const MARK = '# chompyy nudge';
/** Sent anyway this many stops in a row in one project: stop stopping you there (a heads-up instead). */
export const QUIET_AFTER = 3;

// ---------- what Chompyy learned from you: per project ----------

export interface NudgePrefs {
  /** When live suggestions were turned on: the "before" for did-it-work. */
  onAt?: string;
  /** Projects you asked to always stop (overrides learning) or never stop. */
  strict?: string[];
  quiet?: string[];
}

const prefsPath = () => homePath('nudge-prefs.json');
export function loadPrefs(): NudgePrefs {
  try {
    return JSON.parse(readFileSync(prefsPath(), 'utf8')) as NudgePrefs;
  } catch {
    return {};
  }
}
export function savePrefs(p: NudgePrefs): void {
  writeFileSync(prefsPath(), JSON.stringify(p, null, 2) + '\n');
}

/** `chompyy nudge strict|quiet|learn <dir>`: always stop here, never stop here, or go back to learning. */
export function setProjectMode(mode: 'strict' | 'quiet' | 'learn', cwd: string): string {
  const p = loadPrefs();
  p.strict = (p.strict ?? []).filter((x) => x !== cwd);
  p.quiet = (p.quiet ?? []).filter((x) => x !== cwd);
  if (mode !== 'learn') p[mode] = [...p[mode]!, cwd];
  savePrefs(p);
  const name = basename(cwd);
  return mode === 'strict' ? `${name}: Chompyy always stops a cold return here.` : mode === 'quiet' ? `${name}: a one-line heads-up only, never a stop.` : `${name}: back to learning from what you do.`;
}

/**
 * Should Chompyy stop you in this project, or only give a heads-up? Your choice first; otherwise it learns: after
 * QUIET_AFTER stops in a row here that you sent anyway, being stopped isn't helping you, so it stops stopping.
 */
export function learnedQuiet(cwd: string, events: NudgeEvent[], prefs = loadPrefs()): { quiet: boolean; why: 'you' | 'learned' | null; sentInARow: number } {
  if (prefs.strict?.includes(cwd)) return { quiet: false, why: 'you', sentInARow: 0 };
  if (prefs.quiet?.includes(cwd)) return { quiet: true, why: 'you', sentInARow: 0 };
  const here = outcomes(events.filter((e) => e.cwd === cwd));
  let n = 0;
  for (const o of [...here].reverse()) {
    if (o.did !== 'sent') break;
    n++;
  }
  return { quiet: n >= QUIET_AFTER, why: n >= QUIET_AFTER ? 'learned' : null, sentInARow: n };
}

export function quietText(e: Pick<NudgeEvent, 'context' | 'cwd'>, first: boolean): string {
  const name = basename(e.cwd ?? '');
  return first
    ? `🍪 You sent anyway the last ${QUIET_AFTER} times in ${name}, so Chompyy won't stop you here any more (${k(e.context)} rewritten now). To be stopped again: chompyy nudge strict`
    : `🍪 Cold cache: this message rewrites ${k(e.context)} tokens.`;
}

export interface Reply {
  at: number;
  /** Tokens the request sent: what a cold cache writes again. */
  context: number;
  cacheWrite: number;
}

export interface NudgeEvent {
  at: string;
  /** quiet: let through with a one-line heads-up, because you sent anyway the last times in this project. */
  kind: 'stopped' | 'sent' | 'warned' | 'quiet';
  /** The project folder, so Chompyy learns per project. */
  cwd?: string;
  /** warned: when the cache goes cold. */
  coldAt?: string;
  project?: string;
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
export function decide(input: HookInput, now: number, events = loadNudges(), prefs = loadPrefs()): { block: false } | { block: true; reason: string; event: NudgeEvent } | { block: false; event: NudgeEvent; notice?: string } {
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
  let cwd = '';
  try {
    cwd = cwdOf(transcript);
  } catch {}
  const base = { session, transcript, idleMs, context: last.context, ...(fresh ? { fresh } : {}), ...(cwd ? { cwd } : {}) };
  // Already stopped once for this break: you chose to send it.
  if (events.some((e) => e.kind === 'stopped' && e.session === session && Date.parse(e.at) > last.at)) {
    return { block: false, event: { at: new Date(now).toISOString(), kind: 'sent', ...base } };
  }
  // Learned per project: if stopping you here never helped, a one-line heads-up instead.
  if (cwd && learnedQuiet(cwd, events, prefs).quiet) {
    const event: NudgeEvent = { at: new Date(now).toISOString(), kind: 'quiet', ...base };
    const first = !events.some((e) => e.kind === 'quiet' && e.cwd === cwd);
    return { block: false, event, notice: quietText(event, first) };
  }
  const event: NudgeEvent = { at: new Date(now).toISOString(), kind: 'stopped', ...base };
  return { block: true, reason: reasonText(event), event };
}

export function reasonText(e: Pick<NudgeEvent, 'idleMs' | 'context' | 'fresh'>): string {
  return [
    `🍪 /compact first: idle ${formatDuration(e.idleMs)}, the cache expired, so sending rewrites all ${k(e.context)} tokens.`,
    `Or /clear and say where you were${e.fresh ? ` (~${k(e.fresh)})` : ''}. Or send again: Chompyy stops once per break.`,
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
  if (d.block) return JSON.stringify({ decision: 'block', reason: d.reason });
  return 'notice' in d && d.notice ? JSON.stringify({ systemMessage: d.notice }) : '';
}

// ---------- before it goes cold: the menu bar app asks every minute ----------

export interface GoingCold {
  session: string;
  transcript: string;
  project: string;
  context: number;
  fresh?: number;
  idleMs: number;
  coldAt: string;
}

/**
 * Conversations 45-60 minutes into a pause, big enough to matter: each break is reported once (logged as `warned`),
 * so the app can notify without keeping its own list. Looks only at transcripts written in the last hour.
 */
export function goingCold(now = Date.now(), dir = projectsDir(), events = loadNudges()): GoingCold[] {
  const out: GoingCold[] = [];
  let folders: string[] = [];
  try {
    folders = readdirSync(dir).filter((f) => !isAutomated(f));
  } catch {
    return out;
  }
  for (const folder of folders) {
    let files: string[] = [];
    try {
      files = readdirSync(join(dir, folder)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const transcript = join(dir, folder, f);
      try {
        const mtime = statSync(transcript).mtimeMs;
        if (now - mtime > COLD_AFTER_MS || now - mtime < WARN_AFTER_MS - 60_000) continue;
        const { last, first } = replies(transcript);
        if (!last || last.context < MIN_CONTEXT) continue;
        const idleMs = now - last.at;
        if (idleMs < WARN_AFTER_MS || idleMs >= COLD_AFTER_MS) continue;
        const session = f.replace(/\.jsonl$/, '');
        if (events.some((e) => e.kind === 'warned' && e.session === session && Date.parse(e.at) > last.at)) continue;
        const cwd = cwdOf(transcript);
        const fresh = first && first.context < last.context / 2 ? first.context : undefined;
        out.push({ session, transcript, project: cwd ? basename(cwd) : folder, context: last.context, ...(fresh ? { fresh } : {}), idleMs, coldAt: new Date(last.at + COLD_AFTER_MS).toISOString() });
      } catch {
        /* one bad file never hides the others */
      }
    }
  }
  return out;
}

function cwdOf(transcript: string): string {
  const m = slice(transcript, 64 << 10, true).match(/"cwd":"((?:[^"\\]|\\.)*)"/g);
  const last = m?.[m.length - 1];
  return last ? (JSON.parse(`{${last}}`) as { cwd: string }).cwd : '';
}

/** Report each conversation once: log it, return it. */
export function takeGoingCold(now = Date.now()): GoingCold[] {
  const due = goingCold(now);
  for (const d of due) {
    try {
      appendJsonl(homePath('nudges.jsonl'), { at: new Date(now).toISOString(), kind: 'warned', session: d.session, transcript: d.transcript, idleMs: d.idleMs, context: d.context, coldAt: d.coldAt, project: d.project, ...(d.fresh ? { fresh: d.fresh } : {}) } satisfies NudgeEvent);
    } catch {
      /* still report it */
    }
  }
  return due;
}

/** The notification: what's at stake and the one move that pays now. */
export function coldWarningText(d: GoingCold): { title: string; body: string } {
  const at = new Date(d.coldAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return {
    title: `${d.project}: /compact before ${at}`,
    body: `After ${at} its cache expires and coming back rewrites all ${k(d.context)}. Done with it? Do nothing.`,
  };
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

/** After a warning: compacted while warm (the later return is small), carried on, came back cold, or left. */
export interface WarnOutcome {
  event: NudgeEvent;
  did: 'compacted' | 'continued' | 'cold' | 'left';
  saved: number;
}

export function warnOutcomes(events = loadNudges()): WarnOutcome[] {
  return events.filter((e) => e.kind === 'warned').map((event) => {
    const coldAt = Date.parse(event.coldAt ?? '') || Date.parse(event.at) + 15 * 60_000;
    let next: Reply | null = null;
    try {
      for (const line of readFileSync(event.transcript, 'utf8').split('\n')) {
        const r = replyOf(line);
        if (r && r.at > Date.parse(event.at)) {
          next = r;
          break;
        }
      }
    } catch {
      /* transcript gone */
    }
    if (!next) return { event, did: 'left', saved: 0 };
    if (next.at >= coldAt) return { event, did: 'cold', saved: 0 };
    if (next.context < event.context / 2) return { event, did: 'compacted', saved: event.context - next.context };
    return { event, did: 'continued', saved: 0 };
  });
}

const WEEK = 7 * 86_400_000;

/** What the app's "Saved" line shows: the measured trend in cold returns, and what the nudges led to. */
export interface Impact {
  on: boolean;
  thisWeek: { count: number; tokens: number };
  lastWeek: { count: number; tokens: number };
  stops: Outcome[];
  warnings: WarnOutcome[];
  saved: number;
  line: string;
}

export function impact(on = nudgeInstalled(), now = Date.now(), root?: string, events = loadNudges()): Impact {
  const s = scan({ days: 14, now: new Date(now), ...(root ? { root } : {}) });
  const all = coldReturns(s, now - 2 * WEEK);
  const sum = (from: number, to: number) => {
    const xs = all.filter((x) => x.at >= from && x.at < to);
    return { count: xs.length, tokens: xs.reduce((a, x) => a + x.tokens, 0) };
  };
  const thisWeek = sum(now - WEEK, Infinity);
  const lastWeek = sum(now - 2 * WEEK, now - WEEK);
  const stops = outcomes(events);
  const warnings = warnOutcomes(events);
  const saved = [...stops, ...warnings].filter((o) => now - Date.parse(o.event.at) < WEEK).reduce((a, o) => a + o.saved, 0);
  const trend = `Cold returns: ${thisWeek.count} this week (${k(thisWeek.tokens)}), ${lastWeek.count} last week (${k(lastWeek.tokens)}).`;
  const line = saved ? `~${k(saved)} tokens saved this week. ${trend}` : trend;
  return { on, thisWeek, lastWeek, stops, warnings, saved, line };
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
  const events = list.map((o) => o.event);
  const prefs = loadPrefs();
  for (const cwd of new Set(events.map((e) => e.cwd).filter((c): c is string => Boolean(c)))) {
    const q = learnedQuiet(cwd, loadNudges(), prefs);
    if (q.quiet) lines.push(`Heads-up only in ${basename(cwd)} (${q.why === 'you' ? 'you asked' : `you sent anyway ${QUIET_AFTER} times in a row`}). Stop me again: chompyy nudge strict ${cwd}`);
  }
  lines.push('Did it work? chompyy worked');
  return lines.join('\n');
}

// ---------- installing the hook in Claude Code's settings ----------

export const claudeSettingsPath = () => process.env.CHOMPYY_CLAUDE_SETTINGS || join(homedir(), '.claude', 'settings.json');
const settingsPath = claudeSettingsPath;

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

const nudgeInstalledBefore = (raw: string | null) => Boolean(raw?.includes(MARK));

/** When live suggestions were turned on: recorded since this version; before that, the settings backup `nudge on` made, else the first event. */
export function nudgeOnSince(events = loadNudges(), path = settingsPath()): number | null {
  const at = Date.parse(loadPrefs().onAt ?? '');
  if (at) return at;
  try {
    return statSync(`${path}.chompyy-backup`).mtimeMs;
  } catch {}
  return events.length ? Date.parse(events[0]!.at) : null;
}

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
  try {
    const p = loadPrefs();
    if (on && !nudgeInstalledBefore(raw)) savePrefs({ ...p, onAt: new Date().toISOString() });
  } catch {}
  return on
    ? `On. Added a UserPromptSubmit hook to ${path.replace(homedir(), '~')} (the old file is saved next to it as .chompyy-backup). Conversations already open may need a restart to pick it up.`
    : `Off. Removed Chompyy's hook from ${path.replace(homedir(), '~')}; your other hooks are untouched.`;
}
