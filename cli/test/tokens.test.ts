import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addCard, loadBoard, updateBoard } from '../src/board.js';
import { readRuns, recordRun } from '../src/costs.js';
import { backfillTokens, median } from '../src/tokenstore.js';
import { compact, formatTokens, TokenTally, tokensFromStream, totalTokens } from '../src/tokens.js';
import { NOW, useTempHome } from './helpers.js';

// The result event from card #22's real run (2026-11-18), trimmed to the fields Chompyy reads.
const RESULT = {
  type: 'result',
  total_cost_usd: 0.6961270000000002,
  num_turns: 14,
  usage: { input_tokens: 26, cache_creation_input_tokens: 53738, cache_read_input_tokens: 608695, output_tokens: 7219, output_tokens_details: { thinking_tokens: 929 } },
  modelUsage: { 'claude-opus-5-5': { outputTokens: 7219 } },
};

describe('exact tokens per run', () => {
  it('reads the result event, ignores every other event', () => {
    const t = new TokenTally();
    t.feed({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } });
    t.feed({ type: 'result' }); // no usage: ignored
    expect(t.total()).toBeUndefined();
    t.feed(RESULT);
    expect(t.total()).toEqual({ input: 26, output: 7219, cacheRead: 608695, cacheWrite: 53738, thinking: 929, costUsd: 0.6961, turns: 14, models: ['claude-opus-5-5'] });
  });

  it('adds up several result events (a run with more than one result)', () => {
    const t = new TokenTally();
    t.feed(RESULT);
    t.feed(RESULT);
    expect(t.total()).toMatchObject({ output: 14438, turns: 28, costUsd: 1.3923 });
  });

  it('says it plainly', () => {
    const t = new TokenTally();
    t.feed(RESULT);
    expect(totalTokens(t.total()!)).toBe(669678);
    expect(formatTokens(t.total()!)).toBe('670k tokens (7.2k out · 609k cache read · 54k cache write · 26 in) · $0.70 at API prices · 14 turns');
    expect([compact(999), compact(1234), compact(54000), compact(1_900_000)]).toEqual(['999', '1.2k', '54k', '1.9M']);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('filling in runs recorded before this existed', () => {
  const home = useTempHome();

  it('finds each run\'s stream log by its start time and fills in board and runs.jsonl', () => {
    const started = Date.parse('2026-11-18T16:12:15.449Z');
    const finished = started + 446213;
    const dir = join(home(), 'runs', '1');
    mkdirSync(dir, { recursive: true });
    const stream = join(dir, '2026-11-18T16-12-15-449Z.stream.jsonl');
    writeFileSync(stream, `${JSON.stringify({ type: 'system' })}\n${JSON.stringify(RESULT)}\n`);
    const b = loadBoard();
    const card = addCard(b, 'eyes', '/r', NOW, 'review');
    card.logPath = join(dir, '2026-11-18T16-12-15-449Z.log');
    card.run = { status: 'ok', startedAt: new Date(started).toISOString(), finishedAt: new Date(finished).toISOString(), durationMs: 446213, exitCode: 0, workdir: '/w', summary: '' };
    updateBoard((bb) => Object.assign(bb, b));
    recordRun({ at: new Date(finished).toISOString(), card: '1', title: 'eyes', idea: 'eyes', cwd: '/r', status: 'ok', durationMs: 446213, fiveHourPct: 5, weeklyPct: 0 });
    recordRun({ at: '2026-11-18T10:00:00.000Z', card: '9', title: 'no log', idea: 'x', cwd: '/r', status: 'ok', durationMs: 1000, fiveHourPct: null, weeklyPct: null });

    expect(backfillTokens()).toBe(1);
    expect(loadBoard().cards[0]!.run!.tokens!.output).toBe(7219);
    const runs = readRuns();
    expect(runs[0]!.tokens!.cacheRead).toBe(608695);
    expect(runs[0]!.fiveHourPct).toBe(5); // nothing else changed
    expect(runs[1]!.tokens).toBeUndefined();
    expect(backfillTokens()).toBe(0); // second time: nothing to do
    expect(tokensFromStream(join(dir, 'missing.stream.jsonl'))).toBeUndefined();
    expect(readFileSync(join(home(), 'runs.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });
});
