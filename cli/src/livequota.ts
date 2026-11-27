// Live Claude quota from Anthropic's usage endpoint, via codeburn's reader (src/vendor/codeburn).
// Uses the login Claude Code already saved (macOS Keychain or ~/.claude/.credentials.json).
// It sends no message, so it never starts a 5-hour window. Chosen over the status-line
// snapshot on 2026-11-15 because it is fresh even when no Claude Code session is open.
import { fetchClaudeQuota, type ClaudeResult } from './vendor/codeburn/claude.js';
import type { QuotaProvider } from './vendor/codeburn/types.js';
import { type Config, setConfig } from './config.js';
import { homePath, readJson, writeJson } from './home.js';
import { loadSnapshot, mergeSnapshot, saveSnapshot, type QuotaWindow, type Snapshot } from './quota.js';

/** What the app and `chompyy quota` say while the Keychain read waits for your OK. */
export const KEYCHAIN_ASK =
  "Live quota needs your OK to read Claude Code's saved login from your Keychain (only to ask Anthropic how much is left; it sends no message). Run `chompyy quota --allow-keychain`, or press Allow.";

/** What they say once you turned the Keychain read off. */
export const KEYCHAIN_OFF =
  "Keychain reading is off, as you chose. Quota comes from Claude Code's status line; `chompyy quota --allow-keychain` turns live quota back on.";

/**
 * Reading the Keychain is opt-in (#24). Allowed once you say yes. A Mac where an earlier check already read the
 * login (you chose Always Allow before Chompyy asked first) counts as a yes, and that is saved.
 */
export function keychainAllowed(config: Pick<Config, 'allowKeychain'>): boolean {
  if (config.allowKeychain !== null && config.allowKeychain !== undefined) return config.allowKeychain;
  if (loadLiveState().connection !== 'connected') return false;
  setConfig('allowKeychain', true);
  return true;
}

/** Whether to show the Allow button: a Mac, live quota on, never asked, and the check found nothing without it. */
export function keychainAsk(config: Pick<Config, 'allowKeychain' | 'quotaSource'>, platform = process.platform): boolean {
  return platform === 'darwin' && config.quotaSource === 'api' && (config.allowKeychain ?? null) === null && loadLiveState().connection === 'keychainUnchecked';
}

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
 * `allowKeychain` lets it read the Keychain (macOS shows its one-time "allow access?" prompt); off unless you allowed it.
 */
export async function refreshLiveQuota(
  opts: { force?: boolean; allowKeychain?: boolean; keychainOff?: boolean; now?: Date; fetchQuota?: (o: { allowKeychain: boolean }) => Promise<ClaudeResult> } = {},
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
  const result = await fetchQuota({ allowKeychain: opts.allowKeychain ?? false });
  const next: LiveState = {
    lastTryAt: now.toISOString(),
    connection: result.quota.connection,
    plan: result.quota.planLabel,
  };
  if (result.retryAfterSeconds) next.retryAfterAt = new Date(now.getTime() + result.retryAfterSeconds * 1000).toISOString();
  const snap = snapshotFromProvider(result.quota, now);
  if (!snap) {
    const ask = opts.keychainOff ? KEYCHAIN_OFF : KEYCHAIN_ASK;
    next.note = result.quota.connection === 'keychainUnchecked' ? ask : result.quota.footerLines.join(' ') || result.quota.connection;
    writeJson(statePath(), next);
    // A 429: other tools signed in with the same Claude login (or a recent check) used up the allowance.
    if (next.retryAfterAt) return { ok: false, snapshot: current, message: `Anthropic limits how often quota can be checked; next check after ${hhmm(next.retryAfterAt)}.` };
    return { ok: false, snapshot: current, message: result.quota.connection === 'keychainUnchecked' ? ask : explain(result.quota) };
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
      return KEYCHAIN_ASK;
    case 'disconnected':
      return 'No Claude Code login found. Sign in to Claude Code once, then try again.';
    case 'terminalFailure':
      return `Anthropic refused the request.${extra}`;
    default:
      return `Couldn't reach Anthropic right now.${extra}`;
  }
}
