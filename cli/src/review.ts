// After a run: what changed, what the agent asks, and keep / undo (spec §5.7).
// Every git card works on its own branch, so undo is just removing that branch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from './board.js';
import { gitRoot } from './workspace.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ran(card: Card) {
  if (!card.run) throw new Error(`Card #${card.id} hasn't run yet.`);
  return card.run;
}

/** The question itself: up to the first "?", else the first sentence. Never cut mid-sentence. */
function questionPart(text: string): string {
  const q = text.indexOf('?');
  if (q !== -1) return text.slice(0, q + 1);
  const dot = text.search(/[.!](\s|$)/);
  return dot !== -1 ? text.slice(0, dot + 1) : text;
}

/** Top-level items from QUESTIONS.md, as whole questions, at most `max`. */
export function firstQuestions(markdown: string, max = 2): string[] {
  return markdown
    .split('\n')
    .filter((line) => /^(\d+\.|[-*])\s+/.test(line)) // top level only, not indented sub-points
    .map((line) => questionPart(line.replace(/^(\d+\.|[-*])\s+/, '').replace(/\*\*|__|`/g, '').trim()))
    .filter(Boolean)
    .slice(0, max);
}

/** Wrap text at word boundaries so long questions fold onto the next line instead of being cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export function questionsOf(card: Card): string[] {
  const path = card.run ? join(card.run.workdir, 'QUESTIONS.md') : '';
  return path && existsSync(path) ? firstQuestions(readFileSync(path, 'utf8')) : [];
}

/** Files the run changed: from the branch for git cards, from the folder for draft cards. */
export function changedFiles(card: Card): string[] {
  const run = card.run;
  if (!run || !existsSync(run.workdir)) return [];
  try {
    if (run.branch) {
      const root = gitRoot(card.cwd);
      if (!root) return [];
      return git(root, ['diff', '--name-only', `HEAD...${run.branch}`]).split('\n').filter(Boolean);
    }
    return readdirSync(run.workdir, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath ?? run.workdir, d.name).slice(run.workdir.length + 1));
  } catch {
    return [];
  }
}

export function diffCard(card: Card): string {
  const run = ran(card);
  if (!run.branch) return `Card #${card.id} ran in a draft folder, not a git repo. Its files are in ${run.workdir}`;
  const root = gitRoot(card.cwd);
  if (!root) throw new Error(`${card.cwd} is no longer a git repo.`);
  return git(root, ['diff', '--stat', '--patch', `HEAD...${run.branch}`]) || 'No changes on the branch.';
}

function removeWorktree(root: string, card: Card): void {
  const run = ran(card);
  if (existsSync(run.workdir)) git(root, ['worktree', 'remove', '--force', run.workdir]);
}

/** Merge the card's branch into the repo's current branch, then tidy up the worktree. */
export function keepCard(card: Card): string {
  const run = ran(card);
  if (!run.branch) return `Card #${card.id} ran in a draft folder; copy what you want from ${run.workdir}`;
  const root = gitRoot(card.cwd);
  if (!root) throw new Error(`${card.cwd} is no longer a git repo.`);
  if (git(root, ['status', '--porcelain'])) {
    throw new Error(`${root} has uncommitted changes. Commit or set them aside first, then run keep again.`);
  }
  const into = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  try {
    git(root, ['merge', '--no-ff', '-m', `Keep Chompyy card #${card.id}: ${card.title}`, run.branch]);
  } catch {
    try {
      git(root, ['merge', '--abort']);
    } catch {}
    throw new Error(`${run.branch} conflicts with ${into}. Nothing was changed. Merge it by hand: git -C ${root} merge ${run.branch}`);
  }
  removeWorktree(root, card);
  git(root, ['branch', '-d', run.branch]);
  return `Kept #${card.id}: merged ${run.branch} into ${into}. Undo it with \`git -C ${root} reset --hard HEAD~1\`.`;
}

/** Throw the run away: remove the worktree and branch (or the draft folder). */
export function undoCard(card: Card): string {
  const run = ran(card);
  if (!run.branch) {
    rmSync(run.workdir, { recursive: true, force: true });
    return `Undone #${card.id}: removed the draft folder.`;
  }
  const root = gitRoot(card.cwd);
  if (!root) throw new Error(`${card.cwd} is no longer a git repo.`);
  removeWorktree(root, card);
  git(root, ['branch', '-D', run.branch]);
  return `Undone #${card.id}: removed branch ${run.branch}. Your own branches were never touched.`;
}
