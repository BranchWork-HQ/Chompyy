// What the Mac app reads (`chompyy state --json`) and the card actions it needs beyond the CLI's.
// The app holds no logic of its own: it shows this JSON and calls chompyy commands.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCard, type BoardData, type Card } from './board.js';
import type { Config } from './config.js';
import { budgetGate } from './gate.js';
import { appendJsonl, homePath, readJson, writeJson } from './home.js';
import { loadLiveState } from './livequota.js';
import { windowView, type Snapshot } from './quota.js';
import { changedFiles } from './review.js';
import { loadColdStart } from './coldstart.js';

export interface CardView extends Card {
  files: string[];
  /** Full QUESTIONS.md from the run, if any. */
  questionsText: string | null;
}

export function cardView(card: Card): CardView {
  const qPath = card.run ? join(card.run.workdir, 'QUESTIONS.md') : '';
  return {
    ...card,
    files: card.run ? changedFiles(card) : [],
    questionsText: qPath && existsSync(qPath) ? readFileSync(qPath, 'utf8') : null,
  };
}

export function appState(board: BoardData, snap: Snapshot | null, config: Config, now: Date) {
  const live = loadLiveState();
  return {
    generatedAt: now.toISOString(),
    quota: {
      source: snap?.source ?? 'statusline',
      capturedAt: snap?.capturedAt ?? null,
      plan: live.plan ?? null,
      note: live.note ?? null,
      fiveHour: windowView(snap?.fiveHour, now),
      sevenDay: windowView(snap?.sevenDay, now),
    },
    gate: budgetGate(snap, config, now),
    cards: board.cards.map(cardView),
    coldStart: coldStartState(),
  };
}

/** Whether the app should offer the cold start: never run, proposals waiting, or done. */
export function coldStartState(): { status: 'never' | 'proposed' | 'done'; waiting: number } {
  const cs = loadColdStart();
  if (!cs) return { status: 'never', waiting: 0 };
  const waiting = [...cs.taste, ...cs.cards].filter((p) => p.status === 'proposed').length;
  return { status: waiting ? 'proposed' : 'done', waiting };
}

/** Replace a card's blueprint with your edit. Edits are the strongest taste signal, so the change is logged. */
export function editBlueprint(board: BoardData, id: string, text: string, now: Date): Card {
  const card = getCard(board, id);
  if (card.column === 'running') throw new Error(`Card #${card.id} is running; edit it after the run.`);
  const next = text.trim();
  if (!next) throw new Error('The blueprint is empty.');
  const before = card.blueprint;
  if (before?.trim() === next) return card;
  card.blueprint = next;
  delete card.blueprintError;
  card.updatedAt = now.toISOString();
  appendJsonl(homePath('signals.jsonl'), { at: card.updatedAt, card: card.id, title: card.title, kind: 'blueprint-edit', before, after: next });
  return card;
}

/** Answer the run's questions: the card goes back to approved and the next run gets your answers. */
export function answerCard(board: BoardData, id: string, text: string, now: Date): Card {
  const card = getCard(board, id);
  if (card.column !== 'review') throw new Error(`Card #${card.id} is in ${card.column}; only cards waiting for review can be answered.`);
  const answer = text.trim();
  if (!answer) throw new Error('The answer is empty.');
  const at = now.toISOString();
  card.answers = [...(card.answers ?? []), { at, text: answer }];
  card.column = 'approved';
  card.approvedAt = at;
  card.updatedAt = at;
  appendJsonl(homePath('signals.jsonl'), { at, card: card.id, title: card.title, kind: 'answer', text: answer });
  return card;
}

/** Remember how to start this CLI, so the Mac app can run it without your shell's PATH (nvm etc.). */
export function recordCliLocation(): void {
  const path = homePath('cli.json');
  const want = { node: process.execPath, script: process.argv[1] };
  const have = readJson<{ node?: string; script?: string }>(path, {});
  if (have.node !== want.node || have.script !== want.script) writeJson(path, want);
}
