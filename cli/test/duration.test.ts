import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../src/duration.js';

describe('parseDuration', () => {
  it.each([
    ['1h', 3_600_000],
    ['30m', 1_800_000],
    ['1h30m', 5_400_000],
    ['1.5h', 5_400_000],
    ['45s', 45_000],
    ['90', 5_400_000],
    [' 2H ', 7_200_000],
  ])('%s', (text, ms) => expect(parseDuration(text)).toBe(ms));

  it.each(['', 'soon', '1x', '0m', '1h banana', '-5m'])('rejects %j', (text) => {
    expect(() => parseDuration(text)).toThrow();
  });
});

describe('formatDuration', () => {
  it.each([
    [30_000, '<1m'],
    [40 * 60_000, '40m'],
    [100 * 60_000, '1h40m'],
    [65 * 60_000, '1h05m'],
    [120 * 60_000, '2h'],
    [(3 * 24 + 4) * 3_600_000, '3d4h'],
  ])('%i ms → %s', (ms, text) => expect(formatDuration(ms)).toBe(text));
});
