import { describe, expect, it } from 'vitest';
import { budgetGate } from '../src/gate.js';
import type { Snapshot } from '../src/quota.js';
import { NOW, nowSec } from './helpers.js';

const cfg = { min5hLeftPct: 10, weeklyReservePct: 10 };
const snap = (five?: number, week?: number, fiveResetIn = 3600): Snapshot => ({
  capturedAt: NOW.toISOString(),
  ...(five !== undefined ? { fiveHour: { usedPct: five, resetsAt: nowSec + fiveResetIn } } : {}),
  ...(week !== undefined ? { sevenDay: { usedPct: week, resetsAt: nowSec + 86_400 } } : {}),
});

describe('budgetGate', () => {
  it('opens with room in both windows', () => {
    expect(budgetGate(snap(40, 50), cfg, NOW)).toEqual({ ok: true, reasons: [], notes: [] });
  });

  it('closes when the 5h window is under the minimum', () => {
    const g = budgetGate(snap(95, 50), cfg, NOW);
    expect(g.ok).toBe(false);
    expect(g.reasons[0]).toMatch(/5% left/);
    expect(budgetGate(snap(90, 50), cfg, NOW).ok).toBe(true); // exactly 10% left is enough
  });

  it('closes when the weekly reserve would be touched', () => {
    expect(budgetGate(snap(40, 91), cfg, NOW).reasons[0]).toMatch(/weekly usage is 91%/);
    expect(budgetGate(snap(40, 90), cfg, NOW).ok).toBe(true);
    expect(budgetGate(snap(40, 75), { ...cfg, weeklyReservePct: 30 }, NOW).ok).toBe(false);
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
