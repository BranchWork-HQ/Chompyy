import { describe, expect, it } from 'vitest';
import { tasteState } from '../src/appstate.js';
import { appendJsonl, homePath } from '../src/home.js';
import { saveStore, type Preference } from '../src/taste.js';
import { NOW, useTempHome } from './helpers.js';

// "What Chompyy heard from you" (2026-11-19): the badge counts the waiting rules; each comes with receipts in your
// own words. Two real rules had waited since 2026-11-18 because the question only existed in the CLI.
const sig = (r: Record<string, unknown>) => appendJsonl(homePath('signals.jsonl'), { at: NOW.toISOString(), ...r });
const pref = (id: string, status: Preference['status'], evidence: string[], extra: Partial<Preference> = {}): Preference => ({
  id, scope: 'Everywhere', text: `rule ${id}`, noticed: `noticed ${id}`, status, evidence, stated: true,
  createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra,
});

describe('taste for the app', () => {
  useTempHome();

  it('lists every waiting rule with receipts quoting you, and the learned ones apart', () => {
    sig({ card: '2', title: 'README section', rating: 2, reason: 'the report is hard to read' });
    sig({ card: '9', title: 'spec', rating: 4, toFive: ['Shorter and simpler'] });
    sig({ card: '4', title: 'quiz', rating: 3 });
    saveStore({
      nextId: 4,
      prefs: [
        pref('p1', 'ready', ['s1', 's2']),
        pref('p2', 'ready', ['s3']),
        pref('p3', 'active', ['s3'], { validFrom: NOW.toISOString() }),
        pref('p4' as string, 'muted', ['s1']),
      ],
    } as never);
    const t = tasteState();
    expect(t.waiting.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    const p1 = t.waiting.find((p) => p.id === 'p1')!;
    expect(p1.evidence).toBe('rated #2 · asked for a change on #9');
    expect(p1.receipts.map((r) => r.said)).toEqual([
      'rated card #2 "README section" 2/5 "the report is hard to read"',
      'rated card #9 "spec" 4/5 · to make it a 5: Shorter and simpler',
    ]);
    expect(t.learned.map((p) => [p.id, p.since])).toEqual([['p3', NOW.toISOString()]]);
  });

  it('nothing waiting: no badge', () => {
    expect(tasteState()).toEqual({ waiting: [], learned: [] });
  });
});
