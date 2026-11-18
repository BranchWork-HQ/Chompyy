// Preflight (research/away-readiness.md, steps 1–2): before cards run in a repo, run the repo's own checks on
// clean latest main, in the same box an away run uses AND outside it. The difference is the verdict:
//   passes in the box            → ready
//   fails only in the box        → a box problem (the catalog says which, and how to fix it)
//   fails outside the box too    → main itself is broken (not the box, and not any card's fault)
// Outside-the-box runs only ever execute your own code on main, never an agent's change.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { cacheEnv } from './away.js';
import { diagnose, type FixKind } from './catalog.js';
import { homePath, readJson, writeJson } from './home.js';
import { detectCheck, run, sandboxProfile } from './verify.js';
import { linkDependencies } from './workspace.js';

export interface RepoCheck {
  /** Folder inside the repo ('' = the top). */
  dir: string;
  label: string;
  argv: string[];
  kind: 'test' | 'typecheck' | 'build';
}

const SKIP = new Set(['node_modules', '.git', '.build', 'dist', 'build', 'vendor', 'Pods', 'DerivedData', '.venv', 'venv', 'target']);

/** Every check the repo has, from what's in its folders (up to 3 levels deep). */
/**
 * `swift build` as it can run in the away box: SwiftPM's own sandbox off (the box already sandboxes it; macOS
 * forbids nesting) and its caches inside the box. Proven by preflight on 2026-11-18.
 */
export function swiftBuildArgv(cacheDir: string): string[] {
  return ['swift', 'build', '--disable-sandbox', '--cache-path', `${cacheDir}/swiftpm/cache`, '--config-path', `${cacheDir}/swiftpm/config`, '--security-path', `${cacheDir}/swiftpm/security`];
}

export function detectChecks(root: string, cacheDir: string, maxDepth = 3): RepoCheck[] {
  const checks: RepoCheck[] = [];
  const walk = (dir: string, depth: number) => {
    const rel = relative(root, dir);
    const test = detectCheck(dir);
    if (test) checks.push({ dir: rel, label: test.label, argv: test.argv, kind: 'test' });
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const scripts = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
        if (scripts.typecheck) checks.push({ dir: rel, label: 'npm run typecheck', argv: ['npm', 'run', 'typecheck'], kind: 'typecheck' });
      } catch {}
    }
    if (existsSync(join(dir, 'Package.swift'))) {
      const argv = swiftBuildArgv(cacheDir);
      checks.push({ dir: rel, label: argv.join(' '), argv, kind: 'build' });
    }
    if (depth >= maxDepth) return;
    let subdirs: string[] = [];
    try {
      subdirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name)).map((d) => d.name);
    } catch {}
    for (const name of subdirs) walk(join(dir, name), depth + 1);
  };
  walk(root, 0);
  return checks;
}

export type Verdict = 'ready' | 'box' | 'broken' | 'not-run';

export interface CheckResult {
  check: RepoCheck;
  verdict: Verdict;
  why: string;
  /** For box problems: what the catalog recognised, with the matching line. */
  diagnoses?: { id: string; title: string; cause: string; fix: FixKind; remedy: string; evidence: string }[];
  /** The last lines of the failing output. */
  tail?: string;
  ms: number;
}

export interface PreflightResult {
  at: string;
  root: string;
  /** What was checked: the ref and its commit. */
  base: { ref: string; commit: string; note?: string };
  /** Every check passes in the box. */
  ready: boolean;
  results: CheckResult[];
}

export interface RepoProfile {
  root: string;
  checks: RepoCheck[];
  updatedAt: string;
  preflight?: PreflightResult;
}

const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd: string, args: string[]) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

/** Where a repo's profile lives: ~/.chompyy/repos/<name>-<hash>.json. */
export function profilePath(root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return homePath('repos', `${basename(root)}-${hash}.json`);
}
export const loadProfile = (root: string): RepoProfile | null => readJson<RepoProfile | null>(profilePath(root), null);
export const saveProfile = (p: RepoProfile) => writeJson(profilePath(p.root), p);

/**
 * The latest main, as interactive Claude would see it: fetch the remote (Chompyy, outside the box, may use the
 * network) and use its default branch; with no remote, the local main/master; failing that, HEAD.
 */
