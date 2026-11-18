import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Snapshot } from '../src/quota.js';
import { awayRunning, bedtimeKey, decideTrigger, launchAgentPlist, parseClock, takeAwayLock } from '../src/triggers.js';
import { useTempHome } from './helpers.js';

// Local times, so the bedtime tests don't depend on the machine's time zone.
const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m);
const snap = (now: Date, leftPct: number, minutesToReset: number): Snapshot => {
  const resetsAt = Math.floor(now.getTime() / 1000) + minutesToReset * 60;
  return { capturedAt: now.toISOString(), fiveHour: { usedPct: 100 - leftPct, resetsAt }, sevenDay: { usedPct: 10, resetsAt: resetsAt + 5 * 86_400 } };
};
const cfg = { ...DEFAULT_CONFIG, lastHourTrigger: true, lastHourMinLeftPct: 25, bedtime: null as string | null };

describe('decideTrigger', () => {
  it('fires in the last hour with enough left, once per window, ending before the reset', () => {
    const now = at(15);
    const s = snap(now, 40, 50);
    const d = decideTrigger(now, s, cfg, [], 2, false);
    expect(d).toMatchObject({ fire: true, kind: 'last-hour', durationMs: 48 * 60_000, key: `last-hour:${s.fiveHour!.resetsAt}` });
    expect(decideTrigger(now, s, cfg, [d.fire ? d.key : ''], 2, false)).toMatchObject({ fire: false, why: 'last-hour already ran for this window' });
  });

  it('holds off with little left, too close to the reset, nothing approved, a run going, or the trigger off', () => {
    const now = at(15);
    expect(decideTrigger(now, snap(now, 20, 50), cfg, [], 2, false).why).toMatch(/only 20% left/);
    expect(decideTrigger(now, snap(now, 60, 8), cfg, [], 2, false).why).toMatch(/too close/);
    expect(decideTrigger(now, snap(now, 60, 50), cfg, [], 0, false).why).toBe('no approved cards');
    expect(decideTrigger(now, snap(now, 60, 50), cfg, [], 2, true).why).toMatch(/already going/);
    expect(decideTrigger(now, snap(now, 60, 50), { ...cfg, lastHourTrigger: false }, [], 2, false).why).toBe('no trigger due');
    expect(decideTrigger(now, snap(now, 60, 200), cfg, [], 2, false).why).toBe('no trigger due');
  });

  it('respects the budget gate', () => {
    const now = at(15);
    const s = snap(now, 60, 50);
    s.sevenDay!.usedPct = 95;
    expect(decideTrigger(now, s, cfg, [], 2, false).why).toMatch(/gate closed: weekly usage is 95%/);
    expect(decideTrigger(now, null, cfg, [], 2, false).why).toMatch(/gate closed/);
  });

  it('fires at bedtime once a night, for the window that is left', () => {
    const c = { ...cfg, bedtime: '23:30', bedtimeWindowMin: 60 };
    const now = at(23, 45);
    const d = decideTrigger(now, snap(now, 70, 180), c, [], 1, false);
    expect(d).toMatchObject({ fire: true, kind: 'bedtime', key: 'bedtime:2026-11-13', durationMs: 178 * 60_000 });
    expect(decideTrigger(now, snap(now, 70, 180), c, ['bedtime:2026-11-13'], 1, false).why).toMatch(/already ran tonight/);
    expect(decideTrigger(at(22), snap(at(22), 70, 180), c, [], 1, false).why).toBe('no trigger due');
  });
});

describe('decideTrigger on a reset window', () => {
  // The window had reset and nothing restarted it: bedtime should still run, in a fresh 5-hour window.
  it('fires at bedtime with a fresh window, but never the last-hour trigger', () => {
    const c = { ...cfg, bedtime: '23:30', bedtimeWindowMin: 60 };
    const now = at(23, 45);
    const reset = snap(now, 30, -40); // the window ended 40 minutes ago
    expect(decideTrigger(now, reset, c, [], 1, false)).toMatchObject({ fire: true, kind: 'bedtime', durationMs: (5 * 60 - 2) * 60_000, why: 'bedtime, a fresh window' });
    expect(decideTrigger(at(15), snap(at(15), 30, -40), cfg, [], 1, false)).toMatchObject({ fire: false, why: 'no trigger due' });
  });
});

describe('bedtime', () => {
  it('parses clock times', () => {
    expect(parseClock('23:30')).toBe(23 * 60 + 30);
    expect(() => parseClock('25:00')).toThrow(/23:30/);
    expect(() => parseClock('11pm')).toThrow();
  });

  it('keeps the evening date for a window past midnight', () => {
    expect(bedtimeKey(at(0, 15, 14), '23:30', 90)).toBe('bedtime:2026-11-13');
    expect(bedtimeKey(at(1, 30, 14), '23:30', 90)).toBeNull();
    expect(bedtimeKey(at(23, 29), '23:30', 90)).toBeNull();
  });
});

describe('away lock', () => {
  useTempHome();

  it('one away at a time; a lock from a dead process does not count', async () => {
    const release = takeAwayLock(new Date(), 'test');
    expect(awayRunning()).toBeNull(); // our own pid never blocks us
    release();
    const { writeJson, homePath } = await import('../src/home.js');
    writeJson(homePath('away.lock'), { pid: 999_999_999 });
    expect(awayRunning()).toBeNull();
    writeJson(homePath('away.lock'), { pid: process.ppid });
    expect(awayRunning()).toBe(process.ppid);
    expect(() => takeAwayLock(new Date(), 'test')).toThrow(/Another away run/);
  });
});

describe('LaunchAgent', () => {
  it('runs chompyy tick every 5 minutes with the PATH it was installed from', () => {
    const plist = launchAgentPlist({ node: '/usr/local/bin/node', script: '/x/cli.js', log: '/h/tick.log', env: { PATH: '/a:/b', CHOMPYY_HOME: '/h&co' } });
    expect(plist).toContain('<string>tick</string>');
    expect(plist).toContain('<integer>300</integer>');
    expect(plist).toContain('<key>PATH</key><string>/a:/b</string>');
    expect(plist).toContain('/h&amp;co');
  });
});
