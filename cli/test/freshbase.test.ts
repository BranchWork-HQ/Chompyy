import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '../src/board.js';
import { setupDependencies } from '../src/deps.js';
import { changedFiles, diffCard, keepCard } from '../src/review.js';
import { prepareWorkspace } from '../src/workspace.js';
import { useTempHome } from './helpers.js';

const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const gitIn = (dir: string) => (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
const card = (id: string, cwd: string): Card => ({ id, title: `t${id}`, idea: 'i', cwd, column: 'running', blueprint: 'bp', createdAt: '', updatedAt: '' }) as Card;

/** A repo whose main moved on while the folder the cards point at sat on an old commit (2026-11-18). */
function staleCheckout() {
  const repo = tmp('chompyy-fb-');
  const g = gitIn(repo);
  g('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'app.txt'), 'v0.2.0\n');
  g('add', '.'); g('commit', '-qm', 'v0.2.0');
  const old = g('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'app.txt'), 'v0.3.0 with the fold button\n');
  g('commit', '-qam', 'fold button');
  // The cards' folder: a second checkout, detached at the old commit (like token-saving-research-release).
  const cardsFolder = join(tmp('chompyy-fb-release-'), 'release');
  g('worktree', 'add', '-q', '--detach', cardsFolder, old);
  g('checkout', '-q', '--detach'); // nobody has main open
  return { repo, cardsFolder, g };
}

describe('fresh base: a card starts from the latest main', () => {
  useTempHome();

  it('not from the old commit its folder has checked out', () => {
    const { cardsFolder } = staleCheckout();
    const ws = prepareWorkspace(card('17', cardsFolder), { fetch: false });
    expect(readFileSync(join(ws.dir, 'app.txt'), 'utf8')).toBe('v0.3.0 with the fold button\n');
    expect(ws.base).toMatchObject({ ref: 'main', branch: 'main' });
  });

  it('uses the remote\'s main when the local one is behind', () => {
    const upstream = tmp('chompyy-fb-up-');
    const u = gitIn(upstream);
    u('init', '-q', '-b', 'main');
    writeFileSync(join(upstream, 'f.txt'), 'one\n');
    u('add', '.'); u('commit', '-qm', 'one');
    const clone = join(tmp('chompyy-fb-clone-'), 'c');
    execFileSync('git', ['clone', '-q', upstream, clone]);
    writeFileSync(join(upstream, 'f.txt'), 'two\n');
    u('commit', '-qam', 'two'); // pushed after you cloned
    const ws = prepareWorkspace(card('3', clone)); // fetches
    expect(ws.base!.ref).toBe('origin/main');
    expect(readFileSync(join(ws.dir, 'f.txt'), 'utf8')).toBe('two\n');
  });
});

describe('keep lands the card on main', () => {
  useTempHome();
  const ranCard = (c: Card, ws: ReturnType<typeof prepareWorkspace>): Card => ({ ...c, column: 'review', run: { status: 'ok', startedAt: '', finishedAt: '', durationMs: 0, exitCode: 0, workdir: ws.dir, branch: ws.branch, base: ws.base, summary: '' } }) as Card;

  it('in a temporary copy when no folder has main open, leaving your folders untouched', () => {
    const { repo, cardsFolder, g } = staleCheckout();
    const c = card('12', cardsFolder);
    const ws = prepareWorkspace(c, { fetch: false });
    writeFileSync(join(ws.dir, 'badge.txt'), '73%\n');
    gitIn(ws.dir)('add', '.'); gitIn(ws.dir)('commit', '-qm', 'badge');
    // Only the card's own work: not the 30 commits between the folder's old checkout and latest main (2026-11-18).
    expect(changedFiles(ranCard(c, ws))).toEqual(['badge.txt']);
    expect(diffCard(ranCard(c, ws))).not.toContain('app.txt');
    const before = gitIn(cardsFolder)('rev-parse', 'HEAD');
    expect(keepCard(ranCard(c, ws))).toMatch(/merged chompyy\/12 into main \(none of your folders has main open/);
    expect(g('show', 'main:badge.txt')).toBe('73%');
    expect(g('show', 'main:app.txt')).toBe('v0.3.0 with the fold button');
    expect(gitIn(cardsFolder)('rev-parse', 'HEAD')).toBe(before); // the stale folder wasn't touched
    expect(existsSync(ws.dir)).toBe(false);
    expect(repo).toBeTruthy();
  });

  it('in the folder that has main open, when there is one', () => {
    const { repo, cardsFolder, g } = staleCheckout();
    g('checkout', '-q', 'main');
    const c = card('13', cardsFolder);
    const ws = prepareWorkspace(c, { fetch: false });
    writeFileSync(join(ws.dir, 'fold.txt'), 'folded\n');
    gitIn(ws.dir)('add', '.'); gitIn(ws.dir)('commit', '-qm', 'fold');
    expect(keepCard(ranCard(c, ws))).toMatch(new RegExp(`merged chompyy/13 into main in ${repo}`));
    expect(readFileSync(join(repo, 'fold.txt'), 'utf8')).toBe('folded\n');
  });
});

describe('setup: dependencies are never reinstalled per card', () => {
  const pkgRepo = (lock: string) => {
    const dir = tmp('chompyy-deps-');
    mkdirSync(join(dir, 'cli', 'node_modules', 'vitest'), { recursive: true });
    writeFileSync(join(dir, 'cli', 'package.json'), '{}');
    writeFileSync(join(dir, 'cli', 'package-lock.json'), lock);
    writeFileSync(join(dir, 'cli', 'node_modules', 'vitest', 'index.js'), 'yours');
    return dir;
  };
  const copyOf = (lock: string) => {
    const dir = tmp('chompyy-deps-wt-');
    mkdirSync(join(dir, 'cli'));
    writeFileSync(join(dir, 'cli', 'package.json'), '{}');
    writeFileSync(join(dir, 'cli', 'package-lock.json'), lock);
    return dir;
  };

  it('clones yours when the lockfile matches, installs once into a snapshot when it doesn\'t, then reuses it', () => {
    const snapshotsDir = tmp('chompyy-snaps-');
    const mine = pkgRepo('{"v":1}');
    let installs = 0;
    const install = (_steps: string[][], cwd: string) => {
      installs++;
      mkdirSync(join(cwd, 'node_modules', 'vitest'), { recursive: true });
      writeFileSync(join(cwd, 'node_modules', 'vitest', 'index.js'), 'fresh');
      return true;
    };
    expect(setupDependencies(mine, copyOf('{"v":1}'), 'r', { snapshotsDir, install })).toEqual([{ dir: 'cli', source: 'your checkout' }]);
    const a = copyOf('{"v":2}');
    expect(setupDependencies(mine, a, 'r', { snapshotsDir, install })[0]).toMatchObject({ source: 'installed' });
    expect(readFileSync(join(a, 'cli', 'node_modules', 'vitest', 'index.js'), 'utf8')).toBe('fresh');
    expect(setupDependencies(mine, copyOf('{"v":2}'), 'r', { snapshotsDir, install })[0]).toMatchObject({ source: 'snapshot' });
    expect(installs).toBe(1); // once per lockfile, not per card
  });

  it('falls back to your packages, flagged, when the one-time install fails', () => {
    const steps = setupDependencies(pkgRepo('{"v":1}'), copyOf('{"v":3}'), 'r', { snapshotsDir: tmp('chompyy-snaps-'), install: () => false });
    expect(steps[0]).toMatchObject({ source: 'your checkout', note: expect.stringMatching(/failed; using your installed packages/) });
  });
});
