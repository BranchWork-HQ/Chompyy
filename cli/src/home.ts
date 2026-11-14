// All Chompyy state lives in one folder of plain files: ~/.chompyy/ (or $CHOMPYY_HOME).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function chompyyHome(): string {
  return process.env.CHOMPYY_HOME || join(homedir(), '.chompyy');
}

/** Path inside the Chompyy home. Creates the parent folder. */
export function homePath(...parts: string[]): string {
  const path = join(chompyyHome(), ...parts);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write via a temp file and rename, so a crash or a parallel reader never sees half a file. */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(record) + '\n');
}
