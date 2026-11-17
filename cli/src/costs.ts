// Cost ranges and trends (spec §5.4, FEATURES §5–6).
//
// Each away run records what it cost in your own currency: the % of the 5-hour window (and the week) it used,
// read from quota before and after the card. Models predict their own spend poorly (r ≤ 0.39), so a card's
// cost is a range from similar past runs, which narrows as history grows. The quota delta also counts anything
// else you did in that window at the same time, so it is an upper bound.
import { existsSync, readFileSync } from 'node:fs';
import type { Card, RunStatus } from './board.js';
import { formatDuration } from './duration.js';
import { appendJsonl, homePath } from './home.js';
import type { QuotaWindow } from './quota.js';
import type { Signal } from './taste.js';

export interface RunRecord {
  at: string;
  card: string;
  title: string;
  idea: string;
  cwd: string;
  status: RunStatus;
  durationMs: number;
  /** Points of the 5-hour window the run used; null when the window reset mid-run or quota was unknown. */
  fiveHourPct: number | null;
  weeklyPct: number | null;
}

export function runsPath(): string {
  return homePath('runs.jsonl');
}

export function readRuns(): RunRecord[] {
  const path = runsPath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l) as RunRecord] : [];
      } catch {
        return [];
      }
    });
}

export function recordRun(r: RunRecord): void {
  appendJsonl(runsPath(), r);
}

/** Used points between two readings of the same window; null if it reset in between or either is unknown. */
export function usedBetween(before: QuotaWindow | undefined, after: QuotaWindow | undefined): number | null {
  if (!before || !after || before.resetsAt !== after.resetsAt) return null;
  return Math.max(0, Math.round((after.usedPct - before.usedPct) * 10) / 10);
}

const STOP = new Set('a an and the to of in for on with from by is it this that be as at or into add make write update fix use new'.split(' '));

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Nearest-rank percentile of sorted values. */
function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export interface CostRange {
  /** Points of a 5-hour window. */
  low: number;
  high: number;
  durationLowMs: number;
  durationHighMs: number;
  /** How many past runs it is based on. */
  n: number;
  basis: 'similar' | 'all';
}

export const MIN_SIMILARITY = 0.15;

/**
 * A cost range for a card from past runs: the most similar ones (same words in title and idea, same project
 * counts extra) when there are at least 3, else all runs. P10–P90 once there are 5+ runs, min–max before.
 */
export function costRange(card: Pick<Card, 'id' | 'title' | 'idea' | 'cwd'>, runs: RunRecord[]): CostRange | null {
  const known = runs.filter((r) => r.fiveHourPct !== null && r.card !== card.id && r.status !== 'error');
  if (known.length < 2) return null;
  const mine = words(`${card.title} ${card.idea}`);
  const scored = known
    .map((r) => ({ r, s: similarity(mine, words(`${r.title} ${r.idea}`)) + (r.cwd === card.cwd ? 0.05 : 0) }))
    .filter((x) => x.s >= MIN_SIMILARITY)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map((x) => x.r);
  const basis = scored.length >= 3 ? 'similar' : 'all';
  const pool = basis === 'similar' ? scored : known;
  const pcts = pool.map((r) => r.fiveHourPct!).sort((a, b) => a - b);
  const durs = pool.map((r) => r.durationMs).sort((a, b) => a - b);
  const [lo, hi] = pool.length >= 5 ? [10, 90] : [0, 100];
  return {
    low: percentile(pcts, lo),
    high: percentile(pcts, hi),
    durationLowMs: percentile(durs, lo),
    durationHighMs: percentile(durs, hi),
    n: pool.length,
    basis,
  };
}

const fmtPct = (n: number) => (n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n)));

export function formatCostRange(r: CostRange | null): string {
  if (!r) return 'Cost: not known yet (needs 2 past runs)';
  const pct = r.low === r.high ? `~${fmtPct(r.low)}%` : `${fmtPct(r.low)}–${fmtPct(r.high)}%`;
  const dur = r.durationLowMs === r.durationHighMs ? formatDuration(r.durationLowMs) : `${formatDuration(r.durationLowMs)}–${formatDuration(r.durationHighMs)}`;
  return `Cost: ${pct} of a 5h window · ${dur} (from ${r.n} ${r.basis === 'similar' ? 'similar' : 'past'} run${r.n === 1 ? '' : 's'})`;
}

// ---------- trends ----------

