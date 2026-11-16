import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerCard, appState, editBlueprint } from '../src/appstate.js';
import { taskPrompt } from '../src/away.js';
import { addCard, type BoardData } from '../src/board.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { refreshLiveQuota, snapshotFromProvider } from '../src/livequota.js';
import { loadSnapshot, saveSnapshot } from '../src/quota.js';
import type { QuotaProvider } from '../src/vendor/codeburn/types.js';
import { NOW, nowSec, useTempHome } from './helpers.js';

const connected = (fivePct: number, weekPct: number): QuotaProvider => ({
  provider: 'claude',
  connection: 'connected',
  primary: null,
  planLabel: 'Max 5x',
  footerLines: [],
  details: [
    { label: '5-hour', percent: fivePct, resetsAt: new Date((nowSec + 3600) * 1000).toISOString() },
    { label: 'Weekly', percent: weekPct, resetsAt: new Date((nowSec + 3 * 86400) * 1000).toISOString() },
  ],
});

describe('live quota', () => {
  const home = useTempHome();

  it('turns codeburn fractions into a snapshot in percent', () => {
    expect(snapshotFromProvider(connected(0.07, 0.315), NOW)).toEqual({
      capturedAt: NOW.toISOString(),
      source: 'api',
      fiveHour: { usedPct: 7, resetsAt: nowSec + 3600 },
      sevenDay: { usedPct: 31.5, resetsAt: nowSec + 3 * 86400 },
    });
    expect(snapshotFromProvider({ ...connected(0, 0), connection: 'accessDenied' }, NOW)).toBeNull();
  });

  it('saves a refresh, then waits 5 minutes before asking again', async () => {
    let calls = 0;
    const fetchQuota = async () => (calls++, { quota: connected(0.2, 0.1) });
    expect((await refreshLiveQuota({ now: NOW, fetchQuota })).ok).toBe(true);
    expect(loadSnapshot()?.fiveHour?.usedPct).toBe(20);
    await refreshLiveQuota({ now: new Date(NOW.getTime() + 60_000), fetchQuota });
    expect(calls).toBe(1);
    await refreshLiveQuota({ now: new Date(NOW.getTime() + 60_000), fetchQuota, force: true });
    expect(calls).toBe(2);
  });

  it('keeps the old snapshot and honours a 429 backoff', async () => {
    saveSnapshot({ capturedAt: NOW.toISOString(), fiveHour: { usedPct: 50, resetsAt: nowSec + 600 } });
    let calls = 0;
    const limited = async () => (calls++, { quota: { ...connected(0, 0), connection: 'transientFailure' as const, details: [] }, retryAfterSeconds: 300 });
    const r = await refreshLiveQuota({ now: NOW, fetchQuota: limited, force: true });
    expect(r.ok).toBe(false);
    expect(loadSnapshot()?.fiveHour?.usedPct).toBe(50);
    await refreshLiveQuota({ now: new Date(NOW.getTime() + 60_000), fetchQuota: limited, force: true });
    expect(calls).toBe(1);
  });

  it('logs blueprint edits as taste signals and refuses empty ones', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    const card = addCard(b, 'idea', '/r', NOW);
    card.blueprint = '## Goal\nold';
    editBlueprint(b, card.id, '## Goal\nnew', NOW);
    expect(card.blueprint).toBe('## Goal\nnew');
    expect(() => editBlueprint(b, card.id, '  ', NOW)).toThrow(/empty/);
    const signal = JSON.parse(readFileSync(join(home(), 'signals.jsonl'), 'utf8').trim());
    expect(signal).toMatchObject({ kind: 'blueprint-edit', before: '## Goal\nold', after: '## Goal\nnew' });
  });

  it('answering moves a review card back to approved and puts the answers in the next prompt', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    const card = addCard(b, 'idea', '/r', NOW);
    expect(() => answerCard(b, card.id, 'yes', NOW)).toThrow(/review/);
    card.column = 'review';
    answerCard(b, card.id, 'Use pnpm, not npm.', NOW);
    expect(card.column).toBe('approved');
    expect(taskPrompt(card, '/w')).toContain('Use pnpm, not npm.');
  });

  it('builds the app state with quota views, gate and cards', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    addCard(b, 'idea', '/r', NOW);
    const s = appState(b, { capturedAt: NOW.toISOString(), source: 'api', fiveHour: { usedPct: 30, resetsAt: nowSec + 3600 } }, DEFAULT_CONFIG, NOW);
    expect(s.quota.fiveHour).toMatchObject({ known: true, leftPct: 70 });
    expect(s.quota.source).toBe('api');
    expect(s.cards[0]).toMatchObject({ id: '1', files: [], questionsText: null });
  });
});

describe('checks', () => {
  it('reads the last CHECKS line, tolerating dashes and bold', async () => {
    const { parseChecks } = await import('../src/away.js');
    expect(parseChecks('done\nCHECKS: passed — npm test, 8 pass')).toEqual({ result: 'passed', why: 'npm test, 8 pass' });
    expect(parseChecks('**CHECKS:** not run - npm install was blocked')).toEqual({ result: 'not run', why: 'npm install was blocked' });
    expect(parseChecks('CHECKS: failed — x\nCHECKS: passed — y')?.result).toBe('passed');
    expect(parseChecks('no verdict')).toBeUndefined();
  });

  it('the report flags a finished card whose checks did not pass', async () => {
    const { formatReport } = await import('../src/report.js');
    const card = {
      id: '4', title: 'lodash', idea: 'i', cwd: '/r', column: 'review' as const, blueprint: 'bp',
      createdAt: '', updatedAt: '',
      run: { status: 'ok' as const, startedAt: '', finishedAt: '', durationMs: 1000, exitCode: 0, workdir: '/w', summary: 's', checks: { result: 'not run' as const, why: 'npm install was blocked' } },
    };
    const text = formatReport([card], null, () => ({ files: [], questions: [] }));
    expect(text).toContain("couldn't check its work");
    expect(text).toContain('npm install was blocked');
  });
});
