// Away run (spec §5.2, §5.5, §5.6): approved cards, one at a time, headless, inside the window.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { awayQueue, ensureCardDir, loadBoard, recoverRunning, updateBoard, getCard, type Card, type Checks, type RunStatus } from './board.js';
import type { Config } from './config.js';
import { formatDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { homePath } from './home.js';
import { windowView, type Snapshot } from './quota.js';
import type { Runner } from './runner.js';
import type { Workspace } from './workspace.js';
import { recordRun, usedBetween } from './costs.js';
import { applyPermissions, type RunNeeds } from './permissions.js';
import { tasteForPrompt } from './taste.js';
import { boxTempDirs, type Verified } from './verify.js';

/** Don't start a card with less than this much time left in the away run. */
export const MIN_CARD_MS = 2 * 60_000;
/** After a 5-hour reset, wait this much longer before carrying on (the new window needs a moment to show up). */
export const RESET_WAIT_MARGIN_MS = 2 * 60_000;

export function safetyRules(workdir: string): string {
  return `You are running unattended while the user is away. Nobody can answer questions. Rules:
1. Work only inside this directory: ${workdir}. Don't read or change files outside it.
2. Nothing outward: no git push, merge, rebase or pull request; no sending email or messages, no posting,
   no publishing packages, no purchases, no changes to remote services.
3. If you need a decision only the user can make, stop and write the question(s) to QUESTIONS.md in this
   directory, with the options you see and your recommendation. Don't guess on anything irreversible.
4. Stay inside the blueprint's scope. If this is a git repo, commit your work to the current branch: that is
   always allowed, even if the blueprint says otherwise, because the branch is how the user reviews and undoes it.
   Don't commit QUESTIONS.md.
5. Check your work the way the blueprint says (run the tests if there are any). Shell commands run in a
   sandbox, so local commands like tests and scripts are fine. The sandbox has no network: don't install or
   download anything (no npm install/ci, pip install, brew, curl). Dependencies the repo already has installed
   are in place. If a check can't run without a download, don't retry it: say so in the CHECKS line.
6. End with a short summary: what you made, where it is, and how to check it. The very last line must be
   exactly one of:
   CHECKS: passed — <what you ran>
   CHECKS: failed — <what fails, and whether it failed before your change>
   CHECKS: not run — <why you couldn't check>`;
}

/** Claude Code sandbox settings for an away run: writes only in the card's folder (+ its repo's .git), no network. */
/**
 * Build tools keep caches in your home folder (Go in ~/Library/Caches/go-build, npm in ~/.npm), which the
 * sandbox blocks. Point them at one Chompyy cache folder the sandbox allows, so tests and builds work.
 */
export function cacheEnv(dir: string): Record<string, string> {
  return {
    GOCACHE: `${dir}/go-build`,
    GOMODCACHE: `${dir}/go-mod`,
    GOFLAGS: '-modcacherw',
    npm_config_cache: `${dir}/npm`,
    PIP_CACHE_DIR: `${dir}/pip`,
    XDG_CACHE_HOME: dir,
    CLANG_MODULE_CACHE_PATH: `${dir}/clang-module-cache`,
  };
}

export function sandboxSettings(ws: Workspace, allowedDomains: string[], cacheDir?: string, denyRead: string[] = []): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true, // refuse to run rather than run unprotected
      allowUnsandboxedCommands: false, // no retrying outside the sandbox
      filesystem: { allowWrite: [...(ws.gitDir ? [ws.gitDir] : []), ...(cacheDir ? [cacheDir] : []), ...boxTempDirs()], ...(denyRead.length ? { denyRead } : {}) },
      network: { allowedDomains },
      // Commands are confined by the sandbox, so local ones (tests, scripts) run without a prompt.
      // The deny list still blocks outward commands (push, publish, curl, …).
      autoAllowBashIfSandboxed: true,
    },
  };
}

/** Read rules for the file tools: the sandbox's denyRead only covers shell commands. */
export function denyReadRules(paths: string[]): string[] {
  return paths.flatMap((p) => [`Read(${p})`, `Read(${p}/**)`]);
}

