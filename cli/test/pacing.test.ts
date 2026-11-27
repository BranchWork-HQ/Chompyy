import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { budgetGate } from '../src/gate.js';
import { snapshotFromProvider } from '../src/livequota.js';
import {
  weekForecast,
  windowShareOfWeek,
  dailyAllowance, dayBounds, forecastWindow, formatAllowance, formatDelta, formatForecast, formatForecastShort, loadSamples, paceDelta, pacing, recordSample,
  FIVE_HOURS, WEEK, type Sample,
} from '../src/pacing.js';
import { saveSnapshot, statusText, type QuotaWindow } from '../src/quota.js';
import { NOW, nowSec, useTempHome } from './helpers.js';

const MIN = 60_000;
const w = (usedPct: number, minutesLeft: number): QuotaWindow => ({ usedPct, resetsAt: nowSec + minutesLeft * 60 });

describe('pace delta', () => {
  it('is used minus elapsed: ⇣ headroom, ⇡ burning fast', () => {
    expect(paceDelta(w(20, 150), FIVE_HOURS, NOW)).toBeCloseTo(-30); // half gone, 20% used
    expect(paceDelta(w(80, 150), FIVE_HOURS, NOW)).toBeCloseTo(30);
    expect(paceDelta(w(20, -1), FIVE_HOURS, NOW)).toBeNull(); // reset
    expect(formatDelta(-30)).toBe('⇣30%');
    expect(formatDelta(30.4)).toBe('⇡30%');
    expect(formatDelta(0.3)).toBe('±0%');
    expect(formatDelta(-30, true)).toBe('\u001b[32m⇣30%\u001b[0m');
    expect(formatDelta(null)).toBe('');
  });
});

describe('forecast', () => {
  const s = (minAgo: number, used: number, resetsAt = nowSec + 60 * 60): Sample => ({ at: NOW.getTime() - minAgo * MIN, five: { usedPct: used, resetsAt } });

  it('uses the last hour of readings in this window', () => {
    // 10 points in the last 50 minutes → 0.2 %/min; 60 minutes left → +12 → 52% used, 48% unused.
    const f = forecastWindow(w(40, 60), FIVE_HOURS, [s(50, 30), s(20, 36), s(0, 40)], (x) => x.five, NOW);
    expect(f).toMatchObject({ kind: 'unused', basis: 'recent' });
    expect(f.kind === 'unused' && Math.round(f.unusedPct)).toBe(48);
    expect(formatForecastShort(f)).toMatch(/^~48% unused at \d\d:\d\d$/);
  });

  it('idle in the last hour means what is left now resets unused', () => {
    const f = forecastWindow(w(40, 60), FIVE_HOURS, [s(40, 40), s(0, 40)], (x) => x.five, NOW);
    expect(f.kind === 'unused' && f.unusedPct).toBe(60);
  });

  it('falls back to the average since the window started, ignores other windows', () => {
    const other = s(30, 0, nowSec + 99);
    const f = forecastWindow(w(40, 60), FIVE_HOURS, [other, s(0, 40)], (x) => x.five, NOW);
    // 40% in 240 minutes → +10 in the last 60 → 50% unused.
    expect(f).toMatchObject({ kind: 'unused', basis: 'average', unusedPct: 50 });
    expect(forecastWindow(w(5, 295), FIVE_HOURS, [], (x) => x.five, NOW)).toEqual({ kind: 'unknown' }); // too early
  });

  it('says when the limit comes first, and freezes once it is hit', () => {
    const f = forecastWindow(w(90, 60), FIVE_HOURS, [s(30, 60), s(0, 90)], (x) => x.five, NOW); // 1 %/min
    expect(f).toMatchObject({ kind: 'limit-ahead', atMs: NOW.getTime() + 10 * MIN });
    const hit = forecastWindow(w(100, 60), FIVE_HOURS, [s(30, 60), s(0, 100)], (x) => x.five, NOW);
    expect(hit).toEqual({ kind: 'limit', resetsAt: nowSec + 3600 });
    expect(formatForecast(hit)).toMatch(/^limit hit; no forecast until it resets at/);
  });
});

