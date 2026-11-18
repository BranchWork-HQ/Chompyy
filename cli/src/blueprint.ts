// Blueprint (spec §5.4): the scope agreed before a card runs, drafted by a cheap model.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureCardDir, type BoardData, type Card } from './board.js';
import type { Runner } from './runner.js';

export const BLUEPRINT_SECTIONS = ['Goal', 'Scope', 'Out of scope', 'Shape', "How it's checked"] as const;
/** Optional: what the run needs beyond the box, for the permission plan. */
export const OPTIONAL_SECTIONS = ['Needs'] as const;

export function blueprintPrompt(card: Pick<Card, 'idea' | 'cwd'>): string {
  return `You write short blueprints for tasks a coding agent will run unattended, with nobody to ask.
Turn the idea below into a blueprint. Reply with ONLY this Markdown, no preamble:

## Goal
<one line: what exists when this is done>

## Scope
- <3 to 5 bullets of what the result will contain>

## Out of scope
- <1 to 3 bullets of what will NOT be done, especially anything outward: no push, merge, PR, sending or posting. Committing is fine: the run commits to the card's own branch, which Chompyy creates; don't name a branch>

## Shape
<a short outline of the artifact: files, sections or steps>

## How it's checked
- <how someone can verify the result without the author: tests, files that exist, cited sources>

## Needs
- <ONLY if the run truly can't succeed inside the box; otherwise leave this whole section out>
- network: <domain>: <why, one line>   (the shell needs to reach this domain, e.g. to download a file)
- command: <program>: <why, one line>  (a program the run must use that needs approval)

Look at the working directory first (read-only) so the blueprint fits what is really there: its files,
languages, test command and tooling. Don't plan steps for tools the repo doesn't have.
If the plan depends on facts you're unsure of (an API, a library's usage, a format), you may check them with
WebSearch or WebFetch first. Keep research short: the blueprint, not the research, is the deliverable.

The run can only change files inside the working directory. Its shell has no network, but the agent CAN
read public web pages with its web tools (WebFetch, WebSearch), so reading docs or a linked page is fine.
The repo's installed dependencies are already in the run's copy, so don't plan to install them.
If the idea needs the shell to reach a site or run a program needing approval, list it under Needs: the user
can allow it when approving. If it needs anything else outside the directory (global or user config, other
folders or repos, accounts, calling APIs), start Out of scope with "Can't run unattended: <why>" and plan only
what can be done inside the directory, such as a script or written steps the user can run themselves.

Keep it under 200 words. Pick the smallest useful version of the idea.
Never write "no commits" or "leave files untracked": the run always commits to the card's own branch (Chompyy
creates and names it, so don't name one), and that branch is how the user reviews, keeps or undoes the work.
Don't plan a QUESTIONS.md by default. Only if the idea truly can't be done without a decision only the user
can make, say so in Out of scope and plan to write that question to QUESTIONS.md.

Working directory: ${card.cwd}
Idea: ${card.idea}`;
}

/** Keep a copy of the card's blueprint in its folder (`<store>/<workspace>/<id>/blueprint.md`). Returns the path. */
export function writeBlueprintFile(card: Pick<Card, 'id' | 'workspace'>, text: string): string {
  const path = join(ensureCardDir(card), 'blueprint.md');
  writeFileSync(path, text.trim() + '\n');
  return path;
}

/** Strip chatter before the first heading; insist on the Goal heading. */
export function cleanBlueprint(output: string): string {
  const text = output.trim();
  const start = text.indexOf('## Goal');
  if (start === -1) throw new Error('The model reply has no "## Goal" section.');
  return text.slice(start).trim();
}

export async function draftBlueprint(
  card: Pick<Card, 'idea' | 'cwd'>,
  runner: Runner,
  opts: { model: string; cwd: string; timeoutMs?: number },
): Promise<string> {
  const result = await runner.run({
    prompt: blueprintPrompt(card),
    cwd: opts.cwd,
    model: opts.model,
    // Research while drafting: the plan you approve should already be checked against the docs.
    tools: 'Read,Glob,Grep,WebSearch,WebFetch',
    // Headless runs refuse anything not allowed up front (nobody to approve), so allow the research tools.
    allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    timeoutMs: opts.timeoutMs ?? 240_000,
  });
  if (result.timedOut) throw new Error('Blueprint model timed out.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  return cleanBlueprint(result.output);
}

/** A draft that started this long ago and never finished (its process died) counts as not drafting. */
const DRAFT_STALE_MS = 3 * 60_000;

/**
 * Later cards "Draft all" should draft: no blueprint yet and not being drafted right now.
 * Cards with a blueprint (edited ones too) are left alone; a card whose last draft failed is retried.
 */
export function laterToDraft(board: BoardData, now: Date = new Date()): Card[] {
  return board.cards.filter(
    (c) =>
      c.column === 'later' &&
      !c.blueprint?.trim() &&
      (!c.draftingAt || Date.parse(c.draftingAt) < now.getTime() - DRAFT_STALE_MS),
  );
}

/**
 * The plan for `chompyy blueprint --all-later`: which cards to draft, or why it drafts nothing.
 * Same gate as background drafting: with no active 5-hour window a model call would start a new one.
 */
export function draftAllPlan(board: BoardData, windowActive: boolean, now: Date = new Date()): { ids: string[]; message?: string } {
  if (!windowActive) return { ids: [], message: 'No active 5-hour window: drafting now would start one. Nothing drafted; try again while you are using Claude Code.' };
  const ids = laterToDraft(board, now).map((c) => c.id);
  return ids.length ? { ids } : { ids, message: 'Every later card already has a blueprint (or is being drafted).' };
}

/** Generic options when a card-specific list can't be made (e.g. no active window). */
export const GENERIC_FIVE_STAR = ['Closer to what I asked for', 'Shorter and simpler', 'More thorough', 'A different format'];

export function fiveStarPrompt(card: Pick<Card, 'idea' | 'blueprint'> & { summary?: string; files?: string[] }): string {
  return `A coding agent finished a task and the user rated it below 5 stars. Suggest what would most likely
have made it a 5 for this user. Reply with ONLY 4 lines, one option per line, no numbering, no bullets.
Each option: a concrete, specific change to the result, at most 9 words, written as the user would say it
(e.g. "Put the answers in a separate file"). Make them different from each other.

Task: ${card.idea}

Blueprint:
${card.blueprint ?? '(none)'}

What the agent said it did:
${card.summary ?? '(nothing)'}

Files changed: ${(card.files ?? []).join(', ') || '(unknown)'}`;
}

export async function draftFiveStarOptions(
  card: Pick<Card, 'idea' | 'blueprint'> & { summary?: string; files?: string[] },
  runner: Runner,
  opts: { model: string; cwd: string },
): Promise<string[]> {
  const result = await runner.run({ prompt: fiveStarPrompt(card), cwd: opts.cwd, model: opts.model, tools: '', timeoutMs: 60_000 });
  if (result.exitCode !== 0 || result.timedOut) throw new Error('could not draft options');
  const lines = result.output
    .split('\n')
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').replace(/^"|"$/g, '').trim())
    .filter((l) => l.length > 2 && l.length < 90);
  if (lines.length < 2) throw new Error('could not draft options');
  return lines.slice(0, 4);
}
