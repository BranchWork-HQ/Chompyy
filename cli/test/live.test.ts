import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordCliLocation } from '../src/appstate.js';
import { appBundle, keepAffectsLive, liveOff, liveSet, liveUpdate, liveUpdateLocked, loadLive, planUpdate, type LiveDeps } from '../src/live.js';
import { useTempHome } from './helpers.js';

// The live copy (2026-11-19): kept cards #10, #12, #19, #22 never reached the running app, because the app ran
// from a work folder that had been switched to another branch and nothing rebuilt after Keep.

const repos: string[] = [];
afterEach(() => repos.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo(): { root: string; g: (...a: string[]) => string; commit: (file: string, text: string) => string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-live-')));
  repos.push(root);
  const g = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  const commit = (file: string, text: string) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), text);
    g('add', '.');
    g('commit', '-qm', file);
    return g('rev-parse', 'HEAD');
  };
  commit('cli/package-lock.json', '{"v":1}');
  commit('mac/Sources/App.swift', 'v1');
  return { root, g, commit };
}

/** Records the commands; "builds" create what a real build would, so the next update sees them. */
function fakeDeps(running = true, opts: { quitAfter?: number; openFails?: number } = {}): LiveDeps & { ran: string[]; lines: string[]; slept: number } {
  const ran: string[] = [];
  let quitIn = -1;
  let openFails = opts.openFails ?? 0;
  const lines: string[] = [];
  return {
    ran,
    lines,
    slept: 0,
    run: (cmd, args, cwd) => {
      ran.push([cmd.split('/').pop(), ...args].join(' '));
      if (cmd === 'pkill') quitIn = opts.quitAfter ?? 0; // pkill only asks: it quits after a few checks
      if (cmd === 'open' && openFails-- > 0) throw new Error('LSOpenURLsWithRole() failed with error -600');
      if (cmd.endsWith('build-app.sh')) mkdirSync(join(cwd, 'build', 'Chompyy.app'), { recursive: true });
      if (cmd === 'npm' && args[1] === 'build') {
        mkdirSync(join(cwd, 'dist'), { recursive: true });
        writeFileSync(join(cwd, 'dist', 'cli.js'), '');
      }
    },
    log: (l) => lines.push(l),
    appRunning: () => {
      if (quitIn === 0) running = false;
      else if (quitIn > 0) quitIn--;
      return running;
    },
    sleep(ms) {
      this.slept += ms;
    },
    node: '/usr/bin/node',
  };
}

