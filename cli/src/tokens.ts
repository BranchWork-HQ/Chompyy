// Exact tokens per run (2026-11-19): what a card really used, from the run's own stream (the `result` event
// Claude Code prints at the end), instead of "5-hour % before vs after", which is whole points only, mixes in
// your own use at the same time, and goes blank when the window resets mid-run. Tagged per run, the way
// Langfuse tags each interaction; the base for honest cost estimates later.
import { existsSync, readFileSync } from 'node:fs';

export interface RunTokens {
  /** Fresh input tokens (not from the cache). */
  input: number;
  output: number;
  /** Input read from the prompt cache (cheap). */
  cacheRead: number;
  /** Input written to the prompt cache. */
  cacheWrite: number;
  /** Thinking tokens, part of output. */
  thinking: number;
  /** What the run would cost at API list prices (subscription users don't pay this; it's the value used). */
  costUsd: number;
  /** Agent turns. */
  turns: number;
  /** Models used. */
  models: string[];
}

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
};

/** Adds up every `result` event in a stream (a resumed or multi-result run has more than one). */
export class TokenTally {
  private t: RunTokens | null = null;
  private cost = 0;

  feed(event: unknown): void {
    const e = event as { type?: string; usage?: Usage; total_cost_usd?: number; num_turns?: number; modelUsage?: Record<string, unknown> };
    if (e?.type !== 'result' || !e.usage) return;
    const t = (this.t ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0, turns: 0, models: [] });
    const u = e.usage;
    t.input += u.input_tokens ?? 0;
    t.output += u.output_tokens ?? 0;
    t.cacheRead += u.cache_read_input_tokens ?? 0;
    t.cacheWrite += u.cache_creation_input_tokens ?? 0;
    t.thinking += u.output_tokens_details?.thinking_tokens ?? 0;
    this.cost += e.total_cost_usd ?? 0; // rounded once, at the end
    t.costUsd = Math.round(this.cost * 10_000) / 10_000;
    t.turns += e.num_turns ?? 0;
    for (const m of Object.keys(e.modelUsage ?? {})) if (!t.models.includes(m)) t.models.push(m);
  }

  total(): RunTokens | undefined {
    return this.t ?? undefined;
  }
}

/** Tokens from a saved stream log (`<run>.stream.jsonl`), e.g. for runs recorded before this existed. */
export function tokensFromStream(path: string): RunTokens | undefined {
  if (!existsSync(path)) return undefined;
  const tally = new TokenTally();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('"type":"result"')) continue;
    try {
      tally.feed(JSON.parse(line));
    } catch {}
  }
  return tally.total();
}

export const totalTokens = (t: RunTokens) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** 1234 → "1.2k", 670000 → "670k", 1_500_000 → "1.5M". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** "670k tokens (7.2k out · 609k cache read · 54k cache write · 26 in) · $0.70 at API prices · 14 turns" */
export function formatTokens(t: RunTokens): string {
  const parts = [`${compact(t.output)} out`, `${compact(t.cacheRead)} cache read`, `${compact(t.cacheWrite)} cache write`, `${compact(t.input)} in`];
  return `${compact(totalTokens(t))} tokens (${parts.join(' · ')}) · $${t.costUsd.toFixed(2)} at API prices · ${t.turns} turn${t.turns === 1 ? '' : 's'}`;
}

/** The stream log next to a run's text log. */
export const streamPathFor = (logPath: string) => logPath.replace(/\.log$/, '.stream.jsonl');
