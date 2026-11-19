// Refresh (2026-11-19): Chompyy keeps cards in review up to date with main by itself. Cards from one night start
// from the same main; keeping one can make the next clash with it (#20 and #21 after #12, #19, #22 were kept).
// You shouldn't have to pick an order or merge by hand. After each Keep, every card in review that now clashes
// is brought onto the new main: git merges it when it can, and when it can't, a short agent session in the
// card's own sandbox fits both changes together. Then Chompyy's own check runs again against the new main.
// Pressing Keep on a clashing card does the same and keeps it once the check passes.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cacheEnv, denyReadRules, safetyRules, sandboxSettings } from './away.js';
import { getCard, loadBoard, updateBoard, type Card, type Refresh } from './board.js';
import type { Config } from './config.js';
import { homePath } from './home.js';
import { windowView, type Snapshot } from './quota.js';
import type { Runner } from './runner.js';
import type { Verified } from './verify.js';
import type { RunTokens } from './tokens.js';
import { commitLeftovers, gitRoot, type Workspace } from './workspace.js';

const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ok = (cwd: string, args: string[]) => {
  try {
    git(cwd, args);
    return true;
  } catch {
    return false;
  }
};

/** The branch Keep would land the card on. */
export function landingBranch(card: Card): string | null {
  if (card.run?.base?.branch) return card.run.base.branch;
  try {
    return git(card.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || null;
  } catch {
    return null;
  }
}

/**
 * Would Keep clash? For a card in review: the landing branch's commit, and the files git can't merge by itself.
 * Null when it merges cleanly (or isn't a branch card in review). Uses `git merge-tree`, which touches no folder.
 */
export function clashOf(card: Card): { onto: string; branch: string; files: string[] } | null {
  const run = card.run;
  if (card.column !== 'review' || !run?.branch) return null;
  const repo = gitRoot(card.cwd);
  const branch = landingBranch(card);
  if (!repo || !branch) return null;
  try {
    const onto = git(repo, ['rev-parse', branch]);
    if (ok(repo, ['merge-base', '--is-ancestor', onto, run.branch])) return null; // already has it
    try {
      git(repo, ['merge-tree', '--write-tree', '--name-only', onto, run.branch]);
      return null; // merges cleanly
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      if (e.status !== 1) return null; // not a conflict (an old git, a missing branch): leave it to Keep
      const files = String(e.stdout ?? '').split('\n\n')[0]!.split('\n').slice(1).filter(Boolean);
      return { onto, branch, files: [...new Set(files)] };
    }
  } catch {
    return null;
  }
}

/** Why a refresh must wait, or null. Like drafting: it finishes work you already chose, so only a used-up window stops it. */
export function refreshGate(snap: Snapshot | null, now: Date): string | null {
  const five = windowView(snap?.fiveHour, now);
  const week = windowView(snap?.sevenDay, now);
  if (five.known && five.usedPct >= 100) return 'the 5-hour window is used up; it updates after the reset';
  if (week.known && week.usedPct >= 100) return 'the weekly limit is used up; it updates after the reset';
  return null;
}

export function refreshPrompt(card: Card, workdir: string, branch: string, files: string[], checks: { dir: string; label: string }[]): string {
  return `${safetyRules(workdir)}

# Bring card #${card.id} up to date with ${branch}

This folder is card #${card.id} ("${card.title}"), waiting for review. Meanwhile other work was kept on ${branch}, and
the two now clash. Chompyy has already started \`git merge ${branch}\` here; these files have conflicts:

${files.map((f) => `- ${f}`).join('\n')}

Resolve every conflict so that BOTH changes work: this card's change (what it was for: ${card.idea}) and what is
already on ${branch}. Usually that means keeping both sides and fitting them together: both imports, both fields,
both functions, both tests. Don't drop either side's feature, don't change anything else, and don't restart or
abort the merge. Then \`git add\` the files and finish with \`git commit --no-edit\`.
${checks.length ? `
After the merge, check it (these pass on ${branch}):
${checks.map((c) => `- in ${c.dir || 'the top folder'}: \`${c.label}\``).join('\n')}
` : ''}`;
}

export interface RefreshDeps {
  runner: Runner;
  config: Config;
  now: () => Date;
  snapshot: () => Snapshot | null;
  out: (line: string) => void;
  /** Chompyy's own check of the card against the main it's now on. */
  verify?: (ws: Workspace, card: Card) => Promise<Verified | undefined>;
  repoChecks?: (card: Card) => { dir: string; label: string }[];
  /** Keep the card (and do Keep's bookkeeping): for cards you already pressed Keep on. */
  keep?: (id: string) => void;
  /** How long the agent may take. */
  timeoutMs?: number;
}

function setRefresh(id: string, refresh: Refresh, extra: (c: Card) => void = () => {}): void {
  updateBoard((b) => {
    const c = getCard(b, id);
    c.refresh = refresh;
    extra(c);
    c.updatedAt = refresh.at;
  });
}

/** Markers git leaves in a conflicted file. */
const MARKERS = /^(<{7}|>{7})( |$)/m;

/** Bring one card in review onto its landing branch. Returns what happened (also saved on the card). */
export async function refreshCard(id: string, deps: RefreshDeps): Promise<Refresh> {
  const card = getCard(loadBoard(), id);
  const at = () => deps.now().toISOString();
  const keepIfAsked = (verified: Verified | undefined) => {
    if (!card.keepWhenRefreshed || !deps.keep) return;
    if (verified && verified.result !== 'passed') return deps.out(`  not keeping #${id} by itself: ${verified.why}`);
    deps.keep(id);
  };
  const clash = clashOf(card);
  if (!clash) {
    const done: Refresh = { state: 'done', why: 'already merges cleanly with main', at: at() };
    if (card.refresh || card.keepWhenRefreshed) setRefresh(id, done);
    keepIfAsked(undefined);
    return done;
  }
  const short = clash.onto.slice(0, 7);
  const waiting = refreshGate(deps.snapshot(), deps.now());
  if (waiting) {
    const r: Refresh = { state: 'waiting', onto: clash.onto, files: clash.files, why: waiting, at: at() };
    setRefresh(id, r);
    deps.out(`  #${id} clashes with ${clash.branch} but waits: ${waiting}`);
    return r;
  }
  const run = card.run!;
  const dir = run.workdir;
  const fail = (why: string): Refresh => {
    const r: Refresh = { state: 'failed', onto: clash.onto, files: clash.files, why, at: at() };
    setRefresh(id, r, (c) => delete c.keepWhenRefreshed);
    deps.out(`  ✗ #${id}: ${why}`);
    return r;
  };
  if (!existsSync(join(dir, '.git'))) return fail(`its folder ${dir} is gone; run it again on top of the latest with \`chompyy redo ${id}\``);
  setRefresh(id, { state: 'running', onto: clash.onto, files: clash.files, why: `bringing it onto ${clash.branch} @ ${short}`, at: at() });
  deps.out(`▶ refreshing #${id} onto ${clash.branch} @ ${short} (clashes in ${clash.files.join(', ')})`);

  commitLeftovers({ kind: 'worktree', dir }, card);
  const before = git(dir, ['rev-parse', 'HEAD']);
  const undo = () => {
    if (ok(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) ok(dir, ['merge', '--abort']);
    ok(dir, ['reset', '-q', '--hard', before]);
  };
  let by: 'git' | 'agent' = 'git';
  let tokens: RunTokens | undefined;
  const ident = ['-c', 'user.name=Chompyy', '-c', 'user.email=chompyy@localhost'];
  if (!ok(dir, [...ident, 'merge', '--no-edit', '-m', `Bring Chompyy card #${id} up to date with ${clash.branch}`, clash.onto])) {
    by = 'agent';
    const config = deps.config;
    const gitDir = resolve(dir, git(dir, ['rev-parse', '--git-common-dir']));
    const ws: Workspace = { kind: 'worktree', dir, branch: run.branch!, gitDir };
    const cacheDir = homePath('cache', 'tools');
    try {
      const result = await deps.runner.run({
        prompt: refreshPrompt(card, dir, clash.branch, clash.files, deps.repoChecks?.(card) ?? []),
        cwd: dir,
        timeoutMs: deps.timeoutMs ?? 15 * 60_000,
        model: config.runModel,
        maxTurns: config.maxTurns,
        permissionMode: config.permissionMode,
        permissionPrompts: config.permissionPrompts,
        allowedTools: config.allowedTools,
        disallowedTools: [...config.disallowedTools, ...denyReadRules(config.denyReadPaths)],
        ...(config.sandbox ? { settings: sandboxSettings(ws, config.sandboxAllowedDomains, cacheDir, config.denyReadPaths) } : {}),
        env: cacheEnv(cacheDir),
        extraArgs: config.extraArgs,
        ...(config.idleTimeoutMin > 0 ? { idleTimeoutMs: config.idleTimeoutMin * 60_000 } : {}),
        rawLogPath: homePath('runs', id, `refresh-${at().replace(/[:.]/g, '-')}.stream.jsonl`),
      });
      tokens = result.tokens;
      if (result.timedOut || result.stuck || result.stalled) {
        undo();
        return fail(`the agent couldn't finish fitting the changes together (${result.timedOut ? 'ran out of time' : result.stuck ?? result.stalled}); nothing was changed`);
      }
    } catch (err) {
      undo();
      return fail(`the agent didn't run (${err instanceof Error ? err.message : err}); nothing was changed`);
    }
    // Chompyy checks the agent's merge itself, never on its word.
    const stillMerging = ok(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    const leftMarkers = clash.files.filter((f) => existsSync(join(dir, f)) && MARKERS.test(readFileSync(join(dir, f), 'utf8')));
    const hasMain = ok(dir, ['merge-base', '--is-ancestor', clash.onto, 'HEAD']);
    if (stillMerging || leftMarkers.length || !hasMain) {
      undo();
      return fail(
        leftMarkers.length
          ? `conflict markers were left in ${leftMarkers.join(', ')}; nothing was changed`
          : stillMerging
          ? "the merge wasn't finished; nothing was changed"
          : `the result doesn't contain ${clash.branch}; nothing was changed`,
      );
    }
  }

  const base = { ref: run.base?.ref ?? clash.branch, branch: clash.branch, commit: clash.onto };
  let verified: Verified | undefined;
  if (deps.verify) {
    deps.out('  checking it against the new main (running the repo\'s tests, sandboxed)…');
    verified = await deps.verify({ kind: 'worktree', dir, branch: run.branch!, base }, card).catch(() => undefined);
    if (verified) deps.out(`  ${verified.result === 'passed' ? '✓' : verified.result === 'failed' ? '✗' : '·'} ${verified.why}`);
  }
  const done: Refresh = {
    state: 'done',
    onto: clash.onto,
    files: clash.files,
    by,
    ...(tokens ? { tokens } : {}),
    why: by === 'agent' ? `brought onto ${clash.branch} @ ${short}; an agent fitted both changes together in ${clash.files.join(', ')}` : `brought onto ${clash.branch} @ ${short}`,
    at: at(),
  };
  setRefresh(id, done, (c) => {
    c.run = { ...c.run!, base, ...(verified ? { verified } : {}) };
  });
  deps.out(`  → #${id} is up to date with ${clash.branch}`);
  keepIfAsked(verified);
  return done;
}

/** Every card in review that clashes with its main, one at a time. */
export async function refreshClashing(deps: RefreshDeps): Promise<Refresh[]> {
  const out: Refresh[] = [];
  for (const c of loadBoard().cards) {
    if (c.column !== 'review' || !c.run?.branch) continue;
    if (!clashOf(c) && !c.keepWhenRefreshed && c.refresh?.state !== 'waiting') continue;
    out.push(await refreshCard(c.id, deps));
  }
  return out;
}

/**
 * One refresh at a time (two Keeps in a row ask twice). A second ask leaves a note and the running one goes
 * round again, so every card ends up on the newest main. Returns false when another refresh took the ask.
 */
export async function withRefreshLock(fn: () => Promise<unknown>): Promise<boolean> {
  const lock = homePath('refresh.lock');
  const again = homePath('refresh.again');
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
      return false;
    }
    rmSync(lock, { force: true });
    fd = openSync(lock, 'wx');
  }
  try {
    writeFileSync(fd, String(process.pid));
    do {
      rmSync(again, { force: true });
      await fn();
    } while (existsSync(again));
    return true;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
