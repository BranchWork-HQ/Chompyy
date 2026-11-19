// Filling in exact tokens for runs recorded before tokens.ts existed: every away run since 2026-11-17 saved its
// whole stream (`<started>.stream.jsonl`), and the stream's result event has the exact counts.
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardDir, loadBoard, updateBoard } from './board.js';
import { readRuns, runsPath, type RunRecord } from './costs.js';
import { homePath } from './home.js';
import { streamPathFor, tokensFromStream } from './tokens.js';

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-');

/** Where a run's stream log is: next to its log, in the old runs/<id>/ folder, or in the card's own folder. */
function streamFor(r: Pick<RunRecord, 'card' | 'at' | 'durationMs'>, workspace?: string): string | null {
  const name = `${stamp(Date.parse(r.at) - r.durationMs)}.stream.jsonl`;
  for (const dir of [homePath('runs', r.card), cardDir({ id: r.card, workspace })]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Fill in `tokens` on board runs and runs.jsonl records that lack it. Returns how many runs.jsonl records got them. */
export function backfillTokens(): number {
  const board = loadBoard();
  const ws = new Map(board.cards.map((c) => [c.id, c.workspace]));
  if (board.cards.some((c) => c.run && !c.run.tokens && c.logPath)) {
    updateBoard((b) => {
      for (const c of b.cards) {
        if (!c.run || c.run.tokens || !c.logPath) continue;
        const t = tokensFromStream(streamPathFor(c.logPath));
        if (t) c.run.tokens = t;
      }
    });
  }
  const runs = readRuns();
  let filled = 0;
  for (const r of runs) {
    if (r.tokens) continue;
    const p = streamFor(r, ws.get(r.card));
    const t = p ? tokensFromStream(p) : undefined;
    if (t) {
      r.tokens = t;
      filled++;
    }
  }
  if (filled) {
    const path = runsPath();
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    renameSync(tmp, path);
  }
  return filled;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
