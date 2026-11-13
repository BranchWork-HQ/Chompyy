// Quota snapshot (spec §5.1). Read from Claude Code's status line JSON, never by sending a
// message: if no window is active, the first message would start a new 5-hour window.
import { formatDuration } from './duration.js';
import { homePath, readJson, writeJson } from './home.js';

export interface QuotaWindow {
  usedPct: number;
  /** Unix seconds. */
  resetsAt: number;
}

export interface Snapshot {
  capturedAt: string;
  fiveHour?: QuotaWindow;
  sevenDay?: QuotaWindow;
}

export type WindowView =
  | { known: false; reason: 'missing' | 'stale'; resetsAt?: number }
  | { known: true; usedPct: number; leftPct: number; msLeft: number; pacePerHour: number; resetsAt: number };

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function readWindow(raw: unknown): QuotaWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const usedPct = num(r.used_percentage);
  let resetsAt = num(r.resets_at);
  if (resetsAt === undefined && typeof r.resets_at === 'string') {
    const t = Date.parse(r.resets_at);
    if (!Number.isNaN(t)) resetsAt = Math.floor(t / 1000);
  }
  if (usedPct === undefined || resetsAt === undefined) return undefined;
  if (resetsAt > 1e12) resetsAt = Math.floor(resetsAt / 1000); // tolerate milliseconds
  return { usedPct: Math.min(100, Math.max(0, usedPct)), resetsAt };
}

/** Parse the status line JSON. Tolerant: bad or partial input gives a snapshot with fewer windows. */
export function parseStatusline(input: string, now: Date): Snapshot {
  const snap: Snapshot = { capturedAt: now.toISOString() };
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return snap;
  }
  const limits = (data as { rate_limits?: Record<string, unknown> } | null)?.rate_limits;
  if (!limits || typeof limits !== 'object') return snap;
  const fiveHour = readWindow(limits.five_hour);
  const sevenDay = readWindow(limits.seven_day);
  if (fiveHour) snap.fiveHour = fiveHour;
  if (sevenDay) snap.sevenDay = sevenDay;
  return snap;
}

/**
 * Keep windows the new input doesn't carry. Before the first reply of a session the status line
 * has no rate_limits, but the previous snapshot stays true until its resets_at.
 */
export function mergeSnapshot(prev: Snapshot | null, next: Snapshot): Snapshot {
  return {
    capturedAt: next.capturedAt,
    fiveHour: next.fiveHour ?? prev?.fiveHour,
    sevenDay: next.sevenDay ?? prev?.sevenDay,
  };
}

/** % left, time left and pace for one window. Past resets_at the window has reset: unknown. */
export function windowView(w: QuotaWindow | undefined, now: Date): WindowView {
  if (!w) return { known: false, reason: 'missing' };
  const msLeft = w.resetsAt * 1000 - now.getTime();
  if (msLeft <= 0) return { known: false, reason: 'stale', resetsAt: w.resetsAt };
  const leftPct = 100 - w.usedPct;
  const hoursLeft = Math.max(msLeft, 60_000) / 3_600_000;
  return { known: true, usedPct: w.usedPct, leftPct, msLeft, pacePerHour: leftPct / hoursLeft, resetsAt: w.resetsAt };
}

const pct = (n: number) => `${Math.round(n)}%`;

/** One short line for Claude Code's status bar: "🍪 5h 62% left · 1h40m · ~37%/h | 7d 41% used". */
export function statusLineText(snap: Snapshot, now: Date): string {
  const five = windowView(snap.fiveHour, now);
  const week = windowView(snap.sevenDay, now);
  const fivePart = five.known
    ? `5h ${pct(five.leftPct)} left · ${formatDuration(five.msLeft)} · ~${pct(five.pacePerHour)}/h`
    : five.reason === 'stale'
      ? '5h reset'
      : '5h ?';
  const weekPart = week.known ? ` | 7d ${pct(week.usedPct)} used` : '';
  return `🍪 ${fivePart}${weekPart}`;
}

/** Multi-line `chompyy status` text. */
export function statusText(snap: Snapshot | null, now: Date): string {
  if (!snap || (!snap.fiveHour && !snap.sevenDay)) {
    return [
      'No quota snapshot yet.',
      'Add `chompyy statusline` as your Claude Code statusLine command (see cli/README.md),',
      'then send one message in any Claude Code session.',
    ].join('\n');
  }
  const clock = (unix: number) => new Date(unix * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const lines: string[] = [];
  const five = windowView(snap.fiveHour, now);
  if (five.known) {
    lines.push(`5h window  ${pct(five.leftPct)} left · resets in ${formatDuration(five.msLeft)} (${clock(five.resetsAt)}) · pace ~${pct(five.pacePerHour)}/h`);
  } else if (five.reason === 'stale') {
    lines.push(`5h window  unknown: the snapshot's window reset at ${clock(five.resetsAt!)}. Open Claude Code to refresh it.`);
  } else {
    lines.push('5h window  unknown: not in the snapshot (Pro/Max only, and only after the first reply of a session)');
  }
  const week = windowView(snap.sevenDay, now);
  if (week.known) {
    lines.push(`7d window  ${pct(week.usedPct)} used · resets in ${formatDuration(week.msLeft)} (${clock(week.resetsAt)})`);
  } else {
    lines.push(`7d window  unknown${week.reason === 'stale' ? ' (snapshot is from before the weekly reset)' : ''}`);
  }
  const age = now.getTime() - Date.parse(snap.capturedAt);
  const stale = !five.known;
  lines.push(`snapshot   taken ${formatDuration(age)} ago${stale ? ' · STALE' : ''}`);
  return lines.join('\n');
}

export function snapshotPath(): string {
  return homePath('quota.json');
}

export function loadSnapshot(): Snapshot | null {
  return readJson<Snapshot | null>(snapshotPath(), null);
}

export function saveSnapshot(snap: Snapshot): void {
  writeJson(snapshotPath(), snap);
}
