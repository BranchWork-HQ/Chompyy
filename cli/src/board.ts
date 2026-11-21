// The board (spec §5.3): cards in columns, stored in ~/.chompyy/board.json.
import { mkdirSync } from 'node:fs';
import { formatTokens, type RunTokens } from './tokens.js';
import { join } from 'node:path';
import { appendJsonl, chompyyHome, homePath, readJson, writeJson } from './home.js';
import type { PictureInfo } from './picture.js';
import type { WindowView } from './quota.js';
import type { Verified } from './verify.js';

export const COLUMNS = ['suggested', 'later', 'approved', 'running', 'review', 'done'] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABEL: Record<Column, string> = {
  suggested: '💡 suggested',
  later: '📥 later',
  approved: '✅ approved',
  running: '⚙️  running',
  review: '👀 review',
  done: '⭐ done',
};

/** Which moves are allowed. Running and review are only entered by an away run. */
const TRANSITIONS: Record<Column, Column[]> = {
  suggested: ['later', 'approved'],
  later: ['approved'],
  approved: ['running', 'later'],
  running: ['review', 'approved'],
  review: ['done', 'approved'],
  done: [],
};

export interface Checks {
  result: 'passed' | 'failed' | 'not run';
  why: string;
}

export type RunStatus = 'ok' | 'failed' | 'timeout' | 'questions' | 'error' | 'stuck';

export interface RunInfo {
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  workdir: string;
  branch?: string;
  /** What the copy started from (the latest main) and the local branch Keep lands the work on. */
  base?: { ref: string; commit: string; branch: string };
  /** First non-empty lines of the agent's final output. */
  summary: string;
  /** What the agent said about its own checks (its last "CHECKS:" line). */
  checks?: Checks;
  /** Points of the 5-hour window and the week used during the run (null = window reset or quota unknown). */
  cost?: { fiveHourPct: number | null; weeklyPct: number | null };
  /** Chompyy ran the repo's tests itself after the run (sandboxed), instead of trusting the agent's word. */
  verified?: Verified;
  /** Exact tokens the agent used and their API-value cost (tokens.ts). */
  tokens?: RunTokens;
  /** What started it: you (away) or a trigger. */
  trigger?: string;
  /** Files the run changed, saved at Keep or Undo (after that its branch is gone, so they can't be read again). */
  files?: string[];
}

/**
 * One earlier cycle of a card that was sent back with `chompyy continue`: what that run did, so the next run
 * (and you, reading the card) can see what was already done.
 */
export interface Cycle {
  /** When you sent it back for another cycle. */
  at: string;
  /** What you said is still missing ('' if you said nothing). */
  note: string;
  status: RunStatus;
  outcome?: 'kept' | 'undone';
  /** What the agent said it did. */
  summary: string;
  /** Files that run changed. */
  files: string[];
  branch?: string;
  checks?: Checks;
  rating?: Rating;
  answers?: { at: string; text: string }[];
}

export interface Rating {
  score: number;
  reason?: string;
  /** Your picks for "what would have made it a 5?": concrete changes, the best raw material for taste. */
  toFive?: string[];
  at: string;
}

/**
 * Chompyy bringing a card in review up to date after its main moved on (refresh.ts): another card was kept
 * and now this one would clash with it.
 */
export interface Refresh {
  state: 'waiting' | 'running' | 'done' | 'failed';
  /** The main commit it was brought onto (done), or is being brought onto. */
  onto?: string;
  /** git merged it cleanly, or an agent resolved the clash. */
  by?: 'git' | 'agent';
  /** Plain words: why it waits or failed, or what was done. */
  why?: string;
  /** The files that clashed. */
  files?: string[];
  /** What the agent used, when one was needed. */
  tokens?: RunTokens;
  at: string;
}

