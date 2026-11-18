import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/catalog.js';
import { detectChecks, latestMain, preflight } from '../src/preflight.js';
import { useTempHome } from './helpers.js';

// The failure catalog, fed the exact lines seen on 2026-11-18. Every new kind of box failure adds a line here.
describe('failure catalog', () => {
  const seen = (output: string) => diagnose(output).map((d) => d.entry.id);
  it('recognises each failure from that night', () => {
    expect(seen("→ EPERM: operation not permitted, mkdtemp '/Users/davidchung/.chompyy-verify-outside-XXXXXX'")).toEqual(['writes-home']);
    expect(seen('sandbox-exec: sandbox_apply: Operation not permitted')).toContain('nested-sandbox');
    expect(seen('warning: /Users/d/Library/org.swift.swiftpm/configuration is not accessible or not writable')).toContain('tool-cache-outside');
    expect(seen('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/vitest failed')).toContain('network');
    expect(seen("sh: vitest: command not found")).toContain('missing-deps');
    expect(seen('Permission for this tool use was denied. It requires approval, and this session has no approval surface')).toContain('needs-approval');
  });
  it('stays quiet on an ordinary test failure', () => {
    expect(seen('AssertionError: expected 2 to be 3\n Tests  1 failed | 10 passed')).toEqual([]);
  });
});

function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-pf-')));
  const g = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  mkdirSync(join(root, 'cli'), { recursive: true });
  writeFileSync(join(root, 'cli', 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' } }));
  mkdirSync(join(root, 'mac'));
  writeFileSync(join(root, 'mac', 'Package.swift'), '// swift-tools-version: 6.0');
  g('add', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return root;
}

describe('repo profile', () => {
  it('finds every check, in subfolders too (the old check only looked at the top)', () => {
    const checks = detectChecks(repo(), '/cache');
    expect(checks.map((c) => [c.dir, c.kind])).toEqual([['cli', 'test'], ['cli', 'typecheck'], ['mac', 'build']]);
    expect(checks[2]!.argv).toEqual(['swift', 'build', '--disable-sandbox', '--cache-path', '/cache/swiftpm/cache', '--config-path', '/cache/swiftpm/config', '--security-path', '/cache/swiftpm/security']);
  });

  it('checks the latest main, not whatever is checked out', () => {
    const root = repo();
    execFileSync('git', ['-C', root, 'checkout', '-q', '-b', 'old-feature']);
    expect(latestMain(root, false).ref).toBe('main');
  });
});

describe('preflight verdicts', () => {
  useTempHome();
  // A fake runner: what each check does in the box and outside it.
  const fake = (inBox: Record<string, [number, string]>, outside: Record<string, [number, string]>) =>
    async (argv: string[], _cwd: string, _env: NodeJS.ProcessEnv, _t: number, boxed: boolean) => {
      const key = argv.slice(0, 3).join(' ');
      const [code, output] = (boxed ? inBox : outside)[key] ?? [0, ''];
      return { code, output, timedOut: false };
    };

  it('ready, box problem (with the cause), or broken on main', async () => {
    const root = repo();
    const r = await preflight(root, {
      cacheDir: join(tmpdir(), 'chompyy-pf-cache'), denyRead: [], timeoutMs: 1000, fetch: false,
      exec: fake(
        { 'npm test': [1, "EPERM: operation not permitted, mkdtemp '/Users/me/.x-XXXX'"], 'npm run typecheck': [0, ''], 'swift build --disable-sandbox': [1, 'error: boom'] },
        { 'npm test': [0, ''], 'swift build --disable-sandbox': [1, 'error: boom'] },
      ),
    });
    expect(r.base.ref).toBe('main');
    expect(r.results.map((x) => [x.check.label.split(' ').slice(0, 2).join(' '), x.verdict])).toEqual([['npm test', 'box'], ['npm run', 'ready'], ['swift build', 'broken']]);
    expect(r.results[0]!.diagnoses!.map((d) => d.id)).toEqual(['writes-home']);
    expect(r.ready).toBe(false);
  });

  it('flags a box failure the catalog does not know, instead of hiding it', async () => {
    const r = await preflight(repo(), {
      cacheDir: join(tmpdir(), 'chompyy-pf-cache'), denyRead: [], timeoutMs: 1000, fetch: false,
      exec: fake({ 'npm test': [1, 'something new'] }, {}),
    });
    expect(r.results[0]).toMatchObject({ verdict: 'box', why: expect.stringMatching(/isn't in the catalog yet/) });
  });

  it('is away-ready only when every check passes in the box', async () => {
    const r = await preflight(repo(), { cacheDir: join(tmpdir(), 'chompyy-pf-cache'), denyRead: [], timeoutMs: 1000, fetch: false, exec: fake({}, {}) });
    expect(r.ready).toBe(true);
  });
});

describe('the agent gets the proven checks', () => {
  it('lists them in its prompt, exactly as preflight ran them', async () => {
    const { taskPrompt } = await import('../src/away.js');
    const card = { id: '9', title: 't', idea: 'i', cwd: '/r', column: 'approved', blueprint: 'bp', createdAt: '', updatedAt: '' } as never;
    const prompt = taskPrompt(card, '/w', '', [{ dir: 'mac', label: 'swift build --disable-sandbox' }, { dir: '', label: 'npm test' }]);
    expect(prompt).toMatch(/they pass here/);
    expect(prompt).toContain('- in mac: `swift build --disable-sandbox`');
    expect(prompt).toContain('- in the top folder: `npm test`');
    expect(taskPrompt(card, '/w')).not.toMatch(/How to check this repo/);
  });
});
