// Where a card runs (spec §5.5): its own git worktree on chompyy/<id>, or a draft folder.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
  /** The repo's shared .git folder. Read-only to the agent; Chompyy commits for it. */
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
    if (!commit) continue;
    // Kept cards land on your local branch and may not be pushed yet: when it is ahead of the remote's, start
    // from it, or the next card starts without them and clashes with them (found by the lab night, 2026-11-20).
    const local = ref.startsWith('origin/') ? ref.slice('origin/'.length) : null;
    const localCommit = local ? tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}^{commit}`]) : null;
    if (local && localCommit && localCommit !== commit) {
      const isAncestor = (a: string, b: string) => tryGit(root, ['merge-base', '--is-ancestor', a, b]) !== null;
      if (isAncestor(commit, localCommit)) return { ref: local, commit: localCommit, ...(note ? { note } : {}) };
      if (!isAncestor(localCommit, commit)) {
        return { ref: local, commit: localCommit, note: `your ${local} and ${ref} have each moved on; used your ${local} (it has your kept cards)${note ? `; ${note}` : ''}` };
      }
    }
    return { ref, commit, ...(note ? { note } : {}) };
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
 * The agent can edit any file in its folder, the `.git` link file included. Pointed at a folder it made, git would
 * read that folder's config (hooks, core.fsmonitor, filters) and run it, outside the sandbox, the next time Chompyy
 * runs git there (#24). So after a run, before any git command in the folder, the link goes back to the repo's own
 * record of this worktree (in .git, which the agent can't write). Returns true when it had to repair it.
 */
export function restoreGitLink(dir: string, gitDir: string): boolean {
  const want = realpathSync(dir);
  const records = join(gitDir, 'worktrees');
  const name = existsSync(records)
    ? readdirSync(records).find((n) => {
        try {
          const linked = resolve(gitDir, readFileSync(join(records, n, 'gitdir'), 'utf8').trim());
          return existsSync(dirname(linked)) && realpathSync(dirname(linked)) === want;
        } catch {
          return false;
        }
      })
    : undefined;
  if (!name) throw new Error(`${gitDir} has no record of the worktree ${dir}`);
  const link = `gitdir: ${join(records, name)}\n`;
  const path = join(dir, '.git');
  const stat = existsSync(path) || isLink(path) ? lstatSync(path) : null;
  if (stat?.isFile() && readFileSync(path, 'utf8') === link) return false;
  rmSync(path, { recursive: true, force: true });
  writeFileSync(path, link);
  return true;
}

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * After a run: commit the agent's changes in its worktree (the agent can't write .git, so it never commits
 * itself), so keep merges the whole result and undo removes it. Puts the worktree's .git link back first when
 * the workspace knows its repo. Returns true when it made a commit.
 */
export function commitLeftovers(ws: Workspace, card: Pick<Card, 'id' | 'title'>): boolean {
  if (ws.kind !== 'worktree' || !existsSync(ws.dir)) return false;
  if (ws.gitDir) restoreGitLink(ws.dir, ws.gitDir);
  // Add exactly the changed files we want, by name. Naming excluded paths instead (":(exclude).claude") makes git
  // fail outright when the repo also gitignores them (Keep broke this way on 2026-11-18).
  const files = changedPaths(ws.dir).filter((f) => !neverCommit(f));
  for (let i = 0; i < files.length; i += 200) git(ws.dir, ['add', '-A', '--', ...files.slice(i, i + 200)]);
  const staged = git(ws.dir, ['diff', '--cached', '--name-only']);
  if (!staged) return false;
  git(ws.dir, ['-c', 'user.name=Chompyy', '-c', 'user.email=chompyy@localhost', 'commit', '--no-verify', '-m', `Chompyy card #${card.id}: ${card.title}\n\nMade by an away run; committed by Chompyy.`]);
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
