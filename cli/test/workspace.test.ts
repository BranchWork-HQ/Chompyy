import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '../src/board.js';
import { commitLeftovers, planWorkspace, prepareWorkspace, restoreGitLink } from '../src/workspace.js';
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
    expect(ws.base).toMatchObject({ ref: expect.stringMatching(/^(main|master)$/), branch: expect.stringMatching(/^(main|master)$/) });
    expect(prepareWorkspace(c)).toMatchObject({ kind: ws.kind, dir: ws.dir, branch: ws.branch }); // second call reuses it
    git('worktree', 'remove', '--force', ws.dir);
  });
});


// #24: the agent can edit its folder's .git link file. Pointed at a folder it made, git would run that folder's
// config (core.fsmonitor, hooks) outside the sandbox the next time Chompyy ran git there.
describe('the worktree .git link after a run (#24)', () => {
  const temps: string[] = [];
  afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  function repoWithWorktree() {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-link-')));
    const wt = `${repo}-card`;
    temps.push(repo, wt);
    g(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'a\n');
    g(repo, 'add', '.');
    g(repo, 'commit', '-qm', 'init');
    g(repo, 'worktree', 'add', '-q', '-b', 'chompyy/1', wt);
    return { repo, wt, gitDir: join(repo, '.git'), link: readFileSync(join(wt, '.git'), 'utf8') };
  }
  /** What a tricked agent could leave: a git folder of its own whose config runs a command on any git status. */
  function plantEvilGitDir(wt: string): string {
    const marker = join(wt, '..', `${wt.split('/').pop()}-pwned`);
    temps.push(marker);
    const evil = join(wt, 'evil');
    execFileSync('cp', ['-R', join(wt, '..', wt.split('/').pop()!.replace(/-card$/, ''), '.git'), evil]);
    writeFileSync(join(evil, 'config'), `[core]\n\tfsmonitor = "touch ${marker}; false"\n`);
    return marker;
  }

  it('leaves an untouched link alone', () => {
    const { wt, gitDir, link } = repoWithWorktree();
    expect(restoreGitLink(wt, gitDir)).toBe(false);
    expect(readFileSync(join(wt, '.git'), 'utf8')).toBe(link);
  });

  it('puts back a link the agent pointed at its own folder, before Chompyy commits (no command from that config runs)', () => {
    const { wt, gitDir, link } = repoWithWorktree();
    const marker = plantEvilGitDir(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${join(wt, 'evil')}\n`);
    writeFileSync(join(wt, 'a.txt'), 'changed\n');
    expect(commitLeftovers({ kind: 'worktree', dir: wt, gitDir }, { id: '1', title: 't' })).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(join(wt, '.git'), 'utf8')).toBe(link);
    expect(g(gitDir, 'log', '-1', '--format=%s', 'chompyy/1')).toBe('Chompyy card #1: t');
  });

  it('replaces a .git folder the agent made in place of the link file', () => {
    const { wt, gitDir, link } = repoWithWorktree();
    rmSync(join(wt, '.git'));
    mkdirSync(join(wt, '.git'));
    writeFileSync(join(wt, '.git', 'config'), '[core]\n\thooksPath = /tmp\n');
    expect(restoreGitLink(wt, gitDir)).toBe(true);
    expect(readFileSync(join(wt, '.git'), 'utf8')).toBe(link);
  });

  it('refuses when the repo has no record of the folder', () => {
    const { repo, gitDir } = repoWithWorktree();
    const stranger = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-stranger-')));
    temps.push(stranger);
    expect(() => restoreGitLink(stranger, gitDir)).toThrow(/no record/);
    expect(repo).toBeTruthy();
  });
});
