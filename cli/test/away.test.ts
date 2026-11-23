import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { away, awayTools, safetyRules, sandboxSettings, type AwayDeps } from '../src/away.js';
import { boxTempDirs, sandboxProfile } from '../src/verify.js';
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

describe('away loop: recovery and questions', () => {
  const home = useTempHome();

  it('a QUESTIONS.md that was already there and untouched does not count as questions', async () => {
    const { deps } = setup(home, { cards: 1 });
    const dir = join(home(), 'runs', '1', 'work');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'QUESTIONS.md'), 'old question');
    await away(60 * MIN, deps);
    expect(loadBoard().cards[0]!.run!.status).toBe('ok');
  });

  it('moves a card left in running by a crashed run to review, then runs the rest of the queue', async () => {
    const { deps, lines } = setup(home, { cards: 2 });
    updateBoard((b) => {
      b.cards[0]!.column = 'running';
    });
    const summary = await away(60 * MIN, deps);
    expect(lines.some((l) => l.includes('Moved to review after an interrupted run: #1'))).toBe(true);
    expect(loadBoard().cards[0]!.run!.status).toBe('error');
    expect(summary.ran).toEqual(['2']);
    expect(columns()).toEqual({ 1: 'review', 2: 'review' });
  });
});

describe('guardrails: one bad card never eats the night', () => {
  const home = useTempHome();

  it('a worker that dies mid-card puts that card in review and the queue goes on', async () => {
    const { deps, lines } = setup(home, { cards: 3 });
    const { runCard } = await import('../src/away.js');
    deps.isolate = async (id, timeoutMs, trigger) => {
      if (id === '1') {
        // What happened on 2026-11-17: the process died (out of memory) with the card still in running.
        updateBoard((b) => {
          b.cards.find((c) => c.id === '1')!.column = 'running';
        });
        return { exitCode: 134, signal: null, stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n 1: 0x10055f0b8 node::OOMErrorHandler' };
      }
      await runCard(id, timeoutMs, deps, trigger);
      return { exitCode: 0, stderr: '' };
    };
    const summary = await away(8 * 60 * MIN, deps);
    expect(summary.ran).toEqual(['1', '2', '3']);
    expect(columns()).toEqual({ 1: 'review', 2: 'review', 3: 'review' });
    const run = loadBoard().cards[0]!.run!;
    expect(run.status).toBe('error');
    expect(run.summary).toMatch(/exited with code 134 before it finished: FATAL ERROR: Reached heap limit/);
    expect(run.summary).not.toMatch(/0x10055f0b8/);
    expect(lines.some((l) => l.includes('Moving on to the next card'))).toBe(true);
    expect(loadBoard().cards[1]!.run!.status).toBe('ok');
  });

  it('a worker that cannot even start still does not stop the queue', async () => {
    const { deps } = setup(home, { cards: 2 });
    deps.isolate = async () => {
      throw new Error('spawn ENOENT');
    };
    const summary = await away(60 * MIN, deps);
    expect(summary.ran).toEqual(['1', '2']); // neither reached running, both stay approved
    expect(columns()).toEqual({ 1: 'approved', 2: 'approved' });
  });

  it('a stalled agent is stopped as stuck, says why, and asks the runner to watch for it', async () => {
    const { deps, requests } = setup(home, { cards: 2, result: { exitCode: null, stalled: 'no progress for 15m' } });
    await away(60 * MIN, deps);
    expect(requests[0]!.idleTimeoutMs).toBe(15 * MIN);
    const run = loadBoard().cards[0]!.run!;
    expect(run.status).toBe('stuck');
    expect(run.summary).toMatch(/no progress for 15m/);
    expect(loadBoard().cards[1]!.column).toBe('review'); // and the next card ran
  });
});

describe('permission plan in a run', () => {
  const home = useTempHome();
  it('a card runs with exactly what you allowed, and remembers what it was blocked on', async () => {
    const { deps, requests } = setup(home, { cards: 1, result: { needs: { commands: ['swiftc *'], hosts: [] } } });
    updateBoard((b) => {
      b.cards[0]!.permissions = ['command:swiftc *', 'network:docs.swift.org'];
    });
    const recorded: unknown[] = [];
    deps.recordNeeds = (card, needs) => recorded.push([card.id, needs]);
    deps.config = { ...deps.config, sandbox: true };
    await away(60 * MIN, deps);
    expect(requests[0]!.allowedTools).toContain('Bash(swiftc *)');
    expect(JSON.stringify(requests[0]!.settings)).toContain('docs.swift.org');
    expect(recorded).toEqual([['1', { commands: ['swiftc *'], hosts: [] }]]);
  });

  it('a card nobody allowed anything for gets only the defaults', async () => {
    const { deps, requests } = setup(home, { cards: 1 });
    await away(60 * MIN, deps);
    expect(requests[0]!.allowedTools).toEqual(deps.config.allowedTools);
  });
});

// 2026-11-18: "Going to sleep" would have stopped at ~23:40 when the window ran low and left the night unused.
describe('a long away run waits out a 5-hour reset', () => {
  const home = useTempHome();
  const resetIn = 30 * MIN;
  // Low window until the reset, a fresh one after it; the week is fine throughout.
  const snapAt = (clock: () => number) => () => {
    const resetsAt = Math.floor((NOW.getTime() + resetIn) / 1000);
    const afterReset = clock() >= NOW.getTime() + resetIn;
    return {
      capturedAt: new Date(clock()).toISOString(),
      fiveHour: afterReset ? { usedPct: 0, resetsAt: resetsAt + 5 * 3600 } : { usedPct: 95, resetsAt },
      sevenDay: { usedPct: 1, resetsAt: resetsAt + 6 * 86_400 },
    };
  };

  it('waits for the reset, then runs the cards', async () => {
    let clockRef = () => 0;
    const { deps, lines, advance } = setup(home, { cards: 2, snapshot: () => snapAt(clockRef)() });
    clockRef = deps.now;
    const waited: number[] = [];
    deps.wait = async (ms) => {
      waited.push(ms);
      advance(ms);
    };
    const summary = await away(8 * 60 * MIN, deps);
    expect(waited).toEqual([resetIn + 2 * MIN]);
    expect(lines.some((l) => /Waiting for the 5-hour window to reset/.test(l))).toBe(true);
    expect(summary.ran).toEqual(['1', '2']);
  });

  it("doesn't wait when the reset comes after the run's end", async () => {
    let clockRef = () => 0;
    const { deps } = setup(home, { cards: 1, snapshot: () => snapAt(clockRef)() });
    clockRef = deps.now;
    let waited = false;
    deps.wait = async () => {
      waited = true;
    };
    const summary = await away(20 * MIN, deps);
    expect(waited).toBe(false);
    expect(summary.stoppedBecause).toMatch(/5h window/);
  });

  it('never waits when the week is the problem', async () => {
    const { deps } = setup(home, { cards: 1, snapshot: () => ({ capturedAt: NOW.toISOString(), fiveHour: { usedPct: 95, resetsAt: Math.floor(NOW.getTime() / 1000) + 1800 }, sevenDay: { usedPct: 99, resetsAt: Math.floor(NOW.getTime() / 1000) + 86_400 } }) });
    let waited = false;
    deps.wait = async () => {
      waited = true;
    };
    const summary = await away(8 * 60 * MIN, deps);
    expect(waited).toBe(false);
    expect(summary.stoppedBecause).toMatch(/weekly/);
  });
});

describe('sandbox', () => {
  const home = useTempHome();
  it('runs away cards sandboxed by default, allowing writes to the tool cache and temp folders only, not the repo .git (#24)', async () => {
    const { deps, requests } = setup(home, { cards: 1 });
    deps.prepare = (card) => ({ kind: 'worktree', dir: join(home(), 'worktrees', card.id), branch: `chompyy/${card.id}`, gitDir: '/repo/.git' });
    mkdirSync(join(home(), 'worktrees', '1'), { recursive: true });
    await away(60 * MIN, deps);
    expect(requests[0]!.settings).toEqual({
      sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: [join(home(), 'cache', 'tools'), ...boxTempDirs()], denyRead: DEFAULT_CONFIG.denyReadPaths }, network: { allowedDomains: [] }, autoAllowBashIfSandboxed: true },
    });
    expect(requests[0]!.env?.GOCACHE).toBe(join(home(), 'cache', 'tools', 'go-build'));
    expect(requests[0]!.disallowedTools).toEqual(expect.arrayContaining(['Bash(git push *)', 'Read(~/.ssh)', 'Read(~/.ssh/**)', 'Read(~/.aws/**)']));
  });
  it('allows the same temp folders as Chompyy\'s own check box, so swift build works in both (2026-11-18)', () => {
    const settings = sandboxSettings({ kind: 'worktree', dir: '/w', branch: 'b', gitDir: '/g' } as never, []) as { sandbox: { filesystem: { allowWrite: string[] } } };
    const profile = sandboxProfile({ writable: [], denyRead: [] });
    for (const t of boxTempDirs()) {
      expect(settings.sandbox.filesystem.allowWrite).toContain(t);
      expect(profile).toContain(`(subpath "${t}")`);
    }
    expect(boxTempDirs()).toContain('/private/tmp');
  });
  it('can be turned off', async () => {
    const { deps, requests } = setup(home, { cards: 1 });
    deps.config = { ...deps.config, sandbox: false };
    await away(60 * MIN, deps);
    expect(requests[0]!.settings).toBeUndefined();
  });
});