describe('daily allowance', () => {
  // Local times so bedtimes don't depend on the machine's zone.
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
  const weekWin = (now: Date, used: number, daysLeft: number): QuotaWindow => ({ usedPct: used, resetsAt: Math.floor(now.getTime() / 1000) + daysLeft * 86_400 });

  it('a day runs from bedtime to bedtime (midnight without one)', () => {
    expect(dayBounds(at(13, 10), '23:30')).toEqual({ start: at(12, 23, 30).getTime(), end: at(13, 23, 30).getTime() });
    expect(dayBounds(at(13, 23, 45), '23:30').start).toBe(at(13, 23, 30).getTime());
    expect(dayBounds(at(13, 10), null)).toEqual({ start: at(13, 0).getTime(), end: at(14, 0).getTime() });
  });

  it('today = what was left at the start of the day ÷ days left; on pace, ahead, behind, over', () => {
    const now = at(13, 12); // half a day since midnight
    const win = weekWin(now, 0, 4.5); // window ends in 4.5 days → 5 days left counting today
    const start = at(13, 0).getTime();
    const hist = (usedAtStart: number): Sample[] => [{ at: start - MIN, week: { usedPct: usedAtStart, resetsAt: win.resetsAt } }];
    // 50 left / 5 days = 10 today; by noon an even day would have used 5.
    expect(dailyAllowance({ ...win, usedPct: 55 }, hist(50), now, null)).toMatchObject({ allowance: 10, usedToday: 5, status: 'on pace', daysLeft: 5, approx: false });
    expect(dailyAllowance({ ...win, usedPct: 58 }, hist(50), now, null)!.status).toBe('ahead');
    expect(dailyAllowance({ ...win, usedPct: 51 }, hist(50), now, null)!.status).toBe('behind');
    expect(dailyAllowance({ ...win, usedPct: 62 }, hist(50), now, null)!.status).toBe('over');
    expect(formatAllowance(dailyAllowance({ ...win, usedPct: 51 }, hist(50), now, null))).toMatch(/^today {6}1% of 10% ▓░{9} behind: 4% unspent so far, it funds the night · day ends \d\d:\d\d$/);
  });

  it('without a reading from before today, counts from the first one today', () => {
    const now = at(13, 12);
    const win = weekWin(now, 30, 4.5);
    const a = dailyAllowance(win, [{ at: at(13, 9).getTime(), week: { usedPct: 28, resetsAt: win.resetsAt } }], now, null)!;
    expect(a).toMatchObject({ usedToday: 2, approx: true, tooEarly: false });
    expect(formatAllowance(a)).toContain('counted from the first reading today');
    // Only a few minutes of today known: the allowance, no verdict.
    const early = dailyAllowance(win, [{ at: at(13, 11, 50).getTime(), week: { usedPct: 30, resetsAt: win.resetsAt } }], now, null)!;
    expect(early.tooEarly).toBe(true);
    expect(formatAllowance(early)).toMatch(/^today {6}14% a day for the 5 days left · tracking today since \d\d:\d\d, so no verdict yet/);
    expect(formatAllowance(null)).toMatch(/unknown/);
  });
});

describe('history and status', () => {
  useTempHome();

  it('saves a reading when the numbers change or every 5 minutes, never twice the same', () => {
    const snap = (used: number, ms: number) => ({ capturedAt: new Date(ms).toISOString(), fiveHour: { usedPct: used, resetsAt: nowSec + 3600 } });
    const t = NOW.getTime();
    expect(recordSample(snap(10, t))).toBe(true);
    expect(recordSample(snap(10, t + MIN))).toBe(false);
    expect(recordSample(snap(11, t + 2 * MIN))).toBe(true);
    expect(recordSample(snap(11, t + 8 * MIN))).toBe(true);
    expect(recordSample({ capturedAt: NOW.toISOString() })).toBe(false);
    expect(loadSamples().map((s) => s.five!.usedPct)).toEqual([10, 11, 11]);
    saveSnapshot(snap(12, t + 9 * MIN)); // saving a snapshot records it too
    expect(loadSamples()).toHaveLength(4);
  });

  it('chompyy status shows pace, forecast, today and per-model windows', () => {
    const snap = { capturedAt: NOW.toISOString(), fiveHour: w(38, 100), sevenDay: { usedPct: 41, resetsAt: nowSec + 300_000 }, models: { Opus: { usedPct: 70, resetsAt: nowSec + 300_000 } } };
    const text = statusText(snap, NOW, { samples: [], bedtime: null });
    expect(text).toMatch(/7d Opus {4}70% used ⇡20%/);
    expect(text).toMatch(/pace {7}5h ⇣29% · 7d ⇣9%/);
    expect(text).toMatch(/forecast {3}at your average pace this window, ~43% of this window resets unused/);
    expect(text).toMatch(/^today /m);
    const p = pacing(snap, [], NOW, null);
    expect(p.models.Opus).toMatchObject({ usedPct: 70 });
    expect(Math.round(p.weekDelta!)).toBe(-9);
  });
});

