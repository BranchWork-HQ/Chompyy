// "While you were away" report and rating (spec §5.7).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getCard, type BoardData, type Card } from './board.js';
import { formatDuration } from './duration.js';
import { wrap } from './review.js';
import { appendJsonl, homePath, readJson, writeJson } from './home.js';

interface State {
  lastReportAt?: string;
}

const statePath = () => homePath('state.json');

export function lastReportAt(): string | null {
  return readJson<State>(statePath(), {}).lastReportAt ?? null;
}

export function markReported(now: Date): void {
  writeJson(statePath(), { ...readJson<State>(statePath(), {}), lastReportAt: now.toISOString() });
}

/** Cards whose last run finished after `since` (all runs when null), oldest first. */
export function cardsSince(board: BoardData, since: string | null): Card[] {
  return board.cards
    .filter((c) => c.run && (!since || c.run.finishedAt > since))
    .sort((a, b) => a.run!.finishedAt.localeCompare(b.run!.finishedAt));
}

/** What the report needs to know about a card beyond the board: kept out so tests can fake it. */
export interface CardFacts {
  files: string[];
  questions: string[];
}

/** The one thing to do about each run, most urgent first. */
const ACTION: Record<string, { icon: string; rank: number; text: string }> = {
  questions: { icon: '❓', rank: 0, text: 'Answer its question, then keep or undo' },
  failed: { icon: '❌', rank: 1, text: "It didn't finish. Look at what happened, then undo or run it again" },
  error: { icon: '⚠️', rank: 1, text: "It couldn't start. Look at what happened" },
  timeout: { icon: '⏱', rank: 2, text: 'It ran out of time. Check what it got done, then keep or undo' },
  ok: { icon: '✅', rank: 3, text: 'Check the change, then keep or undo' },
};

/** Once you've kept or undone a card, the only thing left is the rating. */
const DECIDED: Record<'kept' | 'undone', { icon: string; rank: number; text: string }> = {
  kept: { icon: '📥', rank: 4, text: 'Kept. Rate it so Chompyy learns your taste' },
  undone: { icon: '↩️', rank: 4, text: 'Undone. Rate it so Chompyy learns what missed' },
};

function filesLine(files: string[]): string {
  if (!files.length) return 'no files changed';
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${shown} +${files.length - 3} more` : shown;
}

/** Short and action-first; details come from `show`, `diff`, `keep`, `undo` on request. */
export function formatReport(cards: Card[], since: string | null, facts: (card: Card) => CardFacts): string {
  if (cards.length === 0) return since ? 'Nothing new since your last report.' : 'Nothing has run yet.';
  const rank = (c: Card) => (c.outcome ? DECIDED[c.outcome].rank : (ACTION[c.run!.status]?.rank ?? 9));
  const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
  const out = [`🍪 While you were away · ${cards.length} card${cards.length === 1 ? '' : 's'}`, ''];
  for (const c of sorted) {
    const decided = c.outcome ? DECIDED[c.outcome] : undefined;
    const action = decided ?? ACTION[c.run!.status] ?? { icon: '•', text: 'Take a look' };
    const { files, questions } = decided ? { files: [], questions: [] } : facts(c);
    out.push(`${action.icon} #${c.id}  ${c.title}`);
    out.push(`   → ${action.text}`);
    for (const q of questions) wrap(q, 70).forEach((part, i) => out.push(`     ${i === 0 ? '·' : ' '} ${part}`));
    if (!decided) out.push(`   changed: ${filesLine(files)} · took ${formatDuration(c.run!.durationMs)}`);
    out.push('');
  }
  const top = sorted[0]!;
  const id = top.id;
  out.push(top.outcome
    ? `More on a card: chompyy show ${id} · rate ${id} <1-5>`
    : `More on a card: chompyy show ${id} · diff ${id} · keep ${id} · undo ${id} · rate ${id} <1-5>`);
  return out.join('\n');
}

export function rateCard(board: BoardData, id: string, score: number, reason: string | undefined, now: Date): Card {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Rating must be a whole number from 1 to 5.');
  const card = getCard(board, id);
  if (card.column !== 'review' && card.column !== 'done') {
    throw new Error(`Card #${card.id} is in ${card.column}; only cards that ran (review or done) can be rated.`);
  }
  const at = now.toISOString();
  card.rating = { score, ...(reason ? { reason } : {}), at };
  card.column = 'done';
  card.updatedAt = at;
  // Raw material for taste distillation (spec §5.8). The distiller is not built yet.
  appendJsonl(homePath('signals.jsonl'), {
    at,
    card: card.id,
    title: card.title,
    rating: score,
    reason: reason ?? null,
    blueprint: card.blueprint,
    status: card.run?.status ?? null,
  });
  return card;
}

export const TASTE_STUB = `# taste.md

What Chompyy has learned about how you like work done. Plain text: edit it freely, your edits win.
Nothing is distilled yet; ratings collect in signals.jsonl until the distiller exists.

## Everywhere
`;

export function readTaste(): { path: string; text: string; created: boolean } {
  const path = homePath('taste.md');
  if (existsSync(path)) return { path, text: readFileSync(path, 'utf8'), created: false };
  writeFileSync(path, TASTE_STUB);
  return { path, text: TASTE_STUB, created: true };
}
