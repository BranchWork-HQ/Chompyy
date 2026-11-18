import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addCard, getCard, loadBoard, updateBoard } from '../src/board.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { clashOf, refreshCard, refreshClashing, refreshGate, type RefreshDeps } from '../src/refresh.js';
import type { RunRequest, RunResult, Runner } from '../src/runner.js';
import type { Verified } from '../src/verify.js';
import { NOW, nowSec, useTempHome } from './helpers.js';

// 2026-11-19: #20 and #21 clashed with main after #12, #19 and #22 were kept, and Keep handed the clash to the
// user. Now Chompyy brings such cards up to date itself.

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();

/**
 * A repo whose card branch (in its own worktree) and main both changed line 2 of app.ts after the card started:
 * the same shape as #20 vs #19 (both added an import on the same line).
 */
function clashingCard(opts: { clash?: boolean } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-refresh-')));
  const wt = `${repo}-card`;
  dirs.push(repo, wt);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'app.ts'), 'line1\nimport a\nline3\n');
  writeFileSync(join(repo, 'other.ts'), 'x\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'init');
  const base = g(repo, 'rev-parse', 'HEAD');
  g(repo, 'worktree', 'add', '-q', '-b', 'chompyy/1', wt);
  writeFileSync(join(wt, 'app.ts'), 'line1\nimport a, card\nline3\n');
  g(wt, 'commit', '-qam', 'card');
  // Meanwhile another card is kept on main.
  if (opts.clash === false) writeFileSync(join(repo, 'other.ts'), 'y\n');
  else writeFileSync(join(repo, 'app.ts'), 'line1\nimport a, kept\nline3\n');
  g(repo, 'commit', '-qam', 'kept another card');
  const b = loadBoard();
  const card = addCard(b, 'add card import', repo, NOW, 'review');
  card.run = {
    status: 'ok', startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), durationMs: 1, exitCode: 0,
    workdir: wt, branch: 'chompyy/1', base: { ref: 'origin/main', commit: base, branch: 'main' }, summary: 'done',
  };
  updateBoard((bb) => {
    bb.cards = b.cards;
    bb.nextId = b.nextId;
  });
  return { repo, wt, id: card.id };
}

/** A fake agent: does `act` in the card's folder (like a real one resolving the conflict), records the prompt. */
function agent(act: (dir: string) => void): Runner & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    run: async (req: RunRequest): Promise<RunResult> => {
      prompts.push(req.prompt);
      act(req.cwd);
      return { exitCode: 0, output: 'CHECKS: passed — fake', stderr: '', timedOut: false, durationMs: 1 };
    },
  };
}

const resolveBoth = (dir: string) => {
  writeFileSync(join(dir, 'app.ts'), 'line1\nimport a, card, kept\nline3\n');
  g(dir, 'add', 'app.ts');
  g(dir, 'commit', '--no-edit', '-q');
};

function deps(runner: Runner, extra: Partial<RefreshDeps> = {}): RefreshDeps & { kept: string[]; lines: string[] } {
  const kept: string[] = [];
  const lines: string[] = [];
  return {
    runner,
    config: { ...DEFAULT_CONFIG, sandbox: false },
    now: () => NOW,
    snapshot: () => null,
    out: (l) => lines.push(l),
    keep: (id) => kept.push(id),
    kept,
    lines,
    ...extra,
  };
}

const passed: Verified = { result: 'passed', why: 'nothing broke', at: NOW.toISOString() };

describe('spotting a clash', () => {
  useTempHome();
  it('finds the files a Keep would clash in', () => {
    const c = clashingCard();
    expect(clashOf(getCard(loadBoard(), c.id))).toMatchObject({ branch: 'main', files: ['app.ts'] });
  });
  it('a card behind main that merges cleanly is not a clash', () => {
    const c = clashingCard({ clash: false });
    expect(clashOf(getCard(loadBoard(), c.id))).toBeNull();
  });
});

