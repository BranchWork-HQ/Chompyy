// "While you were away" report and rating (spec §5.7).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getCard, type BoardData, type Card } from './board.js';
import { formatDuration } from './duration.js';
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

const ICON: Record<string, string> = { ok: '✅', questions: '❓', timeout: '⏱', failed: '❌', error: '⚠️' };

export function formatReport(cards: Card[], since: string | null): string {
  if (cards.length === 0) return since ? `Nothing ran since the last report (${since}).` : 'Nothing has run yet.';
  const out = [`While you were away: ${cards.length} card(s)${since ? ` since ${since}` : ''}`, ''];
  for (const c of cards) {
    const r = c.run!;
    out.push(`${ICON[r.status] ?? '•'} #${c.id} ${c.title}`);
    out.push(`   ${r.status} · ${formatDuration(r.durationMs)} · ${r.branch ? `branch ${r.branch} · ` : ''}${r.workdir}`);
    if (r.status === 'questions') out.push(`   needs you: see ${r.workdir}/QUESTIONS.md`);
    for (const line of r.summary.split('\n').filter(Boolean)) out.push(`   │ ${line}`);
    if (c.logPath) out.push(`   log: ${c.logPath}`);
    out.push('');
  }
  out.push('Rate each against its blueprint: chompyy rate <id> <1-5> ["why"]');
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
