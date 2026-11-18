import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '../src/board.js';
import { planWorkspace, prepareWorkspace } from '../src/workspace.js';
import { NOW, useTempHome } from './helpers.js';

const card = (id: string, cwd: string): Card => ({
  id, title: 't', idea: 't', cwd, column: 'approved', blueprint: 'bp', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
});

describe('workspace', () => {
  const home = useTempHome();
  const temps: string[] = [];
  afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('uses a draft folder outside git', () => {
    const plain = mkdtempSync(join(tmpdir(), 'chompyy-plain-'));
    temps.push(plain);
    const ws = prepareWorkspace(card('4', plain));
    expect(ws).toEqual({ kind: 'draft', dir: join(home(), 'runs', '4', 'work') });
    expect(existsSync(ws.dir)).toBe(true);
  });

  it('creates a worktree on chompyy/<id> inside a git repo, and reuses it', () => {
    const repo = mkdtempSync(join(tmpdir(), 'chompyy-repo-'));
    temps.push(repo);
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
    git('init', '-q');
    writeFileSync(join(repo, 'README.md'), '# demo\n');
    git('add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');

    const c = card('7', repo);
    expect(planWorkspace(c)).toMatchObject({ kind: 'worktree', branch: 'chompyy/7' });
    const ws = prepareWorkspace(c);
    expect(existsSync(join(ws.dir, 'README.md'))).toBe(true);
    expect(execFileSync('git', ['-C', ws.dir, 'branch', '--show-current'], { encoding: 'utf8' }).trim()).toBe('chompyy/7');
    expect(prepareWorkspace(c)).toEqual(ws); // second call is a no-op
    git('worktree', 'remove', '--force', ws.dir);
  });
});

describe('dependencies in a fresh worktree', () => {
  it('clones installed node_modules into the worktree, without touching the originals', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { linkDependencies } = await import('../src/workspace.js');
    const root = mkdtempSync(join(tmpdir(), 'chompyy-deps-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
    g('init', '-q');
    mkdirSync(join(root, 'cli', 'node_modules', 'leftpad'), { recursive: true });
    writeFileSync(join(root, 'cli', 'package.json'), '{}');
    writeFileSync(join(root, 'cli', 'node_modules', 'leftpad', 'index.js'), 'module.exports = 1');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    const wt = join(mkdtempSync(join(tmpdir(), 'chompyy-wt-')), 'w');
    g('worktree', 'add', '-q', wt);
    expect(linkDependencies(root, wt)).toEqual(['cli']);
    expect(readFileSync(join(wt, 'cli', 'node_modules', 'leftpad', 'index.js'), 'utf8')).toBe('module.exports = 1');
    writeFileSync(join(wt, 'cli', 'node_modules', 'leftpad', 'index.js'), 'changed');
    expect(readFileSync(join(root, 'cli', 'node_modules', 'leftpad', 'index.js'), 'utf8')).toBe('module.exports = 1'); // a copy, not a link
    expect(existsSync(join(wt, 'node_modules'))).toBe(false); // only where the repo has one
    expect(linkDependencies(root, wt)).toEqual([]); // already there: left alone
    // an empty node_modules (left by an aborted npm ci) counts as missing
    const wt2 = join(mkdtempSync(join(tmpdir(), 'chompyy-wt-')), 'w');
    g('worktree', 'add', '-q', '--detach', wt2);
    mkdirSync(join(wt2, 'cli', 'node_modules'));
    expect(linkDependencies(root, wt2)).toEqual(['cli']);
  });
});
