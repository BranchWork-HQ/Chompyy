// Pacing (FEATURES §2): how you're spending your windows, at a glance.
//
// - Signed pace delta (claude-pace): used % minus the % of the window that has passed. ⇣15% = headroom,
//   ⇡15% = burning faster than an even pace.
// - Forecast unused at reset (Claude-Code-Usage-Monitor forecasts run-out; we flip it): "~40% resets unused at
//   18:20" is the moment to offer cards. Frozen once a limit is hit: no projections past 100%.
// - Rolling daily allowance: today = what's left of the week ÷ days left, where your day ends at bedtime.
//
// The burn rate comes from a small history of quota readings (quota-history.json), saved whenever the snapshot
// changes, so no extra calls are made.
import { homePath, readJson, writeJson } from './home.js';
import { archiveWindowEnds } from './premise.js';
import { windowView, type QuotaWindow, type Snapshot } from './quota.js';

export const FIVE_HOURS = 5 * 3600_000;
export const WEEK = 7 * 24 * 3600_000;
const DAY = 24 * 3600_000;

// ---------- history of readings ----------

export interface Sample {
  /** ms since epoch */
  at: number;
  five?: QuotaWindow;
  week?: QuotaWindow;
}

const historyPath = () => homePath('quota-history.json');
/** Keep 8 days: enough for a weekly window and the day before it. */
const KEEP_MS = 8 * DAY;
/** Save a reading at most this often unless the numbers changed. */
const MIN_GAP_MS = 5 * 60_000;

export function loadSamples(): Sample[] {
  return readJson<{ samples: Sample[] }>(historyPath(), { samples: [] }).samples;
}

const same = (a?: QuotaWindow, b?: QuotaWindow) => a?.usedPct === b?.usedPct && a?.resetsAt === b?.resetsAt;

/** Add a reading when it says something new. Returns true when saved. */
export function recordSample(snap: Snapshot, nowMs: number = Date.parse(snap.capturedAt)): boolean {
  if (!snap.fiveHour && !snap.sevenDay) return false;
  const samples = loadSamples();
  const last = samples.at(-1);
  if (last && same(last.five, snap.fiveHour) && same(last.week, snap.sevenDay) && nowMs - last.at < MIN_GAP_MS) return false;
  if (last && nowMs < last.at) return false; // out of order
  samples.push({ at: nowMs, ...(snap.fiveHour ? { five: snap.fiveHour } : {}), ...(snap.sevenDay ? { week: snap.sevenDay } : {}) });
  writeJson(historyPath(), { samples: samples.filter((s) => s.at > nowMs - KEEP_MS) });
  try {
    archiveWindowEnds(samples, nowMs); // windows that ended, kept beyond the 8 days (premise.ts)
  } catch {}
  return true;
}

// ---------- pace delta ----------

/** Used % minus elapsed % of the window. Negative = headroom. Null when the window is unknown or reset. */
export function paceDelta(w: QuotaWindow | undefined, lengthMs: number, now: Date): number | null {
  const v = windowView(w, now);
  if (!v.known) return null;
  const elapsedPct = Math.min(100, Math.max(0, (1 - v.msLeft / lengthMs) * 100));
  return v.usedPct - elapsedPct;
}

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const RESET = '\u001b[0m';

/** "⇣15%" (headroom, green) or "⇡15%" (burning fast, red); "±0%" when within a point. */
export function formatDelta(delta: number | null, color = false): string {
  if (delta === null) return '';
  const n = Math.round(Math.abs(delta));
  if (n < 1) return '±0%';
  const text = delta < 0 ? `⇣${n}%` : `⇡${n}%`;
  return color ? `${delta < 0 ? GREEN : RED}${text}${RESET}` : text;
}

// ---------- forecast ----------

export type Forecast =
  | { kind: 'unknown' }
  /** At the current rate this much of the window resets unused. */
  | { kind: 'unused'; unusedPct: number; resetsAt: number; basis: 'recent' | 'average' }
  /** At the current rate the limit is reached before the reset. */
  | { kind: 'limit-ahead'; atMs: number; resetsAt: number }
  /** The limit is hit: no projection, just when it resets. */
  | { kind: 'limit'; resetsAt: number };

const RECENT_MS = 60 * 60_000;
const MIN_SPAN_MS = 10 * 60_000;

