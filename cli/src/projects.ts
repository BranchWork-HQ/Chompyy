// Recent projects, so you can pick where a card runs from a list instead of a folder dialog.
// Reads only the working folder ("cwd") from your Claude Code transcripts, locally, plus folders of past cards.
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { BoardData } from './board.js';

/** Walk up to the folder holding .git, without starting git (fast enough for hundreds of folders). */
function findGitRoot(dir: string): string | null {
  let d = dir;
  for (let i = 0; i < 30; i++) {
    if (existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

/** Folders people usually keep code in; scanned two levels deep for git repos. */
const CODE_FOLDERS = ['orca', 'Desktop', 'Developer', 'code', 'Code', 'projects', 'Projects', 'src', 'dev', 'repos', 'GitHub', 'Documents/GitHub'];

const isTemp = (p: string) => /^\/(private\/)?(var|tmp)\//.test(p) || p.includes('/.chompyy/') || p.includes('/node_modules/');

export interface Project {
  path: string;
  name: string;
  /** ISO time it was last used. */
  lastUsed: string;
  isGit: boolean;
}

/** The first "cwd" in the first 64 KB of a transcript. */
function cwdOf(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const m = buf.subarray(0, n).toString('utf8').match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return m ? (JSON.parse(`"${m[1]}"`) as string) : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function recentProjects(board: BoardData, opts: { claudeDir?: string; home?: string; limit?: number } = {}): Project[] {
  const claudeDir = opts.claudeDir ?? join(homedir(), '.claude', 'projects');
  const seen = new Map<string, Project>();
  const add = (dir: string, at: number) => {
    if (!dir || isTemp(dir) || !existsSync(dir)) return;
    const root = findGitRoot(dir);
    if (!root || root === homedir() || isTemp(root)) return; // cards run best in git repos
    let path = root;
    try {
      path = realpathSync.native(root); // one entry per repo even when folder names differ in case (code vs Code)
    } catch {}
    const prev = seen.get(path);
    if (prev && Date.parse(prev.lastUsed) >= at) return;
    seen.set(path, { path, name: basename(path), lastUsed: new Date(at).toISOString(), isGit: true });
  };

  if (existsSync(claudeDir)) {
    for (const entry of readdirSync(claudeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(claudeDir, entry.name);
      let newest: { file: string; mtime: number } | null = null;
      for (const f of readdirSync(folder)) {
        if (!f.endsWith('.jsonl')) continue;
        const mtime = statSync(join(folder, f)).mtimeMs;
        if (!newest || mtime > newest.mtime) newest = { file: join(folder, f), mtime };
      }
      if (newest) {
        const cwd = cwdOf(newest.file);
        if (cwd) add(cwd, newest.mtime);
      }
    }
  }
  for (const card of board.cards) add(card.cwd, Date.parse(card.updatedAt) || 0);

  // Repos you haven't used with Claude Code yet: look in the usual code folders.
  const home = opts.home ?? homedir();
  const scan = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = join(dir, e.name);
      if (existsSync(join(sub, '.git'))) {
        {
          let at = 0;
          try {
            at = statSync(join(sub, '.git')).mtimeMs;
          } catch {}
          add(sub, at);
        }
      } else if (depth > 1) scan(sub, depth - 1);
    }
  };
  for (const f of CODE_FOLDERS) scan(join(home, f), 3);

  return [...seen.values()]
    .sort((a, b) => b.lastUsed.localeCompare(a.lastUsed))
    .slice(0, opts.limit ?? 20);
}
