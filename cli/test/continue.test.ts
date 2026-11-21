import { describe, expect, it } from 'vitest';
import { taskPrompt } from '../src/away.js';
import { CYCLE_SUMMARY_MAX, continuationPrompt } from '../src/blueprint.js';
import { addCard, awayQueue, continueCard, cycleOf, formatBoard, formatCard, type BoardData, type Card } from '../src/board.js';
import { NOW, useTempHome } from './helpers.js';

const BLUEPRINT = '## Goal\nA short research note on the Chompyy board UI.\n\n## Scope\n- research only';
const LATER = new Date(NOW.getTime() + 3600_000);

/** A card that ran, did only research (one notes file, no code), and was kept. */
function researchOnlyCard(b: BoardData): Card {
  const c = addCard(b, 'Improve the UI/UX of the Chompyy board', '/repo', NOW);
  c.blueprint = BLUEPRINT;
  c.column = 'done';
  c.outcome = 'kept';
  c.rating = { score: 3, at: NOW.toISOString() };
  c.answers = [{ at: NOW.toISOString(), text: 'Use the existing colors.' }];
  c.fiveStarOptions = ['More thorough'];
  c.run = {
    status: 'ok',
    startedAt: NOW.toISOString(),
    finishedAt: NOW.toISOString(),
    durationMs: 1000,
    exitCode: 0,
    workdir: '/wt/1',
    branch: 'chompyy/1',
    summary: 'Wrote research/board-ux.md: three problems with the card layout.',
    checks: { result: 'not run', why: 'research only' },
    files: ['research/board-ux.md'],
  };
  return c;
}

describe('continue a finished card', () => {
  useTempHome();

  it('moves a done card back to approved, saving the run as cycle 1', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    researchOnlyCard(b);
    const c = continueCard(b, '1', '  Now change the card layout in the app  ', LATER);
    expect(c.column).toBe('approved');
    expect(c.approvedAt).toBe(LATER.toISOString());
    expect(c.blueprint).toBe(BLUEPRINT);
    expect(cycleOf(c)).toBe(2);
    expect(c.cycles).toEqual([
      {
        at: LATER.toISOString(),
        note: 'Now change the card layout in the app',
        status: 'ok',
        outcome: 'kept',
        summary: 'Wrote research/board-ux.md: three problems with the card layout.',
        files: ['research/board-ux.md'],
        branch: 'chompyy/1',
        checks: { result: 'not run', why: 'research only' },
        rating: { score: 3, at: NOW.toISOString() },
        answers: [{ at: NOW.toISOString(), text: 'Use the existing colors.' }],
      },
    ]);
    // The new cycle starts clean, so the board shows it as queued, not as an old result.
    for (const k of ['run', 'outcome', 'rating', 'answers', 'fiveStarOptions'] as const) expect(c[k]).toBeUndefined();
    expect(awayQueue(b).map((x) => x.id)).toEqual(['1']);
  });

  it('lets the caller pass the full summary and file list', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    researchOnlyCard(b);
    const c = continueCard(b, '1', '', LATER, { summary: 'The whole output.', files: ['a.md', 'b.md'] });
    expect(c.cycles![0]).toMatchObject({ note: '', summary: 'The whole output.', files: ['a.md', 'b.md'] });
  });

  it('only continues finished cards that ran', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    const c = researchOnlyCard(b);
    for (const col of ['later', 'approved', 'running', 'suggested'] as const) {
      c.column = col;
      expect(() => continueCard(b, '1', 'x', LATER)).toThrow(/only finished cards/);
    }
    c.column = 'review';
    expect(() => continueCard(b, '1', 'x', LATER)).toThrow(/Keep or undo it first/);
    c.column = 'done';
    const run = c.run;
    delete c.run;
    expect(() => continueCard(b, '1', 'x', LATER)).toThrow(/never ran/);
    c.run = run;
    expect(c.column).toBe('done'); // nothing changed by the failed attempts
    expect(c.cycles).toBeUndefined();
  });

  it('adds one cycle per continue and shows it on the board and the card', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    const c = researchOnlyCard(b);
    continueCard(b, '1', 'Now change the layout', LATER);
    // Second cycle runs and is undone, then sent back again.
    c.column = 'done';
    c.outcome = 'undone';
    c.run = { ...researchOnlyCard({ nextId: 9, cards: [] }).run!, summary: 'Changed Board.swift', files: ['mac/Board.swift'] };
    continueCard(b, '1', 'Keep the old colors', LATER);
    expect(cycleOf(c)).toBe(3);
    expect(c.cycles!.map((y) => y.outcome)).toEqual(['kept', 'undone']);
    expect(formatBoard(b)).toMatch(/cycle 3/);
    const shown = formatCard(c);
    expect(shown).toMatch(/cycle 3: continues 2 earlier cycles/);
    expect(shown).toMatch(/cycle 1: ok · kept · 1 file\n {4}sent back: Now change the layout/);
    expect(shown).toMatch(/cycle 2: ok · undone · 1 file/);
  });
});