describe('cost and taste', () => {
  const home = useTempHome();

  it('records what each card used of the windows, from quota before and after', async () => {
    let used = 40;
    const resetsAt = Math.floor(NOW.getTime() / 1000) + 4 * 3600;
    const { deps } = setup(home, { cards: 2, onRun: () => (used += 6) });
    deps.snapshot = () => ({ capturedAt: NOW.toISOString(), fiveHour: { usedPct: used, resetsAt }, sevenDay: { usedPct: 20, resetsAt: resetsAt + 86_400 } });
    let reads = 0;
    deps.refreshQuota = async () => {
      reads++;
    };
    await away(60 * MIN, deps, { trigger: 'last-hour' });
    const cards = loadBoard().cards;
    expect(cards[0]!.run).toMatchObject({ cost: { fiveHourPct: 6, weeklyPct: 0 }, trigger: 'last-hour' });
    const { readRuns } = await import('../src/costs.js');
    expect(readRuns().map((r) => [r.card, r.fiveHourPct])).toEqual([['1', 6], ['2', 6]]);
    expect(reads).toBe(3); // before the first card, then after each (not again right before the second)
  });

  it('gives the agent your taste.md, without Chompyy\'s bookkeeping', async () => {
    const { deps, requests } = setup(home, { cards: 1 });
    deps.taste = () => '## Everywhere\n- Explain in plain words';
    await away(60 * MIN, deps);
    expect(requests[0]!.prompt).toContain('# How this user likes work done');
    expect(requests[0]!.prompt).toContain('- Explain in plain words');
  });

  it('leaves the taste section out when nothing is learned', async () => {
    const { deps, requests } = setup(home, { cards: 1 });
    deps.taste = () => '';
    await away(60 * MIN, deps);
    expect(requests[0]!.prompt).not.toContain('How this user likes work done');
  });
});

