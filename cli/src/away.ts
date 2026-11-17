// Away run (spec §5.2, §5.5, §5.6): approved cards, one at a time, headless, inside the window.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { awayQueue, loadBoard, recoverRunning, updateBoard, getCard, type Card, type Checks, type RunStatus } from './board.js';
import type { Config } from './config.js';
import { formatDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { homePath } from './home.js';
import type { Snapshot } from './quota.js';
import type { Runner } from './runner.js';
import type { Workspace } from './workspace.js';
import { recordRun, usedBetween } from './costs.js';
import { tasteForPrompt } from './taste.js';

/** Don't start a card with less than this much time left in the away run. */
export const MIN_CARD_MS = 2 * 60_000;

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
   sandbox, so local commands like tests and scripts are fine.
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
  };
}

export function sandboxSettings(ws: Workspace, allowedDomains: string[], cacheDir?: string): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true, // refuse to run rather than run unprotected
      allowUnsandboxedCommands: false, // no retrying outside the sandbox
      filesystem: { allowWrite: [...(ws.gitDir ? [ws.gitDir] : []), ...(cacheDir ? [cacheDir] : [])] },
      network: { allowedDomains },
      // Commands are confined by the sandbox, so local ones (tests, scripts) run without a prompt.
      // The deny list still blocks outward commands (push, publish, curl, …).
      autoAllowBashIfSandboxed: true,
    },
  };
}

export function taskPrompt(card: Card, workdir: string, taste = ''): string {
  return `${safetyRules(workdir)}
${taste ? `
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
  /** taste.md as agents should read it; defaults to the real one. */
  taste?: () => string;
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
    const recovered = updateBoard((b) => recoverRunning(b, new Date(deps.now())));
    if (recovered.length) out(`Put back in approved after an interrupted run: ${recovered.map((id) => `#${id}`).join(', ')}`);
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
    const gate = budgetGate(deps.snapshot(), config, new Date(deps.now()));
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

    summary.ran.push(await runCard(queued.id, Math.min(config.cardTimeoutMin * 60_000, remaining), deps, opts.trigger));
  }

  const notRun = queue.map((c) => c.id).filter((id) => !summary.ran.includes(id));
  summary.skipped = notRun;
  if (summary.stoppedBecause) out(`${opts.dryRun ? 'Would stop' : 'Stopped'}: ${summary.stoppedBecause}.`);
  if (notRun.length) out(`Left in approved: ${notRun.map((id) => `#${id}`).join(', ')}`);
  if (opts.dryRun) out('Dry run: nothing was started.');
  else out(`Done. ${summary.ran.length} card(s) in review. See \`chompyy report\`.`);
  return summary;
}

async function runCard(id: string, timeoutMs: number, deps: AwayDeps, trigger?: string): Promise<string> {
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

  const logPath = homePath('runs', card.id, `${stamp(startedMs)}.log`);
  let ws: Workspace | null = null;
  let status: RunStatus;
  let exitCode: number | null = null;
  let summaryText = '';
  let checks: Checks | undefined;
  let log = '';

  try {
    ws = deps.prepare(card);
    const prompt = taskPrompt(card, ws.dir, (deps.taste ?? tasteForPrompt)());
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
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      ...(config.sandbox ? { settings: sandboxSettings(ws, config.sandboxAllowedDomains, cacheDir) } : {}),
      env: cacheEnv(cacheDir),
      extraArgs: config.extraArgs,
    });
    exitCode = result.exitCode;
    try {
      if (deps.commitLeftovers?.(ws, card)) out('  (committed changes the agent left uncommitted)');
    } catch (err) {
      out(`  couldn't commit leftover changes: ${err instanceof Error ? err.message : err}`);
    }
    const hasQuestions = existsSync(questionsPath) && readFileSync(questionsPath, 'utf8') !== questionsBefore;
    status = result.timedOut ? 'timeout' : result.exitCode !== 0 ? 'failed' : hasQuestions ? 'questions' : 'ok';
    checks = parseChecks(result.output);
    summaryText = firstLines(result.output.replace(/^\s*CHECKS:.*$/gim, '')) || firstLines(result.stderr);
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
      summary: summaryText,
      ...(checks ? { checks } : {}),
      cost,
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
