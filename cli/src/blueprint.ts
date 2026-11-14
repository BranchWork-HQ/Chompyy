// Blueprint (spec §5.4): the scope agreed before a card runs, drafted by a cheap model.
import type { Card } from './board.js';
import type { Runner } from './runner.js';

export const BLUEPRINT_SECTIONS = ['Goal', 'Scope', 'Out of scope', 'Shape', "How it's checked"] as const;

export function blueprintPrompt(card: Pick<Card, 'idea' | 'cwd'>): string {
  return `You write short blueprints for tasks a coding agent will run unattended, with nobody to ask.
Turn the idea below into a blueprint. Reply with ONLY this Markdown, no preamble:

## Goal
<one line: what exists when this is done>

## Scope
- <3 to 5 bullets of what the result will contain>

## Out of scope
- <1 to 3 bullets of what will NOT be done, especially anything outward: no push, merge, PR, sending or posting. Committing to its own chompyy branch is fine: that's how the user reviews and undoes it>

## Shape
<a short outline of the artifact: files, sections or steps>

## How it's checked
- <how someone can verify the result without the author: tests, files that exist, cited sources>

Keep it under 200 words. Pick the smallest useful version of the idea. If the idea needs a decision only
the user can make, say so in Out of scope and plan to write the open questions to QUESTIONS.md.

Working directory: ${card.cwd}
Idea: ${card.idea}`;
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
    tools: '',
    timeoutMs: opts.timeoutMs ?? 120_000,
  });
  if (result.timedOut) throw new Error('Blueprint model timed out.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  return cleanBlueprint(result.output);
}
