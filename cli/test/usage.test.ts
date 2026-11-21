import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, homePath } from '../src/home.js';
import { loadLedger, parseSessionFile, priceOf, usageView } from '../src/usage.js';
import { useTempHome } from './helpers.js';

// The usage ledger (2026-11-21): one engine under the monitor and the per-conversation trace.
// Research: research/monitoring/PICKS.md.

const NOW = new Date('2026-11-21T15:00:00Z');
let projects: string;

const assistant = (o: { id: string; req?: string; session?: string; cwd?: string; at?: string; model?: string; usage: Record<string, unknown>; agent?: string }) =>
  JSON.stringify({
    type: 'assistant', sessionId: o.session ?? 's1', requestId: o.req ?? `r-${o.id}`, cwd: o.cwd ?? '/work/app', timestamp: o.at ?? '2026-11-21T10:00:00Z',
    ...(o.agent ? { agentId: o.agent } : {}),
    message: { id: o.id, model: o.model ?? 'claude-opus-5-5', usage: o.usage, content: [{ type: 'text', text: 'never read' }] },
  });
const u = (i: number, o: number, read = 0, w5 = 0, w1 = 0) => ({
  input_tokens: i, output_tokens: o, cache_read_input_tokens: read, cache_creation_input_tokens: w5 + w1,
  cache_creation: { ephemeral_5m_input_tokens: w5, ephemeral_1h_input_tokens: w1 },
});

