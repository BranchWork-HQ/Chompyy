// Verify, main vs card (research/away-readiness.md, step 4): after a card runs, Chompyy runs the repo's checks
// itself on the card's copy AND on the main it started from, both in the sandbox, and reports only what the card
// made worse. The agent's own "CHECKS:" line becomes a claim; this is the measurement.
//   passes on the card                           → ok
//   fails on the card, passes on main            → the card broke it (with the failing tests when readable)
//   fails on both, same failing tests            → not the card: main fails the same way
//   fails on both, new failing tests on the card → the card broke those tests
// Main's results are cached per commit, so cards that started from the same main share one run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cacheEnv } from './away.js';
import { setupDependencies } from './deps.js';
import { homePath, readJson, writeJson } from './home.js';
import { detectChecks, type RepoCheck } from './preflight.js';
import { run as runCmd, sandboxProfile, type Verified } from './verify.js';

export interface CheckOutcome {
  label: string;
  dir: string;
  /** passed / failed (timeouts count as failed). */
  card: 'passed' | 'failed';
  main: 'passed' | 'failed' | 'unknown';
  /** Failing tests on the card that don't fail on main (when the output names tests). */
  newFailures: string[];
  verdict: 'ok' | 'broke' | 'same-as-main';
  /** Failed once, passed on the retry. */
  flaky?: boolean;
  tail?: string;
}

/** Names of failing tests in common test runners' output (vitest/jest, go test, pytest, XCTest, cargo). */
export function failingTests(output: string): string[] {
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const names = new Set<string>();
  for (const m of clean.matchAll(/^\s*(?:FAIL|×|✗)\s+(\S+\.(?:test|spec)\.[jt]sx?\s*>.+?)\s*(?:\d+ms)?$/gm)) names.add(m[1]!.trim());
  for (const m of clean.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)) names.add(m[1]!.trim());
  for (const m of clean.matchAll(/^--- FAIL: (\S+)/gm)) names.add(m[1]!);
  for (const m of clean.matchAll(/^FAILED (\S+::\S+)/gm)) names.add(m[1]!);
  for (const m of clean.matchAll(/Test Case '-\[(\S+ \S+)\]' failed/g)) names.add(m[1]!);
  for (const m of clean.matchAll(/^test (\S+) \.\.\. FAILED/gm)) names.add(m[1]!);
  // vitest prints a failure twice ("× name" and "FAIL file > name"): keep the fuller one.
  const all = [...names];
  return all.filter((n) => !all.some((m) => m !== n && m.endsWith(` > ${n}`))).sort();
}

type Exec = (argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, writable: string[]) => Promise<{ code: number | null; output: string; timedOut: boolean }>;

export interface VerifyCardOptions {
  /** Your checkout (for git and the dependency setup). */
  root: string;
  /** The card's copy. */
  dir: string;
  /** The commit the card started from (its main). */
  baseCommit: string;
  cacheDir: string;
  denyRead: string[];
  timeoutMs: number;
  now?: () => Date;
  /** For tests: replace the sandboxed runner. */
  exec?: Exec;
}

const tail = (t: string) => t.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd().split('\n').slice(-12).join('\n').slice(-1500);
const key = (c: RepoCheck) => `${c.dir}::${c.label}`;

interface Baseline {
  commit: string;
  at: string;
  results: Record<string, { result: 'passed' | 'failed'; failures: string[] }>;
}