export interface Card {
  id: string;
  title: string;
  idea: string;
  cwd: string;
  /** The branch or workspace the card belongs to (the git branch it was created on); missing = `unsorted`. */
  workspace?: string;
  column: Column;
  blueprint: string | null;
  blueprintError?: string;
  /** Why the blueprint isn't drafted yet (the 5-hour quota is used up); it drafts once quota returns. */
  blueprintWaiting?: string;
  /** Don't retry the draft before this time (set when a draft hit the usage limit). */
  blueprintWaitUntil?: string;
  /** Permissions you allowed for this card's run when approving it ("network:host", "command:swiftc *"). */
  permissions?: string[];
  /** When a background draft started (so the app doesn't start a second one). */
  draftingAt?: string;
  /** Parked with --no-blueprint: don't draft it automatically. */
  noAutoDraft?: boolean;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  logPath?: string;
  run?: RunInfo;
  /** What the user decided after the run. */
  outcome?: 'kept' | 'undone';
  /** Chompyy bringing this card up to date with main after another card was kept (refresh.ts). */
  refresh?: Refresh;
  /** You pressed Keep while it clashed: Chompyy keeps it by itself once it's refreshed and its checks pass. */
  keepWhenRefreshed?: boolean;
  rating?: Rating;
  /** Your answers to the run's QUESTIONS.md; added to the task prompt on the next run. */
  answers?: { at: string; text: string }[];
  /** Options offered for "what would have made it a 5?", written for this card. */
  fiveStarOptions?: string[];
  /** Where a suggested card came from ("history" = the cold start). */
  source?: 'history';
  /** Why it was suggested, in one sentence. */
  why?: string;
  /** The card's picture (diagram-design HTML), drawn from its blueprint. */
  picture?: PictureInfo;
  pictureError?: string;
  /** When a background drawing started. */
  drawingAt?: string;
  /** Earlier cycles, oldest first, when you sent the card back for more (`chompyy continue`). */
  cycles?: Cycle[];
}

export interface BoardData {
  nextId: number;
  cards: Card[];
}

export function boardPath(): string {
  return homePath('board.json');
}

export function loadBoard(): BoardData {
  return readJson<BoardData>(boardPath(), { nextId: 1, cards: [] });
}

export function saveBoard(board: BoardData): void {
  writeJson(boardPath(), board);
}

/** Load, change, save. Keeps the read-modify-write window short (a background blueprint may write too). */
export function updateBoard<T>(fn: (board: BoardData) => T): T {
  const board = loadBoard();
  const result = fn(board);
  saveBoard(board);
  return result;
}

export function titleFrom(idea: string): string {
  const first = idea.trim().split('\n')[0] ?? '';
  return first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first;
}

/** Where cards with no branch (or made before workspaces existed) are grouped. */
export const UNSORTED = 'unsorted';

/** The card's workspace; old cards and cards made outside a git branch are `unsorted`. */
export function workspaceOf(card: Pick<Card, 'workspace'>): string {
  return card.workspace?.trim() || UNSORTED;
}

/** A workspace name as one safe folder name: "feat/login" -> "feat-login"; nothing that could climb out. */
export function workspaceFolder(workspace: string): string {
  const safe = workspace.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|-+$/g, '');
  return safe || UNSORTED;
}

/** The card's own folder, `<store>/<workspace>/<card-id>/` (store = ~/.chompyy/cards). Not created here. */
export function cardDir(card: Pick<Card, 'id' | 'workspace'>, store = join(chompyyHome(), 'cards')): string {
  return join(store, workspaceFolder(workspaceOf(card)), workspaceFolder(card.id));
}

