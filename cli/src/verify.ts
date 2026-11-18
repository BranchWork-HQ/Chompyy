// Independent check (FEATURES §5): after a card runs, Chompyy runs the repo's own tests itself, so "Checks
// pass" no longer rests only on the agent grading its own work. The tests are code the agent may have
// written, so they run in a macOS sandbox (sandbox-exec): writes only in the card's folder, the tool cache and
// temp folders; no network; no reads of credential folders. Elsewhere the check is skipped, never run open.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CheckCommand {
  argv: string[];
  /** As shown to you: "npm test". */
  label: string;
  /** The project uses node_modules (linked in from your checkout for the check). */
  node?: boolean;
}

export interface Verified {
  result: 'passed' | 'failed' | 'not run';
  command?: string;
  why: string;
  at: string;
  /** The last lines of the output, for when it fails. */
  tail?: string;
  /** The failure looks like the sandbox blocking something (a write outside the folder, the network), not broken code. */
  sandboxBlocked?: boolean;
}

/** Signs in test output that the sandbox, not the code, stopped it. */
export function looksSandboxBlocked(output: string): boolean {
  return /\bEPERM\b|Operation not permitted|ENOTFOUND|EAI_AGAIN|getaddrinfo|network is unreachable|Could not resolve host/i.test(output);
}

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** The repo's test command, from what's in the folder. `override` (from config) wins. */
export function detectCheck(dir: string, override?: string): CheckCommand | null {
  if (override?.trim()) return { argv: ['sh', '-c', override], label: override.trim() };
  const pkg = read(join(dir, 'package.json'));
  if (pkg) {
    try {
      const test = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts?.test;
      if (test && !/no test specified/.test(test)) {
        const pm = existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
        return { argv: [pm, 'test'], label: `${pm} test`, node: true };
      }
    } catch {}
  }
  if (existsSync(join(dir, 'go.mod'))) return { argv: ['go', 'test', './...'], label: 'go test ./...' };
  if (existsSync(join(dir, 'Cargo.toml'))) return { argv: ['cargo', 'test', '--offline'], label: 'cargo test --offline' };
  const py = read(join(dir, 'pyproject.toml')) + read(join(dir, 'setup.cfg')) + read(join(dir, 'tox.ini'));
  const hasPyTests = existsSync(join(dir, 'pytest.ini')) || /pytest/.test(py) || (existsSync(join(dir, 'tests')) && readdirSync(join(dir, 'tests')).some((f) => /^test_.*\.py$/.test(f)));
  if (hasPyTests) return { argv: ['python3', '-m', 'pytest', '-q'], label: 'pytest' };
  if (/^test:/m.test(read(join(dir, 'Makefile')))) return { argv: ['make', 'test'], label: 'make test' };
  return null;
}

const sbString = (p: string) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** The sandbox-exec profile: everything readable except credentials; writes only where the check needs them. */
export function sandboxProfile(opts: { writable: string[]; denyRead: string[] }): string {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(allow network* (local unix))',
    '(deny file-write*)',
    `(allow file-write* ${[...opts.writable.map((p) => `(subpath ${sbString(p)})`), '(subpath "/private/tmp")', '(subpath "/private/var/folders")', '(literal "/dev/null")', '(literal "/dev/tty")'].join(' ')})`,
    ...opts.denyRead.map((p) => `(deny file-read* (subpath ${sbString(expand(p))}))`),
  ].join('\n');
}

export interface VerifyOptions {
  /** The card's folder (a worktree of your repo). */
  dir: string;
  /** Your checkout, where node_modules lives. */
  repoRoot: string | null;
  cacheDir: string;
  env: Record<string, string>;
  denyRead: string[];
  timeoutMs: number;
  override?: string;
  now: () => Date;
  /** For tests: run without sandbox-exec. */
  unsandboxed?: boolean;
}

function tail(text: string, lines = 15): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') // colour codes
    .trimEnd().split('\n').slice(-lines).join('\n').slice(-2000);
}

/** Run the repo's tests in the card's folder, sandboxed. Never throws. */
export async function verifyRun(opts: VerifyOptions): Promise<Verified> {
  const at = () => opts.now().toISOString();
  const check = detectCheck(opts.dir, opts.override);
  if (!check) return { result: 'not run', why: 'no test command found in the repo', at: at() };
  if (!opts.unsandboxed && (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec'))) {
    return { result: 'not run', command: check.label, why: 'needs the macOS sandbox (sandbox-exec) to run tests safely', at: at() };
  }
  // A fresh worktree has no node_modules (it's gitignored): borrow your checkout's for the check.
  const writable = [opts.dir, opts.cacheDir];
  let linked = '';
  if (check.node && opts.repoRoot) {
    const mine = join(opts.dir, 'node_modules');
    const theirs = join(opts.repoRoot, 'node_modules');
    if (!existsSync(mine) && existsSync(theirs)) {
      symlinkSync(theirs, mine, 'dir');
      linked = mine;
      writable.push(join(theirs, '.vite'), join(theirs, '.vite-temp'), join(theirs, '.cache')); // test runners' caches and temp files
    }
  }
  const argv = opts.unsandboxed ? check.argv : ['/usr/bin/sandbox-exec', '-p', sandboxProfile({ writable, denyRead: opts.denyRead }), ...check.argv];
  try {
    const r = await run(argv, opts.dir, { ...process.env, ...opts.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }, opts.timeoutMs);
    if (r.timedOut) return { result: 'failed', command: check.label, why: `took longer than ${Math.round(opts.timeoutMs / 60_000)} minutes`, at: at(), tail: tail(r.output) };
    if (r.code === 0) return { result: 'passed', command: check.label, why: `${check.label} passed`, at: at() };
    if (!opts.unsandboxed && looksSandboxBlocked(r.output)) {
      return { result: 'failed', command: check.label, why: `${check.label} failed, but the sandbox blocked something it needs (a write outside the folder or the network), so it may not be the change`, at: at(), tail: tail(r.output), sandboxBlocked: true };
    }
    return { result: 'failed', command: check.label, why: `${check.label} exited with ${r.code}`, at: at(), tail: tail(r.output) };
  } catch (err) {
    return { result: 'not run', command: check.label, why: `couldn't start: ${err instanceof Error ? err.message : err}`, at: at() };
  } finally {
    if (linked && lstatSync(linked).isSymbolicLink()) rmSync(linked);
  }
}

export function run(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let output = '';
    let timedOut = false;
    const add = (d: Buffer) => {
      output = (output + d.toString()).slice(-20_000);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}
