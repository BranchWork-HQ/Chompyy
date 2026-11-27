// The detective, step 5: "did it work?" (research/detective/RULEBOOK.md §10). Every Advice card registered its
// check before it was applied (rule 7); this measures each one against it, from your own local files.
//
// The rules it keeps (M1–M3):
//   - Name the method, strongest first: a re-count of the thing that changed (deterministic), else before vs
//     after (can't separate the fix from anything else that week, and says so). Never added across methods.
//   - A saving is signed: a regression shows as a regression, never as zero and never as a saving.
//   - "Worked" means at least 70% of the promised saving; habits wait the two weeks their card names.
//   - Provenance: a settings change is re-read each time. If something changed it since, the saving is not claimed.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { Advice, SettingChange } from './advice.js';
import type { BoardData, Card } from './board.js';
import { coldReturns, configuredMcp, installedSkills, ruleS4, ruleS5, scan, tokensOf, type Scan } from './detect.js';
import { projectsDir } from './dream.js';

export type Verdict = 'too-early' | 'worked' | 'short' | 'no-change' | 'worse' | 'cant-tell';

export interface AdviceResult {
  /** When it was last measured. */
  at: string;
  verdict: Verdict;
  /** recount: the changed thing counted again (strongest). before-after: weeks compared (can't isolate the fix). */
  method: 'recount' | 'before-after';
  /** One plain sentence: what was measured, before → after, and the verdict. */
  line: string;
  before?: number;
  after?: number;
  /** Tokens, signed: before − after. A regression is negative. */
  saved?: number;
  /** What `saved` is per: "session start", "week". */
  per?: string;
  /** Settings advice only: is the change still as Chompyy left it? */
  provenance?: 'intact' | 'changed' | 'missing';
  /** When the verdict is due (habits). */
  dueAt?: string;
  /** A weaker method's reading, shown next to the first, never added to it. */
  also?: string;
}

const DAY = 86_400_000;
/** Habits: the window their card names ("two weeks on"). */
export const HABIT_DAYS = 14;
/** "Worked" = at least this share of the promised saving (codeburn `act`). */
export const WORKED_SHARE = 0.7;
/** Before/after on session starts: wait this long and for this many sessions. */
const MIN_DAYS = 3;
const MIN_SESSIONS = 5;

const k = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k` : `${Math.round(a)}`;
  return n < 0 ? `-${s}` : s;
};
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Before → after: which way it went, given the pre-registered bar for "worked". */
function verdictOf(before: number, after: number, worked: boolean): Verdict {
  if (worked) return 'worked';
  if (after < before) return 'short';
  if (after === before) return 'no-change';
  return 'worse';
}

const sessionsIn = (s: Scan, from: number, to: number) => s.sessions.filter((x) => x.turns[0]!.at >= from && x.turns[0]!.at < to);

// ---------- habits: before vs after, over the two weeks the card names ----------

/** C1: cold returns in the week before you started vs the second week after (the card: "two weeks on, a week has a third fewer"). */
export function checkC1(since: number, now: number, s: Scan): AdviceResult {
  const due = since + HABIT_DAYS * DAY;
  const before = coldReturns(s, since - 7 * DAY).filter((x) => x.at < since);
  const base = { at: new Date(now).toISOString(), method: 'before-after' as const, per: 'week', dueAt: new Date(due).toISOString() };
  if (!before.length) return { ...base, verdict: 'cant-tell', line: 'No cold returns in the week before you started, so there is nothing to compare against.' };
  const tokens = (xs: { tokens: number }[]) => xs.reduce((a, x) => a + x.tokens, 0);
  if (now < due) {
    const so = coldReturns(s, since);
    const days = Math.max(1, (now - since) / DAY);
    return {
      ...base,
      verdict: 'too-early',
      before: before.length,
      after: so.length,
      line: `So far ${plural(so.length, 'cold return')} in ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} (about ${Math.round((so.length * 7) / days)} a week), against ${before.length} the week before you started. The verdict comes on ${day(due)}.`,
    };
  }
  const week = coldReturns(s, since + 7 * DAY).filter((x) => x.at < due);
  const bar = Math.floor((before.length * 2) / 3);
  const verdict = verdictOf(before.length, week.length, week.length <= bar);
  const saved = tokens(before) - tokens(week);
  const nBefore = sessionsIn(s, since - 7 * DAY, since).length;
  const nAfter = sessionsIn(s, since + 7 * DAY, due).length;
  const said = {
    worked: 'it worked',
    short: `fewer, but not the third fewer the card asked for (${bar} or less)`,
    'no-change': 'no change',
    worse: 'more than before',
  }[verdict as 'worked' | 'short' | 'no-change' | 'worse'];
  return {
    ...base,
    verdict,
    before: before.length,
    after: week.length,
    saved,
    line: `Cold returns a week: ${before.length} → ${week.length} (${saved >= 0 ? `${k(saved)} fewer tokens rebuilt` : `${k(-saved)} more tokens rebuilt`}): ${said}.`,
    also: `You started ${nAfter} sessions that week and ${nBefore} the week before: a quieter week also means fewer cold returns, and before/after can't tell the two apart.`,
  };
}

