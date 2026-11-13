// Budget gate (spec §5.2): only spend what would otherwise reset, and keep a weekly reserve.
import { windowView, type Snapshot } from './quota.js';

export interface GateConfig {
  min5hLeftPct: number;
  weeklyReservePct: number;
}

export interface GateResult {
  ok: boolean;
  /** Why it is closed. */
  reasons: string[];
  /** Things worth knowing that don't close it. */
  notes: string[];
}

export function budgetGate(snap: Snapshot | null, cfg: GateConfig, now: Date): GateResult {
  const reasons: string[] = [];
  const notes: string[] = [];

  const five = windowView(snap?.fiveHour, now);
  if (!five.known) {
    // A reset (or no) window means running would *start* a fresh window, which isn't leftover capacity.
    reasons.push(
      five.reason === 'stale'
        ? '5h window unknown: the snapshot is from a window that has reset'
        : '5h window unknown: no quota snapshot (set up `chompyy statusline`)',
    );
  } else if (five.leftPct < cfg.min5hLeftPct) {
    reasons.push(`5h window has ${Math.round(five.leftPct)}% left, under the ${cfg.min5hLeftPct}% minimum`);
  }

  const week = windowView(snap?.sevenDay, now);
  const maxWeeklyUsed = 100 - cfg.weeklyReservePct;
  if (!week.known) {
    notes.push('weekly usage unknown; reserve not checked');
  } else if (week.usedPct > maxWeeklyUsed) {
    reasons.push(`weekly usage is ${Math.round(week.usedPct)}%, over the ${maxWeeklyUsed}% line (keeping ${cfg.weeklyReservePct}% in reserve)`);
  }

  return { ok: reasons.length === 0, reasons, notes };
}