export function taskPrompt(card: Card, workdir: string, taste = '', checks: { dir: string; label: string }[] = []): string {
  return `${safetyRules(workdir)}
${checks.length ? `
# How to check this repo (Chompyy ran these on main in this same sandbox: they pass here)

${checks.map((c) => `- in ${c.dir || 'the top folder'}: \`${c.label}\``).join('\n')}

Run these, exactly as written. If one fails after your change, it's your change.
After you finish, Chompyy runs them again itself and compares the result with main. So CHECKS: failed means
your change broke something. If a check can't run at all (a permission or sandbox error, a missing download),
that is not your change: write CHECKS: not run, with the error.
` : ''}${taste ? `
# How this user likes work done (their taste.md; follow it unless the blueprint says otherwise)

${taste}
` : ''}
# Task #${card.id}: ${card.title}

Original idea: ${card.idea}

# Blueprint (agreed scope)

${card.blueprint ?? ''}
${card.answers?.length ? `
# Your earlier questions have been answered

The previous run left QUESTIONS.md. The user's answers:

${card.answers.map((a) => a.text).join('\n\n')}

Continue from the work already in this folder. Delete QUESTIONS.md once it's resolved.
` : ''}`;
}

export interface AwayDeps {
  runner: Runner;
  config: Config;
  now: () => number;
  snapshot: () => Snapshot | null;
  /** Plan the workspace without side effects (dry run). */
  plan: (card: Card) => Workspace;
  prepare: (card: Card) => Workspace;
  out: (line: string) => void;
  /** After a run: commit what the agent left uncommitted (worktrees only). */
  commitLeftovers?: (ws: Workspace, card: Card) => boolean;
  /** Before each card: read fresh quota, so the gate sees what earlier cards used. */
  refreshQuota?: () => Promise<void>;
  /** Sleep (for waiting out a 5-hour reset during a long away run). Unset = stop instead of waiting. */
  wait?: (ms: number) => Promise<void>;
  /** taste.md as agents should read it; defaults to the real one. */
  taste?: () => string;
  /** Remember what a run was blocked on, for the repo's next permission plan. */
  recordNeeds?: (card: Card, needs: RunNeeds) => void;
  /** The checks preflight proved pass in the box for this card's repo (research/away-readiness.md). */
  repoChecks?: (card: Card) => { dir: string; label: string }[];
  /** After a run: Chompyy runs the repo's tests itself (worktrees only). */
  verify?: (ws: Workspace, card: Card) => Promise<Verified | undefined>;
  /**
   * Run one card in its own process (\`chompyy run-card\`), so a card that crashes or hangs Chompyy ends only that
   * card and the queue goes on. Unset = in this process (tests).
   */
  isolate?: (id: string, timeoutMs: number, trigger?: string) => Promise<{ exitCode: number | null; signal?: string | null; stderr: string }>;
}

export interface AwayOptions {
  dryRun?: boolean;
  /** Skip the budget gate (still respects the duration). */
  force?: boolean;
  /** What started the run, e.g. "last-hour" or "bedtime"; recorded on each card's run. */
  trigger?: string;
}

export interface AwaySummary {
  ran: string[];
  skipped: string[];
  stoppedBecause: string | null;
}

/** The agent's own verdict on its checks: the last "CHECKS: passed|failed|not run — why" line. */
export function parseChecks(output: string): Checks | undefined {
  const matches = [...output.matchAll(/^\s*\**CHECKS:\**\s*(passed|failed|not run)\s*[—–:-]*\s*(.*)$/gim)];
  const last = matches.at(-1);
  if (!last) return undefined;
  return { result: last[1]!.toLowerCase() as Checks['result'], why: last[2]!.trim() };
}

function firstLines(text: string, n = 5): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(0, n)
    .join('\n');
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

/** When quota was last read after a card (module state: one away run per process). */
let lastRefreshMs = -Infinity;