const isRebuild = (t: { miss?: string }) => t.miss === 'tools_changed' || t.miss === 'messages_changed';
function rebuilds(s: Scan, from: number, to: number): { count: number; tokens: number } {
  let count = 0;
  let tokens = 0;
  for (const ses of s.sessions) {
    for (const t of ses.turns) {
      if (t.at < from || t.at >= to || !isRebuild(t)) continue;
      count++;
      tokens += t.missedTokens ?? t.cacheWrite;
    }
  }
  return { count, tokens };
}

/** C2: mid-session rebuilds, two weeks before vs two weeks after (the card: "it worked if there are none"). */
export function checkC2(since: number, now: number, s: Scan): AdviceResult {
  const due = since + HABIT_DAYS * DAY;
  const before = rebuilds(s, since - HABIT_DAYS * DAY, since);
  const after = rebuilds(s, since, Math.min(now, due));
  const base = { at: new Date(now).toISOString(), method: 'before-after' as const, per: 'two weeks', dueAt: new Date(due).toISOString(), before: before.count, after: after.count };
  if (!before.count) return { ...base, verdict: 'cant-tell', line: `No mid-session rebuilds in the two weeks before you started, so there is nothing to improve${after.count ? `; ${plural(after.count, 'has', 'have')} happened since` : ''}.` };
  if (now < due) {
    return { ...base, verdict: 'too-early', line: `So far ${plural(after.count, 'mid-session rebuild')} since you started, against ${before.count} in the two weeks before. The verdict comes on ${day(due)}.` };
  }
  const verdict = verdictOf(before.count, after.count, after.count === 0);
  const saved = before.tokens - after.tokens;
  return {
    ...base,
    verdict,
    saved,
    line: `Mid-session rebuilds in two weeks: ${before.count} → ${after.count} (${saved >= 0 ? `${k(saved)} fewer tokens re-cached` : `${k(-saved)} more tokens re-cached`}): ${verdict === 'worked' ? 'it worked' : verdict === 'worse' ? 'more than before' : 'not none, as the card asked'}.`,
  };
}

// ---------- settings and setup: re-count what changed ----------

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function valueAt(obj: Record<string, unknown>, key: string[]): unknown {
  let cur: unknown = obj;
  for (const p of key) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
  return cur;
}

