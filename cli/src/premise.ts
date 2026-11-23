// The premise (FEATURES §10, §11): how often a 5-hour window resets with capacity left while the weekly limit
// isn't what stops you. Chompyy's pitch rests on that number, so it's measured from your own quota readings, never
// assumed.
//
// quota-history.json keeps only 8 days, so every window that ends is also written to windows.jsonl, which is
// kept: one line per window, numbers only.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homePath } from './home.js';
import type { Sample } from './pacing.js';

export interface WindowEnd {
  kind: '5h' | 'week';
  /** When it reset (seconds since epoch). */
  resetsAt: number;
  /** % used when it reset. */
  usedPct: number;
  /** True when a reading came at or after the reset, or within 15 minutes before it: the final number is known. */
  exact: boolean;
  /** For a 5-hour window: the week's % used when it reset, and when that week resets. */
  weekUsedPct?: number;
  weekResetsAt?: number;
}

/** Anthropic's reset times wobble by a second or a minute (14:59:59 vs 15:00:00): the same window. */
const bucket = (resetsAt: number) => Math.floor((resetsAt + 300) / 600);
const key = (e: Pick<WindowEnd, 'kind' | 'resetsAt'>) => `${e.kind}:${bucket(e.resetsAt)}`;
const EXACT_MS = 15 * 60_000;

/**
 * Windows that have ended, from the readings. A reading after the reset that still shows the old window means no
 * new window has started yet, so its number is the final one. A window is only returned once its number can't
 * change any more: it is exact, or a newer window of the same kind has started.
 */
export function windowEnds(samples: Sample[], nowMs: number): WindowEnd[] {
  const groups = new Map<string, { kind: '5h' | 'week'; resetsAt: number; list: { at: number; usedPct: number; week?: Sample['week'] }[] }>();
  for (const s of samples) {
    for (const [kind, w] of [['5h', s.five], ['week', s.week]] as const) {
      if (!w) continue;
      const k = key({ kind, resetsAt: w.resetsAt });
      const g = groups.get(k) ?? { kind, resetsAt: w.resetsAt, list: [] };
      g.resetsAt = Math.max(g.resetsAt, w.resetsAt);
      g.list.push({ at: s.at, usedPct: w.usedPct, ...(kind === '5h' && s.week ? { week: s.week } : {}) });
      groups.set(k, g);
    }
  }
  const latest = { '5h': 0, week: 0 };
  for (const g of groups.values()) latest[g.kind] = Math.max(latest[g.kind], bucket(g.resetsAt));
  const ends: WindowEnd[] = [];
  for (const g of groups.values()) {
    const resetMs = g.resetsAt * 1000;
    if (resetMs > nowMs) continue; // still running
    const list = g.list.sort((a, b) => a.at - b.at);
    const before = list.filter((x) => x.at <= resetMs);
    const after = list.filter((x) => x.at > resetMs);
    const last = before.at(-1) ?? after[0]!;
    const exact = after.length > 0 || resetMs - last.at <= EXACT_MS;
    if (!exact && bucket(g.resetsAt) === latest[g.kind]) continue; // could still get a closer reading
    const usedPct = Math.max(...(after.length ? [...before, ...after] : before).map((x) => x.usedPct));
    const week = [...before, ...after].reverse().find((x) => x.week)?.week;
    ends.push({ kind: g.kind, resetsAt: g.resetsAt, usedPct, exact, ...(week ? { weekUsedPct: week.usedPct, weekResetsAt: week.resetsAt } : {}) });
  }
  return ends.sort((a, b) => a.resetsAt - b.resetsAt);
}

const logPath = () => homePath('windows.jsonl');

export function loadWindowLog(): WindowEnd[] {
  if (!existsSync(logPath())) return [];
  return readFileSync(logPath(), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as WindowEnd];
    } catch {
      return [];
    }
  });
}