export function latestMain(root: string, fetch = true): { ref: string; commit: string; note?: string } {
  let note: string | undefined;
  const hasOrigin = (tryGit(root, ['remote']) ?? '').split('\n').includes('origin');
  if (hasOrigin && fetch && tryGit(root, ['fetch', '--quiet', 'origin']) === null) note = "couldn't fetch origin; used what's already here";
  const candidates = hasOrigin
    ? [tryGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']), 'origin/main', 'origin/master', 'main', 'master']
    : ['main', 'master'];
  for (const ref of candidates) {
    if (!ref) continue;
    const commit = tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (commit) return { ref, commit, ...(note ? { note } : {}) };
  }
  return { ref: 'HEAD', commit: git(root, ['rev-parse', 'HEAD']), note: note ?? 'no main branch found; used HEAD' };
}

export interface PreflightOptions {
  cacheDir: string;
  denyRead: string[];
  timeoutMs: number;
  fetch?: boolean;
  /** Check this ref instead of the latest main (e.g. a branch before it merges). */
  ref?: string;
  now?: () => Date;
  /** For tests: replace the command runner. `boxed` says whether this run is inside the box. */
  exec?: (argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, boxed: boolean) => Promise<{ code: number | null; output: string; timedOut: boolean }>;
}

const clean = (text: string, lines = 12) =>
  text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd().split('\n').slice(-lines).join('\n').slice(-1500);

/** Run the repo's checks on a clean copy of the latest main, in the box and outside it. Never touches your checkout. */
export async function preflight(root: string, opts: PreflightOptions): Promise<PreflightResult> {
  const now = opts.now ?? (() => new Date());
  const base = opts.ref ? { ref: opts.ref, commit: git(root, ['rev-parse', '--verify', `${opts.ref}^{commit}`]) } : latestMain(root, opts.fetch ?? true);
  const dir = homePath('preflight', basename(profilePath(root), '.json'));
  if (existsSync(dir)) {
    tryGit(root, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(opts.cacheDir, { recursive: true });
  git(root, ['worktree', 'add', '--detach', '--quiet', dir, base.commit]);
  const results: CheckResult[] = [];
  try {
    linkDependencies(root, dir);
    const checks = detectChecks(dir, opts.cacheDir);
    const env = { ...process.env, ...cacheEnv(opts.cacheDir), CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
    const exec = opts.exec ?? ((argv, cwd, e, t, boxed) => run(boxed ? ['/usr/bin/sandbox-exec', '-p', sandboxProfile({ writable: [dir, opts.cacheDir], denyRead: opts.denyRead }), ...argv] : argv, cwd, e, t));
    const boxAvailable = opts.exec !== undefined || (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'));
    for (const check of checks) {
      const started = Date.now();
      const cwd = join(dir, check.dir);
      if (!boxAvailable) {
        results.push({ check, verdict: 'not-run', why: 'needs the macOS sandbox (sandbox-exec)', ms: 0 });
        continue;
      }
      let inBox;
      try {
        inBox = await exec(check.argv, cwd, env, opts.timeoutMs, true);
      } catch (err) {
        results.push({ check, verdict: 'not-run', why: `couldn't start: ${err instanceof Error ? err.message : err}`, ms: Date.now() - started });
        continue;
      }
      if (inBox.code === 0 && !inBox.timedOut) {
        results.push({ check, verdict: 'ready', why: 'passes in the box', ms: Date.now() - started });
        continue;
      }
      // Failed in the box: is it the box, or main itself? Run the same check on the same code outside it.
      const outside = await exec(check.argv, cwd, env, opts.timeoutMs, false).catch((err) => ({ code: null, output: String(err), timedOut: false }));
      const ms = Date.now() - started;
      if (outside.code === 0 && !outside.timedOut) {
        const diagnoses = diagnose(inBox.output).map((d) => ({ id: d.entry.id, title: d.entry.title, cause: d.entry.cause, fix: d.entry.fix, remedy: d.entry.remedy, evidence: d.evidence }));
        results.push({
          check,
          verdict: 'box',
          why: diagnoses.length
            ? `passes outside the box, fails inside: ${diagnoses.map((d) => d.title.toLowerCase()).join('; ')}`
            : "passes outside the box, fails inside, and the cause isn't in the catalog yet",
          diagnoses,
          tail: clean(inBox.output),
          ms,
        });
      } else {
        results.push({ check, verdict: 'broken', why: inBox.timedOut && outside.timedOut ? 'times out on main, in and outside the box' : 'fails on main outside the box too: main itself is broken', tail: clean(outside.output), ms });
      }
    }
  } finally {
    tryGit(root, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  }
  return { at: now().toISOString(), root, base, ready: results.length > 0 && results.every((r) => r.verdict === 'ready'), results };
}

/** Preflight as you'd read it. */
export function formatPreflight(p: PreflightResult): string {
  const mark: Record<Verdict, string> = { ready: '✓', box: '✗', broken: '!', 'not-run': '·' };
  const lines = [`Preflight for ${basename(p.root)} (${p.base.ref} @ ${p.base.commit.slice(0, 7)})${p.base.note ? `\n  note: ${p.base.note}` : ''}`];
  if (!p.results.length) lines.push('  No checks found (tests, typecheck or build). Away cards here can\'t be checked.');
  for (const r of p.results) {
    lines.push(`  ${mark[r.verdict]} ${r.check.dir || '.'}: ${r.check.label} — ${r.why} (${Math.round(r.ms / 1000)}s)`);
    for (const d of r.diagnoses ?? []) {
      lines.push(`      ${d.title}. ${d.cause}`);
      lines.push(`      fix (${d.fix}): ${d.remedy}`);
      lines.push(`      seen: ${d.evidence}`);
    }
    if (r.verdict !== 'ready' && !r.diagnoses?.length && r.tail) lines.push(...r.tail.split('\n').slice(-4).map((l) => `      | ${l}`));
  }
  const box = p.results.filter((r) => r.verdict === 'box').length;
  const broken = p.results.filter((r) => r.verdict === 'broken').length;
  lines.push(
    p.ready
      ? 'Away-ready: yes. Every check passes in the box, so a card\'s "checks fail" will mean its change.'
      : `Away-ready: no${box ? ` · ${box} check(s) blocked by the box` : ''}${broken ? ` · ${broken} failing on main itself` : ''}.`,
  );
  return lines.join('\n');
}
