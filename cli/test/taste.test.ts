import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addCard, loadBoard, moveCard, updateBoard, type BoardData } from '../src/board.js';
import { appendJsonl, homePath } from '../src/home.js';
import type { Runner, RunRequest } from '../src/runner.js';
import {
  answerPreference, applyDistill, distill, distillDue, formatQuestion, formatWhy, governedCards, loadStore, nextQuestion,
  readSignals, readTaste, recordOutcome, retirePreference, saveStore, syncTasteFile, tasteChangesSince, tasteForPrompt, tastePath,
} from '../src/taste.js';
import { NOW, useTempHome } from './helpers.js';

const sig = (r: Record<string, unknown>) => appendJsonl(homePath('signals.jsonl'), { at: NOW.toISOString(), ...r });

/** Cards 1–4 approved (governed), card 5 parked only (not governed). */
function board(): BoardData {
  return updateBoard((b) => {
    for (let i = 1; i <= 5; i++) {
      const c = addCard(b, `task ${i}`, '/repo', NOW);
      c.blueprint = '## Goal\nx';
      if (i <= 4) moveCard(b, c.id, 'approved', NOW);
    }
    return b;
  });
}

function seed() {
  board();
  sig({ card: '1', title: 'task 1', kind: 'outcome', outcome: 'undone' }); // s1
  sig({ card: '2', title: 'task 2', rating: 2, reason: 'added tests I did not ask for', toFive: ['No extra tests'] }); // s2
  sig({ card: '3', title: 'task 3', kind: 'blueprint-edit', before: 'add tests', after: 'no tests' }); // s3
  sig({ card: '5', title: 'task 5', kind: 'blueprint-edit', before: 'a', after: 'b' }); // s4: card never approved
  sig({ kind: 'coldstart', accepted: { taste: [], cards: [] }, declined: { taste: [], cards: [] } }); // s5
}

const reply = (json: unknown): Runner => ({
  async run() {
    return { exitCode: 0, output: `Here you go:\n${JSON.stringify(json)}`, stderr: '', timedOut: false, durationMs: 1 };
  },
});

