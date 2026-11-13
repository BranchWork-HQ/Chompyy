import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCard, awayQueue, canMove, dropCard, formatBoard, loadBoard, moveCard, updateBoard, type BoardData } from '../src/board.js';
import { cardsSince, rateCard, readTaste } from '../src/report.js';
import { NOW, useTempHome } from './helpers.js';

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

describe('rating', () => {
  const home = useTempHome();

  it('rates a reviewed card, moves it to done and appends a signal', () => {
    const b = empty();
    const card = addCard(b, 'idea', '/r', NOW);
    card.blueprint = '## Goal\nthing';
    expect(() => rateCard(b, '1', 4, undefined, NOW)).toThrow(/only cards that ran/);
    card.column = 'review';
    expect(() => rateCard(b, '1', 6, undefined, NOW)).toThrow(/1 to 5/);
    rateCard(b, '1', 4, 'close, too long', NOW);
    expect(card.column).toBe('done');
    expect(card.rating).toEqual({ score: 4, reason: 'close, too long', at: NOW.toISOString() });
    const signal = JSON.parse(readFileSync(join(home(), 'signals.jsonl'), 'utf8').trim());
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