/** Write the windows that ended and aren't in windows.jsonl yet. Returns how many were added. */
export function archiveWindowEnds(samples: Sample[], nowMs: number): number {
  const known = new Set(loadWindowLog().map(key));
  const fresh = windowEnds(samples, nowMs).filter((e) => !known.has(key(e)));
  if (fresh.length) appendFileSync(logPath(), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return fresh.length;
}

/** Everything known: the log plus what the current readings add. */
export function allWindowEnds(samples: Sample[], nowMs: number): WindowEnd[] {
  const byKey = new Map(loadWindowLog().map((e) => [key(e), e]));
  for (const e of windowEnds(samples, nowMs)) if (!byKey.has(key(e)) || (e.exact && !byKey.get(key(e))!.exact)) byKey.set(key(e), e);
  return [...byKey.values()].sort((a, b) => a.resetsAt - b.resetsAt);
}

/** A 5-hour window "had capacity left" at this much or more. */
export const LEFT_PCT = 20;
/** A week "wasn't binding" when it reset with at least this much left. */
export const WEEK_SLACK_PCT = 10;

export interface Premise {
  fiveHour: { ended: number; exact: number; medianLeftPct: number | null; withLeft: number };
  weeks: { resetsAt: number; leftPct: number; exact: boolean }[];
  /** The premise itself: exact 5-hour windows in finished weeks, and how many had LEFT_PCT+ left in a week that had slack. */
  premise: { windows: number; hits: number; sharePct: number | null };
}

export function premise(ends: WindowEnd[]): Premise {
  const five = ends.filter((e) => e.kind === '5h');
  const exact = five.filter((e) => e.exact);
  const left = exact.map((e) => 100 - e.usedPct).sort((a, b) => a - b);
  const median = left.length ? (left.length % 2 ? left[(left.length - 1) / 2]! : (left[left.length / 2 - 1]! + left[left.length / 2]!) / 2) : null;
  const weeks = ends.filter((e) => e.kind === 'week').map((e) => ({ resetsAt: e.resetsAt, leftPct: 100 - e.usedPct, exact: e.exact }));
  const weekOf = new Map(weeks.map((w) => [bucket(w.resetsAt), w]));
  const judged = exact.filter((e) => e.weekResetsAt !== undefined && weekOf.has(bucket(e.weekResetsAt)));
  const hits = judged.filter((e) => 100 - e.usedPct >= LEFT_PCT && weekOf.get(bucket(e.weekResetsAt!))!.leftPct >= WEEK_SLACK_PCT);
  return {
    fiveHour: { ended: five.length, exact: exact.length, medianLeftPct: median, withLeft: left.filter((l) => l >= LEFT_PCT).length },
    weeks,
    premise: { windows: judged.length, hits: hits.length, sharePct: judged.length ? Math.round((hits.length / judged.length) * 100) : null },
  };
}

const day = (sec: number) => new Date(sec * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

export function premiseText(p: Premise): string[] {
  const lines: string[] = [];
  const f = p.fiveHour;
  if (!f.ended && !p.weeks.length) return ['No 5-hour window has ended since Chompyy started reading your quota. Check back after the next reset.'];
  if (!f.ended) lines.push('5-hour windows: none ended yet.');
  else
    lines.push(
      `5-hour windows: ${f.ended} ended, ${f.exact} with a reading close enough to the reset to know the final number.`,
      f.exact ? `  Left at reset: median ${Math.round(f.medianLeftPct!)}%; ${f.withLeft} of ${f.exact} had ${LEFT_PCT}% or more left.` : '  None measured exactly yet.',
    );
  if (p.weeks.length) {
    lines.push('Weeks:');
    for (const w of p.weeks) lines.push(`  week to ${day(w.resetsAt)}: ${Math.round(w.leftPct)}% of the weekly allowance reset unused${w.exact ? '' : ' (at most: the last reading came before the reset)'}`);
  } else lines.push('Weeks: none finished yet, so the weekly side is still unknown.');
  const q = p.premise;
  lines.push(
    q.windows
      ? `The premise: ${q.hits} of ${q.windows} measured windows (${q.sharePct}%) reset with ${LEFT_PCT}%+ left in a week that still had ${WEEK_SLACK_PCT}%+ spare. That is capacity an away run could have used.`
      : 'The premise: not measurable yet (needs a finished week with measured windows in it).',
  );
  return lines;
}
