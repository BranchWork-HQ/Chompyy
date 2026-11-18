// Live Claude quota from Anthropic's usage endpoint, via codeburn's reader (src/vendor/codeburn).
// Uses the login Claude Code already saved (macOS Keychain or ~/.claude/.credentials.json).
// It sends no message, so it never starts a 5-hour window. Chosen over the status-line
// snapshot on 2026-11-15 because it is fresh even when no Claude Code session is open.
import { fetchClaudeQuota, type ClaudeResult } from './vendor/codeburn/claude.js';
import type { QuotaProvider } from './vendor/codeburn/types.js';
import { homePath, readJson, writeJson } from './home.js';
import { loadSnapshot, mergeSnapshot, saveSnapshot, type QuotaWindow, type Snapshot } from './quota.js';

/** Don't ask the endpoint more often than this. */
export const MIN_INTERVAL_MS = 5 * 60_000;

interface LiveState {
  lastTryAt?: string;
  retryAfterAt?: string;
  connection?: QuotaProvider['connection'];
  plan?: string | null;
  note?: string;
}

const statePath = () => homePath('livequota.json');
export const loadLiveState = (): LiveState => readJson<LiveState>(statePath(), {});

function windowFrom(provider: QuotaProvider, label: string): QuotaWindow | undefined {
  const row = provider.details.find((d) => d.label === label);
  if (!row || !row.resetsAt) return undefined;
  return { usedPct: Math.round(row.percent * 1000) / 10, resetsAt: Math.floor(Date.parse(row.resetsAt) / 1000) };
}

/** Turn codeburn's provider result into Chompyy's snapshot shape. */
export function snapshotFromProvider(provider: QuotaProvider, now: Date): Snapshot | null {
  if (provider.connection !== 'connected') return null;
  const snap: Snapshot = { capturedAt: now.toISOString(), source: 'api' };
  const five = windowFrom(provider, '5-hour');
  const week = windowFrom(provider, 'Weekly');
  if (five) snap.fiveHour = five;
  if (week) snap.sevenDay = week;
  // Per-model weekly windows ("Weekly · Opus", "Weekly · Sonnet", …).
  const models: Record<string, QuotaWindow> = {};
  for (const row of provider.details) {
    const name = row.label.startsWith('Weekly · ') ? row.label.slice('Weekly · '.length) : '';
    const w = name ? windowFrom(provider, row.label) : undefined;
    if (w) models[name] = w;
  }
  if (Object.keys(models).length) snap.models = models;
  return snap;
}

export interface RefreshResult {
  ok: boolean;
  snapshot: Snapshot | null;
  message: string;
}

/**
 * Refresh the snapshot from the endpoint. `force` skips the 5-minute spacing (not a 429 backoff).
 * `allowKeychain` lets macOS show its one-time "allow access to the Claude Code login?" prompt.
 */
export async function refreshLiveQuota(
  opts: { force?: boolean; allowKeychain?: boolean; now?: Date; fetchQuota?: (o: { allowKeychain: boolean }) => Promise<ClaudeResult> } = {},
): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const state = loadLiveState();
  const current = loadSnapshot();
  if (state.retryAfterAt && Date.parse(state.retryAfterAt) > now.getTime()) {
    return { ok: false, snapshot: current, message: `Anthropic limits how often quota can be checked; next check after ${hhmm(state.retryAfterAt)}.` };
  }
  if (!opts.force && state.lastTryAt && now.getTime() - Date.parse(state.lastTryAt) < MIN_INTERVAL_MS && current?.source === 'api') {
    return { ok: true, snapshot: current, message: 'Fresh enough.' };
  }
  const fetchQuota = opts.fetchQuota ?? ((o) => fetchClaudeQuota(o));
  const result = await fetchQuota({ allowKeychain: opts.allowKeychain ?? true });
  const next: LiveState = {
    lastTryAt: now.toISOString(),
    connection: result.quota.connection,
    plan: result.quota.planLabel,
  };
  if (result.retryAfterSeconds) next.retryAfterAt = new Date(now.getTime() + result.retryAfterSeconds * 1000).toISOString();
  const snap = snapshotFromProvider(result.quota, now);
  if (!snap) {
    next.note = result.quota.footerLines.join(' ') || result.quota.connection;
    writeJson(statePath(), next);
    // A 429: other tools signed in with the same Claude login (or a recent check) used up the allowance.
    if (next.retryAfterAt) return { ok: false, snapshot: current, message: `Anthropic limits how often quota can be checked; next check after ${hhmm(next.retryAfterAt)}.` };
    return { ok: false, snapshot: current, message: explain(result.quota) };
  }
  const merged = mergeSnapshot(current, snap);
  saveSnapshot(merged);
  writeJson(statePath(), next);
  return { ok: true, snapshot: merged, message: `Updated from Anthropic${result.quota.planLabel ? ` (${result.quota.planLabel})` : ''}.` };
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function explain(p: QuotaProvider): string {
  const extra = p.footerLines.length ? ` ${p.footerLines.join(' ')}` : '';
  switch (p.connection) {
    case 'accessDenied':
      return `macOS didn't allow reading the Claude Code login.${extra}`;
    case 'keychainUnchecked':
    case 'disconnected':
      return 'No Claude Code login found. Sign in to Claude Code once, then try again.';
    case 'terminalFailure':
      return `Anthropic refused the request.${extra}`;
    default:
      return `Couldn't reach Anthropic right now.${extra}`;
  }
}
