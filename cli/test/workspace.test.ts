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
