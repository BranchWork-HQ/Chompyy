import { describe, expect, it } from 'vitest';
import { mergeSnapshot, parseStatusline, statusLineText, statusText, windowView } from '../src/quota.js';
import { NOW, nowSec } from './helpers.js';

const input = (rl: unknown) => JSON.stringify({ model: { id: 'x' }, rate_limits: rl });

describe('parseStatusline', () => {
  it('reads both windows when present', () => {
    const snap = parseStatusline(
      input({
        five_hour: { used_percentage: 38, resets_at: nowSec + 6000 },
        seven_day: { used_percentage: 41.5, resets_at: nowSec + 300_000 },
      }),
      NOW,
    );
    expect(snap.capturedAt).toBe(NOW.toISOString());
    expect(snap.fiveHour).toEqual({ usedPct: 38, resetsAt: nowSec + 6000 });
    expect(snap.sevenDay).toEqual({ usedPct: 41.5, resetsAt: nowSec + 300_000 });
  });

  it('tolerates missing fields, windows and rate_limits', () => {
    expect(parseStatusline(input({ five_hour: { used_percentage: 10 } }), NOW).fiveHour).toBeUndefined();
    const onlyWeek = parseStatusline(input({ seven_day: { used_percentage: 5, resets_at: nowSec + 10 } }), NOW);
    expect(onlyWeek.fiveHour).toBeUndefined();
    expect(onlyWeek.sevenDay?.usedPct).toBe(5);
    expect(parseStatusline(JSON.stringify({ model: {} }), NOW)).toEqual({ capturedAt: NOW.toISOString() });
    expect(parseStatusline('not json', NOW)).toEqual({ capturedAt: NOW.toISOString() });
    expect(parseStatusline('', NOW)).toEqual({ capturedAt: NOW.toISOString() });
  });

  it('accepts numeric strings and milliseconds, and clamps the percentage', () => {
    const snap = parseStatusline(input({ five_hour: { used_percentage: '120', resets_at: String((nowSec + 60) * 1000) } }), NOW);
    expect(snap.fiveHour).toEqual({ usedPct: 100, resetsAt: nowSec + 60 });
  });

  it('keeps windows from the previous snapshot that the new input lacks', () => {
    const prev = parseStatusline(input({ five_hour: { used_percentage: 20, resets_at: nowSec + 100 } }), NOW);
    const merged = mergeSnapshot(prev, parseStatusline('{}', NOW));
    expect(merged.fiveHour?.usedPct).toBe(20);
  });
});

describe('windowView and pace', () => {
  it('computes % left, time left and per-hour pace', () => {
    const v = windowView({ usedPct: 65, resetsAt: nowSec + 40 * 60 }, NOW);
    expect(v.known).toBe(true);
    if (!v.known) return;
    expect(v.leftPct).toBe(35);
    expect(v.msLeft).toBe(40 * 60_000);
    expect(v.pacePerHour).toBeCloseTo(52.5); // the spec's "35% left · 40 min → about 52% per hour"
  });

  it('does not blow up in the last seconds of a window', () => {
    const v = windowView({ usedPct: 50, resetsAt: nowSec + 1 }, NOW);
    expect(v.known && v.pacePerHour).toBe(50 * 60); // floored at one minute left
  });

  it('is unknown when missing or past resets_at (stale)', () => {
    expect(windowView(undefined, NOW)).toEqual({ known: false, reason: 'missing' });
    expect(windowView({ usedPct: 10, resetsAt: nowSec - 1 }, NOW)).toMatchObject({ known: false, reason: 'stale' });
    expect(windowView({ usedPct: 10, resetsAt: nowSec }, NOW)).toMatchObject({ known: false, reason: 'stale' });
  });
});

describe('text output', () => {
  it('prints the one-line status bar', () => {
    const snap = parseStatusline(
      input({
        five_hour: { used_percentage: 38, resets_at: nowSec + 100 * 60 },
        seven_day: { used_percentage: 41, resets_at: nowSec + 300_000 },
      }),
      NOW,
    );
    expect(statusLineText(snap, NOW)).toBe('🍪 5h 62% left · 1h40m · ~37%/h | 7d 41% used');
  });

  it('marks a stale or missing 5h window', () => {
    const stale = { capturedAt: NOW.toISOString(), fiveHour: { usedPct: 10, resetsAt: nowSec - 60 } };
    expect(statusLineText(stale, NOW)).toBe('🍪 5h reset');
    expect(statusText(stale, NOW)).toContain('STALE');
    expect(statusLineText({ capturedAt: NOW.toISOString() }, NOW)).toBe('🍪 5h ?');
    expect(statusText(null, NOW)).toContain('No quota snapshot yet');
  });
});
