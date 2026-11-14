import { describe, expect, it } from 'vitest';
import { budgetGate, weekElapsedPct } from '../src/gate.js';
import type { Snapshot } from '../src/quota.js';
import { NOW, nowSec } from './helpers.js';

const cfg = { min5hLeftPct: 10, weeklyReservePct: 10, weeklyPace: true };
const snap = (five?: number, week?: number, fiveResetIn = 3600, weekResetIn = 86_400): Snapshot => ({
  capturedAt: NOW.toISOString(),
  ...(five !== undefined ? { fiveHour: { usedPct: five, resetsAt: nowSec + fiveResetIn } } : {}),
  ...(week !== undefined ? { sevenDay: { usedPct: week, resetsAt: nowSec + weekResetIn } } : {}),
});

describe('budgetGate', () => {
  it('opens with room in both windows', () => {
    const g = budgetGate(snap(40, 50), cfg, NOW);
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it('closes when the 5h window is under the minimum', () => {
    const g = budgetGate(snap(95, 50), cfg, NOW);
    expect(g.ok).toBe(false);
    expect(g.reasons[0]).toMatch(/5% left/);
    expect(budgetGate(snap(90, 50), cfg, NOW).ok).toBe(true); // exactly 10% left is enough
  });

  it('hard stop above 90% weekly used, whatever the pace', () => {
    const noPace = { ...cfg, weeklyPace: false };
    expect(budgetGate(snap(40, 91), cfg, NOW).reasons[0]).toMatch(/weekly usage is 91%, over the 90% hard stop/);
    expect(budgetGate(snap(40, 90), noPace, NOW).ok).toBe(true);
    expect(budgetGate(snap(40, 75), { ...noPace, weeklyReservePct: 30 }, NOW).ok).toBe(false);
  });

  it('stays on pace: runs only while behind an even pace through the week', () => {
    const day = 86_400;
    // 2.5 days into the week (4.5 days left): even pace is ~36%
    expect(weekElapsedPct(4.5 * day * 1000)).toBeCloseTo(35.7, 1);
    const behind = budgetGate(snap(40, 20, 3600, 4.5 * day), cfg, NOW);
    expect(behind.ok).toBe(true);
    expect(behind.notes[0]).toMatch(/16% of the week unspent/);
    const ahead = budgetGate(snap(40, 40, 3600, 4.5 * day), cfg, NOW);
    expect(ahead.ok).toBe(false);
    expect(ahead.reasons[0]).toMatch(/ahead of pace this week: 40% used, an even pace is 36%/);
    // pace can be turned off: then only the hard stop applies
    expect(budgetGate(snap(40, 40, 3600, 4.5 * day), { ...cfg, weeklyPace: false }, NOW).ok).toBe(true);
  });

  it('closes without a snapshot or with a stale one: running would start a new window', () => {
    expect(budgetGate(null, cfg, NOW).reasons[0]).toMatch(/no quota snapshot/);
    expect(budgetGate(snap(10, 10, -5), cfg, NOW).reasons[0]).toMatch(/has reset/);
  });

  it('notes but allows an unknown weekly window', () => {
    const g = budgetGate(snap(40), cfg, NOW);
    expect(g.ok).toBe(true);
    expect(g.notes[0]).toMatch(/weekly usage unknown/);
  });
});