describe('signals', () => {
  useTempHome();

  it('reads signals with stable ids and learns only from governed cards', () => {
    seed();
    const signals = readSignals();
    expect(signals.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(signals[1]!.kind).toBe('rating');
    expect([...governedCards(loadBoard().cards)].sort()).toEqual(['1', '2', '3', '4']);
  });

  it('records keep and undo as signals', () => {
    board();
    const card = loadBoard().cards[0]!;
    recordOutcome(card, 'undone', NOW);
    expect(readSignals()[0]).toMatchObject({ kind: 'outcome', card: '1', raw: { outcome: 'undone' } });
  });
});

describe('distiller', () => {
  useTempHome();

  it('keeps only evidence that exists and is governed; asks after 3 separate cards', async () => {
    seed();
    let prompt = '';
    const runner: Runner = {
      async run(req: RunRequest) {
        prompt = req.prompt;
        return reply({
          candidates: [
            { id: null, scope: 'Everywhere', text: "Don't add tests unless the blueprint asks", noticed: 'You undid or edited 3 cards that added tests.', signals: ['s1', 's2', 's3', 's4'] },
            { id: null, text: 'Uses tabs', signals: ['s99'] }, // made-up evidence
            { id: null, text: 'Short summaries', signals: ['s4'] }, // only an ungoverned card
          ],
          contradicted: [],
        }).run(req);
      },
    };
    const r = await distill(loadBoard(), runner, { model: 'sonnet', cwd: '/tmp', now: NOW });
    expect(r.read).toBe(3); // s1–s3: s4 is ungoverned, s5 has no card
    expect(prompt).toContain('s2');
    expect(prompt).not.toMatch(/^s4 /m);
    expect(r.changes).toMatchObject({ added: ['p1'], ready: ['p1'], dropped: 2 });
    const store = loadStore();
    expect(store.prefs[0]).toMatchObject({ id: 'p1', status: 'ready', evidence: ['s1', 's2', 's3'] });
    expect(store.seenThrough).toBe(5);
    // Nothing new: no model call.
    const again = await distill(loadBoard(), { run: async () => { throw new Error('should not be called'); } }, { model: 'sonnet', cwd: '/tmp', now: NOW });
    expect(again.read).toBe(0);
  });

  it('waits for more cards unless you stated it yourself in a rating', () => {
    seed();
    const store = loadStore();
    const signals = readSignals();
    applyDistill(store, { candidates: [
      { text: 'Use pnpm', signals: ['s1', 's3'] }, // 2 cards, not stated
      { text: 'No extra tests', signals: ['s2'], stated: true }, // your own words in a rating
      { text: 'Fake stated', signals: ['s3'], stated: true }, // "stated" needs a rating behind it
    ] }, signals, NOW);
    expect(store.prefs.map((p) => [p.text, p.status])).toEqual([
      ['Use pnpm', 'candidate'],
      ['No extra tests', 'ready'],
      ['Fake stated', 'candidate'],
    ]);
  });

  it('extends a known preference instead of duplicating it, and retires a contradicted one', () => {
    seed();
    const store = loadStore();
    const signals = readSignals();
    applyDistill(store, { candidates: [{ text: 'Use pnpm', signals: ['s1', 's3'] }] }, signals, NOW);
    applyDistill(store, { candidates: [{ id: 'p1', signals: ['s2'] }] }, signals, NOW);
    expect(store.prefs).toHaveLength(1);
    expect(store.prefs[0]).toMatchObject({ status: 'ready', evidence: ['s1', 's3', 's2'] });
    applyDistill(store, { contradicted: [{ id: 'p1', signals: ['s1'], why: 'already evidence' }] }, signals, NOW);
    expect(store.prefs[0]!.status).toBe('ready'); // its own evidence can't contradict it
    sig({ card: '4', title: 'task 4', kind: 'outcome', outcome: 'undone' }); // s6
    applyDistill(store, { contradicted: [{ id: 'p1', signals: ['s6'], why: 'you undid a card that used pnpm' }] }, readSignals(), NOW);
    expect(store.prefs[0]).toMatchObject({ status: 'retired', retiredBecause: 'you undid a card that used pnpm', against: ['s6'] });
  });

  it('never proposes again what you muted', () => {
    seed();
    const store = loadStore();
    applyDistill(store, { candidates: [{ text: 'Use pnpm', signals: ['s1'] }] }, readSignals(), NOW);
    store.prefs[0]!.status = 'muted';
    const r = applyDistill(store, { candidates: [{ text: 'use pnpm', signals: ['s2'] }, { id: 'p1', signals: ['s3'] }] }, readSignals(), NOW);
    expect(r.added).toEqual([]);
    expect(store.prefs).toHaveLength(1);
    expect(store.prefs[0]!.evidence).toEqual(['s1']);
  });

  it('is due only with new governed signals and not too soon after the last run', () => {
    seed();
    expect(distillDue(loadBoard(), NOW)).toBe(true);
    const store = loadStore();
    store.seenThrough = 5;
    store.lastDistillAt = NOW.toISOString();
    saveStore(store);
    expect(distillDue(loadBoard(), NOW)).toBe(false);
    sig({ card: '4', title: 'task 4', rating: 4, reason: 'good' });
    expect(distillDue(loadBoard(), new Date(NOW.getTime() + 3600_000))).toBe(false); // within 6 h
    expect(distillDue(loadBoard(), new Date(NOW.getTime() + 7 * 3600_000))).toBe(true);
  });
});

describe('asking and taste.md', () => {
  useTempHome();

  function withReady() {
    seed();
    const store = loadStore();
    applyDistill(store, { candidates: [
      { text: "Don't add tests unless asked", noticed: 'You undid or edited 3 cards that added tests.', signals: ['s1', 's2', 's3'] },
      { text: 'Short answers', signals: ['s2'], stated: true },
    ] }, readSignals(), NOW);
    saveStore(store);
  }

  it('asks one question, strongest evidence first, with receipts', () => {
    withReady();
    const signals = readSignals();
    const q = nextQuestion(loadStore(), signals)!;
    expect(q.id).toBe('p1');
    const lines = formatQuestion(q, signals).join('\n');
    expect(lines).toContain('You undid or edited 3 cards that added tests.');
    expect(lines).toContain('undid #1');
    expect(lines).toContain('edited the blueprint of #3');
    expect(lines).toContain('chompyy taste yes p1');
  });

  it('yes writes it to taste.md with a valid-from date; deleting the line retires it', () => {
    withReady();
    readTaste();
    writeFileSync(tastePath(), readFileSync(tastePath(), 'utf8') + '- My own line\n');
    const p = answerPreference('p1', 'yes', NOW);
    expect(p).toMatchObject({ status: 'active', validFrom: NOW.toISOString() });
    let text = readFileSync(tastePath(), 'utf8');
    expect(text).toMatch(/## Everywhere\n- My own line\n- Don't add tests unless asked {2}\(learned 2026-11-13 · from cards #1, #2, #3 · p1\)/);
    expect(tasteForPrompt()).toBe("## Everywhere\n- My own line\n- Don't add tests unless asked");
    expect(readSignals().at(-1)).toMatchObject({ kind: 'taste-answer', raw: { pref: 'p1', answer: 'yes' } });

    // You delete the learned line: your edit wins.
    writeFileSync(tastePath(), text.split('\n').filter((l) => !l.includes('· p1)')).join('\n'));
    expect(syncTasteFile(NOW)).toEqual(['p1']);
    expect(loadStore().prefs[0]).toMatchObject({ status: 'retired', retiredBecause: 'you removed it from taste.md' });
    text = readFileSync(tastePath(), 'utf8');
    expect(text).toContain('- My own line');
  });

  it('retiring takes the line out of taste.md but keeps the preference with its reason', () => {
    withReady();
    answerPreference('p1', 'yes', NOW);
    retirePreference('p1', NOW);
    expect(readFileSync(tastePath(), 'utf8')).not.toContain('p1)');
    const p = loadStore().prefs[0]!;
    expect(formatWhy(p, readSignals())).toMatch(/Retired 2026-11-13: you retired it/);
  });

  it('"not now" waits for a new card; "never" stops asking', () => {
    withReady();
    answerPreference('p1', 'not-now', NOW);
    answerPreference('p2', 'never', NOW);
    expect(nextQuestion(loadStore(), readSignals())).toBeNull();
    sig({ card: '4', title: 'task 4', kind: 'outcome', outcome: 'undone' });
    const store = loadStore();
    const n = readSignals().length;
    applyDistill(store, { candidates: [{ id: 'p1', signals: [`s${n}`] }] }, readSignals(), NOW);
    expect(store.prefs[0]!.status).toBe('ready');
  });

  it('counts what changed since the last report', () => {
    withReady();
    answerPreference('p1', 'yes', NOW);
    expect(tasteChangesSince(loadStore(), '2026-11-01T00:00:00Z')).toEqual({ learned: 1, retired: 0, toAsk: 1 });
    expect(tasteChangesSince(loadStore(), '2026-11-20T00:00:00Z')).toEqual({ learned: 0, retired: 0, toAsk: 1 });
  });

  it('tasteForPrompt is empty when nothing is learned', () => {
    readTaste();
    expect(tasteForPrompt()).toBe('');
  });
});
