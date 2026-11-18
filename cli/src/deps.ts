// Setup stage (research/away-readiness.md, step 2): a card's copy gets its dependencies before the box closes,
// without ever reinstalling per card. For each package folder in the copy, by its lockfile's contents:
//   your checkout has the same lockfile installed → clone your node_modules (instant, no download)
//   a snapshot for this lockfile exists           → clone the snapshot
//   neither                                       → install once into a snapshot (with network, outside the box),
//                                                   then clone it; every later card with this lockfile reuses it
// Clones are APFS copy-on-write (`cp -c`): near-zero disk, and nothing a card does reaches the source.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homePath } from './home.js';

// The snapshot only has package.json and the lockfile, so the repo's own scripts (e.g. "prepare": "npm run build")
// can't run there: install with --ignore-scripts, then rebuild, which runs the dependencies' install steps only.
const LOCKFILES: [string, string[][]][] = [
  ['package-lock.json', [['npm', 'ci', '--no-audit', '--no-fund', '--ignore-scripts'], ['npm', 'rebuild']]],
  ['npm-shrinkwrap.json', [['npm', 'ci', '--no-audit', '--no-fund', '--ignore-scripts'], ['npm', 'rebuild']]],
  ['pnpm-lock.yaml', [['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], ['pnpm', 'rebuild']]],
  ['yarn.lock', [['yarn', 'install', '--frozen-lockfile', '--ignore-scripts']]],
];

const SKIP = new Set(['node_modules', '.git', '.build', 'dist', 'build', 'vendor', 'Pods', 'DerivedData', '.venv', 'venv', 'target']);

/** Package folders in a tree (relative paths; '' = the top), up to `maxDepth` levels down. */
export function packageDirs(root: string, maxDepth = 3): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, 'package.json'))) found.push(relative(root, dir));
    if (depth >= maxDepth) return;
    let subdirs: string[] = [];
    try {
      subdirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)).map((d) => d.name);
    } catch {}
    for (const name of subdirs) walk(join(dir, name), depth + 1);
  };
  walk(root, 0);
  return found;
}

/** The folder's lockfile and a hash of its contents (null when it has none). */
export function lockOf(dir: string): { file: string; hash: string; install: string[][] } | null {
  for (const [file, install] of LOCKFILES) {
    const p = join(dir, file);
    if (existsSync(p)) return { file, hash: createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16), install };
  }
  return null;
}

function hasModules(dir: string): boolean {
  try {
    return readdirSync(join(dir, 'node_modules')).length > 0;
  } catch {
    return false;
  }
}

/** Copy-on-write clone of a node_modules folder (replaces an empty or missing one). */
function cloneModules(from: string, to: string): boolean {
  const dst = join(to, 'node_modules');
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  return spawnSync('cp', ['-cR', join(from, 'node_modules'), dst], { stdio: 'ignore', timeout: 180_000 }).status === 0;
}

export interface DepsStep {
  dir: string;
  /** Where its node_modules came from. */
  source: 'kept' | 'your checkout' | 'snapshot' | 'installed' | 'none';
  note?: string;
}

export interface SetupOptions {
  /** Where one-time installs go: <snapshots>/<repo>/<lockhash>/node_modules. */
  snapshotsDir?: string;
  /** Environment for installs (package-manager caches). */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** For tests: replace the installer. */
  install?: (steps: string[][], cwd: string) => boolean;
}

/**
 * Give every package folder in `worktree` its dependencies, preferring what's already installed. `checkout` is your
 * own copy of the repo (its node_modules are the first choice when its lockfile matches). Never throws.
 */
export function setupDependencies(checkout: string, worktree: string, repoKey: string, opts: SetupOptions = {}): DepsStep[] {
  const steps: DepsStep[] = [];
  const snapshots = opts.snapshotsDir ?? homePath('deps', 'x').replace(/[/\\]x$/, '');
  for (const rel of packageDirs(worktree)) {
    const dir = join(worktree, rel);
    const label = rel || '.';
    if (hasModules(dir)) {
      steps.push({ dir: label, source: 'kept' });
      continue;
    }
    const mine = join(checkout, rel);
    const lock = lockOf(dir);
    if (!lock) {
      // Nothing to compare against: your installed packages are the best guess.
      if (hasModules(mine) && cloneModules(mine, dir)) steps.push({ dir: label, source: 'your checkout', note: 'no lockfile to compare' });
      else steps.push({ dir: label, source: 'none', note: 'no lockfile and nothing installed in your checkout' });
      continue;
    }
    const myLock = lockOf(mine);
    if (myLock?.hash === lock.hash && hasModules(mine) && cloneModules(mine, dir)) {
      steps.push({ dir: label, source: 'your checkout' });
      continue;
    }
    const snap = join(snapshots, repoKey, `${(rel || 'root').replace(/[/\\]/g, '_')}-${lock.hash}`);
    if (!hasModules(snap)) {
      // Install once, with network, outside the box: only package.json and the lockfile are needed.
      mkdirSync(snap, { recursive: true });
      copyFileSync(join(dir, 'package.json'), join(snap, 'package.json'));
      copyFileSync(join(dir, lock.file), join(snap, lock.file));
      const ok = opts.install
        ? opts.install(lock.install, snap)
        : lock.install.every((argv) => spawnSync(argv[0]!, argv.slice(1), { cwd: snap, stdio: 'ignore', timeout: opts.timeoutMs ?? 300_000, env: { ...process.env, ...opts.env } }).status === 0);
      if (!ok || !hasModules(snap)) {
        rmSync(join(snap, 'node_modules'), { recursive: true, force: true });
        // Better something than nothing: your checkout's packages, flagged as a mismatch.
        if (hasModules(mine) && cloneModules(mine, dir)) steps.push({ dir: label, source: 'your checkout', note: `${lock.install[0]!.join(' ')} failed; using your installed packages, which may not match the lockfile` });
        else steps.push({ dir: label, source: 'none', note: `${lock.install[0]!.join(' ')} failed and nothing is installed in your checkout` });
        continue;
      }
      if (cloneModules(snap, dir)) steps.push({ dir: label, source: 'installed', note: `${lock.install[0]!.join(' ')}, once for this lockfile` });
      else steps.push({ dir: label, source: 'none', note: "couldn't copy the installed packages" });
      continue;
    }
    if (cloneModules(snap, dir)) steps.push({ dir: label, source: 'snapshot' });
    else steps.push({ dir: label, source: 'none', note: "couldn't copy the snapshot" });
  }
  return steps;
}