function file(rel: string, lines: string[]): string {
  const p = join(projects, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

describe('prices', () => {
  // Real requests on 2026-11-21: Claude Code's own total_cost_usd for each, matched to the 8th decimal.
  it('match the cost Claude Code recorded, 1-hour cache writes included', () => {
    expect(priceOf('claude-haiku-5-5', { input: 2, output: 82, cacheRead: 649, cacheWrite5m: 0, cacheWrite1h: 3135 })).toBeCloseTo(0.00067469, 8);
    expect(priceOf('claude-opus-5-5', { input: 2, output: 116, cacheRead: 649, cacheWrite5m: 0, cacheWrite1h: 2383 })).toBeCloseTo(0.0215218, 7);
  });

  it('a 1-hour cache write costs 1.6× a 5-minute one', () => {
    const five = priceOf('claude-opus-5-5', { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 1000, cacheWrite1h: 0 })!;
    const hour = priceOf('claude-opus-5-5', { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 1000 })!;
    expect(hour / five).toBeCloseTo(1.6, 6);
  });

  it('dated names and [1m] suffixes find their row; an unknown model has no price', () => {
    expect(priceOf('claude-sonnet-4-5-20250929', { input: 100_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeCloseTo(0.3, 6);
    expect(priceOf('claude-opus-5-5[1m]', { input: 1e6, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeCloseTo(4, 6);
    expect(priceOf('claude-made-up-9', { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeNull();
  });

  it('the long-context tier prices the whole call once the prompt is over its threshold', () => {
    const small = priceOf('claude-sonnet-4-5', { input: 100_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })!;
    const big = priceOf('claude-sonnet-4-5', { input: 300_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })!;
    expect(small).toBeCloseTo(0.3, 6);
    expect(big).toBeCloseTo(1.8, 6); // $6/M, not 3 × $0.30
  });
});

describe('the ledger', () => {
  useTempHome();
  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'chompyy-usage-'));
    process.env.CHOMPYY_CLAUDE_PROJECTS = projects;
  });

  it('counts a request logged once per content block only once, keeping the largest copy and the first time', () => {
    const f = file('app/s1.jsonl', [
      assistant({ id: 'm1', at: '2026-11-21T10:00:00Z', usage: u(10, 5) }),
      assistant({ id: 'm1', at: '2026-11-21T10:00:02Z', usage: u(10, 50) }),
      assistant({ id: 'm1', at: '2026-11-21T10:00:03Z', usage: u(10, 50) }),
      assistant({ id: 'm2', usage: u(1, 1) }),
      JSON.stringify({ type: 'user', message: { content: 'a "usage" word in your own text' } }),
    ]);
    const { rows } = parseSessionFile(f);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 'm1:r-m1', output: 50, at: '2026-11-21T10:00:00Z' });
  });

  it('groups a conversation under the folder it started in, even after Claude cds into a subfolder', () => {
    const f = file('app/s1.jsonl', [assistant({ id: 'a', cwd: '/work/app', usage: u(1, 1) }), assistant({ id: 'b', cwd: '/work/app/cli', usage: u(1, 1) })]);
    expect(parseSessionFile(f).rows.map((r) => r.workspace)).toEqual(['/work/app', '/work/app']);
  });

  it('dedupes across files, reads subagents, keeps the AI title, and adds away runs as recorded', () => {
    file('app/s1.jsonl', [assistant({ id: 'a', usage: u(100, 10) }), JSON.stringify({ type: 'ai-title', sessionId: 's1', aiTitle: 'Fix the parking box' })]);
    file('app/s1/subagents/agent-1.jsonl', [assistant({ id: 'sub', agent: 'agent-1', usage: u(50, 5) })]);
    file('app/copy.jsonl', [assistant({ id: 'a', usage: u(100, 10) })]); // a resumed copy of the same request
    appendJsonl(homePath('runs.jsonl'), { at: '2026-11-21T03:00:00Z', card: '24', title: 'Grow the box', cwd: '/work/app', status: 'success', durationMs: 1, fiveHourPct: null, weeklyPct: null, idea: '', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, thinking: 0, costUsd: 0.42, turns: 1, models: ['claude-opus-5-5'] } });
    const ledger = loadLedger();
    expect(ledger.rows.filter((r) => r.basis === 'calculated')).toHaveLength(2);
    const v = usageView(ledger, NOW, 7);
    const titles = v.conversations.map((c) => c.title);
    expect(titles).toContain('Fix the parking box');
    expect(titles).toContain('#24 Grow the box');
    expect(v.conversations.find((c) => c.away)!.costUsd).toBe(0.42);
  });

  it('keeps rows of a file Claude Code has cleaned up, and re-reads a file only when it changed', () => {
    const f = file('app/s1.jsonl', [assistant({ id: 'a', usage: u(1, 1) })]);
    expect(loadLedger().parsed).toBe(1);
    expect(loadLedger().parsed).toBe(0);
    appendFileSync(f, assistant({ id: 'b', usage: u(1, 1) }) + '\n');
    expect(loadLedger().parsed).toBe(1);
    rmSync(f);
    expect(loadLedger().rows).toHaveLength(2);
  });

  it('shows days, projects and models; hides the titles of folders you did not tick, but counts them', () => {
    file('app/s1.jsonl', [assistant({ id: 'a', at: '2026-11-21T10:00:00Z', usage: u(1000, 100) }), JSON.stringify({ type: 'ai-title', sessionId: 's1', aiTitle: 'Work' })]);
    file('home/s2.jsonl', [assistant({ id: 'b', session: 's2', cwd: '/Users/me', at: '2026-11-19T10:00:00Z', usage: u(1000, 100) }), JSON.stringify({ type: 'ai-title', sessionId: 's2', aiTitle: 'Homework' })]);
    const v = usageView(loadLedger(), NOW, 7, 10, (ws) => ws === '/work/app');
    expect(v.days).toHaveLength(7);
    expect(v.total.requests).toBe(2);
    expect(v.byWorkspace.map((w) => w.workspace).sort()).toEqual(['/Users/me', '/work/app']);
    const hidden = v.conversations.find((c) => c.session === 's2')!;
    expect(hidden).toMatchObject({ title: null, private: true });
    expect(v.conversations.find((c) => c.session === 's1')!.title).toBe('Work');
  });
});
