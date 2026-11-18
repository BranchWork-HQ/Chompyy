// What the Mac app reads (`chompyy state --json`) and the card actions it needs beyond the CLI's.
// The app holds no logic of its own: it shows this JSON and calls chompyy commands.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getCard, type BoardData, type Card } from './board.js';
import type { Config } from './config.js';
import { budgetGate } from './gate.js';
import { appendJsonl, homePath, readJson, writeJson } from './home.js';
import { loadLiveState } from './livequota.js';
import { windowView, type Snapshot } from './quota.js';
import { loadSamples, pacing } from './pacing.js';
import { changedFiles } from './review.js';
import { loadColdStart } from './coldstart.js';
import { blueprintHash } from './picture.js';
import { costRange, readRuns, type CostRange, type RunRecord } from './costs.js';
import { loadStore, nextQuestion, readSignals, receipts, type Preference } from './taste.js';
import { agentInstalled, loadTriggerState } from './triggers.js';

export interface CardView extends Card {
  files: string[];
  /** Full QUESTIONS.md from the run, if any. */
  questionsText: string | null;
  /** The picture was drawn from an older blueprint. */
  pictureStale: boolean;
  /** Expected cost from similar past runs, for cards that haven't run. */
  costRange: CostRange | null;
  /** For cards waiting for review: the branch your folder is on, which Keep merges into. */
  folderBranch: string | null;
}

export function cardView(card: Card, runs: RunRecord[] = readRuns()): CardView {
  const qPath = card.run ? join(card.run.workdir, 'QUESTIONS.md') : '';
  return {
    ...card,
    files: card.run ? changedFiles(card) : [],
    questionsText: qPath && existsSync(qPath) ? readFileSync(qPath, 'utf8') : null,
    pictureStale: Boolean(card.picture && card.picture.blueprintHash !== blueprintHash(card.blueprint)),
    costRange: card.run ? null : costRange(card, runs),
    folderBranch: card.column === 'review' && card.run?.branch ? currentBranch(card.cwd) : null,
  };
}

/** The branch a folder is on (what Keep merges into), or null. */
function currentBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function appState(board: BoardData, snap: Snapshot | null, config: Config, now: Date) {
  const live = loadLiveState();
  const runs = readRuns();
  return {
    generatedAt: now.toISOString(),
    quota: {
      source: snap?.source ?? 'statusline',
      capturedAt: snap?.capturedAt ?? null,
      plan: live.plan ?? null,
      note: live.note ?? null,
      fiveHour: windowView(snap?.fiveHour, now),
      sevenDay: windowView(snap?.sevenDay, now),
      pacing: pacing(snap, loadSamples(), now, config.bedtime),
    },
    gate: budgetGate(snap, config, now),
    cards: board.cards.map((c) => cardView(c, runs)),
    coldStart: coldStartState(),
    tasteQuestion: tasteQuestion(),
    triggers: { installed: agentInstalled(), lastHour: config.lastHourTrigger, bedtime: config.bedtime, ...loadTriggerState() },
  };
}

/** The one taste question waiting, with its receipts, for the app to show as a one-tap card. */
export function tasteQuestion(): (Pick<Preference, 'id' | 'text' | 'noticed' | 'scope'> & { evidence: string }) | null {
  const signals = readSignals();
  const p = nextQuestion(loadStore(), signals);
  if (!p) return null;
  const byId = new Map(signals.map((s) => [s.id, s]));
  return { id: p.id, text: p.text, noticed: p.noticed, scope: p.scope, evidence: receipts(p.evidence.map((e) => byId.get(e)!).filter(Boolean)) };
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
