// Where a card runs (spec §5.5): its own git worktree on chompyy/<id>, or a draft folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import type { Card } from './board.js';
import { homePath } from './home.js';

export interface Workspace {
  kind: 'worktree' | 'draft';
  dir: string;
  branch?: string;
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
  if (existsSync(plan.dir)) return plan; // a rerun keeps working in the same worktree
  // New branch from the repo's current HEAD; on a rerun after the folder was removed, reuse the branch.
  const args = branchExists(root, branch) ? ['worktree', 'add', plan.dir, branch] : ['worktree', 'add', '-b', branch, plan.dir, 'HEAD'];
  git(root, args);
  return plan;
}
