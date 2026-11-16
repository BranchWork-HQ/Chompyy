// Where a card runs (spec §5.5): its own git worktree on chompyy/<id>, or a draft folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { Card } from './board.js';
import { homePath } from './home.js';

export interface Workspace {
  kind: 'worktree' | 'draft';
  dir: string;
  branch?: string;
  /** The repo's shared .git folder: commits in a worktree write here. */
  gitDir?: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function gitRoot(cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
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

export function prepareWorkspace(card: Card): Workspace {
  const plan = planWorkspace(card);
  if (plan.kind === 'draft') {
    mkdirSync(plan.dir, { recursive: true });
    return plan;
  }
  const root = gitRoot(card.cwd)!;
  const branch = plan.branch!;
  const gitDir = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (existsSync(plan.dir)) return { ...plan, gitDir }; // a rerun keeps working in the same worktree
  // New branch from the repo's current HEAD; on a rerun after the folder was removed, reuse the branch.
  const args = branchExists(root, branch) ? ['worktree', 'add', plan.dir, branch] : ['worktree', 'add', '-b', branch, plan.dir, 'HEAD'];
  git(root, args);
  return { ...plan, gitDir };
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
  const excludes = [...NEVER_COMMIT.map((p) => `:(exclude)${p}`), ...JUNK_FILES.map((f) => `:(exclude,glob)**/${f}`)];
  git(ws.dir, ['add', '-A', '--', '.', ...excludes]);
  const staged = git(ws.dir, ['diff', '--cached', '--name-only']);
  if (!staged) return false;
  git(ws.dir, ['-c', 'user.name=Chompyy', '-c', 'user.email=chompyy@localhost', 'commit', '--no-verify', '-m', `Chompyy card #${card.id}: ${card.title}\n\nCommitted by Chompyy: the agent left these changes uncommitted.`]);
  return true;
}

/** Uncommitted changes in a worktree that keep would lose (ignores QUESTIONS.md and .claude). */
export function uncommittedWork(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return git(dir, ['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\s*\S{1,2}\s+/, '')) // the helper trims, so the first line may lose its leading space
    .filter((f) => !NEVER_COMMIT.some((n) => f === n || f.startsWith(`${n}/`)))
    .filter((f) => !JUNK_FILES.some((j) => f === j || f.endsWith(`/${j}`)));
}
