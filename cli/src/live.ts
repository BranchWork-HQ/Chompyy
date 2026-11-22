// The live copy (2026-11-19): the Chompyy you use runs from its own copy of the repo, ~/.chompyy/live, that
// follows main and that nobody works in. After each Keep that lands on main, Chompyy brings the copy up to
// main, rebuilds the CLI, and rebuilds + restarts the Mac app when its code changed. So a kept card shows up
// in the real app within a couple of minutes, and switching branches in a work folder can't take it away.
//
// Why: on 2026-11-19 four kept cards never reached the running app. The app ran from a work folder
// (token-saving-research-board) that had been switched to another branch, and nothing rebuilt after Keep.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { chompyyHome, homePath, readJson, writeJson } from './home.js';

export interface LiveState {
  /** The repo the copy is made from (your checkout). */
  repo: string;
  /** The branch the copy follows. */
  branch: string;
  /** The copy itself. */
  dir: string;
  /** The commit the CLI was last built from. */
  builtCommit?: string;
  /** The commit the Mac app was last built from. */
  appCommit?: string;
  /** The commit of the copy in ~/Applications (what Spotlight, Launchpad and the Dock open). */
  installedCommit?: string;
  /** Hash of cli/package-lock.json when dependencies were last installed. */
  depsHash?: string;
  at?: string;
  /** What went wrong in the last update, if anything (the previous build keeps running). */
  error?: string;
}

export const livePath = () => homePath('live.json');
export const liveDir = () => join(chompyyHome(), 'live');
export const loadLive = (): LiveState | null => readJson<LiveState | null>(livePath(), null);

const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** The repo's shared .git folder: the same for every worktree of one repo. */
export function commonDir(dir: string): string | null {
  try {
    return resolve(dir, git(dir, ['rev-parse', '--git-common-dir']));
  } catch {
    return null;
  }
}

/** Does a Keep in `cardRepo` onto `branch` change what the live copy follows? */
export function keepAffectsLive(live: LiveState | null, cardRepo: string, branch: string | null | undefined): boolean {
  if (!live || !branch || branch !== live.branch) return false;
  const a = commonDir(cardRepo);
  return !!a && a === commonDir(live.repo);
}

/** What an update has to do to bring the copy from what was built to `target`. */
export interface LivePlan {
  target: string;
  installDeps: boolean;
  buildCli: boolean;
  buildApp: boolean;
}

export function planUpdate(live: LiveState, target: string, depsHash: string, appExists: boolean, macChanged: (from: string, to: string) => boolean): LivePlan {
  return {
    target,
    installDeps: live.depsHash !== depsHash,
    buildCli: live.builtCommit !== target,
    buildApp: !appExists || !live.appCommit || (live.appCommit !== target && macChanged(live.appCommit, target)),
  };
}

export interface LiveDeps {
  /** Run a command in a folder; throws on failure. */
  run: (cmd: string, args: string[], cwd: string) => void;
  log: (line: string) => void;
  /** Is the Mac app running right now? */
  appRunning: () => boolean;
  /** Wait (blocking): the app takes a moment to quit. */
  sleep: (ms: number) => void;
  node: string;
}

