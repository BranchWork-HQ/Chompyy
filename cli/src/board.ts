// The board (spec §5.3): cards in columns, stored in ~/.chompyy/board.json.
import { appendJsonl, homePath, readJson, writeJson } from './home.js';

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
  running: ['review'],
  review: ['done', 'approved'],
  done: [],
};

export type RunStatus = 'ok' | 'failed' | 'timeout' | 'questions' | 'error';

export interface RunInfo {
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  workdir: string;
  branch?: string;
  /** First non-empty lines of the agent's final output. */
  summary: string;
}

export interface Rating {
  score: number;
  reason?: string;
  at: string;
}

export interface Card {
  id: string;
  title: string;
  idea: string;
  cwd: string;
  column: Column;
  blueprint: string | null;
  blueprintError?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  logPath?: string;
  run?: RunInfo;
  rating?: Rating;
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

export function addCard(board: BoardData, idea: string, cwd: string, now: Date, column: Column = 'later'): Card {
  const text = idea.trim();
  if (!text) throw new Error('The idea is empty.');
  const at = now.toISOString();
  const card: Card = {
    id: String(board.nextId++),
    title: titleFrom(text),
    idea: text,
    cwd,
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

/** Remove a card from the board; it is kept in archive.jsonl in case you want it back. */
export function dropCard(board: BoardData, id: string, now: Date): Card {
  const card = getCard(board, id);
  if (card.column === 'running') throw new Error(`Card #${card.id} is running; wait for the run to finish.`);
  board.cards = board.cards.filter((c) => c !== card);
  appendJsonl(homePath('archive.jsonl'), { ...card, droppedAt: now.toISOString() });
  return card;
}

export function cardsIn(board: BoardData, column: Column): Card[] {
  return board.cards.filter((c) => c.column === column);
}

/** Approved cards in the order they were approved: the away queue. */
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
    marks.push(c.blueprint ? 'blueprint ✓' : c.blueprintError ? 'blueprint failed' : 'no blueprint');
  }
  if (c.run) marks.push(c.run.status);
  if (c.rating) marks.push(`${'★'.repeat(c.rating.score)}`);
  const tail = marks.length ? `  [${marks.join(' · ')}]` : '';
  return `  #${c.id.padEnd(3)} ${c.title}${tail}  ${shortPath(c.cwd)}`;
}

export function formatBoard(board: BoardData, columns: readonly Column[] = COLUMNS): string {
  if (board.cards.length === 0) return 'The board is empty. Park an idea with `chompyy later "<idea>"`.';
  const out: string[] = [];
  for (const col of columns) {
    const cards = cardsIn(board, col);
    if (cards.length === 0) continue;
    out.push(`${COLUMN_LABEL[col]} (${cards.length})`);
    for (const c of cards) out.push(cardLine(c));
  }
  return out.length ? out.join('\n') : `No cards in ${columns.join(', ')}.`;
}

export function formatCard(c: Card): string {
  const lines = [
    `#${c.id} ${c.title}`,
    `column: ${c.column} · cwd: ${shortPath(c.cwd)} · created ${c.createdAt}`,
  ];
  if (c.idea !== c.title) lines.push('', c.idea);
  lines.push('', c.blueprint ?? (c.blueprintError ? `(blueprint failed: ${c.blueprintError})` : '(no blueprint yet)'));
  if (c.run) {
    lines.push('', `last run: ${c.run.status} · ${c.run.workdir}${c.run.branch ? ` · branch ${c.run.branch}` : ''}`);
    if (c.run.summary) lines.push('', 'what the agent said:', ...c.run.summary.split('\n').map((l) => `  ${l}`));
  }
  if (c.logPath) lines.push(`log: ${c.logPath}`);
  if (c.rating) lines.push(`rating: ${c.rating.score}/5${c.rating.reason ? ` · ${c.rating.reason}` : ''}`);
  return lines.join('\n');
}