/** Like cardDir, and makes sure the folder exists. */
export function ensureCardDir(card: Pick<Card, 'id' | 'workspace'>): string {
  const dir = cardDir(card);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function addCard(board: BoardData, idea: string, cwd: string, now: Date, column: Column = 'later', workspace?: string | null): Card {
  const text = idea.trim();
  if (!text) throw new Error('The idea is empty.');
  const at = now.toISOString();
  const card: Card = {
    id: String(board.nextId++),
    title: titleFrom(text),
    idea: text,
    cwd,
    workspace: workspace?.trim() || UNSORTED,
    column,
    blueprint: null,
    createdAt: at,
    updatedAt: at,
  };
  board.cards.push(card);
  return card;
}

export function getCard(board: BoardData, id: string): Card {
  const card = board.cards.find((c) => c.id === id.replace(/^#/, ''));
  if (!card) throw new Error(`No card #${id}. See \`chompyy board\`.`);
  return card;
}

export function canMove(from: Column, to: Column): boolean {
  return TRANSITIONS[from].includes(to);
}

export function moveCard(board: BoardData, id: string, to: Column, now: Date): Card {
  const card = getCard(board, id);
  if (!canMove(card.column, to)) throw new Error(`Card #${card.id} is in ${card.column}; it can't move to ${to}.`);
  if (to === 'approved' && !card.blueprint?.trim()) {
    throw new Error(`Card #${card.id} has no blueprint yet. Run \`chompyy blueprint ${card.id}\` first.`);
  }
  card.column = to;
  card.updatedAt = now.toISOString();
  if (to === 'approved') card.approvedAt = card.updatedAt;
  return card;
}

/** Which cycle the card is on: 1 for a card that was never continued. */
export function cycleOf(card: Pick<Card, 'cycles'>): number {
  return (card.cycles?.length ?? 0) + 1;
}

/**
 * Send a finished card back for another cycle: it only did part of the job (say it only researched). The run
 * that just finished is saved as a Cycle, with its summary and files, and the card goes back to approved with
 * its blueprint, so the next away run picks it up and its prompt says what was done and what is missing.
 * `prior` overrides the saved summary and files (the CLI passes the full output from the log).
 */
export function continueCard(board: BoardData, id: string, note: string, now: Date, prior: { summary?: string; files?: string[] } = {}): Card {
  const card = getCard(board, id);
  if (card.column !== 'done') {
    const hint = card.column === 'review' ? ' Keep or undo it first.' : '';
    throw new Error(`Card #${card.id} is in ${card.column}; only finished cards (done) can be continued.${hint}`);
  }
  const run = card.run;
  if (!run) throw new Error(`Card #${card.id} never ran, so there is nothing to continue from.`);
  if (!card.blueprint?.trim()) throw new Error(`Card #${card.id} has no blueprint. Run \`chompyy blueprint ${card.id}\` first.`);
  const at = now.toISOString();
  const cycle: Cycle = {
    at,
    note: note.trim(),
    status: run.status,
    ...(card.outcome ? { outcome: card.outcome } : {}),
    summary: (prior.summary ?? run.summary).trim(),
    files: prior.files ?? run.files ?? [],
    ...(run.branch ? { branch: run.branch } : {}),
    ...(run.checks ? { checks: run.checks } : {}),
    ...(card.rating ? { rating: card.rating } : {}),
    ...(card.answers?.length ? { answers: card.answers } : {}),
  };
  card.cycles = [...(card.cycles ?? []), cycle];
  card.column = 'approved';
  card.approvedAt = at;
  card.updatedAt = at;
  // The new cycle starts clean: these belonged to the run that just ended (and are kept in the Cycle).
  delete card.run;
  delete card.outcome;
  delete card.rating;
  delete card.answers;
  delete card.fiveStarOptions;
  delete card.refresh;
  delete card.keepWhenRefreshed;
  return card;
}

/** Remove a card from the board; it is kept in archive.jsonl in case you want it back. */
export function dropCard(board: BoardData, id: string, now: Date): Card {
  const card = getCard(board, id);
  if (card.column === 'running') throw new Error(`Card #${card.id} is running; wait for the run to finish.`);
  board.cards = board.cards.filter((c) => c !== card);
  appendJsonl(homePath('archive.jsonl'), { ...card, droppedAt: now.toISOString() });
  return card;
}

/**
 * Suggested cards (Chompyy's ideas, not yours) that sat untouched for `days` are archived, so the column
 * doesn't fill with stale guesses. Your own parked ideas never expire. Returns the archived cards.
 */
export function expireSuggested(board: BoardData, now: Date, days: number): Card[] {
  if (days <= 0) return [];
  const cutoff = now.getTime() - days * 24 * 3600_000;
  const stale = board.cards.filter((c) => c.column === 'suggested' && Date.parse(c.updatedAt) < cutoff && !c.draftingAt && !c.drawingAt);
  for (const c of stale) appendJsonl(homePath('archive.jsonl'), { ...c, droppedAt: now.toISOString(), expired: true });
  board.cards = board.cards.filter((c) => !stale.includes(c));
  return stale;
}

export function cardsIn(board: BoardData, column: Column): Card[] {
  return board.cards.filter((c) => c.column === column);
}

/** "14:05" in local time, from Unix seconds. */
function clock(unixSec: number): string {
  return new Date(unixSec * 1000).toTimeString().slice(0, 5);
}

/**
 * Why drafting must wait, or null if it can go ahead. A running 5-hour window with 0% left means a draft
 * would only fail on the usage limit, so the card waits instead of looking stuck.
 */
export function quotaWaitReason(five: WindowView): string | null {
  if (!five.known || five.leftPct > 0) return null;
  return `waiting for quota: the 5-hour window is used up, drafts after it resets at ${clock(five.resetsAt)}`;
}

/** A parked card with no blueprint that should be drafted now (not already drafting, not told to wait). */
function needsDraft(c: Card, now: Date): boolean {
  const stale = now.getTime() - 3 * 60_000;
  return (
    (c.column === 'later' || c.column === 'suggested') &&
    !c.blueprint && !c.blueprintError && !c.noAutoDraft &&
    (!c.draftingAt || Date.parse(c.draftingAt) < stale) &&
    (!c.blueprintWaitUntil || Date.parse(c.blueprintWaitUntil) <= now.getTime())
  );
}

/**
 * Claim the cards whose blueprint should be drafted now: marks them drafting and returns their ids.
 * With `waiting` set (no quota left), nothing is drafted: the cards get the reason instead and stay due,
 * so a later pass drafts them once quota returns.
 */
export function claimDrafts(board: BoardData, now: Date, waiting: string | null): string[] {
  const due = board.cards.filter((c) => needsDraft(c, now));
  if (waiting) {
    for (const c of due) c.blueprintWaiting = waiting;
    return [];
  }
  for (const c of due) {
    c.draftingAt = now.toISOString();
    delete c.blueprintWaiting;
    delete c.blueprintWaitUntil;
  }
  return due.map((c) => c.id);
}

/**
 * Record a failed draft. A usage-limit failure isn't the card's fault, so it gets no blueprintError (which
 * would stop retries): it waits and is retried after `retryAt`.
 */
export function noteDraftFailure(board: BoardData, id: string, message: string, usageLimit: boolean, retryAt: Date): void {
  const c = getCard(board, id);
  delete c.draftingAt;
  if (usageLimit) {
    delete c.blueprintError;
    c.blueprintWaiting = `waiting for quota: the usage limit was hit, retries after ${clock(retryAt.getTime() / 1000)}`;
    c.blueprintWaitUntil = retryAt.toISOString();
  } else {
    c.blueprintError = message;
    delete c.blueprintWaiting;
    delete c.blueprintWaitUntil;
  }
}

/** Approved cards in the order they were approved: the away queue. */
/**
 * Cards stuck in running whose away run is gone (it crashed or was stopped) go to review as an error, with
 * whatever they finished: put back in approved they would look untouched, and a card that crashes Chompyy
 * would crash every away. `where` says where a card's work is. Returns their ids.
 */
export function recoverRunning(
  board: BoardData,
  now: Date,
  where: (c: Card) => { dir: string; branch?: string } = () => ({ dir: '' }),
  why = 'The away run stopped in the middle of this card (Chompyy crashed or was stopped), so it never finished.',
): string[] {
  const stuck = cardsIn(board, 'running');
  for (const c of stuck) {
    const ws = where(c);
    const startedAt = c.updatedAt || now.toISOString();
    c.column = 'review';
    c.updatedAt = now.toISOString();
    c.run = {
      status: 'error',
      startedAt,
      finishedAt: now.toISOString(),
      durationMs: Math.max(0, now.getTime() - Date.parse(startedAt)) || 0,
      exitCode: null,
      workdir: ws.dir,
      ...(ws.branch ? { branch: ws.branch } : {}),
      summary: `${why} Anything it committed is on its branch; Run again to retry.`,
    };
  }
  return stuck.map((c) => c.id);
}

export function awayQueue(board: BoardData): Card[] {
  return cardsIn(board, 'approved').sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''));
}

function shortPath(p: string): string {
  const home = process.env.HOME;
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function cardLine(c: Card): string {
  const marks: string[] = [];
  if (c.column === 'later' || c.column === 'suggested') {
    marks.push(c.blueprint ? 'blueprint ✓' : c.blueprintError ? 'blueprint failed' : c.blueprintWaiting ? 'waiting for quota' : 'no blueprint');
  }
  if (c.cycles?.length) marks.push(`cycle ${cycleOf(c)}`);
  if (c.run) marks.push(c.run.status);
  if (c.rating) marks.push(`${'★'.repeat(c.rating.score)}`);
  const tail = marks.length ? `  [${marks.join(' · ')}]` : '';
  return `  #${c.id.padEnd(3)} ${c.title}${tail}  ${shortPath(c.cwd)}`;
}

/** Workspace names in the order they should be listed: named ones A-Z, `unsorted` last. */
export function workspacesOf(cards: Card[]): string[] {
  const names = [...new Set(cards.map(workspaceOf))];
  return names.sort((a, b) => (a === UNSORTED ? 1 : b === UNSORTED ? -1 : a.localeCompare(b)));
}

/** The board, one header per workspace (branch), and the columns inside each. */
export function formatBoard(board: BoardData, columns: readonly Column[] = COLUMNS): string {
  if (board.cards.length === 0) return 'The board is empty. Park an idea with `chompyy later "<idea>"`.';
  const shown = board.cards.filter((c) => columns.includes(c.column));
  const out: string[] = [];
  for (const ws of workspacesOf(shown)) {
    const mine = shown.filter((c) => workspaceOf(c) === ws);
    if (out.length) out.push('');
    out.push(`[${ws}] (${mine.length})`);
    for (const col of columns) {
      const cards = mine.filter((c) => c.column === col);
      if (cards.length === 0) continue;
      out.push(`${COLUMN_LABEL[col]} (${cards.length})`);
      for (const c of cards) out.push(cardLine(c));
    }
  }
  return out.length ? out.join('\n') : `No cards in ${columns.join(', ')}.`;
}

export function formatCard(c: Card): string {
  const lines = [
    `#${c.id} ${c.title}`,
    `column: ${c.column} · workspace: ${workspaceOf(c)} · cwd: ${shortPath(c.cwd)} · created ${c.createdAt}`,
  ];
  if (c.idea !== c.title) lines.push('', c.idea);
  lines.push('', c.blueprint ?? (c.blueprintError ? `(blueprint failed: ${c.blueprintError})` : c.blueprintWaiting ? `(no blueprint yet: ${c.blueprintWaiting})` : '(no blueprint yet)'));
  if (c.cycles?.length) {
    lines.push('', `cycle ${cycleOf(c)}: continues ${c.cycles.length} earlier cycle${c.cycles.length === 1 ? '' : 's'}`);
    c.cycles.forEach((y, i) => {
      const files = y.files.length ? `${y.files.length} file${y.files.length === 1 ? '' : 's'}` : 'no files changed';
      lines.push(`  cycle ${i + 1}: ${y.status}${y.outcome ? ` · ${y.outcome}` : ''} · ${files}`);
      if (y.note) lines.push(`    sent back: ${y.note}`);
    });
  }
  if (c.run) {
    lines.push('', `last run: ${c.run.status} · ${c.run.workdir}${c.run.branch ? ` · branch ${c.run.branch}` : ''}`);
    if (c.run.tokens) lines.push(`used: ${formatTokens(c.run.tokens)}`);
    if (c.run.summary) lines.push('', 'what the agent said:', ...c.run.summary.split('\n').map((l) => `  ${l}`));
  }
  if (c.logPath) lines.push(`log: ${c.logPath}`);
  if (c.outcome) lines.push(`outcome: ${c.outcome}`);
  if (c.rating) lines.push(`rating: ${c.rating.score}/5${c.rating.reason ? ` · ${c.rating.reason}` : ''}`);
  return lines.join('\n');
}