const defaultDeps = (log: (line: string) => void): LiveDeps => ({
  run: (cmd, args, cwd) => {
    execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  },
  log,
  appRunning: () => {
    try {
      execFileSync('pgrep', ['-x', 'Chompyy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  node: process.execPath,
});

/** Tries before giving up on opening the new app, one second apart. */
export const OPEN_TRIES = 3;

export const appBundle = (dir: string) => join(dir, 'mac', 'build', 'Chompyy.app');

/**
 * Where the app is installed so you can open it like any Mac app (Spotlight, Launchpad, the Dock), without a
 * terminal: ~/Applications/Chompyy.app. No admin rights needed. CHOMPYY_APPLICATIONS moves it (tests).
 */
export const installedApp = () => join(process.env.CHOMPYY_APPLICATIONS || join(homedir(), 'Applications'), 'Chompyy.app');
const lockHash = (dir: string) => {
  const p = join(dir, 'cli', 'package-lock.json');
  return existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) : 'none';
};

/** Point the app at the live CLI, and mark it so other copies of the CLI don't take it over (recordCliLocation). */
export function pinCli(dir: string, node: string): void {
  writeJson(homePath('cli.json'), { node, script: join(dir, 'cli', 'dist', 'cli.js'), live: true });
}

/** Make the live copy: a worktree of `repo` at `branch`, detached so the branch stays free for your own folders. */
export function liveSet(repo: string, branch = 'main'): LiveState {
  const root = git(repo, ['rev-parse', '--show-toplevel']);
  const dir = liveDir();
  if (!existsSync(join(dir, '.git'))) git(root, ['worktree', 'add', '--quiet', '--detach', dir, branch]);
  const state: LiveState = { repo: root, branch, dir };
  writeJson(livePath(), state);
  return state;
}

/**
 * Bring the live copy to the latest `branch` and rebuild what changed. A failed step leaves the last good build
 * running (the CLI is only repointed after a build succeeds) and records the error for `chompyy live`.
 */
export function liveUpdate(deps: LiveDeps = defaultDeps((l) => console.log(l))): LiveState {
  const live = loadLive();
  if (!live) throw new Error('No live copy yet: run `chompyy live set <your Chompyy checkout>` once.');
  const { dir } = live;
  let appClosed = false;
  try {
    const target = git(live.repo, ['rev-parse', live.branch]);
    git(dir, ['checkout', '--quiet', '--force', '--detach', target]);
    const plan = planUpdate(live, target, lockHash(dir), existsSync(appBundle(dir)), (from, to) => {
      try {
        git(dir, ['diff', '--quiet', from, to, '--', 'mac']);
        return false;
      } catch {
        return true;
      }
    });
    const cli = join(dir, 'cli');
    if (plan.installDeps) {
      deps.log('installing the CLI\'s dependencies (the lockfile changed)…');
      deps.run('npm', ['ci', '--no-audit', '--no-fund'], cli);
      live.depsHash = lockHash(dir);
    }
    if (plan.buildCli || plan.installDeps) {
      deps.log(`building the CLI at ${target.slice(0, 7)}…`);
      deps.run('npm', ['run', 'build'], cli);
      live.builtCommit = target;
    }
    pinCli(dir, deps.node);
    const installed = installedApp();
    // Also when only the installed copy is missing or behind (an older download sat there: 0.1.0 on 2026-11-22).
    const install = plan.buildApp || !existsSync(installed) || live.installedCommit !== live.appCommit;
    if (plan.buildApp) {
      deps.log('building the Mac app (its code changed)…');
      deps.run(join(dir, 'mac', 'Scripts', 'build-app.sh'), [], join(dir, 'mac'));
      live.appCommit = target;
    }
    if (install) {
      const wasRunning = deps.appRunning();
      if (wasRunning) {
        try {
          deps.run('pkill', ['-x', 'Chompyy'], dir);
        } catch {}
        // pkill only asks it to quit. Opening while the old app is still closing fails (2026-11-21): wait up to 10 s.
        for (let i = 0; i < 50 && deps.appRunning(); i++) deps.sleep(200);
      }
      // Replace the copy in Applications with this build, then open that copy.
      if (basename(installed) !== 'Chompyy.app') throw new Error(`refusing to replace ${installed}`);
      mkdirSync(dirname(installed), { recursive: true });
      rmSync(installed, { recursive: true, force: true });
      deps.run('ditto', [appBundle(dir), installed], dir);
      live.installedCommit = live.appCommit;
      let failed: unknown;
      for (let i = 0; i < OPEN_TRIES; i++) {
        try {
          // In the background and marked as an update: the app comes back quietly to the menu bar.
          deps.run('open', ['-g', installed, '--args', '--updated'], dir);
          failed = undefined;
          break;
        } catch (err) {
          failed = err;
          if (i < OPEN_TRIES - 1) deps.sleep(1000);
        }
      }
      if (failed) {
        appClosed = wasRunning;
        throw new Error(`the new app is built but didn't open: open ${installed} by hand (${(failed as Error).message.split('\n')[0]})`);
      }
      deps.log(`${wasRunning ? 'restarted the app with the new build' : 'opened the new app'} (installed in ${installed.replace(homedir(), '~')}).`);
    }
    delete live.error;
    if (!plan.buildCli && !install && !plan.installDeps) deps.log(`already up to date at ${target.slice(0, 7)}.`);
  } catch (err) {
    const e = err as { message?: string; stderr?: Buffer | string };
    live.error = `${e.message ?? err}${e.stderr ? `\n${String(e.stderr).slice(-2000)}` : ''}`.trim();
    // Say what is really running: once the old app was closed, nothing is.
    deps.log(appClosed ? `update failed and the app is closed: ${live.error.split('\n')[0]}` : `update failed, the last good build keeps running: ${live.error.split('\n')[0]}`);
  }
  live.at = new Date().toISOString();
  writeJson(livePath(), live);
  return live;
}

/**
 * Run updates one at a time. Keeping two cards in a row asks twice: the second ask leaves a note, and the
 * update that is already running goes round again so it ends at the newest main.
 */
export function liveUpdateLocked(deps?: LiveDeps): LiveState | null {
  const lock = homePath('live.lock');
  const again = homePath('live.again');
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch {
    const pid = Number(readFileSync(lock, 'utf8')) || 0;
    let alive = false;
    try {
      if (pid) process.kill(pid, 0);
      alive = pid > 0;
    } catch {}
    if (alive) {
      writeFileSync(again, '');
      return null;
    }
    rmSync(lock, { force: true }); // left by an update that died
    fd = openSync(lock, 'wx');
  }
  try {
    writeFileSync(fd, String(process.pid));
    let state: LiveState;
    do {
      rmSync(again, { force: true });
      state = liveUpdate(deps);
    } while (existsSync(again));
    return state;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

/** Start an update in the background, so Keep returns at once and the update outlives an app restart. */
export function startLiveUpdate(node: string = process.execPath, script: string = process.argv[1]!): void {
  const out = openSync(homePath('live.log'), 'a');
  const child = spawn(node, [script, 'live', 'update'], { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  closeSync(out);
}

/** Stop following: the app goes back to whichever CLI runs next (the live folder stays until you delete it). */
export function liveOff(): void {
  rmSync(livePath(), { force: true });
  const cli = homePath('cli.json');
  const have = readJson<Record<string, unknown>>(cli, {});
  if (have.live) {
    delete have.live;
    writeJson(cli, have);
  }
}

/** For `chompyy live`: where the copy is, and whether it has everything that's on main. */
export function formatLive(live: LiveState | null): string {
  if (!live) return 'No live copy. Set it up once with `chompyy live set <your Chompyy checkout>`; after that every Keep on main reaches the app by itself.';
  let behind = '';
  try {
    const n = Number(git(live.repo, ['rev-list', '--count', `${live.builtCommit ?? live.branch}..${live.branch}`]));
    behind = n ? `${n} commit(s) on ${live.branch} not built yet` : `up to date with ${live.branch}`;
  } catch {}
  return [
    `live copy  ${live.dir}`,
    `follows    ${live.branch} of ${live.repo}`,
    `CLI built  ${live.builtCommit?.slice(0, 7) ?? 'never'}${behind ? ` (${behind})` : ''}`,
    `app built  ${live.appCommit?.slice(0, 7) ?? 'never'}`,
    ...(live.at ? [`updated    ${live.at}`] : []),
    ...(live.error ? [`last error ${live.error.split('\n')[0]}  (details: ~/.chompyy/live.log)`] : []),
  ].join('\n');
}