describe('the continuation prompt', () => {
  useTempHome();

  it('is empty for a card on its first cycle', () => {
    expect(continuationPrompt({ idea: 'x' })).toBe('');
    const b: BoardData = { nextId: 1, cards: [] };
    expect(taskPrompt(researchOnlyCard(b), '/w')).not.toMatch(/a continuation/);
  });

  it('a research-only card continued with a note: queued, and its prompt has the prior summary and the note', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    researchOnlyCard(b);
    const card = continueCard(b, '1', 'The research is done; now change the card layout in the app', LATER);
    expect(card.column).toBe('approved');
    const prompt = taskPrompt(card, '/w');
    expect(prompt).toContain('Original idea: Improve the UI/UX of the Chompyy board');
    expect(prompt).toContain(BLUEPRINT);
    expect(prompt).toContain('# This is cycle 2: a continuation');
    expect(prompt).toContain('Wrote research/board-ux.md: three problems with the card layout.');
    expect(prompt).toContain('Files it changed: research/board-ux.md');
    expect(prompt).toContain('its work was kept, so it is already in the code you start from');
    expect(prompt).toContain('# What is still missing (the user\'s note)\n\nThe research is done; now change the card layout in the app');
    expect(prompt).toMatch(/Where the note asks\nfor more than the blueprint's Scope/);
    // The old QUESTIONS.md answers belonged to cycle 1; the new run isn't told QUESTIONS.md is still there.
    expect(prompt).not.toMatch(/The previous run left QUESTIONS.md/);
    // Order: blueprint, then what was done, then the rules for this cycle.
    expect(prompt.indexOf('# Blueprint')).toBeLessThan(prompt.indexOf('# This is cycle 2'));
  });

  it('says what to do with no note, and when the earlier work was undone', () => {
    const text = continuationPrompt({
      idea: 'x',
      cycles: [{ at: 'a', note: '', status: 'ok', outcome: 'undone', summary: '', files: [] }],
    });
    expect(text).toMatch(/The user did not say\. Compare the original idea/);
    expect(text).toContain('its work was thrown away (undone), so it is NOT in the code you start from');
    expect(text).toContain('Files it changed: none (no code change)');
    expect(text).toContain('(nothing recorded)');
  });

  it('lists every earlier cycle, with older notes, and cuts very long summaries', () => {
    const text = continuationPrompt({
      idea: 'x',
      cycles: [
        { at: 'a', note: 'make the change', status: 'ok', outcome: 'kept', summary: 'r'.repeat(CYCLE_SUMMARY_MAX + 500), files: ['notes.md'] },
        { at: 'b', note: 'add tests too', status: 'failed', outcome: 'kept', summary: 'changed app.ts', files: ['app.ts'] },
      ],
    });
    expect(text).toContain('# This is cycle 3: a continuation');
    expect(text).toContain('This card already ran 2 times');
    expect(text).toContain('## Cycle 1 (ok;');
    expect(text).toContain('## Cycle 2 (failed;');
    expect(text).toContain('What the user said was still missing then: make the change');
    expect(text).toContain('…(cut)');
    expect(text).not.toContain('r'.repeat(CYCLE_SUMMARY_MAX + 1));
    expect(text).toMatch(/# What is still missing \(the user's note\)\n\nadd tests too/);
  });
});
