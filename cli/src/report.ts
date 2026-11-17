// "While you were away" report and rating (spec §5.7).
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

/** Finished, but its own checks didn't pass: say so instead of a plain ✅. */
const UNCHECKED = {
  failed: { icon: '⚠️', rank: 1, text: 'It finished, but its checks fail. See why before you keep it' },
  notRun: { icon: '🔍', rank: 2, text: "It finished but couldn't check its work. Check it yourself, then keep or undo" },
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
/** Extra lines around the cards: the morning line on top; the one taste question and trends below. */
export interface ReportExtras {
  header?: string[];
  footer?: string[];
}

/** "Last night: 3 cards ran, 1 kept · taste: 1 learned, 1 retired, 1 question". Shows the system evolving. */
export function morningLine(cards: Card[], taste: { learned: number; retired: number; toAsk: number }): string | null {
  const bits: string[] = [];
  if (cards.length) {
    const kept = cards.filter((c) => c.outcome === 'kept').length;
    const used = cards.map((c) => c.run?.cost?.fiveHourPct).filter((n): n is number => typeof n === 'number');
    const total = Math.round(used.reduce((a, b) => a + b, 0));
    bits.push(`${cards.length} card${cards.length === 1 ? '' : 's'} ran${kept ? `, ${kept} kept` : ''}${used.length ? `, using ${total}% of 5h windows` : ''}`);
  }
  const t: string[] = [];
  if (taste.learned) t.push(`${taste.learned} learned`);
  if (taste.retired) t.push(`${taste.retired} retired`);
  if (t.length) bits.push(`taste: ${t.join(', ')}`);
  return bits.length ? `Since last time: ${bits.join(' · ')}` : null;
}

export function formatReport(cards: Card[], since: string | null, facts: (card: Card) => CardFacts, extras: ReportExtras = {}): string {
  const footer = extras.footer?.length ? ['', ...extras.footer] : [];
  if (cards.length === 0) return [since ? 'Nothing new since your last report.' : 'Nothing has run yet.', ...footer].join('\n');
  const actionOf = (c: Card) => {
    if (c.outcome) return DECIDED[c.outcome];
    if (c.run!.status === 'ok' && c.run!.checks && c.run!.checks.result !== 'passed') {
      return c.run!.checks.result === 'failed' ? UNCHECKED.failed : UNCHECKED.notRun;
    }
    return ACTION[c.run!.status];
  };
  const rank = (c: Card) => actionOf(c)?.rank ?? 9;
  const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
  const out = [`🍪 While you were away · ${cards.length} card${cards.length === 1 ? '' : 's'}`, ...(extras.header ?? []), ''];
  for (const c of sorted) {
    const decided = c.outcome ? DECIDED[c.outcome] : undefined;
    const action = actionOf(c) ?? { icon: '•', text: 'Take a look' };
    const { files, questions } = decided ? { files: [], questions: [] } : facts(c);
    out.push(`${action.icon} #${c.id}  ${c.title}`);
    out.push(`   → ${action.text}`);
    if (!decided && action !== ACTION[c.run!.status] && c.run!.checks?.why) wrap(c.run!.checks.why, 70).forEach((part, i) => out.push(`     ${i === 0 ? '·' : ' '} ${part}`));
    for (const q of questions) wrap(q, 70).forEach((part, i) => out.push(`     ${i === 0 ? '·' : ' '} ${part}`));
    if (!decided) out.push(`   changed: ${filesLine(files)} · took ${formatDuration(c.run!.durationMs)}`);
    out.push('');
  }
  const top = sorted[0]!;
  const id = top.id;
  out.push(top.outcome
    ? `More on a card: chompyy show ${id} · rate ${id} <1-5>`
    : `More on a card: chompyy show ${id} · diff ${id} · keep ${id} · undo ${id} · rate ${id} <1-5>`);
  out.push(...footer);
  return out.join('\n');
}

export function rateCard(board: BoardData, id: string, score: number, reason: string | undefined, now: Date, toFive: string[] = []): Card {
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Rating must be a whole number from 1 to 5.');
  const card = getCard(board, id);
  if (card.column !== 'review' && card.column !== 'done') {
    throw new Error(`Card #${card.id} is in ${card.column}; only cards that ran (review or done) can be rated.`);
  }
  const at = now.toISOString();
  card.rating = { score, ...(reason ? { reason } : {}), ...(toFive.length ? { toFive } : {}), at };
  // A card is done once you've kept or undone it. Rating first keeps it in review, so Keep/Undo stay available.
  if (card.outcome) card.column = 'done';
  card.updatedAt = at;
  // Raw material for taste distillation (spec §5.8, taste.ts).
  appendJsonl(homePath('signals.jsonl'), {
    at,
    card: card.id,
    title: card.title,
    rating: score,
    reason: reason ?? null,
    toFive: toFive.length ? toFive : null,
    blueprint: card.blueprint,
    status: card.run?.status ?? null,
  });
  return card;
}

export { readTaste, TASTE_STUB } from './taste.js';
