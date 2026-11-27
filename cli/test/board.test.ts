import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCard, awayQueue, canMove, cardDir, claimDrafts, dropCard, formatBoard, formatCard, loadBoard, moveCard, noteDraftFailure, quotaWaitReason, recoverRunning, updateBoard, workspaceFolder, workspaceOf, type BoardData } from '../src/board.js';
import { windowView } from '../src/quota.js';
import { writeBlueprintFile } from '../src/blueprint.js';
import { writeFileSync } from 'node:fs';
import { cardsSince, rateCard, readTaste } from '../src/report.js';
import { NOW, nowSec, useTempHome } from './helpers.js';

const empty = (): BoardData => ({ nextId: 1, cards: [] });

describe('board', () => {
  const home = useTempHome();

  it('adds cards to later with incrementing ids, title and cwd', () => {
    const b = empty();
    const a = addCard(b, '  Write a digest of caching papers\nwith links  ', '/repo', NOW);
    const c = addCard(b, 'x'.repeat(100), '/repo', NOW);
    expect(a).toMatchObject({ id: '1', column: 'later', cwd: '/repo', title: 'Write a digest of caching papers', blueprint: null });
    expect(c.id).toBe('2');
    expect(c.title.length).toBeLessThanOrEqual(60);
    expect(() => addCard(b, '   ', '/repo', NOW)).toThrow(/empty/);
  });

  it('persists through updateBoard', () => {
    updateBoard((b) => addCard(b, 'idea', '/r', NOW));
    expect(loadBoard().cards).toHaveLength(1);
    expect(existsSync(join(home(), 'board.json'))).toBe(true);
  });

  it('parking an idea into an empty later column (the app path) saves a later card that gets drafted', () => {
    // The app's "Nothing here" click runs `chompyy later "<idea>"` in the picked project, which does this.
    expect(loadBoard().cards.filter((c) => c.column === 'later')).toEqual([]);
    const card = updateBoard((b) => addCard(b, '  add a CONTRIBUTING.md with 3 rules ', '/proj', NOW, 'later', 'main'));
    const saved = loadBoard();
    expect(saved.cards).toHaveLength(1);
    expect(saved.cards[0]).toMatchObject({ id: card.id, column: 'later', cwd: '/proj', workspace: 'main', idea: 'add a CONTRIBUTING.md with 3 rules', blueprint: null });
    expect(claimDrafts(saved, NOW, null)).toEqual([card.id]); // the background drafter picks it up
  });

  it('allows only the defined transitions', () => {
    expect(canMove('later', 'approved')).toBe(true);
    expect(canMove('approved', 'running')).toBe(true);
    expect(canMove('running', 'review')).toBe(true);
    expect(canMove('review', 'done')).toBe(true);
    expect(canMove('later', 'running')).toBe(false);
    expect(canMove('later', 'done')).toBe(false);
    expect(canMove('done', 'approved')).toBe(false);
  });

  it('needs a blueprint before approval', () => {
    const b = empty();
    const card = addCard(b, 'idea', '/r', NOW);
    expect(() => moveCard(b, card.id, 'approved', NOW)).toThrow(/no blueprint/);
    card.blueprint = '## Goal\nx';
    expect(moveCard(b, '#1', 'approved', NOW)).toMatchObject({ column: 'approved', approvedAt: NOW.toISOString() });
    expect(() => moveCard(b, '1', 'done', NOW)).toThrow(/can't move/);
    expect(() => moveCard(b, '9', 'approved', NOW)).toThrow(/No card #9/);
  });

  it('queues approved cards in approval order', () => {
    const b = empty();
    for (const i of [1, 2, 3]) addCard(b, `idea ${i}`, '/r', NOW).blueprint = 'bp';
    moveCard(b, '3', 'approved', new Date('2026-11-13T10:00:00Z'));
    moveCard(b, '1', 'approved', new Date('2026-11-13T11:00:00Z'));
    expect(awayQueue(b).map((c) => c.id)).toEqual(['3', '1']);
  });

  it('drops to the archive, never a running card', () => {
    const b = empty();
    addCard(b, 'keep', '/r', NOW);
    addCard(b, 'running', '/r', NOW).column = 'running';
    dropCard(b, '1', NOW);
    expect(b.cards.map((c) => c.id)).toEqual(['2']);
    expect(readFileSync(join(home(), 'archive.jsonl'), 'utf8')).toContain('"keep"');
    expect(() => dropCard(b, '2', NOW)).toThrow(/running/);
  });

  it('lists cards by column', () => {
    const b = empty();
    addCard(b, 'parked idea', '/r', NOW);
    const text = formatBoard(b);
    expect(text).toContain('📥 later (1)');
    expect(text).toContain('#1');
    expect(text).toContain('no blueprint');
    expect(formatBoard(empty())).toContain('empty');
  });
});

describe('drafting with no quota left', () => {
  const empty5h = windowView({ usedPct: 100, resetsAt: nowSec + 40 * 60 }, NOW);
  const some5h = windowView({ usedPct: 60, resetsAt: nowSec + 40 * 60 }, NOW);

  it('only waits when a running window has 0% left', () => {
    expect(quotaWaitReason(empty5h)).toMatch(/^waiting for quota: the 5-hour window is used up, drafts after it resets at \d\d:\d\d$/);
    expect(quotaWaitReason(some5h)).toBeNull();
    expect(quotaWaitReason(windowView(undefined, NOW))).toBeNull();
  });

  it('a later card with 0% left gets the reason and no draft is started; it drafts once quota returns', () => {
    const b = empty();
    const c = addCard(b, 'parked idea', '/r', NOW);
    expect(claimDrafts(b, NOW, quotaWaitReason(empty5h))).toEqual([]); // [] = no model call
    expect(c.blueprintWaiting).toMatch(/waiting for quota/);
    expect(c.draftingAt).toBeUndefined();

    const later = new Date(NOW.getTime() + 41 * 60_000);
    expect(claimDrafts(b, later, quotaWaitReason(some5h))).toEqual(['1']);
    expect(c.draftingAt).toBe(later.toISOString());
    expect(c.blueprintWaiting).toBeUndefined();
  });

  it('shows the reason instead of a bare "no blueprint"', () => {
    const b = empty();
    const c = addCard(b, 'parked idea', '/r', NOW);
    claimDrafts(b, NOW, quotaWaitReason(empty5h));
    expect(formatBoard(b)).toContain('[waiting for quota]');
    expect(formatBoard(b)).not.toContain('no blueprint');
    expect(formatCard(c)).toMatch(/\(no blueprint yet: waiting for quota: the 5-hour window is used up/);
  });

  it('a draft that hit the usage limit stays retryable (no blueprintError) and is picked up after the reset', () => {
    const b = empty();
    const c = addCard(b, 'parked idea', '/r', NOW);
    claimDrafts(b, NOW, null);
    const reset = new Date(NOW.getTime() + 40 * 60_000);
    noteDraftFailure(b, '1', 'claude exited with 1: Claude AI usage limit reached|1763470800', true, reset);
    expect(c.blueprintError).toBeUndefined();
    expect(c.draftingAt).toBeUndefined();
    expect(c.blueprintWaiting).toMatch(/usage limit was hit, retries after/);
    expect(claimDrafts(b, new Date(NOW.getTime() + 5 * 60_000), null)).toEqual([]); // not before the reset
    expect(claimDrafts(b, reset, null)).toEqual(['1']);
  });

  it('any other failure is still marked failed and not retried', () => {
    const b = empty();
    const c = addCard(b, 'parked idea', '/r', NOW);
    noteDraftFailure(b, '1', 'claude exited with 1: auth error', false, NOW);
    expect(c.blueprintError).toMatch(/auth error/);
    expect(claimDrafts(b, NOW, null)).toEqual([]);
    expect(formatBoard(b)).toContain('blueprint failed');
  });
});

describe('workspaces', () => {
  const home = useTempHome();

  it('puts a card with no workspace in unsorted', () => {
    const b = empty();
    const card = addCard(b, 'no branch here', '/r', NOW);
    expect(card.workspace).toBe('unsorted');
    expect(workspaceOf({})).toBe('unsorted');
    expect(workspaceOf({ workspace: '  ' })).toBe('unsorted');
    expect(cardDir(card)).toBe(join(home(), 'cards', 'unsorted', '1'));
  });

  it('gives two workspaces separate folders, and writes the blueprint there', () => {
    const b = empty();
    const a = addCard(b, 'login fix', '/r', NOW, 'later', 'feat/login');
    const c = addCard(b, 'docs typo', '/r', NOW, 'later', 'main');
    expect(cardDir(a)).toBe(join(home(), 'cards', 'feat-login', '1'));
    expect(cardDir(c)).toBe(join(home(), 'cards', 'main', '2'));
    expect(cardDir(a, '/store')).toBe(join('/store', 'feat-login', '1'));
    const path = writeBlueprintFile(a, '## Goal\nfix login');
    expect(path).toBe(join(home(), 'cards', 'feat-login', '1', 'blueprint.md'));
    expect(readFileSync(path, 'utf8')).toBe('## Goal\nfix login\n');
  });

  it('never makes a folder name that climbs out of the store', () => {
    expect(workspaceFolder('../../etc')).toBe('etc');
    expect(workspaceFolder('..')).toBe('unsorted');
    expect(workspaceFolder('chompyy/19')).toBe('chompyy-19');
  });

  it('groups the listing under one header per workspace, unsorted last', () => {
    const b = empty();
    addCard(b, 'loose idea', '/r', NOW);
    addCard(b, 'login fix', '/r', NOW, 'later', 'feat/login');
    addCard(b, 'login test', '/r', NOW, 'later', 'feat/login').blueprint = 'bp';
    moveCard(b, '3', 'approved', NOW);
    addCard(b, 'docs typo', '/r', NOW, 'later', 'main');
    const text = formatBoard(b);
    const lines = text.split('\n');
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(lines.filter((l) => /^\[/.test(l))).toEqual(['[feat/login] (2)', '[main] (1)', '[unsorted] (1)']);
    expect(at('login fix')).toBeGreaterThan(at('[feat/login]'));
    expect(at('login test')).toBeLessThan(at('[main]'));
    expect(at('docs typo')).toBeGreaterThan(at('[main]'));
    expect(at('loose idea')).toBeGreaterThan(at('[unsorted]'));
    // A column filter leaves out workspaces with nothing in it.
    expect(formatBoard(b, ['approved'])).toBe(`[feat/login] (1)\n✅ approved (1)\n${lines[at('login test')]}`);
  });

  it('still loads an old board whose cards have no workspace, as unsorted', () => {
    const old = {
      nextId: 2,
      cards: [{ id: '1', title: 'old idea', idea: 'old idea', cwd: '/r', column: 'later', blueprint: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    };
    writeFileSync(join(home(), 'board.json'), JSON.stringify(old));
    const b = loadBoard();
    expect(b.cards[0]!.workspace).toBeUndefined();
    expect(workspaceOf(b.cards[0]!)).toBe('unsorted');
    expect(cardDir(b.cards[0]!)).toBe(join(home(), 'cards', 'unsorted', '1'));
    expect(formatBoard(b)).toContain('[unsorted] (1)');
    expect(formatCard(b.cards[0]!)).toContain('workspace: unsorted');
  });
});

describe('rating', () => {
  const home = useTempHome();

  it('rates a reviewed card and appends a signal; it stays in review until kept or undone', () => {
    const b = empty();
    const card = addCard(b, 'idea', '/r', NOW);
    card.blueprint = '## Goal\nthing';
    expect(() => rateCard(b, '1', 4, undefined, NOW)).toThrow(/only cards that ran/);
    card.column = 'review';
    expect(() => rateCard(b, '1', 6, undefined, NOW)).toThrow(/1 to 5/);
    rateCard(b, '1', 4, 'close, too long', NOW);
    expect(card.column).toBe('review'); // Keep/Undo must stay available (card #4, 2026-11-16)
    card.outcome = 'kept';
    rateCard(b, '1', 4, 'close, too long', NOW);
    expect(card.column).toBe('done');
    expect(card.rating).toEqual({ score: 4, reason: 'close, too long', at: NOW.toISOString() });
    const signal = JSON.parse(readFileSync(join(home(), 'signals.jsonl'), 'utf8').trim().split('\n')[0]!);
    expect(signal).toMatchObject({ card: '1', rating: 4, reason: 'close, too long', blueprint: '## Goal\nthing' });
  });

  it('reports only runs that finished after the last report', () => {
    const b = empty();
    const run = (finishedAt: string) => ({ status: 'ok' as const, startedAt: finishedAt, finishedAt, durationMs: 1, exitCode: 0, workdir: '/w', summary: '' });
    addCard(b, 'old', '/r', NOW).run = run('2026-11-12T00:00:00.000Z');
    addCard(b, 'new', '/r', NOW).run = run('2026-11-13T00:00:00.000Z');
    addCard(b, 'never ran', '/r', NOW);
    expect(cardsSince(b, '2026-11-12T12:00:00.000Z').map((c) => c.title)).toEqual(['new']);
    expect(cardsSince(b, null)).toHaveLength(2);
  });

  it('creates a taste.md stub once', () => {
    expect(readTaste().created).toBe(true);
    expect(readTaste()).toMatchObject({ created: false });
    expect(readTaste().text).toMatch(/^# taste\.md/);
  });
});

describe('recoverRunning', () => {
  useTempHome();
  it('moves cards stuck in running to review as an error, with where their work is', () => {
    const b = { nextId: 3, cards: [
      { id: '1', title: 'a', idea: 'a', cwd: '/x', column: 'running', blueprint: 'bp', createdAt: '', updatedAt: '' },
      { id: '2', title: 'b', idea: 'b', cwd: '/x', column: 'review', blueprint: 'bp', createdAt: '', updatedAt: '' },
    ] } as unknown as BoardData;
    expect(recoverRunning(b, NOW, () => ({ dir: '/wt/1', branch: 'chompyy/1' }))).toEqual(['1']);
    expect(b.cards.map((c) => c.column)).toEqual(['review', 'review']);
    expect(b.cards[0]!.run).toMatchObject({ status: 'error', workdir: '/wt/1', branch: 'chompyy/1', exitCode: null });
    expect(b.cards[0]!.run!.summary).toMatch(/stopped in the middle/);
  });
});