describe('the live copy', () => {
  const home = useTempHome();

  it('first update installs, builds the CLI and the app, points the app at it, and restarts the app', () => {
    const r = repo();
    liveSet(r.root);
    const d = fakeDeps(true);
    const live = liveUpdate(d);
    expect(d.ran).toEqual(['npm ci --no-audit --no-fund', 'npm run build', 'build-app.sh', 'pkill -x Chompyy', `open ${appBundle(live.dir)}`]);
    expect(live.builtCommit).toBe(r.g('rev-parse', 'main'));
    expect(live.error).toBeUndefined();
    const cli = JSON.parse(readFileSync(join(home(), 'cli.json'), 'utf8'));
    expect(cli).toEqual({ node: '/usr/bin/node', script: join(live.dir, 'cli', 'dist', 'cli.js'), live: true });
  });

  it('after a Keep that only touches the CLI: rebuilds the CLI, leaves the app alone', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    const target = r.commit('cli/src/x.ts', 'new');
    const d = fakeDeps();
    expect(liveUpdate(d).builtCommit).toBe(target);
    expect(d.ran).toEqual(['npm run build']);
  });

  it('after a Keep that touches the Mac app: rebuilds and restarts it', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    r.commit('mac/Sources/App.swift', 'v2');
    const d = fakeDeps();
    liveUpdate(d);
    expect(d.ran).toContain('build-app.sh');
    expect(d.ran).toContain('pkill -x Chompyy');
    expect(d.ran).not.toContain('npm ci --no-audit --no-fund'); // lockfile unchanged
  });

  it('nothing new on main: does nothing', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    const d = fakeDeps();
    liveUpdate(d);
    expect(d.ran).toEqual([]);
    expect(d.lines.join()).toMatch(/already up to date/);
  });

  it('follows main even when your own folder is on another branch (the 2026-11-19 bug)', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    const kept = r.commit('cli/src/kept.ts', 'card');
    r.g('checkout', '-q', '-b', 'fix/other');
    r.commit('cli/src/other.ts', 'unrelated work');
    const live = liveUpdate(fakeDeps());
    expect(live.builtCommit).toBe(kept);
    expect(execFileSync('git', ['-C', live.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(kept);
  });

  it('a failed build keeps the last good one: the app is not repointed, the error is kept', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    const before = readFileSync(join(home(), 'cli.json'), 'utf8');
    r.commit('cli/src/broken.ts', 'x');
    const d = fakeDeps();
    d.run = (cmd, args) => {
      if (cmd === 'npm') throw Object.assign(new Error('npm run build failed'), { stderr: 'TS2345: oops' });
    };
    const live = liveUpdate(d);
    expect(live.error).toMatch(/npm run build failed[\s\S]*TS2345/);
    expect(readFileSync(join(home(), 'cli.json'), 'utf8')).toBe(before);
  });

  it('a second update while one runs leaves a note instead of building twice at once', () => {
    const r = repo();
    liveSet(r.root);
    writeFileSync(join(home(), 'live.lock'), String(process.pid)); // "another update" (this process: alive)
    expect(liveUpdateLocked(fakeDeps())).toBeNull();
    rmSync(join(home(), 'live.lock'));
    const d = fakeDeps();
    expect(liveUpdateLocked(d)?.builtCommit).toBe(r.g('rev-parse', 'main'));
  });

  it('only Keeps on the followed branch of the same repo update it', () => {
    const r = repo();
    const other = repo();
    const live = liveSet(r.root);
    const wt = join(r.root, '..', `${r.root.split('/').pop()}-wt`);
    repos.push(wt);
    r.g('worktree', 'add', '-q', '-b', 'feat/x', wt);
    expect(keepAffectsLive(live, wt, 'main')).toBe(true); // another worktree of the same repo
    expect(keepAffectsLive(live, r.root, 'feat/x')).toBe(false);
    expect(keepAffectsLive(live, other.root, 'main')).toBe(false);
    expect(keepAffectsLive(null, r.root, 'main')).toBe(false);
  });

  it('once set, a CLI run from a work folder no longer takes the app over; `live off` gives it back', () => {
    const r = repo();
    liveSet(r.root);
    liveUpdate(fakeDeps());
    const pinned = readFileSync(join(home(), 'cli.json'), 'utf8');
    recordCliLocation(); // this test process: a CLI from somewhere else
    expect(readFileSync(join(home(), 'cli.json'), 'utf8')).toBe(pinned);
    liveOff();
    expect(loadLive()).toBeNull();
    recordCliLocation();
    expect(JSON.parse(readFileSync(join(home(), 'cli.json'), 'utf8')).script).toBe(process.argv[1]);
  });
  // 2026-11-21: pkill only asks the app to quit; `open` ran while it was still closing, failed, and the log said
  // "the last good build keeps running" although the app was already closed.
  it('waits for the old app to quit before opening the new one', () => {
    const r = repo();
    liveSet(r.root);
    const d = fakeDeps(true, { quitAfter: 5 });
    liveUpdate(d);
    expect(d.ran.indexOf('open ' + join(home(), 'live', 'mac', 'build', 'Chompyy.app'))).toBeGreaterThan(d.ran.indexOf('pkill -x Chompyy'));
    expect(d.slept).toBeGreaterThanOrEqual(5 * 200);
    expect(d.lines.at(-1)).toBe('restarted the app with the new build.');
  });

  it('tries opening again when macOS refuses once', () => {
    const r = repo();
    liveSet(r.root);
    const d = fakeDeps(true, { openFails: 1 });
    const live = liveUpdate(d);
    expect(d.ran.filter((c) => c.startsWith('open ')).length).toBe(2);
    expect(live.error).toBeUndefined();
  });

  it('when it never opens, it says the app is closed instead of claiming the old one still runs', () => {
    const r = repo();
    liveSet(r.root);
    const d = fakeDeps(true, { openFails: 99 });
    const live = liveUpdate(d);
    expect(live.error).toMatch(/didn't open: open .*Chompyy\.app by hand/);
    expect(d.lines.at(-1)).toMatch(/^update failed and the app is closed/);
  });

});

describe('planning an update', () => {
  const base = { repo: '/r', branch: 'main', dir: '/d', builtCommit: 'a', appCommit: 'a', depsHash: 'h' };
  it('rebuilds the app only when mac/ changed or it is missing', () => {
    expect(planUpdate(base, 'b', 'h', true, () => false)).toEqual({ target: 'b', installDeps: false, buildCli: true, buildApp: false });
    expect(planUpdate(base, 'b', 'h', true, () => true).buildApp).toBe(true);
    expect(planUpdate(base, 'a', 'h', false, () => false).buildApp).toBe(true);
    expect(planUpdate(base, 'b', 'h2', true, () => false).installDeps).toBe(true);
  });
});
