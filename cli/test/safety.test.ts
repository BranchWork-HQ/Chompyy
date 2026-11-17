import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCard, expireSuggested, loadBoard, updateBoard, type Card } from '../src/board.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { budgetGate } from '../src/gate.js';
import { formatReport } from '../src/report.js';
import { blueprintFiles, overlaps } from '../src/review.js';
import { claudeArgs, LoopWatch, streamText } from '../src/runner.js';
import { detectCheck, sandboxProfile, verifyRun } from '../src/verify.js';
import { NOW, nowSec, useTempHome } from './helpers.js';

describe('never spill into paid extra usage', () => {
  const lax = { ...DEFAULT_CONFIG, min5hLeftPct: 0, weeklyReservePct: 0, weeklyPace: false };
  it('closes at 100% whatever the settings say', () => {
    const snap = (five: number, week: number) => ({ capturedAt: NOW.toISOString(), fiveHour: { usedPct: five, resetsAt: nowSec + 3600 }, sevenDay: { usedPct: week, resetsAt: nowSec + 86_400 } });
    expect(budgetGate(snap(100, 10), lax, NOW).reasons).toEqual(['5h window is used up: running now would spill into paid extra usage']);
    expect(budgetGate(snap(50, 100), lax, NOW).reasons).toEqual(['weekly limit is used up: running now would spill into paid extra usage']);
    expect(budgetGate(snap(99, 99), lax, NOW).ok).toBe(true);
  });
});

describe('circuit breaker', () => {
  const call = (id: string, command: string, description = 'x') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description } }] } });
  const result = (id: string, isError: boolean) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError }] } });

  it('trips on the same call repeated, ignoring the description', () => {
    const w = new LoopWatch(3);
    expect(w.feed(call('1', 'ls', 'a'))).toBeNull();
    expect(w.feed(call('2', 'cat x'))).toBeNull();
    expect(w.feed(call('3', 'ls', 'b'))).toBeNull();
    expect(w.feed(call('4', 'ls', 'c'))).toMatch(/called Bash\({"command":"ls"}\) 3 times/);
  });

  it('trips on the same command failing in a row, and resets when it passes', () => {
    const w = new LoopWatch(4);
    w.feed(call('1', 'npm test'));
    expect(w.feed(result('1', true))).toBeNull();
    w.feed(call('2', 'npm test'));
    expect(w.feed(result('2', true))).toBeNull();
    w.feed(call('3', 'npm test'));
    expect(w.feed(result('3', false))).toBeNull(); // passed: streak over
    const v = new LoopWatch(4);
    for (const id of ['a', 'b']) {
      v.feed(call(id, 'make'));
      v.feed(result(id, true));
    }
    v.feed(call('c', 'make'));
    expect(v.feed(result('c', true))).toMatch(/failed 3 times in a row/);
  });

  it('reads the final text from the stream and asks for it only when watching', () => {
    expect(streamText([{ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }, { type: 'result', result: 'Done.\nCHECKS: passed — npm test' }])).toBe('Done.\nCHECKS: passed — npm test');
    expect(streamText([{ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }] } }])).toBe('a');
    expect(claudeArgs({ prompt: '', cwd: '/', timeoutMs: 1, loopRepeat: 5 }).slice(0, 4)).toEqual(['-p', '--output-format', 'stream-json', '--verbose']);
    expect(claudeArgs({ prompt: '', cwd: '/', timeoutMs: 1 }).slice(0, 3)).toEqual(['-p', '--output-format', 'text']);
  });
});

