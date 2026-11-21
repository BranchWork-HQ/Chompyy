import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { byKind, compare, kindOf, loadLedger, periodDays, prCosts } from '../src/usage.js';
import { useTempHome } from './helpers.js';

// The Usage window (2026-11-21): periods, comparisons, kinds of work, cost per pull request.

let projects: string;
const req = (id: string, at: string, tools: string[] = [], session = 's1', out = 1000) =>
  JSON.stringify({
    type: 'assistant', sessionId: session, requestId: `r${id}`, cwd: '/work/app', timestamp: at,
    message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: tools.map((name, i) => ({ type: 'tool_use', id: `${id}${i}`, name, input: {} })) },
  });
const pr = (n: number, at: string, session = 's1') => JSON.stringify({ type: 'pr-link', sessionId: session, prNumber: n, prUrl: `https://github.com/o/app/pull/${n}`, prRepository: 'o/app', timestamp: at });

function write(lines: string[]): void {
  mkdirSync(join(projects, 'app'), { recursive: true });
  writeFileSync(join(projects, 'app', 's1.jsonl'), lines.join('\n') + '\n');
}

describe('kinds of work', () => {
  it('come from the tools a request used, in priority order, in any language', () => {
    expect(kindOf(['Read', 'Edit'])).toBe('Coding');
    expect(kindOf(['Bash', 'Read'])).toBe('Running commands');
    expect(kindOf(['Grep'])).toBe('Reading code');
    expect(kindOf(['WebSearch', 'Bash'])).toBe('Research');
    expect(kindOf(['Task'])).toBe('Delegating');
    expect(kindOf(['TodoWrite'])).toBe('Planning');
    expect(kindOf([])).toBe('Conversation');
  });
});

describe('periods', () => {
  it('Month starts on the 1st; the others are fixed', () => {
    const now = new Date(2026, 10, 21, 15);
    expect([periodDays('today', now), periodDays('7d', now), periodDays('30d', now), periodDays('month', now)]).toEqual([1, 7, 30, 21]);
  });
});

describe('the ledger for the Usage window', () => {
  useTempHome();
  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'chompyy-uw-'));
    process.env.CHOMPYY_CLAUDE_PROJECTS = projects;
  });

  it('gathers the tools of a request logged once per content block', () => {
    write([req('a', '2026-11-21T10:00:00Z', ['Read']), req('a', '2026-11-21T10:00:01Z', ['Edit'])]);
    expect(loadLedger().rows[0]!.tools).toEqual(['Read', 'Edit']);
  });

  it('sums by kind of work', () => {
    write([req('a', '2026-11-21T10:00:00Z', ['Edit']), req('b', '2026-11-21T10:01:00Z', []), req('c', '2026-11-21T10:02:00Z', [])]);
    const k = byKind(loadLedger(), '2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z');
    expect(k.map((x) => [x.kind, x.total.requests])).toEqual([['Conversation', 2], ['Coding', 1]]);
  });

  it('costs each pull request as the work since the previous one, ignoring duplicate links and mentions with no work', () => {
    write([
      req('a', '2026-11-21T10:00:00Z'),
      req('b', '2026-11-21T10:05:00Z'),
      pr(1, '2026-11-21T10:06:00Z'),
      pr(1, '2026-11-21T10:06:01Z'), // written again
      req('c', '2026-11-21T11:00:00Z'),
      pr(2, '2026-11-21T11:01:00Z'),
      pr(3, '2026-11-21T11:01:30Z'), // only mentioned right after: no work of its own
    ]);
    const prs = prCosts(loadLedger(), '2026-11-21T00:00:00Z', '2026-11-22T00:00:00Z');
    expect(prs.map((p) => [p.number, p.total.requests])).toEqual([[2, 1], [1, 2]]);
  });

  it('compares today with yesterday and the 7-day average, and the month with the plan price', () => {
    const now = new Date(2026, 10, 21, 12);
    const day = (d: number, h = 10) => new Date(2026, 10, d, h).toISOString();
    write([req('t', day(21), [], 's1', 2_000_000), req('y', day(20), [], 's1', 1_000_000), req('w', day(15), [], 's1', 1_000_000), req('l', new Date(2026, 9, 5, 10).toISOString(), [], 's1', 1_000_000)]);
    const c = compare(loadLedger(), now, { label: 'Pro', priceUsd: null });
    // Opus 5.5 output is $20 per million tokens.
    expect(c.yesterday.costUsd).toBe(20);
    expect(c.avg7.costUsd).toBeCloseTo(40 / 7, 1);
    expect(c.vsYesterdayPct).toBe(100);
    expect(c.month.toDate.costUsd).toBe(80);
    expect(c.month.lastMonthSameDays.costUsd).toBe(20);
    expect(c.month.plan).toMatchObject({ label: 'Pro', priceUsd: 20, multiple: 4 });
    expect(c.month.projectedUsd).toBeGreaterThan(80);
  });

  it('your own plan price wins over the list price', () => {
    write([req('t', new Date().toISOString(), [], 's1', 1_000_000)]);
    expect(compare(loadLedger(), new Date(), { label: 'Pro', priceUsd: 25 }).month.plan?.priceUsd).toBe(25);
    expect(compare(loadLedger(), new Date(), { label: 'Team', priceUsd: null }).month.plan).toBeNull();
  });
});