describe('refreshing a card', () => {
  useTempHome();

  it('an agent fits both changes together; Chompyy checks the merge, re-verifies on the new main, and records it', async () => {
    const c = clashingCard();
    const runner = agent(resolveBoth);
    let verifiedOn = '';
    const d = deps(runner, { verify: async (ws) => ((verifiedOn = ws.base!.commit), passed) });
    const r = await refreshCard(c.id, d);
    expect(r).toMatchObject({ state: 'done', by: 'agent', files: ['app.ts'] });
    expect(runner.prompts[0]).toMatch(/Bring card #1 up to date with main/);
    expect(runner.prompts[0]).toContain('- app.ts');
    expect(readFileSync(join(c.wt, 'app.ts'), 'utf8')).toBe('line1\nimport a, card, kept\nline3\n');
    const main = g(c.repo, 'rev-parse', 'main');
    expect(verifiedOn).toBe(main); // checked against the new main, not the old base
    const card = getCard(loadBoard(), c.id);
    expect(card.run!.base!.commit).toBe(main);
    expect(card.run!.verified).toEqual(passed);
    expect(clashOf(card)).toBeNull(); // Keep merges cleanly now
    expect(d.kept).toEqual([]); // you didn't press Keep: it waits for you
  });

  it('keeps it by itself when you had pressed Keep and the check passes', async () => {
    const c = clashingCard();
    updateBoard((b) => (getCard(b, c.id).keepWhenRefreshed = true));
    const d = deps(agent(resolveBoth), { verify: async () => passed });
    await refreshCard(c.id, d);
    expect(d.kept).toEqual([c.id]);
  });

  it("doesn't keep it when the check after the merge finds something broken", async () => {
    const c = clashingCard();
    updateBoard((b) => (getCard(b, c.id).keepWhenRefreshed = true));
    const d = deps(agent(resolveBoth), { verify: async () => ({ result: 'failed', why: 'npm test: 2 new failures', at: NOW.toISOString() }) });
    await refreshCard(c.id, d);
    expect(d.kept).toEqual([]);
    expect(d.lines.join('\n')).toMatch(/not keeping #1 by itself: npm test: 2 new failures/);
  });

  it('never trusts the agent: markers left behind undo everything and say so', async () => {
    const c = clashingCard();
    const before = g(c.wt, 'rev-parse', 'HEAD');
    const sloppy = agent((dir) => {
      g(dir, 'add', 'app.ts'); // "resolved" with the markers still in
      g(dir, 'commit', '--no-edit', '-q');
    });
    const r = await refreshCard(c.id, deps(sloppy));
    expect(r.state).toBe('failed');
    expect(r.why).toMatch(/conflict markers were left in app.ts; nothing was changed/);
    expect(g(c.wt, 'rev-parse', 'HEAD')).toBe(before);
    expect(g(c.wt, 'status', '--porcelain')).toBe('');
  });

  it('an agent that leaves the merge unfinished: undone too', async () => {
    const c = clashingCard();
    const before = g(c.wt, 'rev-parse', 'HEAD');
    const r = await refreshCard(c.id, deps(agent(() => {})));
    expect(r).toMatchObject({ state: 'failed' });
    expect(g(c.wt, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('waits instead of spending paid extra usage when the 5-hour window is used up', async () => {
    const c = clashingCard();
    const runner = agent(resolveBoth);
    const snap = { fiveHour: { usedPct: 100, resetsAt: nowSec + 3600 }, at: NOW.toISOString() } as never;
    const r = await refreshCard(c.id, deps(runner, { snapshot: () => snap }));
    expect(r.state).toBe('waiting');
    expect(runner.prompts).toEqual([]);
    expect(refreshGate(snap, NOW)).toMatch(/5-hour window is used up/);
  });

  it('refreshClashing goes through every clashing card in review and skips the rest', async () => {
    const a = clashingCard();
    const runner = agent(resolveBoth);
    const done = await refreshClashing(deps(runner));
    expect(done.map((r) => r.state)).toEqual(['done']);
    expect(await refreshClashing(deps(runner))).toEqual([]); // nothing clashes any more
    expect(runner.prompts).toHaveLength(1);
    expect(getCard(loadBoard(), a.id).refresh?.by).toBe('agent');
  });
});