describe('independent check', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'chompyy-verify-'));

  it('finds the repo\'s test command', () => {
    const d = dir();
    expect(detectCheck(d)).toBeNull();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(detectCheck(d)).toBeNull();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    expect(detectCheck(d)).toMatchObject({ label: 'npm test', node: true });
    writeFileSync(join(d, 'pnpm-lock.yaml'), '');
    expect(detectCheck(d)!.label).toBe('pnpm test');
    expect(detectCheck(d, 'make check')).toEqual({ argv: ['sh', '-c', 'make check'], label: 'make check' });
    const g = dir();
    writeFileSync(join(g, 'go.mod'), 'module x');
    expect(detectCheck(g)!.label).toBe('go test ./...');
    const p = dir();
    mkdirSync(join(p, 'tests'));
    writeFileSync(join(p, 'tests', 'test_a.py'), '');
    expect(detectCheck(p)!.label).toBe('pytest');
    [d, g, p].forEach((x) => rmSync(x, { recursive: true, force: true }));
  });

  it('denies network, writes outside the folder and credential reads in the profile', () => {
    const profile = sandboxProfile({ writable: ['/w "q"'], denyRead: ['~/.ssh'] });
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(subpath "/w \\"q\\"")');
    expect(profile).toMatch(/\(deny file-read\* \(subpath "\/.+\/\.ssh"\)\)/);
  });

  const base = (d: string) => ({ dir: d, repoRoot: null, cacheDir: d, env: {}, denyRead: [], timeoutMs: 20_000, now: () => NOW });

  it('reports pass, fail and nothing to run', async () => {
    const d = dir();
    expect((await verifyRun({ ...base(d), unsandboxed: true })).result).toBe('not run');
    expect(await verifyRun({ ...base(d), unsandboxed: true, override: 'true' })).toMatchObject({ result: 'passed', command: 'true' });
    const failed = await verifyRun({ ...base(d), unsandboxed: true, override: 'echo boom; exit 3' });
    expect(failed).toMatchObject({ result: 'failed', why: 'echo boom; exit 3 exited with 3', tail: 'boom' });
    rmSync(d, { recursive: true, force: true });
  });

  it.runIf(process.platform === 'darwin')('really sandboxes the tests: no writes outside the folder, no network', async () => {
    const d = dir();
    const outside = mkdtempSync(join(process.env.HOME!, '.chompyy-verify-outside-'));
    try {
      expect(await verifyRun({ ...base(d), override: 'echo ok > inside.txt' })).toMatchObject({ result: 'passed' });
      expect(await verifyRun({ ...base(d), override: `echo bad > ${outside}/x.txt` })).toMatchObject({ result: 'failed', sandboxBlocked: true });
      expect((await verifyRun({ ...base(d), override: 'curl -s -m 3 https://example.com' })).result).toBe('failed');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('overlaps', () => {
  const card = (id: string, column: Card['column'], blueprint: string, extra: Partial<Card> = {}): Card =>
    ({ id, title: `t${id}`, idea: '', cwd: '/repo', column, blueprint, createdAt: '', updatedAt: '', ...extra }) as Card;

  it('pulls file paths out of a blueprint', () => {
    expect(blueprintFiles('## Shape\n- `src/cli.ts`: add a flag\n- edit README.md and docs/guide.md, e.g. a section.\nVersion 1.2.3, see https://x.io/a.html')).toEqual(['src/cli.ts', 'README.md', 'docs/guide.md']);
  });

  it('warns about queued or unreviewed cards in the same repo that touch the same files', () => {
    const me = card('1', 'approved', 'change `src/a.ts`');
    const others = [
      card('2', 'approved', 'also `src/a.ts`'),
      card('3', 'later', 'also `src/a.ts`'), // not queued
      card('4', 'review', '', { run: {} as never }),
      card('5', 'review', 'x', { outcome: 'kept' }), // already decided
      card('6', 'approved', '`src/a.ts`', { cwd: '/other' }),
    ];
    expect(overlaps(me, others, (c) => (c.id === '4' ? ['src/a.ts', 'b.ts'] : []))).toEqual([
      { id: '2', title: 't2', files: ['src/a.ts'] },
      { id: '4', title: 't4', files: ['src/a.ts'] },
    ]);
  });
});

describe('stale suggestions expire', () => {
  useTempHome();
  it('archives suggested cards untouched for N days, never your own ideas', () => {
    const old = new Date(NOW.getTime() - 20 * 86_400_000);
    updateBoard((b) => {
      addCard(b, 'old suggestion', '/repo', old, 'suggested');
      addCard(b, 'fresh suggestion', '/repo', NOW, 'suggested');
      addCard(b, 'my old idea', '/repo', old, 'later');
    });
    expect(updateBoard((b) => expireSuggested(b, NOW, 14)).map((c) => c.title)).toEqual(['old suggestion']);
    expect(loadBoard().cards.map((c) => c.title)).toEqual(['fresh suggestion', 'my old idea']);
    expect(updateBoard((b) => expireSuggested(b, NOW, 0))).toEqual([]);
  });
});

describe('report with the independent check', () => {
  it('a failure the sandbox caused is "check it yourself", not "broken"', () => {
    const c = { id: '1', title: 't', run: { status: 'ok', durationMs: 1, finishedAt: 'x', verified: { result: 'failed', why: 'npm test failed, but the sandbox blocked something', at: 'x', sandboxBlocked: true } } } as never;
    const text = formatReport([c], null, () => ({ files: [], questions: [] }));
    expect(text).toContain("couldn't check its work");
    expect(text).not.toContain('the tests fail when Chompyy runs them');
  });

  it('trusts Chompyy\'s test run over the agent\'s word', () => {
    const c = { id: '1', title: 't', run: { status: 'ok', durationMs: 1, finishedAt: 'x', checks: { result: 'passed', why: 'all good' }, verified: { result: 'failed', why: 'npm test exited with 1', at: 'x' } } } as never;
    const text = formatReport([c], null, () => ({ files: [], questions: [] }));
    expect(text).toContain("the tests fail when Chompyy runs them");
    expect(text).toContain('✗ npm test exited with 1 (run by Chompyy, not the agent)');
  });
});
