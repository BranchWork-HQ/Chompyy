import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordSample, type Sample } from '../src/pacing.js';
import { allWindowEnds, archiveWindowEnds, loadWindowLog, premise, premiseText, windowEnds } from '../src/premise.js';
import { useTempHome } from './helpers.js';

const H = 3600;
const T0 = 1_795_000_000; // seconds
const s = (atSec: number, five?: [number, number], week?: [number, number]): Sample => ({
  at: atSec * 1000,
  ...(five ? { five: { usedPct: five[0], resetsAt: five[1] } } : {}),
  ...(week ? { week: { usedPct: week[0], resetsAt: week[1] } } : {}),
});
const WEEK_END = T0 + 20 * H;

describe('windows that ended', () => {
  it('treats a reset time that wobbles by a minute as one window, and a reading after the reset as the final number', () => {
    const ends = windowEnds([s(T0, [10, T0 + 2 * H - 1]), s(T0 + H, [40, T0 + 2 * H]), s(T0 + 3 * H, [40, T0 + 2 * H])], (T0 + 4 * H) * 1000);
    expect(ends).toEqual([{ kind: '5h', resetsAt: T0 + 2 * H, usedPct: 40, exact: true }]);
  });

  it('waits on the latest window when the last reading was long before its reset (a closer one may still come)', () => {
    expect(windowEnds([s(T0, [30, T0 + 2 * H])], (T0 + 3 * H) * 1000)).toEqual([]);
  });

  it('keeps an inexact window once a newer one has started, marked inexact', () => {
    const ends = windowEnds([s(T0, [30, T0 + 2 * H]), s(T0 + 4 * H, [5, T0 + 8 * H])], (T0 + 4 * H) * 1000);
    expect(ends).toEqual([{ kind: '5h', resetsAt: T0 + 2 * H, usedPct: 30, exact: false }]);
  });

  it("doesn't count a window that hasn't reset yet", () => {
    expect(windowEnds([s(T0, [30, T0 + 2 * H])], (T0 + H) * 1000)).toEqual([]);
  });
});

describe('the window log outlives the 8-day history', () => {
  useTempHome();
  it('recording a reading archives windows that ended, once each', () => {
    recordSample({ capturedAt: new Date(T0 * 1000).toISOString(), fiveHour: { usedPct: 50, resetsAt: T0 + 600 } });
    recordSample({ capturedAt: new Date((T0 + 900) * 1000).toISOString(), fiveHour: { usedPct: 50, resetsAt: T0 + 600 } });
    expect(loadWindowLog()).toEqual([{ kind: '5h', resetsAt: T0 + 600, usedPct: 50, exact: true }]);
    expect(archiveWindowEnds([s(T0 + 900, [50, T0 + 600])], (T0 + 1000) * 1000)).toBe(0);
    // Gone from the readings, still in the log.
    expect(allWindowEnds([], (T0 + 9 * 24 * H) * 1000)).toHaveLength(1);
    expect(readFileSync(join(process.env.CHOMPYY_HOME!, 'windows.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
  });
});

describe('the premise', () => {
  const ends = windowEnds(
    [
      s(T0, [70, T0 + H], [40, WEEK_END]),
      s(T0 + H + 60, [70, T0 + H], [40, WEEK_END]), // 30% left, exact
      s(T0 + 5 * H, [95, T0 + 6 * H], [60, WEEK_END]),
      s(T0 + 6 * H + 60, [95, T0 + 6 * H], [60, WEEK_END]), // 5% left: no
      s(T0 + 19 * H, [10, T0 + 19 * H + 1800], [80, WEEK_END]),
      s(T0 + 20 * H + 60, [10, T0 + 19 * H + 1800], [80, WEEK_END]), // 90% left, exact; the week ends with 20% left
      s(T0 + 23 * H, [5, T0 + 27 * H], [1, WEEK_END + 168 * H]),
    ],
    (T0 + 23 * H) * 1000,
  );

  it('counts measured windows with 20%+ left in a finished week that had 10%+ spare', () => {
    const p = premise(ends);
    expect(p.weeks).toEqual([{ resetsAt: WEEK_END, leftPct: 20, exact: true }]);
    expect(p.fiveHour).toEqual({ ended: 3, exact: 3, medianLeftPct: 30, withLeft: 2 }); // left 30, 5, 90
    expect(p.premise).toEqual({ windows: 3, hits: 2, sharePct: 67 });
  });

  it('a week that ran out makes its windows misses: the weekly limit was binding', () => {
    const tight = ends.map((e) => (e.kind === 'week' ? { ...e, usedPct: 95 } : e));
    expect(premise(tight).premise).toEqual({ windows: 3, hits: 0, sharePct: 0 });
  });

  it('says plainly when there is nothing to measure yet, and that an early weekly reading is an upper bound', () => {
    expect(premiseText(premise([]))[0]).toMatch(/No 5-hour window has ended/);
    const text = premiseText(premise([{ kind: 'week', resetsAt: WEEK_END, usedPct: 77, exact: false }])).join('\n');
    expect(text).toMatch(/23% of the weekly allowance reset unused \(at most/);
    expect(text).toMatch(/not measurable yet/);
  });
});