/** M1: is every value still what Chompyy set? The first one that isn't, for the sentence. */
export function provenance(changes: SettingChange[]): { state: 'intact' | 'changed' | 'missing'; what?: string } {
  for (const c of changes) {
    if (!existsSync(c.file)) return { state: 'missing', what: `${c.file.replace(homedir(), '~')} is gone` };
    const json = readJson(c.file);
    const now = json ? valueAt(json, c.key) : undefined;
    if (JSON.stringify(now) !== JSON.stringify(c.to)) return { state: 'changed', what: `${c.key.at(-1)} is ${JSON.stringify(now ?? '(not set)')} again, not ${JSON.stringify(c.to)}` };
  }
  return { state: 'intact' };
}

/** Median first turn (what a session start costs), sessions started in [from, to). */
const startCost = (s: Scan, from: number, to: number) => {
  const xs = sessionsIn(s, from, to).map((x) => x.turns[0]!.cacheRead + x.turns[0]!.cacheWrite).filter((n) => n > 0);
  return { n: xs.length, median: median(xs) };
};

/** S3, a plugin turned off: re-count the plugin's skills that still load at a session start. */
export function checkPlugin(a: Advice, since: number, now: number, s: Scan | null): AdviceResult {
  const at = new Date(now).toISOString();
  const changes = a.changes ?? [];
  const id = changes[0]?.key.at(-1) ?? '';
  // Cards made before `baseline` existed: the promise is on the card's chart (Now − After).
  const bars = a.chart?.bars;
  const promised = a.baseline?.perStart ?? (bars?.length === 2 ? bars[0]!.value - bars[1]!.value : 0);
  const p = provenance(changes);
  if (p.state !== 'intact') {
    return { at, verdict: 'cant-tell', method: 'recount', provenance: p.state, line: `Not claimed: ${p.what}, so the plugin loads again (turned back on with /plugin, or by hand). Approve the card again if you still want it off.` };
  }
  const claudeDir = dirname(changes[0]!.file);
  const still = installedSkills(claudeDir).filter((x) => x.plugin === id).reduce((n, x) => n + x.descriptionTokens, 0);
  const saved = promised - still;
  const worked = promised > 0 && saved >= WORKED_SHARE * promised;
  const r: AdviceResult = {
    at,
    verdict: promised ? verdictOf(promised, still, worked) : 'cant-tell',
    method: 'recount',
    provenance: 'intact',
    before: promised,
    after: still,
    saved,
    per: 'session start',
    line: promised
      ? `Re-counted: the plugin's skills added ~${k(promised)} tokens to every session start, now ~${k(still)}${worked ? ': it worked.' : '.'} The setting is still as Chompyy left it.`
      : `Re-counted: its skills now add ~${k(still)} tokens to a session start. The card didn't record what they added before, so there's no verdict.`,
  };
  // The weaker method, beside it: whole session starts before vs after (moves with which projects you worked in).
  if (s && now - since >= MIN_DAYS * DAY) {
    const b = startCost(s, since - HABIT_DAYS * DAY, since);
    const n = startCost(s, since, now);
    if (b.n >= MIN_SESSIONS && n.n >= MIN_SESSIONS) {
      const d = b.median - n.median;
      r.also = `Whole session starts, median before → after: ${(b.median / 1000).toFixed(1)}k → ${(n.median / 1000).toFixed(1)}k (${d >= 0 ? `${Math.round(d)} smaller` : `${Math.round(-d)} bigger`}, ${n.n} sessions since). That also moves with which projects you worked in, so it isn't added to the re-count.`;
    }
  }
  return r;
}