function baselinePath(root: string, commit: string): string {
  const repo = `${basename(root)}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
  return homePath('baselines', repo, `${commit}.json`);
}

async function runChecks(checks: RepoCheck[], dir: string, opts: VerifyCardOptions, exec: Exec) {
  const env = { ...process.env, ...cacheEnv(opts.cacheDir), CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' };
  const out: Record<string, { result: 'passed' | 'failed'; failures: string[]; output: string; flaky?: boolean }> = {};
  const once = (c: RepoCheck) => exec(c.argv, join(dir, c.dir), env, opts.timeoutMs, [dir, opts.cacheDir]).catch((err) => ({ code: null, output: String(err), timedOut: false }));
  for (const c of checks) {
    let r = await once(c);
    let flaky = false;
    // A failure gets one retry: passing the second time means flaky (slow tests on a busy Mac), not broken.
    if (r.code !== 0 || r.timedOut) {
      const again = await once(c);
      if (again.code === 0 && !again.timedOut) flaky = true;
      r = again.code === 0 && !again.timedOut ? again : r;
    }
    const passed = r.code === 0 && !r.timedOut;
    out[key(c)] = { result: passed ? 'passed' : 'failed', failures: passed ? [] : failingTests(r.output), output: r.timedOut ? `${r.output}\n(timed out)` : r.output, ...(flaky ? { flaky } : {}) };
  }
  return out;
}

/** Main's results for these checks at `commit`: from the cache, else run once on a clean copy and cached. */
async function baseline(checks: RepoCheck[], opts: VerifyCardOptions, exec: Exec): Promise<Baseline> {
  const path = baselinePath(opts.root, opts.baseCommit);
  const cached = readJson<Baseline | null>(path, null);
  const missing = checks.filter((c) => !cached?.results[key(c)]);
  if (cached && !missing.length) return cached;
  const dir = homePath('baseline-copy', basename(path, '.json'));
  const git = (args: string[]) => execFileSync('git', ['-C', opts.root, ...args], { stdio: 'ignore' });
  try {
    git(['worktree', 'remove', '--force', dir]);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
  git(['worktree', 'add', '--detach', '--quiet', dir, opts.baseCommit]);
  try {
    setupDependencies(opts.root, dir, basename(path, '.json'), { env: cacheEnv(opts.cacheDir) });
    const ran = await runChecks(missing, dir, opts, exec);
    const results = { ...(cached?.results ?? {}) };
    for (const [k, v] of Object.entries(ran)) results[k] = { result: v.result, failures: v.failures };
    const b: Baseline = { commit: opts.baseCommit, at: (opts.now ?? (() => new Date()))().toISOString(), results };
    writeJson(path, b);
    return b;
  } finally {
    try {
      git(['worktree', 'remove', '--force', dir]);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the check's output named its failing tests (so the comparison was test by test). */
function failingTestsKnown(o: CheckOutcome): boolean {
  return Boolean(o.tail && failingTests(o.tail).length);
}

/** Run the repo's checks on the card and on its main; report only what the card made worse. Never throws. */
export async function verifyCard(opts: VerifyCardOptions): Promise<Verified & { outcomes?: CheckOutcome[] }> {
  const at = (opts.now ?? (() => new Date()))().toISOString();
  const exec: Exec =
    opts.exec ?? ((argv, cwd, env, t, writable) => runCmd(['/usr/bin/sandbox-exec', '-p', sandboxProfile({ writable, denyRead: opts.denyRead }), ...argv], cwd, env, t));
  if (!opts.exec && (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))) {
    return { result: 'not run', why: 'needs the macOS sandbox (sandbox-exec) to run checks safely', at };
  }
  const checks = detectChecks(opts.dir, opts.cacheDir);
  if (!checks.length) return { result: 'not run', why: 'no checks found in the repo (tests, typecheck or build)', at };
  try {
    const onCard = await runChecks(checks, opts.dir, opts, exec);
    const failedOnCard = checks.filter((c) => onCard[key(c)]!.result === 'failed');
    // Only run main when something failed on the card: a clean card needs no comparison.
    const main = failedOnCard.length ? await baseline(failedOnCard, opts, exec) : null;
    const outcomes: CheckOutcome[] = checks.map((c) => {
      const mine = onCard[key(c)]!;
      const theirs = main?.results[key(c)];
      if (mine.result === 'passed') return { label: c.label, dir: c.dir, card: 'passed', main: theirs?.result ?? 'unknown', newFailures: [], verdict: 'ok', ...(mine.flaky ? { flaky: true } : {}) };
      if (!theirs || theirs.result === 'passed') {
        return { label: c.label, dir: c.dir, card: 'failed', main: theirs?.result ?? 'unknown', newFailures: mine.failures, verdict: 'broke', tail: tail(mine.output) };
      }
      const known = new Set(theirs.failures);
      const fresh = mine.failures.filter((f) => !known.has(f));
      // Both fail. New failing tests on the card → the card broke them; otherwise main fails the same way.
      const broke = fresh.length > 0;
      return { label: c.label, dir: c.dir, card: 'failed', main: 'failed', newFailures: fresh, verdict: broke ? 'broke' : 'same-as-main', tail: tail(mine.output) };
    });
    const broke = outcomes.filter((o) => o.verdict === 'broke');
    const same = outcomes.filter((o) => o.verdict === 'same-as-main');
    const names = (o: CheckOutcome) => `${o.dir ? `${o.dir}: ` : ''}${o.label.split(' --')[0]}`;
    if (broke.length) {
      const detail = broke.map((o) => `${names(o)}${o.newFailures.length ? ` (${o.newFailures.slice(0, 3).join('; ')}${o.newFailures.length > 3 ? ` and ${o.newFailures.length - 3} more` : ''})` : ''}`).join(', ');
      return { result: 'failed', command: broke.map(names).join(', '), why: `this change broke ${detail}; it passes on main`, at, tail: broke[0]!.tail, outcomes };
    }
    const okList = outcomes.filter((o) => o.verdict === 'ok').map((o) => `${names(o)}${o.flaky ? ' (flaky: failed once, passed on retry)' : ''}`);
    const unnamed = same.some((o) => !o.newFailures.length && !failingTestsKnown(o));
    const why = same.length
      ? `${okList.length ? `${okList.join(', ')} pass` : 'nothing new fails'}; ${same.map(names).join(', ')} fail${same.length === 1 ? 's' : ''} the same way on main, so not because of this change${unnamed ? " (its output doesn't name tests, so this compares pass/fail only)" : ''}`
      : `${okList.join(', ')} pass`;
    return { result: 'passed', command: outcomes.map(names).join(', '), why, at, outcomes };
  } catch (err) {
    return { result: 'not run', why: `couldn't run the checks: ${err instanceof Error ? err.message : err}`, at };
  }
}
