// Triggers (spec §5.2): start an away run on its own in the last hour before a 5-hour reset, at your bedtime,
// or (missed-reset, off by default) on the first tick after a reset that nothing used, e.g. the Mac was asleep.
// `chompyy tick` checks them; `chompyy triggers on` installs a macOS LaunchAgent that runs the tick every
// 5 minutes. Nothing fires until you turn triggers on. The budget gate still decides every card.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config } from './config.js';
import { budgetGate } from './gate.js';
import { homePath, readJson, writeJson } from './home.js';
import { windowView, type Snapshot } from './quota.js';

export type TriggerKind = 'last-hour' | 'bedtime' | 'missed-reset';

export interface TriggerConfig {
  /** Run approved cards in the last hour before a 5-hour reset. */
  lastHourTrigger: boolean;
  /** Only when at least this much of the window is left (less is likely yours to finish). */
  lastHourMinLeftPct: number;
  /** "23:30" local time; null = no bedtime trigger. */
  bedtime: string | null;
  /** How long after bedtime it may still start, in minutes. */
  bedtimeWindowMin: number;
  /** Run approved cards on the first tick after a 5-hour reset passed and nothing started a new window. */
  missedReset: boolean;
}

export type TriggerDecision =
  | { fire: true; kind: TriggerKind; durationMs: number; key: string; why: string }
  | { fire: false; why: string };

interface TriggerState {
  /** Keys already fired: "last-hour:<resetsAt>", "bedtime:<YYYY-MM-DD>", "missed:<resetsAt>". */
  fired: string[];
  lastTickAt?: string;
  lastDecision?: string;
}

const statePath = () => homePath('triggers.json');
export const loadTriggerState = (): TriggerState => readJson<TriggerState>(statePath(), { fired: [] });

export function markFired(key: string, now: Date, why: string): void {
  const s = loadTriggerState();
  s.fired = [...s.fired.filter((k) => k !== key), key].slice(-50);
  s.lastTickAt = now.toISOString();
  s.lastDecision = why;
  writeJson(statePath(), s);
}

export function noteTick(now: Date, why: string): void {
  writeJson(statePath(), { ...loadTriggerState(), lastTickAt: now.toISOString(), lastDecision: why });
}

