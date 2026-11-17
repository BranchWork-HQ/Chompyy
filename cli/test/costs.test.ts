import { describe, expect, it } from 'vitest';
import { costRange, formatCostRange, periodStats, readRuns, recordRun, trendLines, usedBetween, type RunRecord } from '../src/costs.js';
import type { Signal } from '../src/taste.js';
import { NOW, useTempHome } from './helpers.js';

const DAY = 24 * 3600_000;
const run = (over: Partial<RunRecord>): RunRecord => ({
  at: NOW.toISOString(), card: '9', title: 'x', idea: 'x', cwd: '/repo', status: 'ok', durationMs: 10 * 60_000, fiveHourPct: 5, weeklyPct: 1, ...over,
});
const sig = (kind: Signal['kind'], card: string, at: Date, raw: Record<string, unknown> = {}): Signal => ({ id: `s${Math.random()}`, kind, card, at: at.toISOString(), raw: { kind, ...raw } });

describe('cost per run', () => {
  useTempHome();

  it('is the used points between two readings of the same window', () => {
    expect(usedBetween({ usedPct: 40, resetsAt: 1 }, { usedPct: 47.25, resetsAt: 1 })).toBe(7.3);
    expect(usedBetween({ usedPct: 40, resetsAt: 1 }, { usedPct: 3, resetsAt: 2 })).toBeNull(); // window reset
    expect(usedBetween(undefined, { usedPct: 3, resetsAt: 2 })).toBeNull();
  });

  it('records runs in runs.jsonl', () => {
    recordRun(run({ card: '1' }));
    recordRun(run({ card: '2' }));
    expect(readRuns().map((r) => r.card)).toEqual(['1', '2']);
  });
});

describe('costRange', () => {
  const card = { id: '1', title: 'Write a changelog from git history', idea: 'Write CHANGELOG.md from the git log', cwd: '/repo' };

  it('is unknown until there are 2 past runs', () => {
    expect(costRange(card, [run({})])).toBeNull();
    expect(formatCostRange(null)).toMatch(/not known yet/);
  });

  it('uses similar runs when there are 3+, else all runs', () => {
    const similar = [3, 4, 6].map((p, i) => run({ card: `c${i}`, title: 'Changelog from git history', idea: 'changelog git log', fiveHourPct: p }));
    const other = [30, 40].map((p, i) => run({ card: `o${i}`, title: 'Port the parser to Rust', idea: 'rewrite parser', fiveHourPct: p }));
    expect(costRange(card, [...similar, ...other])).toMatchObject({ low: 3, high: 6, n: 3, basis: 'similar' });
    expect(costRange(card, [similar[0]!, ...other])).toMatchObject({ low: 3, high: 40, n: 3, basis: 'all' });
  });

  it('narrows to P10–P90 with 5+ runs and skips runs with unknown cost', () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 50].map((p, i) => run({ card: `c${i}`, title: 'changelog git history', fiveHourPct: p, durationMs: (i + 1) * 60_000 }));
    runs.push(run({ card: 'u', title: 'changelog git history', fiveHourPct: null }));
    const r = costRange(card, runs)!;
    expect(r.n).toBe(8); // top 8 similar
    expect(formatCostRange({ low: 2, high: 9, durationLowMs: 5 * 60_000, durationHighMs: 25 * 60_000, n: 6, basis: 'similar' })).toBe('Cost: 2–9% of a 5h window · 5m–25m (from 6 similar runs)');
  });

  it('never counts the card itself', () => {
    expect(costRange(card, [run({ card: '1' }), run({ card: '1' })])).toBeNull();
  });
});

describe('trends', () => {
  const cur = (d: number) => new Date(NOW.getTime() - d * DAY);

  it('compares the last 7 days with the 7 before, only with enough points', () => {
    const runs = [
      ...[1, 2, 3].map((d, i) => run({ card: `a${i}`, at: cur(d + 7).toISOString(), fiveHourPct: 10 })),
      ...[1, 2, 3].map((d, i) => run({ card: `b${i}`, at: cur(d).toISOString(), fiveHourPct: 6.9 })),
    ];
    const signals = [
      ...['a0', 'a1', 'a2'].map((c, i) => sig('outcome', c, cur(8 + i), { outcome: i ? 'undone' : 'kept' })),
      ...['b0', 'b1', 'b2'].map((c, i) => sig('outcome', c, cur(1 + i / 10), { outcome: i < 2 ? 'kept' : 'undone' })),
      sig('blueprint-edit', 'a0', cur(9)), sig('blueprint-edit', 'a1', cur(9)),
    ];
    const lines = trendLines(runs, signals, NOW);
    expect(lines[0]).toContain('cost per card 10% → 6.9% of a 5h window (−31%)');
    expect(lines[0]).toContain('keep rate 33% → 67%');
    expect(lines[0]).toContain('blueprint edits per card 0.7 → 0.0 (−0.7)');
    expect(lines[0]).not.toContain('rating');
  });

  it('says what there is when it can\'t compare yet, and nothing with under 3 runs', () => {
    expect(trendLines([run({}), run({})], [], NOW)).toEqual([]);
    expect(trendLines([run({}), run({}), run({})], [], NOW)[0]).toMatch(/So far: 3 runs · ~5% of a 5h window per card/);
  });

  it('counts the last decision per card', () => {
    const s = [sig('outcome', '1', cur(1), { outcome: 'undone' }), sig('outcome', '1', cur(0.5), { outcome: 'kept' })];
    expect(periodStats([], s, 0, NOW.getTime() + 1)).toMatchObject({ kept: 1, undone: 0, keepRate: 1 });
  });
});
