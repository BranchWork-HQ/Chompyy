// The one change Chompyy offers to make to Claude Code's own settings: keep transcripts longer
// (`cleanupPeriodDays`, default 30), so there's more history to learn from. Only on request.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function keepHistory(days: number, path = join(homedir(), '.claude', 'settings.json')): { path: string; before: number | null } {
  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`${path} isn't valid JSON, so I left it alone. Add "cleanupPeriodDays": ${days} yourself.`);
    }
    writeFileSync(`${path}.chompyy-backup`, raw);
  }
  const before = typeof settings.cleanupPeriodDays === 'number' ? settings.cleanupPeriodDays : null;
  settings.cleanupPeriodDays = days;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  return { path, before };
}
