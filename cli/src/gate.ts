// Budget gate (spec §5.2): only spend what would otherwise reset; stay on an even weekly pace, hard stop at 90%.
import { windowView, type Snapshot } from './quota.js';

export interface GateConfig {
  min5hLeftPct: number;
  weeklyReservePct: number;
  /** Only run while weekly usage is behind an even pace through the week. */
  weeklyPace: boolean;
  /** The model away runs use (null = Claude Code's default), to check its own weekly limit. */
  runModel?: string | null;
}

/** Which per-model windows apply: the run's model if it's named, else all of them (the default may be any). */
function modelWindowsFor(snap: Snapshot | null, runModel: string | null | undefined): [string, Snapshot['sevenDay']][] {
  const all = Object.entries(snap?.models ?? {});
  if (!runModel) return all;
  const m = runModel.toLowerCase();
  return all.filter(([name]) => m.includes(name.toLowerCase()));
}

const WEEK_MS = 7 * 24 * 3600_000;

/** How far through the 7-day window we are, as a % (an even pace would have used this much). */
export function weekElapsedPct(msLeft: number): number {
  return Math.min(100, Math.max(0, (1 - msLeft / WEEK_MS) * 100));
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
  } else if (five.usedPct >= 100) {
    // Whatever the settings say: past 100% a plan with extra usage turned on starts billing.
    reasons.push('5h window is used up: running now would spill into paid extra usage');
  } else if (five.leftPct < cfg.min5hLeftPct) {
    reasons.push(`5h window has ${Math.round(five.leftPct)}% left, under the ${cfg.min5hLeftPct}% minimum`);
  }

  const week = windowView(snap?.sevenDay, now);
  const maxWeeklyUsed = 100 - cfg.weeklyReservePct;
  if (!week.known) {
    notes.push('weekly usage unknown; reserve not checked');
  } else if (week.usedPct >= 100) {
    reasons.push('weekly limit is used up: running now would spill into paid extra usage');
  } else if (week.usedPct > maxWeeklyUsed) {
    reasons.push(`weekly usage is ${Math.round(week.usedPct)}%, over the ${maxWeeklyUsed}% hard stop`);
  } else if (cfg.weeklyPace) {
    // Spend only what you haven't used so far this week; never borrow from the days ahead.
    const pace = weekElapsedPct(week.msLeft);
    if (week.usedPct > pace) {
      reasons.push(`ahead of pace this week: ${Math.round(week.usedPct)}% used, an even pace is ${Math.round(pace)}% by now`);
    } else {
      notes.push(`${Math.round(pace - week.usedPct)}% of the week unspent so far (${Math.round(week.usedPct)}% used, even pace ${Math.round(pace)}%)`);
    }
  }

  // Per-model weekly limits (e.g. Opus has its own 7-day window).
  for (const [name, w] of modelWindowsFor(snap, cfg.runModel)) {
    const v = windowView(w, now);
    if (!v.known) continue;
    if (v.usedPct >= 100) reasons.push(`weekly ${name} limit is used up: running now would spill into paid extra usage`);
    else if (v.usedPct > maxWeeklyUsed) {
      if (cfg.runModel) reasons.push(`weekly ${name} usage is ${Math.round(v.usedPct)}%, over the ${maxWeeklyUsed}% hard stop`);
      else notes.push(`weekly ${name} usage is ${Math.round(v.usedPct)}%; away runs use Claude Code's default model, which may be ${name}`);
    }
  }

  return { ok: reasons.length === 0, reasons, notes };
}