/** "23:30" → minutes after midnight; throws on anything else. */
export function parseClock(text: string): number {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`Bedtime must look like 23:30, not "${text}".`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** If `now` is within the bedtime window, the local date the bedtime started on (handles windows past midnight). */
export function bedtimeKey(now: Date, bedtime: string, windowMin: number): string | null {
  const start = parseClock(bedtime);
  const minutes = now.getHours() * 60 + now.getMinutes();
  let since = minutes - start;
  const day = new Date(now);
  if (since < 0) {
    since += 24 * 60; // bedtime was yesterday evening
    day.setDate(day.getDate() - 1);
  }
  if (since >= windowMin) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bedtime:${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Leave this much before the reset so the last card isn't cut off by a fresh window. */
const RESET_MARGIN_MS = 2 * 60_000;
const MIN_RUN_MS = 10 * 60_000;
const FIVE_HOURS_MS = 5 * 3600_000;

/** Should a trigger start an away run now? Pure: the tick reads state, this decides. */
export function decideTrigger(
  now: Date,
  snap: Snapshot | null,
  config: TriggerConfig & Pick<Config, 'min5hLeftPct' | 'weeklyReservePct' | 'weeklyPace'>,
  fired: string[],
  approved: number,
  awayRunning: boolean,
): TriggerDecision {
  if (awayRunning) return { fire: false, why: 'an away run is already going' };
  if (approved === 0) return { fire: false, why: 'no approved cards' };
  const gate = budgetGate(snap, config, now);
  if (!gate.ok) return { fire: false, why: `gate closed: ${gate.reasons.join('; ')}` };
  const five = windowView(snap?.fiveHour, now);
  // A reset window that nothing has restarted (the gate let it through): a run starts a fresh 5-hour window.
  const fresh = !five.known && five.reason === 'stale';
  if (!five.known && !fresh) return { fire: false, why: '5h window unknown' };
  const untilReset = (five.known ? five.msLeft : FIVE_HOURS_MS) - RESET_MARGIN_MS;

  if (five.known && config.lastHourTrigger && five.msLeft <= 60 * 60_000) {
    const key = `last-hour:${five.resetsAt}`;
    if (fired.includes(key)) return { fire: false, why: 'last-hour already ran for this window' };
    if (five.leftPct < config.lastHourMinLeftPct) return { fire: false, why: `last hour, but only ${Math.round(five.leftPct)}% left (under ${config.lastHourMinLeftPct}%)` };
    if (untilReset < MIN_RUN_MS) return { fire: false, why: 'too close to the reset to finish a card' };
    return { fire: true, kind: 'last-hour', durationMs: untilReset, key, why: `last hour before the reset with ${Math.round(five.leftPct)}% left` };
  }

  if (config.bedtime) {
    const key = bedtimeKey(now, config.bedtime, config.bedtimeWindowMin);
    if (key) {
      if (fired.includes(key)) return { fire: false, why: 'bedtime already ran tonight' };
      if (untilReset < MIN_RUN_MS) return { fire: false, why: 'too close to the reset to finish a card' };
      return { fire: true, kind: 'bedtime', durationMs: untilReset, key, why: five.known ? `bedtime, ${Math.round(five.leftPct)}% of the window left` : 'bedtime, a fresh window' };
    }
  }

  // The reset passed while no away run (and no session) started a new window: only cards you already approved run.
  if (fresh && config.missedReset) {
    const key = `missed:${five.resetsAt}`;
    if (fired.includes(key)) return { fire: false, why: 'missed-reset already ran for this reset' };
    return { fire: true, kind: 'missed-reset', durationMs: untilReset, key, why: 'a 5-hour reset passed unused, a fresh window' };
  }
  return { fire: false, why: 'no trigger due' };
}

// ---------- the away lock (a trigger and a manual away must not run the same cards) ----------

export function lockPath(): string {
  return homePath('away.lock');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The pid of a running away, or null. A lock left by a dead process doesn't count. */
export function awayRunning(): number | null {
  const lock = readJson<{ pid?: number } | null>(lockPath(), null);
  return lock?.pid && lock.pid !== process.pid && alive(lock.pid) ? lock.pid : null;
}

/** Take the lock or throw. Returns a release function. */
export function takeAwayLock(now: Date, why: string): () => void {
  const other = awayRunning();
  if (other) throw new Error(`Another away run is going (pid ${other}). Wait for it, or stop it first.`);
  writeJson(lockPath(), { pid: process.pid, at: now.toISOString(), why });
  return () => {
    const lock = readJson<{ pid?: number } | null>(lockPath(), null);
    if (lock?.pid === process.pid) rmSync(lockPath(), { force: true });
  };
}

// ---------- LaunchAgent ----------

export const AGENT_LABEL = 'dev.chompyy.tick';

export function agentPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${AGENT_LABEL}.plist`);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function launchAgentPlist(opts: { node: string; script: string; log: string; env: Record<string, string>; intervalSec?: number }): string {
  const env = Object.entries(opts.env)
    .map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(opts.node)}</string>
      <string>${xml(opts.script)}</string>
      <string>tick</string>
    </array>
    <key>StartInterval</key><integer>${opts.intervalSec ?? 300}</integer>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>${xml(opts.log)}</string>
    <key>StandardErrorPath</key><string>${xml(opts.log)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
  </dict>
</plist>
`;
}

function launchctl(args: string[]): void {
  execFileSync('launchctl', args, { stdio: 'ignore' });
}

/** Install (or reinstall) the LaunchAgent that runs `chompyy tick` every 5 minutes. */
export function installAgent(): string {
  if (process.platform !== 'darwin') throw new Error('Triggers run from a macOS LaunchAgent; on other systems, run `chompyy tick` from cron every 5 minutes.');
  const path = agentPath();
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.env.CHOMPYY_HOME) env.CHOMPYY_HOME = process.env.CHOMPYY_HOME;
  if (process.env.HOME) env.HOME = process.env.HOME;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, launchAgentPlist({ node: process.execPath, script: process.argv[1]!, log: homePath('tick.log'), env }));
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    launchctl(['bootout', `${domain}/${AGENT_LABEL}`]);
  } catch {}
  launchctl(['bootstrap', domain, path]);
  return path;
}

export function uninstallAgent(): boolean {
  const path = agentPath();
  if (!existsSync(path)) return false;
  try {
    launchctl(['bootout', `gui/${process.getuid?.() ?? 501}/${AGENT_LABEL}`]);
  } catch {}
  rmSync(path, { force: true });
  return true;
}

export function agentInstalled(): boolean {
  return existsSync(agentPath());
}
