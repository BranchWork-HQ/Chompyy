// What the Mac app reads (`chompyy state --json`) and the card actions it needs beyond the CLI's.
// The app holds no logic of its own: it shows this JSON and calls chompyy commands.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { clashOf } from './refresh.js';
import { join } from 'node:path';
import { getCard, titleFrom, type BoardData, type Card } from './board.js';
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
import { describeSignal, loadStore, nextQuestion, readSignals, receipts, type Preference, type Signal } from './taste.js';
import { agentInstalled, loadTriggerState } from './triggers.js';
import { planFor, type PlannedPermission } from './permissions.js';
import { loadProfile, preflightHosts } from './preflight.js';
import { gitRoot } from './workspace.js';
import { writeBlueprintFile } from './blueprint.js';

export interface CardView extends Card {
  files: string[];
  /** Full QUESTIONS.md from the run, if any. */
  questionsText: string | null;
  /** The picture was drawn from an older blueprint. */
  pictureStale: boolean;
  /** Expected cost from similar past runs, for cards that haven't run. */
  costRange: CostRange | null;
  /** What its run may need beyond the box, to tick when approving (research/away-readiness.md, step 3). */
  permissionPlan: PlannedPermission[];
  /** For cards waiting for review: the branch Keep merges into. */
  folderBranch: string | null;
  /** For cards waiting for review: the files that would clash with main if kept now (refresh.ts fixes it). */
  clashFiles: string[];
}

export function cardView(card: Card, runs: RunRecord[] = readRuns()): CardView {
  const qPath = card.run ? join(card.run.workdir, 'QUESTIONS.md') : '';
  return {
    ...card,
    files: card.run ? changedFiles(card) : [],
    questionsText: qPath && existsSync(qPath) ? readFileSync(qPath, 'utf8') : null,
    pictureStale: Boolean(card.picture && card.picture.blueprintHash !== blueprintHash(card.blueprint)),
    costRange: card.run ? null : costRange(card, runs),
    folderBranch: card.column === 'review' && card.run?.branch ? (card.run.base?.branch || currentBranch(card.cwd)) : null,
    clashFiles: card.column === 'review' ? clashOf(card)?.files ?? [] : [],
    permissionPlan: ['later', 'suggested', 'approved'].includes(card.column) ? permissionPlanFor(card) : [],
  };
}

/** The card's permission plan: earlier runs' blocks in its repo, preflight's network needs, the blueprint's Needs. */
function permissionPlanFor(card: Card): PlannedPermission[] {
  try {
    const root = gitRoot(card.cwd);
    const profile = root ? loadProfile(root) : null;
    return planFor(card.blueprint ?? undefined, profile?.needs ?? [], preflightHosts(profile));
  } catch {
    return planFor(card.blueprint ?? undefined, []);
  }
}

/** The branch a folder is on (what Keep merges into), or null. */
export function currentBranch(cwd: string): string | null {
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
    taste: tasteState(),
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

/** One rule as the app shows it: the rule, what Chompyy noticed, and every receipt in your own words. */
export interface TasteItem {
  id: string;
  text: string;
  noticed: string;
  scope: string;
  /** Short: "rated #3, #4 · undid #7". */
  evidence: string;
  /** Each piece of evidence, quoting what you did or said. */
  receipts: { at: string; card: string | null; title: string | null; said: string }[];
  since?: string;
}

/**
 * For "What Chompyy heard from you": the rules waiting for your yes (strongest evidence first) and the ones in
 * force. The app shows the waiting count as a badge on the button.
 */
export function tasteState(): { waiting: TasteItem[]; learned: TasteItem[] } {
  const signals = readSignals();
  const byId = new Map(signals.map((s) => [s.id, s]));
  const store = loadStore();
  const item = (p: Preference): TasteItem => {
    const ev = p.evidence.map((e) => byId.get(e)).filter((s): s is Signal => Boolean(s));
    return {
      id: p.id, text: p.text, noticed: p.noticed, scope: p.scope, evidence: receipts(ev),
      receipts: ev.map((s) => ({ at: s.at, card: s.card ?? null, title: s.title ?? null, said: describeSignal(s, 600) })),
      ...(p.validFrom ? { since: p.validFrom } : {}),
    };
  };
  const waiting: Preference[] = [];
  for (let q = nextQuestion(store, signals), rest = { ...store, prefs: [...store.prefs] }; q; q = nextQuestion(rest, signals)) {
    waiting.push(q);
    rest.prefs = rest.prefs.filter((p) => p.id !== q!.id);
  }
  return { waiting: waiting.map(item), learned: store.prefs.filter((p) => p.status === 'active').map(item) };
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
  delete card.blueprintWaiting;
  delete card.blueprintWaitUntil;
  writeBlueprintFile(card, next);
  card.updatedAt = now.toISOString();
  appendJsonl(homePath('signals.jsonl'), { at: card.updatedAt, card: card.id, title: card.title, kind: 'blueprint-edit', before, after: next });
  return card;
}

/** Replace a parked card's idea (and the title made from it). Only cards still in `later`: once approved, the blueprint is the contract. */
export function editIdea(board: BoardData, id: string, text: string, now: Date): Card {
  const card = getCard(board, id);
  if (card.column !== 'later') throw new Error(`Card #${card.id} is in ${card.column}; only cards in later can have their idea edited.`);
  const next = text.trim();
  if (!next) throw new Error('The idea is empty.');
  if (card.idea === next) return card;
  card.idea = next;
  card.title = titleFrom(next);
  card.updatedAt = now.toISOString();
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
  const have = readJson<{ node?: string; script?: string; live?: boolean }>(path, {});
  // The live copy (live.ts) owns cli.json once set: running a CLI from a work folder must not take the app over.
  if (have.live && have.script && existsSync(have.script)) return;
  if (have.node !== want.node || have.script !== want.script) writeJson(path, want);
}
