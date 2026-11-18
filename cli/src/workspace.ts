// Where a card runs (spec §5.5): its own git worktree on chompyy/<id>, or a draft folder.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Card } from './board.js';
import { setupDependencies, type DepsStep } from './deps.js';
import { homePath } from './home.js';

export interface Workspace {
  kind: 'worktree' | 'draft';
  dir: string;
  branch?: string;
  /** What the copy started from: the latest main (ref, commit) and the local branch Keep lands it on. */
  base?: { ref: string; commit: string; branch: string };
  /** Where each package folder's dependencies came from (setup stage). */
  setup?: DepsStep[];
  /** The repo's shared .git folder: commits in a worktree write here. */
  gitDir?: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const tryGit = (cwd: string, args: string[]): string | null => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

/**
 * The latest main, as interactive Claude would see it: fetch the remote (Chompyy, outside the box, may use the
 * network) and use its default branch; with no remote, the local main/master; failing that, HEAD.
 */
export function latestMain(root: string, fetch = true): { ref: string; commit: string; note?: string } {
  let note: string | undefined;
  const hasOrigin = (tryGit(root, ['remote']) ?? '').split('\n').includes('origin');
  if (hasOrigin && fetch && tryGit(root, ['fetch', '--quiet', 'origin']) === null) note = "couldn't fetch origin; used what's already here";
  const candidates = hasOrigin
    ? [tryGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']), 'origin/main', 'origin/master', 'main', 'master']
    : ['main', 'master'];
  for (const ref of candidates) {
    if (!ref) continue;
    const commit = tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (commit) return { ref, commit, ...(note ? { note } : {}) };
  }
  return { ref: 'HEAD', commit: git(root, ['rev-parse', 'HEAD']), note: note ?? 'no main branch found; used HEAD' };
}

export function gitRoot(cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
}

/** The git branch a folder is on, for a new card's workspace; null outside git or on a detached HEAD. */
export function branchOf(cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  const branch = tryGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return branch || null;
}

function branchExists(root: string, branch: string): boolean {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** What prepareWorkspace would do, without touching anything (for --dry-run). */
export function planWorkspace(card: Card): Workspace {
  const root = gitRoot(card.cwd);
  if (root) return { kind: 'worktree', dir: homePath('worktrees', card.id), branch: `chompyy/${card.id}` };
  return { kind: 'draft', dir: homePath('runs', card.id, 'work') };
}

export function prepareWorkspace(card: Card, opts: { fetch?: boolean } = {}): Workspace {
  const plan = planWorkspace(card);
  if (plan.kind === 'draft') {
    mkdirSync(plan.dir, { recursive: true });
    return plan;
  }
  const root = gitRoot(card.cwd)!;
  const branch = plan.branch!;
  const gitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  // A rerun keeps working in the same worktree, from the same base as before.
  if (existsSync(plan.dir)) return { ...plan, gitDir, ...(card.run?.base ? { base: card.run.base } : {}) };
  // Same code as prompting Claude directly: a new card starts from the latest main (fetched), not from whatever
  // this folder has checked out. On a rerun after the folder was removed, it reuses its branch.
  const base = latestMain(root, opts.fetch ?? true);
  const local = base.ref.replace(/^origin\//, '');
  const args = branchExists(root, branch) ? ['worktree', 'add', plan.dir, branch] : ['worktree', 'add', '-b', branch, plan.dir, base.commit];
  git(root, args);
  const repoKey = `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
  const setup = setupDependencies(root, plan.dir, repoKey, { env: { npm_config_cache: homePath('cache', 'tools', 'npm') } });
  return { ...plan, gitDir, base: { ref: base.ref, commit: base.commit, branch: local === 'HEAD' ? '' : local }, setup };
}

/** Files a run may leave that never belong in the user's repo. */
export const NEVER_COMMIT = ['QUESTIONS.md', '.claude'];

/** OS clutter that appears when you open the card's copy in Finder or Explorer; never committed. */
export const JUNK_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini'];

/**
 * Safety net after a run: commit anything the agent left uncommitted in its worktree, so keep merges the
 * whole result and undo removes it. Without this, keep would merge nothing and then delete the folder.
 * Returns true when it made a commit.
 */
export function commitLeftovers(ws: Workspace, card: Pick<Card, 'id' | 'title'>): boolean {
  if (ws.kind !== 'worktree' || !existsSync(ws.dir)) return false;
  // Add exactly the changed files we want, by name. Naming excluded paths instead (":(exclude).claude") makes git
  // fail outright when the repo also gitignores them (Keep broke this way on 2026-11-18).
  const files = changedPaths(ws.dir).filter((f) => !neverCommit(f));
  for (let i = 0; i < files.length; i += 200) git(ws.dir, ['add', '-A', '--', ...files.slice(i, i + 200)]);
  const staged = git(ws.dir, ['diff', '--cached', '--name-only']);
  if (!staged) return false;
  git(ws.dir, ['-c', 'user.name=Chompyy', '-c', 'user.email=chompyy@localhost', 'commit', '--no-verify', '-m', `Chompyy card #${card.id}: ${card.title}\n\nCommitted by Chompyy: the agent left these changes uncommitted.`]);
  return true;
}

/** Files that never belong in your repo: QUESTIONS.md, .claude/, and OS clutter. */
function neverCommit(f: string): boolean {
  return NEVER_COMMIT.some((n) => f === n || f.startsWith(`${n}/`)) || JUNK_FILES.some((j) => f === j || f.endsWith(`/${j}`));
}

/** Every changed or new (not ignored) file in a folder, exact paths (NUL-separated, so spaces and quotes are safe). */
function changedPaths(dir: string): string[] {
  const out = execFileSync('git', ['-C', dir, 'status', '--porcelain', '-z', '--untracked-files=all'], { encoding: 'utf8' });
  const parts = out.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    paths.push(entry.slice(3));
    if (/^[RC]/.test(entry)) paths.push(parts[++i]!); // a rename lists the old path next
  }
  return paths;
}

/** Uncommitted changes in a worktree that keep would lose (ignores QUESTIONS.md and .claude). */
export function uncommittedWork(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return [...new Set(changedPaths(dir))].filter((f) => !neverCommit(f));
}