export interface PeriodStats {
  runs: number;
  /** Average points of a 5-hour window per run. */
  costPerRun: number | null;
  costRuns: number;
  kept: number;
  undone: number;
  /** kept / (kept + undone). */
  keepRate: number | null;
  ratings: number;
  avgRating: number | null;
  /** Blueprint edits per card that ran: how often the first draft missed. */
  editsPerCard: number | null;
}

export function periodStats(runs: RunRecord[], signals: Signal[], from: number, to: number): PeriodStats {
  const inRange = (at: string) => {
    const t = Date.parse(at);
    return t >= from && t < to;
  };
  const rs = runs.filter((r) => inRange(r.at));
  const costs = rs.filter((r) => r.fiveHourPct !== null).map((r) => r.fiveHourPct!);
  const sig = signals.filter((s) => inRange(s.at));
  // The last decision per card counts (a card can be redone and decided again).
  const decided = new Map<string, string>();
  for (const s of sig) if (s.kind === 'outcome' && s.card) decided.set(s.card, String(s.raw.outcome));
  const kept = [...decided.values()].filter((o) => o === 'kept').length;
  const undone = [...decided.values()].filter((o) => o === 'undone').length;
  const ratings = sig.filter((s) => s.kind === 'rating' && typeof s.raw.rating === 'number').map((s) => s.raw.rating as number);
  const ranCards = new Set(rs.map((r) => r.card));
  const edits = sig.filter((s) => s.kind === 'blueprint-edit' && s.card && ranCards.has(s.card)).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    runs: rs.length,
    costPerRun: avg(costs),
    costRuns: costs.length,
    kept,
    undone,
    keepRate: kept + undone ? kept / (kept + undone) : null,
    ratings: ratings.length,
    avgRating: avg(ratings),
    editsPerCard: ranCards.size ? edits / ranCards.size : null,
  };
}

const DAY = 24 * 3600_000;
/** A metric is compared only when both periods have at least this many data points. */
export const MIN_POINTS = 3;

/** "Last 7 days vs the 7 before" lines; empty when there isn't enough history to say anything honest. */
export function trendLines(runs: RunRecord[], signals: Signal[], now: Date, days = 7): string[] {
  const end = now.getTime();
  const cur = periodStats(runs, signals, end - days * DAY, end + 1);
  const prev = periodStats(runs, signals, end - 2 * days * DAY, end - days * DAY);
  const parts: string[] = [];
  const change = (a: number, b: number) => (a ? `${b >= a ? '+' : '−'}${Math.abs(Math.round(((b - a) / a) * 100))}%` : '');
  if (cur.costRuns >= MIN_POINTS && prev.costRuns >= MIN_POINTS && cur.costPerRun !== null && prev.costPerRun !== null) {
    parts.push(`cost per card ${fmtPct(prev.costPerRun)}% → ${fmtPct(cur.costPerRun)}% of a 5h window (${change(prev.costPerRun, cur.costPerRun)})`);
  }
  if (cur.kept + cur.undone >= MIN_POINTS && prev.kept + prev.undone >= MIN_POINTS) {
    parts.push(`keep rate ${Math.round(prev.keepRate! * 100)}% → ${Math.round(cur.keepRate! * 100)}%`);
  }
  if (cur.ratings >= MIN_POINTS && prev.ratings >= MIN_POINTS) {
    parts.push(`rating ${prev.avgRating!.toFixed(1)} → ${cur.avgRating!.toFixed(1)}`);
  }
  if (cur.runs >= MIN_POINTS && prev.runs >= MIN_POINTS && cur.editsPerCard !== null && prev.editsPerCard !== null) {
    const d = cur.editsPerCard - prev.editsPerCard;
    parts.push(`blueprint edits per card ${prev.editsPerCard.toFixed(1)} → ${cur.editsPerCard.toFixed(1)} (${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(1)})`);
  }
  if (parts.length) return [`📈 Last ${days} days vs the ${days} before: ${parts.join(' · ')}`];
  // Not enough to compare: say what there is, if anything.
  const all = periodStats(runs, signals, 0, end + 1);
  if (all.runs < MIN_POINTS) return [];
  const bits = [`${all.runs} runs`];
  if (all.keepRate !== null) bits.push(`${Math.round(all.keepRate * 100)}% kept`);
  if (all.costPerRun !== null) bits.push(`~${fmtPct(all.costPerRun)}% of a 5h window per card`);
  return [`📈 So far: ${bits.join(' · ')} (trends once there are two weeks to compare)`];
}