/** % per ms over the last hour of readings in this same window, or null if there aren't enough. */
export function recentRate(samples: Sample[], pick: (s: Sample) => QuotaWindow | undefined, resetsAt: number, nowMs: number): number | null {
  const pts = samples.filter((s) => pick(s)?.resetsAt === resetsAt && s.at >= nowMs - RECENT_MS && s.at <= nowMs);
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts.at(-1)!;
  if (last.at - first.at < MIN_SPAN_MS) return null;
  return Math.max(0, (pick(last)!.usedPct - pick(first)!.usedPct) / (last.at - first.at));
}

export function forecastWindow(w: QuotaWindow | undefined, lengthMs: number, samples: Sample[], pick: (s: Sample) => QuotaWindow | undefined, now: Date): Forecast {
  const v = windowView(w, now);
  if (!v.known) return { kind: 'unknown' };
  if (v.usedPct >= 100) return { kind: 'limit', resetsAt: v.resetsAt };
  const nowMs = now.getTime();
  let rate = recentRate(samples, pick, v.resetsAt, nowMs);
  let basis: 'recent' | 'average' = 'recent';
  if (rate === null) {
    const elapsed = lengthMs - v.msLeft;
    if (elapsed < 15 * 60_000) return { kind: 'unknown' };
    rate = v.usedPct / elapsed;
    basis = 'average';
  }
  const projected = v.usedPct + rate * v.msLeft;
  if (projected >= 100 && rate > 0) return { kind: 'limit-ahead', atMs: nowMs + (100 - v.usedPct) / rate, resetsAt: v.resetsAt };
  return { kind: 'unused', unusedPct: Math.max(0, 100 - projected), resetsAt: v.resetsAt, basis };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Short, for the status line: "~40% unused at 18:20" · "limit ~17:05" · "limit hit, resets 18:20". */
export function formatForecastShort(f: Forecast): string {
  switch (f.kind) {
    case 'unused':
      return `~${Math.round(f.unusedPct)}% unused at ${clock(f.resetsAt * 1000)}`;
    case 'limit-ahead':
      return `limit ~${clock(f.atMs)}`;
    case 'limit':
      return `limit hit, resets ${clock(f.resetsAt * 1000)}`;
    default:
      return '';
  }
}

export function formatForecast(f: Forecast): string {
  switch (f.kind) {
    case 'unused':
      return `at ${f.basis === 'recent' ? 'your pace over the last hour' : 'your average pace this window'}, ~${Math.round(f.unusedPct)}% of this window resets unused at ${clock(f.resetsAt * 1000)}${f.unusedPct >= 20 ? ' (room for an away card: chompyy eat-tokens)' : ''}`;
    case 'limit-ahead':
      return `at this pace you hit the limit at ~${clock(f.atMs)}, before the reset at ${clock(f.resetsAt * 1000)}`;
    case 'limit':
      return `limit hit; no forecast until it resets at ${clock(f.resetsAt * 1000)}`;
    default:
      return 'not enough readings yet to forecast';
  }
}

// ---------- rolling daily allowance ----------

/** The day you're in: from your last bedtime (or midnight) to the next. */
export function dayBounds(now: Date, bedtime: string | null): { start: number; end: number } {
  const [h, m] = bedtime ? bedtime.split(':').map(Number) as [number, number] : [0, 0];
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1); // calendar day, so DST shifts don't move bedtime
  return { start: start.getTime(), end: end.getTime() };
}

export type DayStatus = 'on pace' | 'ahead' | 'behind' | 'over';

export interface DailyAllowance {
  /** Points of the weekly window for today. */
  allowance: number;
  usedToday: number;
  /** What an even spend through today would have used by now. */
  expectedByNow: number;
  status: DayStatus;
  daysLeft: number;
  dayEnds: number;
  /** Today's start wasn't in the history, so "used today" counts from the first reading today. */
  approx: boolean;
  /** When counting started (the day's start, or the first reading today). */
  since: number;
  /** Too little of today is known to judge the pace: show the allowance only. */
  tooEarly: boolean;
}