describe('per-model weekly limits', () => {
  const snap = (opus: number) => ({
    capturedAt: NOW.toISOString(),
    fiveHour: w(10, 200),
    sevenDay: { usedPct: 10, resetsAt: nowSec + 6 * 86_400 },
    models: { Opus: { usedPct: opus, resetsAt: nowSec + 6 * 86_400 }, Sonnet: { usedPct: 5, resetsAt: nowSec + 6 * 86_400 } },
  });

  it('closes for the run\'s own model, and for any model at 100% when the model is the default', () => {
    expect(budgetGate(snap(95), { ...DEFAULT_CONFIG, runModel: 'opus' }, NOW).reasons).toEqual(['weekly Opus usage is 95%, over the 90% hard stop']);
    expect(budgetGate(snap(95), { ...DEFAULT_CONFIG, runModel: 'sonnet' }, NOW).ok).toBe(true);
    const def = budgetGate(snap(95), { ...DEFAULT_CONFIG, runModel: null }, NOW);
    expect(def.ok).toBe(true);
    expect(def.notes.join(' ')).toMatch(/weekly Opus usage is 95%; away runs use Claude Code's default model/);
    expect(budgetGate(snap(100), { ...DEFAULT_CONFIG, runModel: null }, NOW).reasons).toEqual(['weekly Opus limit is used up: running now would spill into paid extra usage']);
  });

  it('reads per-model windows from the usage endpoint', () => {
    const resetsAt = new Date(NOW.getTime() + 86_400_000).toISOString();
    const snapshot = snapshotFromProvider({
      provider: 'claude', connection: 'connected', primary: null, planLabel: 'Max', footerLines: [],
      details: [{ label: '5-hour', percent: 0.2, resetsAt }, { label: 'Weekly', percent: 0.3, resetsAt }, { label: 'Weekly · Opus', percent: 0.455, resetsAt }],
    } as never, NOW)!;
    expect(snapshot.models).toEqual({ Opus: { usedPct: 45.5, resetsAt: Math.floor(Date.parse(resetsAt) / 1000) } });
  });
});

describe('the week: will it reset unused?', () => {
  const H = 3600_000;
  const at = Date.parse('2026-11-27T12:00:00Z');
  const resets = (at + 42 * H) / 1000; // 1d18h left
  const snap = (week: number) => ({ capturedAt: new Date(at).toISOString(), fiveHour: { usedPct: 30, resetsAt: (at + 3 * H) / 1000 }, sevenDay: { usedPct: week, resetsAt: resets } }) as never;
  // Readings in one 5-hour window: the 5h bar moved 60 points while the week moved 7 → one window ≈ 11.7% of the week.
  const samples = [0, 20, 40, 60].map((f, i) => ({ at: at - (3 - i) * H, five: { usedPct: f, resetsAt: (at + 3 * H) / 1000 }, week: { usedPct: 19 + (7 * f) / 60, resetsAt: resets } }));

  it('learns what a full 5-hour window is worth on your plan, and says how many windows will go unused', () => {
    expect(windowShareOfWeek(samples)).toBeCloseTo(11.67, 1);
    const f = weekForecast(snap(26), samples, new Date(at))!;
    expect(Math.round(f.unusedPct)).toBe(65);
    expect(Math.floor(f.spareWindows!)).toBe(5);
    const when = `${new Date(resets * 1000).toLocaleDateString('en-US', { weekday: 'short' })} ${new Date(resets * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    expect(f.line).toBe(`Week 26% used. At your pace ~65% resets unused on ${when}: about 5 full 5-hour windows.`);
    expect(f.short).toBe(`At your pace ~65% resets unused on ${when}: about 5 full 5-hour windows.`);
  });

  it("says when even running every window flat out can't use the week", () => {
    const late = { ...(snap(10) as object), sevenDay: { usedPct: 10, resetsAt: (at + 10 * H) / 1000 } } as never;
    const f = weekForecast(late, samples.map((s) => ({ ...s, week: { ...s.week, resetsAt: (at + 10 * H) / 1000 } })), new Date(at))!;
    expect(Math.round(f.maxReachablePct!)).toBe(33);
    expect(f.line).toContain("Even running every window flat out, you'd reach ~33%.");
  });

  it('says when the week runs out first, and stays quiet early in the week or without readings', () => {
    const hot = weekForecast(snap(90), samples, new Date(at))!;
    expect(hot.runsOutAt).toBeDefined();
    expect(hot.line).toContain('At your pace it runs out');
    const early = { ...(snap(2) as object), sevenDay: { usedPct: 2, resetsAt: (at + 160 * H) / 1000 } } as never;
    expect(weekForecast(early, [], new Date(at))).toBeNull();
    expect(windowShareOfWeek([])).toBeNull();
  });
});
