// After a run: what changed, what the agent asks, and keep / undo (spec §5.7).
// Every git card works on its own branch, so undo is just removing that branch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Card } from './board.js';
import { commitLeftovers, gitRoot, uncommittedWork } from './workspace.js';

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

/** File paths a blueprint names: `src/x.ts`, docs/README.md, … (a guess at what a card will touch). */
export function blueprintFiles(blueprint: string | null): string[] {
  if (!blueprint) return [];
  const found = new Set<string>();
  for (const m of blueprint.matchAll(/`([^`\s]+)`|(?:^|[\s(])((?:[\w.-]+\/)*[\w-]+\.[a-z]{1,6})(?=[\s),.:;]|$)/gim)) {
    const p = (m[1] ?? m[2] ?? '').replace(/^\.\//, '');
    if (/\.[a-z]{1,6}$/i.test(p) && !/^https?:/.test(p) && !/^\d+(\.\d+)+$/.test(p) && !/^(e\.g|i\.e|etc)\.?$/i.test(p)) found.add(p);
  }
  return [...found];
}

/**
 * Cards already queued, running or waiting for review that look like they touch the same files as `card`:
 * from what a run really changed, else the files its blueprint names. A warning, not a block: overlaps only
 * conflict at keep time, and Run again recovers.
 */
export function overlaps(card: Card, others: Card[], changed: (c: Card) => string[] = changedFiles): { id: string; title: string; files: string[] }[] {
  const mine = new Set(blueprintFiles(card.blueprint));
  if (!mine.size) return [];
  return others
    .filter((o) => o.id !== card.id && o.cwd === card.cwd && (['approved', 'running'].includes(o.column) || (o.column === 'review' && !o.outcome)))
    .map((o) => {
      const theirs = o.run ? changed(o) : blueprintFiles(o.blueprint);
      return { id: o.id, title: o.title, files: theirs.filter((f) => mine.has(f)) };
    })
    .filter((o) => o.files.length);
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
  const dirty = git(root, ['status', '--porcelain']);
  if (dirty) {
    // Say what's in the way and where Keep would merge, so the choice is clear (commit, set aside, or Undo).
    const files = dirty.split('\n').filter(Boolean).map((l) => l.trim().replace(/^\S+\s+/, ''));
    const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const sample = files.slice(0, 3).join(', ') + (files.length > 3 ? ` and ${files.length - 3} more` : '');
    throw new Error(
      `Can't keep #${card.id} yet: ${root} has ${files.length} uncommitted change${files.length === 1 ? '' : 's'} (${sample}). ` +
        `Keep merges the card into branch ${branch} there, so commit or set those changes aside first. ` +
        `To drop the card's work instead, press Undo.`,
    );
  }
  commitLeftovers({ kind: 'worktree', dir: run.workdir }, card); // older runs may have left work uncommitted
  const loose = uncommittedWork(run.workdir);
  if (loose.length) {
    throw new Error(`The card's folder has uncommitted work that keep would lose: ${loose.slice(0, 5).join(', ')}. Commit it in ${run.workdir} first.`);
  }
  const into = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  try {
    git(root, ['merge', '--no-ff', '-m', `Keep Chompyy card #${card.id}: ${card.title}`, run.branch]);
  } catch {
    try {
      git(root, ['merge', '--abort']);
    } catch {}
    throw new Error(`${run.branch} conflicts with ${into}: another card or your own work changed the same lines. Nothing was changed. Run it again on top of the latest with \`chompyy redo ${card.id}\` (or merge by hand: git -C ${root} merge ${run.branch}).`);
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