export async function away(durationMs: number, deps: AwayDeps, opts: AwayOptions = {}): Promise<AwaySummary> {
  const { config, out } = deps;
  const start = deps.now();
  const deadline = start + durationMs;
  lastRefreshMs = -Infinity;
  if (!opts.dryRun) {
    const recovered = updateBoard((b) => recoverRunning(b, new Date(deps.now()), deps.plan));
    if (recovered.length) out(`Moved to review after an interrupted run: ${recovered.map((id) => `#${id}`).join(', ')}`);
  }
  const queue = awayQueue(loadBoard());
  const summary: AwaySummary = { ran: [], skipped: [], stoppedBecause: null };

  if (queue.length === 0) {
    out('No approved cards. Approve one with `chompyy approve <id>`.');
    return summary;
  }
  out(`${opts.dryRun ? 'Plan' : 'Away'} for ${formatDuration(durationMs)}: ${queue.length} approved card(s), one at a time, ${config.cardTimeoutMin}m max each.`);

  for (const queued of queue) {
    const remaining = deadline - deps.now();
    if (!opts.dryRun && remaining < MIN_CARD_MS) {
      summary.stoppedBecause = 'time is up';
      break;
    }
    // The previous card already read quota when it finished; don't ask twice in a row.
    if (!opts.dryRun && deps.refreshQuota && deps.now() - lastRefreshMs > 60_000) await deps.refreshQuota();
    let gate = budgetGate(deps.snapshot(), config, new Date(deps.now()));
    // The 5-hour window ran low but the run has time left (going to sleep): wait for the reset and carry on,
    // instead of stopping at 23:40 and leaving the night unused. Weekly limits still stop it.
    while (!gate.ok && !opts.force && !opts.dryRun && deps.wait) {
      const five = windowView(deps.snapshot()?.fiveHour, new Date(deps.now()));
      const onlyFiveHour = gate.reasons.every((r) => r.startsWith('5h window'));
      if (!onlyFiveHour || !five.known) break;
      const wakeAt = five.resetsAt * 1000 + RESET_WAIT_MARGIN_MS;
      if (wakeAt + MIN_CARD_MS > deadline) break;
      out(`  ⏸ ${gate.reasons.join('; ')}. Waiting for the 5-hour window to reset at ${new Date(five.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, then carrying on.`);
      await deps.wait(wakeAt - deps.now());
      if (deps.refreshQuota) {
        await deps.refreshQuota().catch(() => {});
        lastRefreshMs = deps.now();
      }
      gate = budgetGate(deps.snapshot(), config, new Date(deps.now()));
    }
    if (!gate.ok && !opts.force) {
      summary.stoppedBecause = gate.reasons.join('; ');
      break;
    }

    if (opts.dryRun) {
      const ws = deps.plan(queued);
      out(`  would run #${queued.id} ${queued.title}`);
      out(`      in ${ws.kind === 'worktree' ? `worktree ${ws.dir} (branch ${ws.branch})` : `draft folder ${ws.dir}`}`);
      summary.ran.push(queued.id);
      continue;
    }

    const timeoutMs = Math.min(config.cardTimeoutMin * 60_000, remaining);
    summary.ran.push(deps.isolate ? await runIsolated(queued.id, timeoutMs, deps, opts.trigger) : await runCard(queued.id, timeoutMs, deps, opts.trigger));
  }

  const notRun = queue.map((c) => c.id).filter((id) => !summary.ran.includes(id));
  summary.skipped = notRun;
  if (summary.stoppedBecause) out(`${opts.dryRun ? 'Would stop' : 'Stopped'}: ${summary.stoppedBecause}.`);
  if (notRun.length) out(`Left in approved: ${notRun.map((id) => `#${id}`).join(', ')}`);
  if (opts.dryRun) out('Dry run: nothing was started.');
  else out(`Done. ${summary.ran.length} card(s) in review. See \`chompyy report\`.`);
  return summary;
}

/** Where a card's agent pid is kept while it runs, so the supervisor can stop it if the worker dies. */
export const agentPidPath = (id: string) => homePath('runs', id, 'agent.pid');

/** Run a card in a worker process; if the worker dies mid-card, stop its agent and put the card in review. */
async function runIsolated(id: string, timeoutMs: number, deps: AwayDeps, trigger?: string): Promise<string> {
  let res: { exitCode: number | null; signal?: string | null; stderr: string };
  try {
    res = await deps.isolate!(id, timeoutMs, trigger);
  } catch (err) {
    res = { exitCode: null, stderr: String(err instanceof Error ? err.message : err) };
  }
  // An orphaned agent would keep working (and spending) alongside the next card.
  const pid = Number(existsSync(agentPidPath(id)) ? readFileSync(agentPidPath(id), 'utf8') : NaN);
  if (pid > 0) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {}
  }
  rmSync(agentPidPath(id), { force: true });
  if (getCard(loadBoard(), id).column !== 'running') return id;
  const how = res.signal ? `was killed (${res.signal})` : `exited with code ${res.exitCode}`;
  const tail = res.stderr.trim().split('\n').filter((l) => !/^\s*\d+: 0x/.test(l)).slice(-3).join(' ').slice(0, 300);
  const why = `Chompyy's worker for this card ${how} before it finished${tail ? `: ${tail}` : ''}.`;
  updateBoard((b) => recoverRunning(b, new Date(deps.now()), deps.plan, why));
  deps.out(`  ⛔ #${id}: ${why} Moving on to the next card.`);
  return id;
}

export async function runCard(id: string, timeoutMs: number, deps: AwayDeps, trigger?: string): Promise<string> {
  const { config, out } = deps;
  const startedMs = deps.now();
  const quotaBefore = deps.snapshot();
  const card = updateBoard((b) => {
    const c = getCard(b, id);
    c.column = 'running';
    c.updatedAt = new Date(startedMs).toISOString();
    return { ...c };
  });
  out(`▶ #${card.id} ${card.title} (up to ${formatDuration(timeoutMs)})`);

  // Run output lives in the card's folder, under its workspace: <store>/<workspace>/<id>/.
  const logPath = join(ensureCardDir(card), `${stamp(startedMs)}.log`);
  let ws: Workspace | null = null;
  let status: RunStatus;
  let exitCode: number | null = null;
  let summaryText = '';
  let checks: Checks | undefined;
  let verified: Verified | undefined;
  let log = '';

  try {
    ws = deps.prepare(card);
    if (ws.base) out(`  from ${ws.base.ref} @ ${ws.base.commit.slice(0, 7)}`);
    for (const s of ws.setup ?? []) if (s.source !== 'kept') out(`  deps in ${s.dir}: ${s.source}${s.note ? ` (${s.note})` : ''}`);
    const granted = applyPermissions(card.permissions);
    if (card.permissions?.length) out(`  allowed for this card: ${card.permissions.join(', ')}`);
    const prompt = taskPrompt(card, ws.dir, (deps.taste ?? tasteForPrompt)(), deps.repoChecks?.(card) ?? []);
    const cacheDir = homePath('cache', 'tools');
    mkdirSync(cacheDir, { recursive: true });
    const questionsPath = join(ws.dir, 'QUESTIONS.md');
    const questionsBefore = existsSync(questionsPath) ? readFileSync(questionsPath, 'utf8') : null;
    const result = await deps.runner.run({
      prompt,
      cwd: ws.dir,
      timeoutMs,
      model: config.runModel,
      maxTurns: config.maxTurns,
      permissionMode: config.permissionMode,
      permissionPrompts: config.permissionPrompts,
      allowedTools: [...config.allowedTools, ...granted.allowedTools],
      disallowedTools: [...config.disallowedTools, ...denyReadRules(config.denyReadPaths)],
      ...(config.sandbox ? { settings: sandboxSettings(ws, [...config.sandboxAllowedDomains, ...granted.domains], cacheDir, config.denyReadPaths) } : {}),
      env: cacheEnv(cacheDir),
      extraArgs: config.extraArgs,
      ...(config.loopRepeat > 0 ? { loopRepeat: config.loopRepeat } : {}),
      ...(config.idleTimeoutMin > 0 ? { idleTimeoutMs: config.idleTimeoutMin * 60_000 } : {}),
      ...(config.maxDenied > 0 ? { maxDenied: config.maxDenied } : {}),
      onSpawn: (pid) => writeFileSync(agentPidPath(card.id), String(pid)),
      // The whole stream (every tool call and result) goes to disk, never into memory: what to read when a run goes wrong.
      rawLogPath: logPath.replace(/\.log$/, '.stream.jsonl'),
    });
    rmSync(agentPidPath(card.id), { force: true });
    exitCode = result.exitCode;
    if (result.needs) {
      try {
        deps.recordNeeds?.(card, result.needs);
      } catch {}
      out(`  blocked on: ${[...result.needs.commands, ...result.needs.hosts].join(', ')} (offered on the next blueprint here)`);
    }
    try {
      if (deps.commitLeftovers?.(ws, card)) out('  (committed changes the agent left uncommitted)');
    } catch (err) {
      out(`  couldn't commit leftover changes: ${err instanceof Error ? err.message : err}`);
    }
    const hasQuestions = existsSync(questionsPath) && readFileSync(questionsPath, 'utf8') !== questionsBefore;
    status = result.stuck || result.stalled ? 'stuck' : result.timedOut ? 'timeout' : result.exitCode !== 0 ? 'failed' : hasQuestions ? 'questions' : 'ok';
    if (result.stuck) out(`  ⛔ stopped: it was going in circles (${result.stuck})`);
    if (result.stalled) out(`  ⛔ stopped: ${result.stalled}`);
    checks = parseChecks(result.output);
    if (deps.verify && ws.kind === 'worktree' && !result.stuck && !result.timedOut && result.exitCode === 0) {
      out('  checking it independently (running the repo\'s tests, sandboxed)…');
      verified = await deps.verify(ws, card).catch(() => undefined);
      if (verified) out(`  ${verified.result === 'passed' ? '✓' : verified.result === 'failed' ? '✗' : '·'} ${verified.why}`);
    }
    summaryText = result.stuck
      ? `Stopped by Chompyy: it was going in circles (${result.stuck}).`
      : result.stalled
      ? `Stopped by Chompyy: ${result.stalled} (a hung command or a stalled agent), so the next card could run.`
      : firstLines(result.output.replace(/^\s*CHECKS:.*$/gim, '')) || firstLines(result.stderr);
    log = `# prompt\n\n${prompt}\n\n# output\n\n${result.output}\n\n# stderr\n\n${result.stderr}\n`;
  } catch (err) {
    status = 'error';
    summaryText = String(err instanceof Error ? err.message : err);
    log = `# error\n\n${summaryText}\n`;
  }

  const finishedMs = deps.now();
  // What the card cost, in points of your windows: quota after minus before (an upper bound if you were busy too).
  if (deps.refreshQuota) {
    await deps.refreshQuota().catch(() => {});
    lastRefreshMs = deps.now();
  }
  const quotaAfter = deps.snapshot();
  const cost = {
    fiveHourPct: usedBetween(quotaBefore?.fiveHour, quotaAfter?.fiveHour),
    weeklyPct: usedBetween(quotaBefore?.sevenDay, quotaAfter?.sevenDay),
  };
  const header = `card #${card.id} · ${status} · exit ${exitCode} · ${formatDuration(finishedMs - startedMs)}\nworkdir: ${ws?.dir ?? '-'}${ws?.branch ? `\nbranch: ${ws.branch}` : ''}\n\n`;
  writeFileSync(logPath, header + log);

  updateBoard((b) => {
    const c = getCard(b, id);
    c.column = 'review';
    c.updatedAt = new Date(finishedMs).toISOString();
    c.logPath = logPath;
    c.run = {
      status,
      startedAt: new Date(startedMs).toISOString(),
      finishedAt: new Date(finishedMs).toISOString(),
      durationMs: finishedMs - startedMs,
      exitCode,
      workdir: ws?.dir ?? '',
      ...(ws?.branch ? { branch: ws.branch } : {}),
      ...(ws?.base ? { base: ws.base } : {}),
      summary: summaryText,
      ...(checks ? { checks } : {}),
      cost,
      ...(verified ? { verified } : {}),
      ...(trigger ? { trigger } : {}),
    };
  });
  recordRun({
    at: new Date(finishedMs).toISOString(),
    card: card.id,
    title: card.title,
    idea: card.idea,
    cwd: card.cwd,
    status,
    durationMs: finishedMs - startedMs,
    ...cost,
  });
  out(`  → ${status} · ${formatDuration(finishedMs - startedMs)}${cost.fiveHourPct !== null ? ` · used ${cost.fiveHourPct}% of the 5h window` : ''} · log ${logPath}`);
  return card.id;
}