describe('circuit breaker and independent check', () => {
  const home = useTempHome();

  it('asks the runner to watch for loops, and marks a stopped run as stuck', async () => {
    const { deps, requests, lines } = setup(home, { cards: 1, result: { exitCode: null, stuck: 'called Bash({"command":"npm test"}) 5 times' } });
    await away(60 * MIN, deps);
    expect(requests[0]!.loopRepeat).toBe(5);
    const run = loadBoard().cards[0]!.run!;
    expect(run.status).toBe('stuck');
    expect(run.summary).toMatch(/going in circles/);
    expect(lines.join('\n')).toMatch(/⛔ stopped/);
  });

  it('runs the independent check on worktree runs and keeps its verdict', async () => {
    const { deps } = setup(home, { cards: 2 });
    deps.prepare = (card) => {
      const dir = join(home(), 'worktrees', card.id);
      mkdirSync(dir, { recursive: true });
      return card.id === '1' ? { kind: 'worktree', dir, branch: `chompyy/${card.id}` } : { kind: 'draft', dir };
    };
    const checked: string[] = [];
    deps.verify = async (_ws, card) => {
      checked.push(card.id);
      return { result: 'failed', command: 'npm test', why: 'npm test exited with 1', at: NOW.toISOString() };
    };
    await away(60 * MIN, deps);
    expect(checked).toEqual(['1']); // draft folders aren't checked
    expect(loadBoard().cards[0]!.run!.verified).toMatchObject({ result: 'failed' });
  });
});

// #24 (a tester's review of v0.3.0): a sandboxed run could plant .git hooks, and WebFetch bypassed the no-network box.
describe('what an unattended run may touch (#24)', () => {
  it('gets no web tools and no read-anywhere tools by default, even from an older config.json that lists them', () => {
    const old = { allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(npm test *)', 'Read(/opt/docs/**)'], awayWeb: false };
    expect(awayTools(old, ['Bash(swiftc *)'])).toEqual(['Bash(npm test *)', 'Read(/opt/docs/**)', 'Bash(swiftc *)']);
    expect(awayTools(DEFAULT_CONFIG)).not.toEqual(expect.arrayContaining(['WebFetch']));
  });
  it('awayWeb turns the web tools back on', () => {
    expect(awayTools({ allowedTools: ['Bash(ls *)'], awayWeb: true })).toEqual(['Bash(ls *)', 'WebSearch', 'WebFetch']);
  });
  it('tells the agent not to commit: Chompyy does', () => {
    expect(safetyRules('/w')).toMatch(/Don't commit/);
    expect(safetyRules('/w')).not.toMatch(/commit your work/);
  });
});