/** S3, skills only you can turn off (synced from claude.ai, or your own): which of them still load. */
export function checkSkillsGone(a: Advice, now: number, claudeDir?: string, plan?: string | null): AdviceResult {
  const at = new Date(now).toISOString();
  // Cards made before `baseline` existed: the names are in the card's own instructions.
  const listed = plan?.match(/(?:the ones you don't use|~\/\.claude\/skills[^:]*): ([^\n]+?)\.(?: Then press|$)/m)?.[1];
  const names = a.baseline?.names ?? listed?.split(', ').map((x) => x.trim()).filter(Boolean) ?? [];
  if (!names.length) return { at, verdict: 'cant-tell', method: 'recount', line: "The card didn't record which skills, so there is nothing to re-count." };
  const loaded = installedSkills(claudeDir);
  const left = names.filter((n) => loaded.some((x) => x.name === n && x.source !== 'plugin'));
  const gone = names.length - left.length;
  const tokens = loaded.filter((x) => left.includes(x.name) && x.source !== 'plugin').reduce((n, x) => n + x.descriptionTokens, 0);
  const worked = gone >= WORKED_SHARE * names.length;
  return {
    at,
    verdict: verdictOf(names.length, left.length, worked),
    method: 'recount',
    before: names.length,
    after: left.length,
    line: left.length
      ? `Re-counted: ${gone} of the ${names.length} skills no longer load; ${plural(left.length, 'still does', 'still do')} (~${k(tokens)} tokens a session start): ${left.slice(0, 6).join(', ')}${left.length > 6 ? ', …' : ''}.${worked ? ' Enough to call it worked.' : ''}`
      : `Re-counted: none of the ${names.length} skills load any more: it worked.`,
  };
}

/** S2: re-measure the CLAUDE.md (the card: "under 200 lines and ~2k tokens"). */
export function checkClaudeMd(a: Advice, now: number): AdviceResult {
  const at = new Date(now).toISOString();
  const file = a.key.slice('S2:'.length);
  if (!existsSync(file)) return { at, verdict: 'cant-tell', method: 'recount', provenance: 'missing', line: `${file.replace(homedir(), '~')} is gone, so there is nothing to re-count.` };
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  const tokens = tokensOf(text);
  const before = a.baseline?.tokens;
  const worked = lines <= 200 && tokens <= 2000;
  const saved = before === undefined ? undefined : before - tokens;
  return {
    at,
    verdict: before === undefined ? (worked ? 'worked' : 'short') : verdictOf(before, tokens, worked),
    method: 'recount',
    ...(before === undefined ? {} : { before, saved }),
    after: tokens,
    per: 'session start there',
    line: `Re-counted: ${a.baseline?.lines ? `${a.baseline.lines} → ` : ''}${lines} lines, ${before === undefined ? '' : `~${k(before)} → `}~${k(tokens)} tokens${worked ? ': under 200 lines and 2k tokens, it worked.' : ': still over 200 lines or 2k tokens.'}`,
  };
}

/** S4 and S5: run the same rule again; it worked if the finding is gone (what the card registered). */
export function checkRuleAgain(a: Advice, now: number, s: Scan, root?: string): AdviceResult {
  const at = new Date(now).toISOString();
  const subject = (say: string) => say.split(' ')[0]!;
  if (a.rule === 'S5') {
    const file = subject(a.key.slice(3));
    const still = ruleS5(root).find((f) => subject(f.say) === file);
    return { at, verdict: still ? 'no-change' : 'worked', method: 'recount', line: still ? `Re-checked: ${still.say}` : `Re-checked: ${file} now fits in what Claude Code loads: it worked.` };
  }
  const still = ruleS4(s, configuredMcp(s.sessions.map((x) => x.cwd).filter(Boolean)));
  return { at, verdict: still.length ? 'no-change' : 'worked', method: 'recount', line: still.length ? `Re-checked: ${still[0]!.say}` : 'Re-checked: no configured MCP server goes unused any more: it worked.' };
}

// ---------- all cards ----------

/** The cards with something to measure: applied, being tried, or done (by you, or kept from an away run). */
export function measurable(c: Card): boolean {
  const a = c.advice;
  if (!a) return false;
  if (a.lane === 'work') return c.column === 'done' && c.outcome === 'kept';
  return a.state === 'applied' || a.state === 'trying' || a.state === 'done';
}

/** When the clock started: when it was applied, approved, or kept. */
const startOf = (c: Card) => Date.parse(c.advice!.since ?? c.approvedAt ?? c.updatedAt) || 0;

/** A habit's verdict, once due, is final (the transcripts behind it get cleaned up later). Re-counts run every time. */
const settled = (r?: AdviceResult) => Boolean(r && r.method === 'before-after' && r.verdict !== 'too-early');

/** Measure every applied/tried/done advice card and write the result on it. Returns the cards measured. */
export function checkWorked(board: BoardData, now: Date, opts: { root?: string; claudeDir?: string } = {}): Card[] {
  const cards = board.cards.filter(measurable);
  if (!cards.length) return [];
  const t = now.getTime();
  // One scan covering the earliest card's "before" window.
  const earliest = Math.min(...cards.map(startOf));
  const needsScan = cards.some((c) => ['C1', 'C2', 'S3', 'S4'].includes(c.advice!.rule) && !settled(c.advice!.result));
  const days = Math.ceil((t - earliest) / DAY) + HABIT_DAYS + 1;
  const root = opts.root ?? projectsDir();
  const s = needsScan ? scan({ days: Math.max(30, days), now, root }) : null;
  for (const c of cards) {
    const a = c.advice!;
    if (settled(a.result)) continue;
    const since = startOf(c);
    if (a.rule === 'C1') a.result = checkC1(since, t, s!);
    else if (a.rule === 'C2') a.result = checkC2(since, t, s!);
    else if (a.rule === 'S3' && a.lane === 'settings') a.result = checkPlugin(a, since, t, s);
    else if (a.rule === 'S3') a.result = checkSkillsGone(a, t, opts.claudeDir, c.blueprint);
    else if (a.rule === 'S2') a.result = checkClaudeMd(a, t);
    else if (a.rule === 'S4' || a.rule === 'S5') a.result = checkRuleAgain(a, t, s ?? scan({ now, root }), root);
  }
  return cards;
}

const ICON: Record<Verdict, string> = { 'too-early': '⏳', worked: '✅', short: '🟡', 'no-change': '➖', worse: '🔻', 'cant-tell': '❔' };

/** One screen: each fix, its verdict, and the saving by method (never added across methods). */
export function workedText(cards: Card[]): string {
  if (!cards.length) return 'Nothing to measure yet: approve an advice card (chompyy advise), and Chompyy checks it against the numbers on the card.';
  const lines = ['Did it work? Each fix against the check written on its card before it was applied.', ''];
  for (const c of cards) {
    const r = c.advice!.result;
    if (!r) continue;
    lines.push(`${ICON[r.verdict]} #${c.id} ${c.title}`, `   ${r.line}`);
    if (r.also) lines.push(`   ${r.also}`);
    if (r.verdict === 'worse' && c.advice!.lane === 'settings') lines.push(`   It went the wrong way: chompyy undo ${c.id} puts it back.`);
  }
  const recount = cards.map((c) => c.advice!.result).filter((r) => r?.method === 'recount' && r.per === 'session start' && r.saved !== undefined && r.verdict !== 'cant-tell');
  const weekly = cards.map((c) => c.advice!.result).filter((r) => r?.method === 'before-after' && r.per === 'week' && r.saved !== undefined);
  if (recount.length || weekly.length) lines.push('');
  if (recount.length) {
    const sum = recount.reduce((n, r) => n + r!.saved!, 0);
    lines.push(`Re-counted (strongest): ${sum >= 0 ? `~${k(sum)} tokens off` : `~${k(-sum)} tokens added to`} every session start, from ${plural(recount.length, 'fix', 'fixes')}.`);
  }
  if (weekly.length) {
    const sum = weekly.reduce((n, r) => n + r!.saved!, 0);
    lines.push(`Before/after (can't isolate the fix): ${sum >= 0 ? `${k(sum)} fewer` : `${k(-sum)} more`} tokens rebuilt a week. Not added to the re-count.`);
  }
  return lines.join('\n');
}

