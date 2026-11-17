import { describe, expect, it } from 'vitest';
import { cardText, chosenType, suggestTypes, typeHint } from '../src/picturetype.js';
import { picturePrompt } from '../src/picture.js';

const card = (blueprint: string, idea = 'x', title = 't') => ({ title, idea, blueprint });

describe('suggestTypes', () => {
  it('points a status lifecycle at a state machine, with the evidence', () => {
    const [top] = suggestTypes(card('## Goal\nA card moves from review to done; on failure it retries, and stale cards move back to approved.'));
    expect(top!.type).toBe('State machine');
    expect(top!.evidence.join(' ')).toMatch(/moves? (from|back)/);
  });

  it('points a formula from inputs to an output at a data flow', () => {
    const [top] = suggestTypes(card('## Goal\nCompute today = remaining weekly allowance ÷ days left. Inputs: weekly used %, reset time → output: today\'s allowance.'));
    expect(top!.type).toBe('Data flow');
  });

  it('points requests between parts at a sequence', () => {
    const [top] = suggestTypes(card('## Shape\nThe app sends a request to the CLI, which calls the usage endpoint; the API replies and the client shows the response.'));
    expect(top!.type).toBe('Sequence');
  });

  it('points a comparison of options at a quadrant', () => {
    const [top] = suggestTypes(card('## Goal\nCompare three options by effort vs impact and prioritize the trade-offs.'));
    expect(top!.type).toBe('Quadrant');
  });

  it('points a feedback cycle at a loop', () => {
    const [top] = suggestTypes(card('## Goal\nClose the loop: ratings feed back into taste, which learns from each run, and the cycle repeats.'));
    expect(top!.type).toBe('Loop');
  });

  it('ignores Out of scope and checks sections, code blocks, and git branches', () => {
    const bp = '## Goal\nWrite a short CONTRIBUTING.md.\n## Out of scope\n- a.ts, b.ts, c.ts, d.ts: if anything else, refuse\n## How it\'s checked\nif tests pass\n```\nif (x) else y\n```\nCommit to the card\'s branch.';
    expect(cardText(card(bp))).not.toMatch(/a\.ts|refuse|tests pass|if \(x\)/);
    expect(suggestTypes(card(bp))).toEqual([]);
  });

  it('suggests nothing when nothing points anywhere, and the hint says to choose freely', () => {
    expect(suggestTypes(card('## Goal\nTidy the wording.'))).toEqual([]);
    expect(typeHint([])).toMatch(/No strong signal\. Choose from the full visual-type guide/);
  });
});

describe('the drawing prompt and the answer', () => {
  it('passes the suggestion and asks for the chosen type in a comment', () => {
    const prompt = picturePrompt({ id: '3', title: 't', idea: 'x', blueprint: '## Goal\nA card moves from review to done and retries when stale.' });
    expect(prompt).toMatch(/Suggested type: State machine \(references\/type-state\.md\), because the card mentions/);
    expect(prompt).toMatch(/<!-- type: <Type>; why:/);
  });

  it('reads the chosen type back from the drawing', () => {
    expect(chosenType('<!DOCTYPE html>\n<!-- type: State machine; why: the card is about statuses -->\n<html>')).toEqual({ type: 'State machine', why: 'the card is about statuses' });
    expect(chosenType('<!DOCTYPE html><html>')).toBeNull();
  });
});