export function dailyAllowance(w: QuotaWindow | undefined, samples: Sample[], now: Date, bedtime: string | null): DailyAllowance | null {
  const v = windowView(w, now);
  if (!v.known) return null;
  const { start, end } = dayBounds(now, bedtime);
  const weekEnd = v.resetsAt * 1000;
  // The weekly window may have started today: then today starts there.
  const dayStart = Math.max(start, weekEnd - WEEK);
  const inWindow = samples.filter((s) => s.week?.resetsAt === v.resetsAt);
  const before = inWindow.filter((s) => s.at <= dayStart).at(-1);
  const after = inWindow.find((s) => s.at > dayStart);
  const approx = !before && !(dayStart > start); // a window that began today started at 0
  const usedAtStart = dayStart > start ? 0 : (before ?? after)?.week?.usedPct ?? v.usedPct;
  const daysLeft = Math.max(1, Math.ceil((weekEnd - dayStart) / DAY - 0.01));
  const allowance = Math.max(0, 100 - usedAtStart) / daysLeft;
  const usedToday = Math.max(0, v.usedPct - usedAtStart);
  const dayEnds = Math.min(end, weekEnd);
  const frac = Math.min(1, Math.max(0, (now.getTime() - dayStart) / Math.max(1, dayEnds - dayStart)));
  const expectedByNow = allowance * frac;
  const slack = Math.max(1, allowance * 0.1);
  const status: DayStatus = usedToday > allowance ? 'over' : usedToday > expectedByNow + slack ? 'ahead' : usedToday < expectedByNow - slack ? 'behind' : 'on pace';
  const since = approx ? (after?.at ?? now.getTime()) : dayStart;
  const tooEarly = approx && now.getTime() - since < 2 * 3600_000;
  return { allowance, usedToday, expectedByNow, status, daysLeft, dayEnds, approx, since, tooEarly };
}

const r1 = (n: number) => (n < 10 ? (Math.round(n * 10) / 10).toString() : Math.round(n).toString());

/** "today  4% of 12% ▓▓▓░░░░░░░ behind: 3% unspent so far, it funds the night · day ends 23:30". */
export function formatAllowance(a: DailyAllowance | null): string {
  if (!a) return 'today      unknown (weekly window not known)';
  if (a.tooEarly) return `today      ${r1(a.allowance)}% a day for the ${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left · tracking today since ${clock(a.since)}, so no verdict yet · day ends ${clock(a.dayEnds)}`;
  const filled = Math.min(10, Math.round((a.usedToday / Math.max(a.allowance, 0.01)) * 10));
  const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
  const say: Record<DayStatus, string> = {
    'on pace': 'on pace',
    ahead: `ahead: ${r1(a.usedToday - a.expectedByNow)}% more than an even day by now`,
    behind: `behind: ${r1(a.expectedByNow - a.usedToday)}% unspent so far, it funds the night`,
    over: `over today's share by ${r1(a.usedToday - a.allowance)}%`,
  };
  return `today      ${r1(a.usedToday)}% of ${r1(a.allowance)}% ${bar} ${say[a.status]} · day ends ${clock(a.dayEnds)}${a.approx ? ' (counted from the first reading today)' : ''}`;
}

// ---------- everything together ----------

export interface Pacing {
  fiveHourDelta: number | null;
  weekDelta: number | null;
  fiveHourForecast: Forecast;
  today: DailyAllowance | null;
  /** Per-model weekly windows (Opus, Sonnet, …) from the usage endpoint. */
  models: Record<string, { usedPct: number; delta: number | null; resetsAt: number }>;
}

export function pacing(snap: Snapshot | null, samples: Sample[], now: Date, bedtime: string | null): Pacing {
  const models: Pacing['models'] = {};
  for (const [name, w] of Object.entries(snap?.models ?? {})) {
    const v = windowView(w, now);
    if (v.known) models[name] = { usedPct: v.usedPct, delta: paceDelta(w, WEEK, now), resetsAt: v.resetsAt };
  }
  return {
    fiveHourDelta: paceDelta(snap?.fiveHour, FIVE_HOURS, now),
    weekDelta: paceDelta(snap?.sevenDay, WEEK, now),
    fiveHourForecast: forecastWindow(snap?.fiveHour, FIVE_HOURS, samples, (s) => s.five, now),
    today: dailyAllowance(snap?.sevenDay, samples, now, bedtime),
    models,
  };
}

