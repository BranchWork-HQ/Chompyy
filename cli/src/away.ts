// Away run (spec §5.2, §5.5, §5.6): approved cards, one at a time, headless, inside the window.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { awayQueue, loadBoard, recoverRunning, updateBoard, getCard, type Card, type RunStatus } from './board.js';
import type { Config } from './config.js';
import { formatDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { homePath } from './home.js';
import type { Snapshot } from './quota.js';
import type { Runner } from './runner.js';
import type { Workspace } from './workspace.js';

/** Don't start a card with less than this much time left in the away run. */
export const MIN_CARD_MS = 2 * 60_000;

export function safetyRules(workdir: string): string {
  return `You are running unattended while the user is away. Nobody can answer questions. Rules:
1. Work only inside this directory: ${workdir}. Don't read or change files outside it.
2. Nothing outward: no git push, merge, rebase or pull request; no sending email or messages, no posting,
   no publishing packages, no purchases, no changes to remote services.
3. If you need a decision only the user can make, stop and write the question(s) to QUESTIONS.md in this
   directory, with the options you see and your recommendation. Don't guess on anything irreversible.
4. Stay inside the blueprint's scope. Commit your work to the current branch if this is a git repo.
5. End with a short summary: what you made, where it is, and how to check it.`;
}

export function taskPrompt(card: Card, workdir: string): string {
  return `${safetyRules(workdir)}

# Task #${card.id}: ${card.title}

Original idea: ${card.idea}

# Blueprint (agreed scope)

${card.blueprint ?? ''}
`;
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
}

export interface AwayOptions {
  dryRun?: boolean;
  /** Skip the budget gate (still respects the duration). */
  force?: boolean;
}

export interface AwaySummary {
  ran: string[];
  skipped: string[];
  stoppedBecause: string | null;
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

export async function away(durationMs: number, deps: AwayDeps, opts: AwayOptions = {}): Promise<AwaySummary> {
  const { config, out } = deps;
  const start = deps.now();
  const deadline = start + durationMs;
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

    summary.ran.push(await runCard(queued.id, Math.min(config.cardTimeoutMin * 60_000, remaining), deps));
  }

  const notRun = queue.map((c) => c.id).filter((id) => !summary.ran.includes(id));
  summary.skipped = notRun;
  if (summary.stoppedBecause) out(`${opts.dryRun ? 'Would stop' : 'Stopped'}: ${summary.stoppedBecause}.`);
  if (notRun.length) out(`Left in approved: ${notRun.map((id) => `#${id}`).join(', ')}`);
  if (opts.dryRun) out('Dry run: nothing was started.');
  else out(`Done. ${summary.ran.length} card(s) in review. See \`chompyy report\`.`);
  return summary;
}

async function runCard(id: string, timeoutMs: number, deps: AwayDeps): Promise<string> {
  const { config, out } = deps;
  const startedMs = deps.now();
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
  let log = '';

  try {
    ws = deps.prepare(card);
    const prompt = taskPrompt(card, ws.dir);
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
      extraArgs: config.extraArgs,
    });
    exitCode = result.exitCode;
    const hasQuestions = existsSync(questionsPath) && readFileSync(questionsPath, 'utf8') !== questionsBefore;
    status = result.timedOut ? 'timeout' : result.exitCode !== 0 ? 'failed' : hasQuestions ? 'questions' : 'ok';
    summaryText = firstLines(result.output) || firstLines(result.stderr);
    log = `# prompt\n\n${prompt}\n\n# output\n\n${result.output}\n\n# stderr\n\n${result.stderr}\n`;
  } catch (err) {
    status = 'error';
    summaryText = String(err instanceof Error ? err.message : err);
    log = `# error\n\n${summaryText}\n`;
  }

  const finishedMs = deps.now();
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
    };
  });
  out(`  → ${status} · ${formatDuration(finishedMs - startedMs)} · log ${logPath}`);
  return card.id;
}
