import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { failingTests, verifyCard } from '../src/verifycard.js';
import { useTempHome } from './helpers.js';

describe('reading which tests failed', () => {
  it('understands vitest, go test, pytest, XCTest and cargo', () => {
    const vitest = ' FAIL  test/projects.test.ts > recentProjects > lists git repos\n   × safety > really sandboxes the tests 43ms\n Tests  2 failed | 175 passed';
    expect(failingTests(vitest)).toEqual(['safety > really sandboxes the tests', 'test/projects.test.ts > recentProjects > lists git repos']);
    expect(failingTests('--- FAIL: TestParse (0.00s)\nok  pkg')).toEqual(['TestParse']);
    expect(failingTests('FAILED tests/test_a.py::test_one - assert 1 == 2')).toEqual(['tests/test_a.py::test_one']);
    expect(failingTests("Test Case '-[AppTests testMenu]' failed (0.1 seconds)")).toEqual(['AppTests testMenu']);
    expect(failingTests('test parser::works ... FAILED')).toEqual(['parser::works']);
    expect(failingTests('all good')).toEqual([]);
    expect(failingTests('   × planted break 3ms\n FAIL  test/planted.test.ts > planted break')).toEqual(['test/planted.test.ts > planted break']);
  });
});

function repoWithCard() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-vc-')));
  const g = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'cli'));
  writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  g('add', '.'); g('commit', '-qm', 'main');
  const base = g('rev-parse', 'HEAD');
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-vc-card-'))), 'card');
  g('worktree', 'add', '-q', '-b', 'chompyy/1', dir, base);
  return { root, dir, base };
}

describe('verify: the card against the main it started from', () => {
  useTempHome();
  // Fake checks: what `npm test` prints on the card's copy and on main's copy (told apart by the folder).
  const fake = (card: [number, string], main: [number, string], calls: string[] = []) =>
    async (_argv: string[], cwd: string) => {
      const onCard = cwd.includes('chompyy-vc-card-');
      calls.push(onCard ? 'card' : 'main');
      const [code, output] = onCard ? card : main;
      return { code, output, timedOut: false };
    };
  const opts = (r: ReturnType<typeof repoWithCard>, exec: ReturnType<typeof fake>) => ({ root: r.root, dir: r.dir, baseCommit: r.base, cacheDir: join(tmpdir(), 'chompyy-vc-cache'), denyRead: [], timeoutMs: 1000, exec });

  it('passes without running main when the card passes', async () => {
    const calls: string[] = [];
    const v = await verifyCard(opts(repoWithCard(), fake([0, 'ok'], [1, 'x'], calls)));
    expect(v).toMatchObject({ result: 'passed', why: 'cli: npm test pass' });
    expect(calls).toEqual(['card']);
  });

  it('blames the card when main passes', async () => {
    const v = await verifyCard(opts(repoWithCard(), fake([1, ' FAIL  test/a.test.ts > adds numbers'], [0, 'ok'])));
    expect(v).toMatchObject({ result: 'failed', why: 'this change broke cli: npm test (test/a.test.ts > adds numbers); it passes on main' });
  });

  // 2026-11-18: every card said "the 2 failures also fail without my change" and nobody could tell. Now measured.
  it('clears the card when main fails the same tests', async () => {
    const both = ' FAIL  test/projects.test.ts > lists repos\n FAIL  test/safety.test.ts > sandboxes';
    const v = await verifyCard(opts(repoWithCard(), fake([1, both], [1, both])));
    expect(v.result).toBe('passed');
    expect(v.why).toBe('nothing new fails; cli: npm test fails the same way on main, so not because of this change');
  });

  it('blames the card for the tests that fail only on the card', async () => {
    const v = await verifyCard(opts(repoWithCard(), fake([1, ' FAIL  test/old.test.ts > a\n FAIL  test/new.test.ts > b'], [1, ' FAIL  test/old.test.ts > a'])));
    expect(v).toMatchObject({ result: 'failed', why: expect.stringContaining('this change broke cli: npm test (test/new.test.ts > b)') });
    expect(v.outcomes![0]).toMatchObject({ card: 'failed', main: 'failed', newFailures: ['test/new.test.ts > b'], verdict: 'broke' });
  });

  // 2026-11-18: git-heavy tests timed out on a busy Mac and the card looked broken. One retry tells flaky from broken.
  it('retries a failing check once and calls it flaky when the retry passes', async () => {
    let n = 0;
    const v = await verifyCard(opts(repoWithCard(), async (_a: string[], cwd: string) => ({ code: cwd.includes('chompyy-vc-card-') && n++ === 0 ? 1 : 0, output: 'timeout', timedOut: false })));
    expect(v).toMatchObject({ result: 'passed', why: 'cli: npm test (flaky: failed once, passed on retry) pass' });
  });

  it('runs main once per commit: later cards from the same main reuse it', async () => {
    const r = repoWithCard();
    const calls: string[] = [];
    await verifyCard(opts(r, fake([1, ' FAIL  test/x.test.ts > y'], [1, ' FAIL  test/x.test.ts > y'], calls)));
    await verifyCard(opts(r, fake([1, ' FAIL  test/x.test.ts > y'], [1, ' FAIL  test/x.test.ts > y'], calls)));
    expect(calls).toEqual(['card', 'card', 'main', 'main', 'card', 'card']); // each failure retried once; main's run reused
  });
});
