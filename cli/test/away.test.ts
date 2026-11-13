import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { away, type AwayDeps } from '../src/away.js';
import { addCard, loadBoard, moveCard, updateBoard } from '../src/board.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Snapshot } from '../src/quota.js';
import type { RunRequest, RunResult, Runner } from '../src/runner.js';
import { NOW, useTempHome } from './helpers.js';

const MIN = 60_000;

/** A clock that only moves when the fake runner says so. */
function setup(home: () => string, opts: { cards?: number; runMs?: number; snapshot?: () => Snapshot | null; result?: Partial<RunResult>; onRun?: (req: RunRequest) => void } = {}) {
  let clock = NOW.getTime();
  const requests: RunRequest[] = [];
  const runner: Runner = {
    async run(req) {
      requests.push(req);
      opts.onRun?.(req);
      const ms = Math.min(opts.runMs ?? 10 * MIN, req.timeoutMs);
      clock += ms;
      return { exitCode: 0, output: 'Made the thing.\nIt is in OUT.md\n', stderr: '', timedOut: ms === req.timeoutMs && (opts.runMs ?? 0) > req.timeoutMs, durationMs: ms, ...opts.result };
    },
  };
  const resetsAt = Math.floor(NOW.getTime() / 1000) + 4 * 3600;
  const healthy: Snapshot = { capturedAt: NOW.toISOString(), fiveHour: { usedPct: 40, resetsAt }, sevenDay: { usedPct: 30, resetsAt: resetsAt + 86_400 } };
  updateBoard((b) => {
    for (let i = 1; i <= (opts.cards ?? 3); i++) {
      addCard(b, `task ${i}`, '/not/a/repo', NOW).blueprint = `## Goal\ntask ${i}`;
      moveCard(b, String(i), 'approved', new Date(NOW.getTime() + i));
    }
  });
  const lines: string[] = [];
  const ws = (card: { id: string }) => ({ kind: 'draft' as const, dir: join(home(), 'runs', card.id, 'work') });
  const deps: AwayDeps = {
    runner,
    config: { ...DEFAULT_CONFIG, cardTimeoutMin: 30 },
    now: () => clock,
    snapshot: opts.snapshot ?? (() => healthy),
    plan: ws,
    prepare: (card) => {
      const w = ws(card);
      mkdirSync(w.dir, { recursive: true });
      return w;
    },
    out: (l) => lines.push(l),
  };
  return { deps, requests, lines, advance: (ms: number) => (clock += ms), healthy };
}

const columns = () => Object.fromEntries(loadBoard().cards.map((c) => [c.id, c.column]));

describe('away loop', () => {
  const home = useTempHome();

  it('runs approved cards in order and moves them to review with a log', async () => {
    const { deps, requests } = setup(home);
    const summary = await away(60 * MIN, deps);
    expect(summary.ran).toEqual(['1', '2', '3']);
    expect(columns()).toEqual({ 1: 'review', 2: 'review', 3: 'review' });
    const card = loadBoard().cards[0]!;
    expect(card.run).toMatchObject({ status: 'ok', durationMs: 10 * MIN, summary: 'Made the thing.\nIt is in OUT.md' });
    expect(readFileSync(card.logPath!, 'utf8')).toContain('# Task #1: task 1');
    // The safety rules come first and the blueprint is the task.
    expect(requests[0]!.prompt.indexOf('Nothing outward')).toBeLessThan(requests[0]!.prompt.indexOf('## Goal'));
    expect(requests[0]!.prompt).toContain('QUESTIONS.md');
    expect(requests[0]!.cwd).toBe(join(home(), 'runs', '1', 'work'));
  });

  it('stops when the duration is used up and caps each card at the time left', async () => {
    const { deps, requests } = setup(home, { runMs: 25 * MIN });
    const summary = await away(40 * MIN, deps);
    // card 1 takes 25m; card 2 gets the 15m left; nothing is left for card 3.
    expect(requests.map((r) => r.timeoutMs)).toEqual([30 * MIN, 15 * MIN]);
    expect(summary).toMatchObject({ ran: ['1', '2'], skipped: ['3'], stoppedBecause: 'time is up' });
    expect(columns()).toEqual({ 1: 'review', 2: 'review', 3: 'approved' });
    expect(loadBoard().cards[1]!.run!.status).toBe('timeout');
  });

  it('respects the budget gate before every card', async () => {
    let calls = 0;
    const ctx = setup(home, {
      snapshot: () => (calls++ < 1 ? ctx.healthy : { ...ctx.healthy, fiveHour: { ...ctx.healthy.fiveHour!, usedPct: 95 } }),
    });
    const summary = await away(60 * MIN, ctx.deps);
    expect(summary.ran).toEqual(['1']);
    expect(summary.stoppedBecause).toMatch(/under the 10% minimum/);
    expect(columns()).toEqual({ 1: 'review', 2: 'approved', 3: 'approved' });
  });

  it('runs nothing with a stale snapshot unless forced', async () => {
    const stale = () => ({ capturedAt: NOW.toISOString(), fiveHour: { usedPct: 0, resetsAt: Math.floor(NOW.getTime() / 1000) - 1 } });
    const { deps, requests } = setup(home, { cards: 1, snapshot: stale });
    expect((await away(60 * MIN, deps)).ran).toEqual([]);
    expect(requests).toHaveLength(0);
    expect((await away(60 * MIN, deps, { force: true })).ran).toEqual(['1']);
  });

  it('dry run plans without running or moving anything', async () => {
    const { deps, requests, lines } = setup(home);
    const summary = await away(30 * MIN, deps, { dryRun: true });
    expect(summary.ran).toEqual(['1', '2', '3']);
    expect(requests).toHaveLength(0);
    expect(columns()).toEqual({ 1: 'approved', 2: 'approved', 3: 'approved' });
    expect(lines.join('\n')).toContain('Dry run: nothing was started.');
  });

  it('marks failures, questions and workspace errors', async () => {
    const { deps } = setup(home, {
      cards: 3,
      onRun: (req) => {
        if (req.cwd.endsWith(join('2', 'work'))) writeFileSync(join(req.cwd, 'QUESTIONS.md'), 'Which API?');
      },
    });
    const prepare = deps.prepare;
    deps.prepare = (card) => {
      if (card.id === '3') throw new Error('git worktree failed');
      return prepare(card);
    };
    await away(120 * MIN, deps);
    const status = loadBoard().cards.map((c) => c.run!.status);
    expect(status).toEqual(['ok', 'questions', 'error']);
    expect(columns()).toEqual({ 1: 'review', 2: 'review', 3: 'review' });

    const failing = setup(home, { cards: 0, result: { exitCode: 1, output: '', stderr: 'boom' } });
    updateBoard((b) => moveCard(b, '1', 'approved', NOW)); // review → approved for a rerun
    await away(60 * MIN, failing.deps);
    expect(loadBoard().cards[0]!.run).toMatchObject({ status: 'failed', summary: 'boom' });
  });

  it('says so when nothing is approved', async () => {
    const { deps, lines } = setup(home, { cards: 0 });
    expect((await away(60 * MIN, deps)).ran).toEqual([]);
    expect(lines[0]).toMatch(/No approved cards/);
    expect(existsSync(join(home(), 'runs'))).toBe(false);
  });
});
