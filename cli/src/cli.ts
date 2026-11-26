#!/usr/bin/env node
// chompyy: park ideas, blueprint them, run approved cards while you're away.
import { execFileSync, spawn } from 'node:child_process';
import { backfillTokens, median } from './tokenstore.js';
import { compact, formatTokens, totalTokens } from './tokens.js';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { away, cacheEnv, runCard, type AwayDeps } from './away.js';
import { formatPreflight, loadProfile, preflight, saveProfile } from './preflight.js';
import { verifyCard } from './verifycard.js';
import { parsePermission, recordNeeds } from './permissions.js';
import { draftAllPlan, draftBlueprint, draftFiveStarOptions, draftTitle, GENERIC_FIVE_STAR, isUsageLimit, writeBlueprintFile } from './blueprint.js';
import { addCard, awayQueue, claimDrafts, COLUMNS, dropCard, expireSuggested, formatBoard, formatCard, getCard, loadBoard, moveCard, noteDraftFailure, quotaWaitReason, recoverRunning, titleFrom, updateBoard, type Column } from './board.js';
import { loadConfig, setConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { chompyyHome, homePath } from './home.js';
import { loadSnapshot, mergeSnapshot, parseStatusline, saveSnapshot, statusLineText, statusText as baseStatusText, windowView, type Snapshot } from './quota.js';
import { loadSamples } from './pacing.js';
import { cardsSince, formatReport, lastReportAt, markReported, morningLine, rateCard, readTaste } from './report.js';
import { changedFiles, diffCard, keepCard, overlaps, questionsOf, undoCard } from './review.js';
import { CappedText, ClaudeRunner, claudeAvailable } from './runner.js';
import { branchOf, commitLeftovers, gitRoot, planWorkspace, prepareWorkspace } from './workspace.js';
import { answerCard, appState, cardView, currentBranch, editBlueprint, editIdea, recordCliLocation } from './appstate.js';
import { detect, detectText } from './detect.js';
import { allWindowEnds, archiveWindowEnds, premise, premiseText } from './premise.js';
import { keychainAllowed, loadLiveState, refreshLiveQuota } from './livequota.js';
import { recentProjects } from './projects.js';
import { cliVersion, installApp } from './macapp.js';
import { buildDigest, historyRetention, scanHistory } from './history.js';
import { acceptColdStart, forgetColdStart, formatColdStart, loadColdStart, runColdStart } from './coldstart.js';
import { keepHistory } from './claudesettings.js';
import { blueprintHash, drawPicture } from './picture.js';
import { costRange, formatCostRange, readRuns, trendLines } from './costs.js';
import {
  answerPreference, distill, distillDue, formatPrefs, formatQuestion, formatWhy, getPref, loadStore, nextQuestion,
  readSignals, recordOutcome, retirePreference, syncTasteFile, tasteChangesSince, type Answer,
} from './taste.js';
import { cachedWorkspaces, dream, dreamDue, formatDream, formatWorkspaces, projectsDir, readLogPath, setTicked } from './dream.js';
import { byKind, compare, formatExtras, formatUsage, loadLedger, periodDays, PERIODS, prCosts, usageView, type Period } from './usage.js';
import { formatTrace, traceSession } from './trace.js';
import { homedir } from 'node:os';
import { clashOf, refreshCard, refreshGate, refreshClashing, withRefreshLock, type RefreshDeps } from './refresh.js';
import { adviseText, applyDue, approveAdvice, runAdvise, undoAdvice } from './advice.js';
import { coldWarningText, hookCommand, impact, nudgeInstalled, nudgeText, outcomes, runHook, setNudge, takeGoingCold } from './nudge.js';
import { formatLive, keepAffectsLive, liveOff, liveSet, liveUpdateLocked, loadLive, startLiveUpdate } from './live.js';
import { agentInstalled, awayRunning, bedtimeKey, decideTrigger, installAgent, loadTriggerState, markFired, noteTick, parseClock, takeAwayLock, uninstallAgent } from './triggers.js';

const HELP = `chompyy: use the 5-hour window capacity that would reset unused

Quota
  chompyy statusline            Claude Code statusLine command: reads JSON on stdin, saves a snapshot
  chompyy status                % left, time to reset, pace, weekly used, staleness
  chompyy quota [--refresh]     read live quota from Anthropic now (uses Claude Code's saved login; sends no message)
  chompyy quota --allow-keychain | --no-keychain   allow (or stop) reading that login from the macOS Keychain
  chompyy detect [--days 30] [--all] [--json]   what wastes tokens in your setup and habits, ranked, on one screen (--all: evidence and every fix)
  chompyy advise [--json]       turn detect's findings into suggested cards to approve or drop: settings changes are
                                applied (backed up, undoable) once no Claude Code session is active; habits are tracked
  chompyy advise apply          apply approved settings advice now, if no session has been active for 10 minutes
  chompyy nudge on|off          live suggestions while you work: stops the first message to a big conversation
                                whose cache expired, with the price and the cheaper ways (Claude Code hook)
  chompyy nudge                 on or off, and what the stops saved
  chompyy nudge due [--json]    conversations 45-60 min into a pause, about to go cold (each reported once; the app notifies; only while nudge is on)
  chompyy premise [--json]      how often a 5-hour window reset with capacity left while the week still had room
  chompyy eat-tokens            show leftover quota and cards you could choose to run (read-only)

Board
  chompyy later "<idea>"        park an idea in later (blueprint drafted in the background)
        --no-blueprint            don't draft one   --wait   draft it now, in the foreground
  chompyy board [--column c]    cards by column (suggested later approved running review done)
  chompyy show <id>             one card: blueprint, last run, what the agent said
  chompyy blueprint <id>        (re)draft the blueprint with a cheap model  [--model haiku]
        --all-later               draft every later card that has no blueprint yet, one at a time
  chompyy picture <id>          (re)draw the card's picture: a diagram of what it will do (diagram-design skill)
  chompyy approve <id>          later → approved (needs a blueprint)
  chompyy edit-blueprint <id>   replace the blueprint with text from stdin
  chompyy edit-idea <id>        replace a later card's idea with text from stdin
  chompyy drop <id>             remove a card (kept in archive.jsonl)

Away
  chompyy away <1h|30m|1h30m>   run approved cards headless, one at a time, until the time is up
        --dry-run                 print the plan, start nothing
        --force                   skip the budget gate (the duration still holds)

Back
  chompyy report [--all]        what ran, and the one thing to do about each
  chompyy diff <id>             the change it made
  chompyy keep <id>             merge its branch into the branch it started from (and update the live app, if set)
  chompyy refresh [<id>]        bring cards in review up to date with main (Chompyy does this by itself after each Keep)
  chompyy undo <id>             throw it away (removes its branch; yours are untouched)
  chompyy answer <id>           answer the run's questions (stdin); the card goes back to approved
  chompyy redo <id>             throw this attempt away and run it again from your latest code
  chompyy rate <id> <1-5> ["why"] [--to-five "change" ...]   rate a result; --to-five = what would have made it a 5
  chompyy five-star <id>        options for "what would have made it a 5?" (JSON)
  chompyy signals [--json]      everything Chompyy has recorded from you: ratings, edits, answers
  chompyy tokens [--json]       exact tokens and API-value cost of each run
  chompyy trends                last 7 days vs the 7 before: cost per card, keep rate, rating, blueprint edits

Taste (learned from what you keep, undo, edit and rate)
  chompyy trace <id>            one conversation turn by turn: cost per turn, context size, what ate the tokens
  chompyy plan-price <usd|auto> what your plan costs a month, for "your plan did N× its price"
  chompyy usage [--period today|7d|30d|month]   tokens and API-value cost of every Claude Code conversation on this Mac
  chompyy dream                 the nightly read: learn how you like to work from your coding sessions
                                (--dry-run shows exactly what it would read; --since 3d to re-read)
  chompyy dream workspaces      the folders and apps it can read, ticked or not
  chompyy dream tick|untick <folder>   choose what it learns from (coding folders start ticked)
  chompyy taste                 show taste.md
  chompyy taste list            every preference: to ask, in taste.md, candidates, declined, retired
  chompyy taste why <id>        the cards, edits and quotes behind a preference
  chompyy taste yes|not-now|never <id>   answer a question (yes writes it to taste.md)
  chompyy taste retire <id>     stop using a preference (kept, with the reason)
  chompyy distill [--force]     read new signals and update preferences now (one model call; runs after away too)

Triggers (start away runs on their own; the budget gate still decides every card)
  chompyy triggers on|off       install or remove the macOS LaunchAgent that runs \`chompyy tick\` every 5 minutes
  chompyy triggers              what is set, and what the last tick decided
  chompyy bedtime <23:30|off>   run approved cards at bedtime (with the window that is left)
  chompyy last-hour <on|off>    run approved cards in the last hour before a 5-hour reset
  chompyy missed-reset <on|off> run approved cards on the first tick after a reset nothing used (default off)
  chompyy tick                  check the triggers once (what the LaunchAgent runs)

Get to know you (cold start)
  chompyy history [--digest]    what Chompyy would read from your Claude Code history (local; --digest = the exact text it would send)
  chompyy coldstart [--force]   read your history once and propose taste lines and suggested cards (one model call)
  chompyy coldstart show        the proposals    accept --taste t1,t2 --cards c1    forget
  chompyy keep-history <days>   keep Claude Code transcripts longer (cleanupPeriodDays; default 30)

App
  chompyy app                   install (or update) the Mac app in ~/Applications and open it
  chompyy live [set <repo>|update|off]   for Chompyy's own developers: the app runs from ~/.chompyy/live, which follows
                                main and rebuilds (CLI, and the app if its code changed) after every Keep on main
  chompyy version               this CLI's version
  chompyy projects [--json]     recent project folders (from Claude Code history and past cards)
  chompyy state --json          everything the Mac app shows, in one JSON (board, show, status also take --json)

State lives in ${chompyyHome()} (override with CHOMPYY_HOME).`;

/** `chompyy status` text with pacing: burn-rate history and your bedtime. */
function statusText(snap: Snapshot | null, now: Date): string {
  return baseStatusText(snap, now, { samples: loadSamples(), bedtime: loadConfig().bedtime });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function need(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`Usage: ${usage}`);
  return value;
}

async function blueprintCard(id: string, model?: string): Promise<string> {
  const config = loadConfig();
  const card = getCard(loadBoard(), id);
  try {
    const runner = new ClaudeRunner(config.claudeBin);
    const opts = {
      model: model ?? config.blueprintModel,
      // Run in the card's folder so the model can read the repo (read-only tools only).
      cwd: existsSync(card.cwd) ? card.cwd : chompyyHome(),
    };
    const text = await draftBlueprint(card, runner, opts);
    // Retitle only cards still named by the first words of the prompt: a title the model already wrote
    // (cold start, or an earlier draft) is kept, so redrafting a blueprint costs no extra call.
    const title = card.title === titleFrom(card.idea) ? await draftTitle(card, runner, opts) : card.title;
    updateBoard((b) => {
      const c = getCard(b, id);
      c.blueprint = text;
      c.title = title;
      delete c.blueprintError;
      delete c.blueprintWaiting;
      delete c.blueprintWaitUntil;
      delete c.draftingAt;
      writeBlueprintFile(c, text);
      c.updatedAt = new Date().toISOString();
    });
    if (config.pictures && windowActive(new Date())) await pictureCard(id).catch(() => {});
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateBoard((b) => noteDraftFailure(b, id, message, isUsageLimit(message), retryAfterLimit(new Date())));
    throw err;
  }
}

/** When to retry a draft that hit the usage limit: at the 5-hour reset if known, else in 30 minutes. */
function retryAfterLimit(now: Date): Date {
  const five = windowView(loadSnapshot()?.fiveHour, now);
  return five.known ? new Date(five.resetsAt * 1000) : new Date(now.getTime() + 30 * 60_000);
}

/** Draw (or redraw) a card's picture with the diagram-design skill. Errors are kept on the card. */
async function pictureCard(id: string, model?: string): Promise<string> {
  const config = loadConfig();
  const card = getCard(loadBoard(), id);
  updateBoard((b) => {
    getCard(b, id).drawingAt = new Date().toISOString();
  });
  try {
    const info = await drawPicture(card, new ClaudeRunner(config.claudeBin), { model: model ?? config.pictureModel, now: new Date() });
    updateBoard((b) => {
      const c = getCard(b, id);
      c.picture = info;
      delete c.pictureError;
      delete c.drawingAt;
    });
    return info.path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateBoard((b) => {
      const c = getCard(b, id);
      c.pictureError = message;
      delete c.drawingAt;
    });
    throw err;
  }
}

/** The agent's whole final message from the run log (the board keeps only its first lines). */
function fullOutput(card: { logPath?: string }): string | undefined {
  if (!card.logPath || !existsSync(card.logPath)) return undefined;
  const m = readFileSync(card.logPath, 'utf8').match(/# output\n\n([\s\S]*?)\n\n# stderr/);
  return m?.[1]?.trim().slice(0, 4000);
}

/** True when a 5-hour window is already running, so a model call uses it instead of starting a new one. */
function windowActive(now: Date): boolean {
  return windowView(loadSnapshot()?.fiveHour, now).known;
}

/** Why a draft must wait (the running window has 0% left), or null. A draft then would only hit the limit. */
function quotaEmpty(now: Date): string | null {
  return quotaWaitReason(windowView(loadSnapshot()?.fiveHour, now));
}

/**
 * Draft blueprints that are waiting, but only while a window is active: drafting is a model call, and
 * with no active window it would start a new 5-hour window. Called whenever quota is fresh.
 */
function draftPending(now: Date): void {
  const days = loadConfig().suggestedExpiryDays;
  if (days > 0 && loadBoard().cards.some((c) => c.column === 'suggested')) updateBoard((b) => expireSuggested(b, now, days));
  if (!windowActive(now) || !claudeAvailable(loadConfig().claudeBin)) return;
  // With 0% left the cards wait (and say so) instead of failing; they stay due and draft after the reset.
  const waiting = quotaEmpty(now);
  const ids = updateBoard((b) => claimDrafts(b, now, waiting));
  for (const id of ids) blueprintInBackground(id);

  // Pictures for cards whose blueprint is ready but not drawn yet, or changed since (an edit or a redraw).
  if (!loadConfig().pictures || waiting) return;
  const toDraw = updateBoard((b) => {
    const due = b.cards.filter(
      (c) =>
        ['suggested', 'later', 'approved'].includes(c.column) &&
        c.blueprint && !c.draftingAt && !c.pictureError && (!c.advice || c.advice.lane === 'work') &&
        (!c.picture || c.picture.blueprintHash !== blueprintHash(c.blueprint)) &&
        (!c.drawingAt || Date.parse(c.drawingAt) < now.getTime() - 6 * 60_000),
    );
    for (const c of due) c.drawingAt = now.toISOString();
    return due.map((c) => c.id);
  });
  for (const id of toDraw) inBackground(['picture', id, '--quiet']);
}

function inBackground(args: string[]): void {
  const child = spawn(process.execPath, [process.argv[1]!, ...args], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
}

/** Draft the blueprint in a detached child so `later` returns at once. */
function blueprintInBackground(id: string): void {
  const child = spawn(process.execPath, [process.argv[1]!, 'blueprint', id, '--quiet'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

/** The nightly read, then distil: inside an active window only (a model call would otherwise start one). */
async function dreamNow(now: Date, opts: { force?: boolean; dryRun?: boolean; sinceMs?: number } = {}): Promise<string> {
  const config = loadConfig();
  if (opts.dryRun) {
    const r = await dream(new ClaudeRunner(config.claudeBin), { model: config.dreamModel, now, dryRun: true, sinceMs: opts.sinceMs });
    return `Would read ${r.sessions} session${r.sessions === 1 ? '' : 's'} (~${Math.round(r.readTokens / 1000)}k tokens) in ${r.chunks} call${r.chunks === 1 ? '' : 's'} with ${config.dreamModel}. Exactly what it would read: ${readLogPath(now)}`;
  }
  if (!opts.force && !windowActive(now)) return 'No active 5-hour window: reading now would start one. It runs after your next away, or add --force.';
  if (!claudeAvailable(config.claudeBin)) return `Can't find Claude Code (\`${config.claudeBin}\`).`;
  const r = await dream(new ClaudeRunner(config.claudeBin), { model: config.dreamModel, now, sinceMs: opts.sinceMs });
  const lines = [formatDream(r, config.dreamModel)];
  if (r.signals) lines.push(`Taste: ${await distillNow(new Date(), true)}`);
  lines.push(`What it read: ${readLogPath(now)}`);
  return lines.join('\n');
}

/** Distil taste from new signals, but only inside an active window (a model call would otherwise start one). */
async function distillNow(now: Date, force = false): Promise<string> {
  const config = loadConfig();
  if (!force && !windowActive(now)) return 'No active 5-hour window: distilling now would start one. It runs after your next away, or add --force.';
  if (!claudeAvailable(config.claudeBin)) return `Can't find Claude Code (\`${config.claudeBin}\`).`;
  const r = await distill(loadBoard(), new ClaudeRunner(config.claudeBin), { model: config.distillModel, cwd: chompyyHome(), now });
  if (!r.read) return 'No new signals to learn from.';
  const c = r.changes;
  const parts = [`${c.added.length} new`, `${c.extended.length} with more evidence`, `${c.ready.length} ready to ask`, `${c.retired.length} retired`];
  return `Read ${r.read} new signal(s): ${parts.join(', ')}${c.dropped ? ` (${c.dropped} thrown out for weak evidence)` : ''}. See \`chompyy taste list\`.`;
}

/** Keep a card: merge it, record it, update the live app, and bring the other cards in review up to date. */
function keepNow(id: string, now: Date): void {
  const kept = getCard(loadBoard(), id);
  console.log(keepCard(kept));
  updateBoard((b) => {
    const card = getCard(b, id);
    card.outcome = 'kept';
    card.column = 'done';
    delete card.keepWhenRefreshed;
    card.updatedAt = now.toISOString();
    recordOutcome(card, 'kept', now);
    return card;
  });
  // If this landed on what the app runs from, bring the app up to date by itself (live.ts).
  const landedOn = kept.run?.base?.branch ?? currentBranch(kept.cwd);
  if (keepAffectsLive(loadLive(), kept.cwd, landedOn)) {
    startLiveUpdate();
    console.log('Updating the app with it in the background: the CLI in seconds, the Mac app in 1–2 minutes if its code changed (`chompyy live` shows progress).');
  }
  // Main moved: cards still in review may clash with it now. Checking each one costs git time per card, so
  // that happens in the background job that also brings them up to date (refresh.ts); Keep returns at once.
  const waiting = loadBoard().cards.filter((c) => c.id !== id && c.column === 'review' && c.run?.branch);
  if (waiting.length) {
    startBackground(['refresh', '--clashing'], 'refresh.log');
    console.log(`Checking ${waiting.map((c) => '#' + c.id).join(', ')} against it in the background; any that clash get brought up to date.`);
  }
}

/** Run a chompyy command in the background, detached, so it outlives this process (and an app restart). */
function startBackground(args: string[], logName: string): void {
  const out = openSync(homePath(logName), 'a');
  spawn(process.execPath, [process.argv[1]!, ...args], { detached: true, stdio: ['ignore', out, out] }).unref();
  closeSync(out);
}

function refreshDeps(config: ReturnType<typeof loadConfig>, freshQuota: (force?: boolean) => Promise<unknown>): RefreshDeps {
  const a = awayDeps(config, freshQuota);
  return {
    runner: a.runner,
    config,
    now: () => new Date(),
    snapshot: loadSnapshot,
    out: (line) => console.log(`${new Date().toISOString().slice(0, 16)} ${line}`),
    ...(a.verify ? { verify: a.verify } : {}),
    ...(a.repoChecks ? { repoChecks: a.repoChecks } : {}),
    keep: (id) => keepNow(id, new Date()),
  };
}

/** An away run: one at a time (lock), then distil what the run taught, if anything. */
/** What an away run (and each card's worker) needs from the real world. */
function awayDeps(config: ReturnType<typeof loadConfig>, freshQuota: (force?: boolean) => Promise<unknown>): AwayDeps {
  return {
    runner: new ClaudeRunner(config.claudeBin),
    config,
    now: () => Date.now(),
    snapshot: loadSnapshot,
    plan: planWorkspace,
    prepare: prepareWorkspace,
    commitLeftovers,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
    recordNeeds: (card, needs) => {
      const root = gitRoot(card.cwd);
      if (!root) return;
      const p = loadProfile(root) ?? { root, checks: [], updatedAt: new Date().toISOString() };
      saveProfile({ ...p, needs: recordNeeds(p.needs ?? [], needs, card.id, new Date().toISOString()) });
    },
    repoChecks: (card) => {
      const root = gitRoot(card.cwd);
      const p = root ? loadProfile(root) : null;
      return (p?.preflight?.results ?? []).filter((r) => r.verdict === 'ready').map((r) => ({ dir: r.check.dir, label: r.check.label }));
    },
    refreshQuota: async () => {
      await freshQuota(true);
    },
    ...(config.independentCheck
      ? {
          verify: async (ws, card) => {
            // Chompyy's own measurement: the repo's checks on the card and on the main it started from.
            const root = gitRoot(card.cwd);
            const cacheDir = homePath('cache', 'tools');
            if (!root || ws.kind !== 'worktree') return undefined;
            const baseCommit = ws.base?.commit ?? execFileSync('git', ['-C', root, 'merge-base', 'HEAD', ws.branch!], { encoding: 'utf8' }).trim();
            return verifyCard({ root, dir: ws.dir, baseCommit, cacheDir, denyRead: config.denyReadPaths, timeoutMs: config.checkTimeoutMin * 60_000, now: () => new Date() });
          },
        }
      : {}),
    out: (line) => console.log(line),
  };
}

/** The supervisor's side of a worker: run `chompyy run-card` and wait, killing it if it outlives its card. */
function isolateCard(config: ReturnType<typeof loadConfig>) {
  return (id: string, timeoutMs: number, trigger?: string) =>
    new Promise<{ exitCode: number | null; signal: string | null; stderr: string }>((resolve) => {
      const args = [process.argv[1]!, 'run-card', id, '--timeout', String(timeoutMs), ...(trigger ? ['--trigger', trigger] : [])];
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'pipe'], env: process.env });
      const stderr = new CappedText(64 * 1024);
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (d: string) => {
        stderr.push(d);
        process.stderr.write(d);
      });
      // Watchdog: the card's cap, plus time for the independent check and committing, plus a margin.
      const limit = timeoutMs + (config.independentCheck ? config.checkTimeoutMin * 60_000 : 0) + 5 * 60_000;
      const dog = setTimeout(() => {
        child.kill('SIGTERM'); // the worker stops its agent's process group on SIGTERM
        setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
      }, limit);
      child.on('close', (code, signal) => {
        clearTimeout(dog);
        resolve({ exitCode: code, signal, stderr: stderr.toString() });
      });
      child.on('error', (err) => {
        clearTimeout(dog);
        resolve({ exitCode: null, signal: null, stderr: String(err) });
      });
    });
}

async function runAway(ms: number, opts: { dryRun?: boolean; force?: boolean; trigger?: string }, now: Date, freshQuota: (force?: boolean) => Promise<unknown>): Promise<void> {
  const config = loadConfig();
  const release = opts.dryRun ? () => {} : takeAwayLock(now, opts.trigger ?? 'away');
  try {
    await away(ms, { ...awayDeps(config, freshQuota), isolate: isolateCard(config) }, opts);
  } finally {
    release();
  }
  // After the cards (they come first): the nightly read of your everyday sessions, once a day.
  if (!opts.dryRun && config.dream && dreamDue(new Date())) {
    try {
      console.log(`Nightly read: ${await dreamNow(new Date())}`);
    } catch (err) {
      console.log(`Nightly read: couldn't run (${err instanceof Error ? err.message : err})`);
    }
  }
  if (!opts.dryRun && config.distillAfterAway && distillDue(loadBoard(), new Date(), 0)) {
    try {
      console.log(`Taste: ${await distillNow(new Date())}`);
    } catch (err) {
      console.log(`Taste: couldn't distil (${err instanceof Error ? err.message : err})`);
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'no-blueprint': { type: 'boolean' },
      'all-later': { type: 'boolean' },
      clashing: { type: 'boolean' },
      wait: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      all: { type: 'boolean' },
      quiet: { type: 'boolean' },
      model: { type: 'string' },
      column: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
      refresh: { type: 'boolean' },
      'allow-keychain': { type: 'boolean' },
      'no-keychain': { type: 'boolean' },
      'to-five': { type: 'string', multiple: true },
      digest: { type: 'boolean' },
      taste: { type: 'string' },
      cards: { type: 'string' },
      ref: { type: 'string' },
      allow: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      trigger: { type: 'string' },
      since: { type: 'string' },
      days: { type: 'string' },
      app: { type: 'boolean' },
      period: { type: 'string' },
    },
  });
  const [command, ...args] = values.help ? ["help"] : positionals;
  const now = new Date();
  const json = (data: unknown) => console.log(JSON.stringify(data, null, 2));
  // detect and premise only read: run once through npx, they must not point the app at npx's temporary copy.
  if (command !== 'statusline' && command !== 'detect' && command !== 'premise' && command !== 'hook') recordCliLocation();
  /** Fresh quota before anything that reads it (at most every 5 minutes unless forced). */
  const freshQuota = async (force = false) => {
    if (loadConfig().quotaSource !== 'api') return null;
    try {
      const config = loadConfig();
      return await refreshLiveQuota({ force, allowKeychain: keychainAllowed(config), keychainOff: config.allowKeychain === false });
    } catch {
      return null;
    }
  };

  switch (command) {
    case 'statusline': {
      // Must never fail loudly: it runs on every status bar refresh.
      try {
        const parsed = parseStatusline(await readStdin(), now);
        const snap = mergeSnapshot(loadSnapshot(), { ...parsed, ...(parsed.fiveHour || parsed.sevenDay ? { source: 'statusline' as const } : {}) });
        saveSnapshot(snap);
        console.log(statusLineText(snap, now, { samples: loadSamples(), color: true }));
      } catch {
        console.log('🍪');
      }
      return;
    }
    case 'status': {
      await freshQuota();
      draftPending(now);
      if (values.json) return json(appState(loadBoard(), loadSnapshot(), loadConfig(), now).quota);
      console.log(statusText(loadSnapshot(), now));
      return;
    }
    case 'quota': {
      if (values['allow-keychain']) setConfig('allowKeychain', true);
      if (values['no-keychain']) setConfig('allowKeychain', false);
      const r = await freshQuota(Boolean(values.refresh || values['allow-keychain']));
      if (r) console.log(r.message);
      else if (loadConfig().quotaSource !== 'api') console.log('quotaSource is "statusline" in config.json; live reading is off.');
      console.log(statusText(loadSnapshot(), now));
      return;
    }
    case 'state': {
      const refreshed = await freshQuota(Boolean(values.refresh));
      draftPending(now);
      // A card left in running by an away run that died shouldn't look like it's still working.
      if (!awayRunning() && loadBoard().cards.some((c) => c.column === 'running')) updateBoard((b) => recoverRunning(b, now, planWorkspace));
      // What the quota check just did, so the app's Refresh button can say it instead of looking dead.
      const quotaRefresh = values.refresh ? (refreshed ? { ok: refreshed.ok, message: refreshed.message } : { ok: false, message: 'Live quota reading is off (quotaSource in config.json).' }) : null;
      return json({ ...appState(loadBoard(), loadSnapshot(), loadConfig(), now), quotaRefresh });
    }
    case 'live': {
      const sub = args[0] ?? 'status';
      if (sub === 'set') {
        const live = liveSet(need(args[1], 'chompyy live set <your Chompyy checkout> [branch]'), args[2] ?? 'main');
        console.log(`Live copy at ${live.dir}, following ${live.branch}. Building it now…`);
        liveUpdateLocked();
        return console.log(formatLive(loadLive()));
      }
      if (sub === 'off') {
        liveOff();
        return console.log('The app no longer follows the live copy; it uses whichever chompyy CLI runs next.');
      }
      if (sub === 'update') {
        const state = liveUpdateLocked();
        if (!state) console.log('An update is already running; it will pick up the newest main when it finishes.');
        if (state?.error) process.exitCode = 1;
        return;
      }
      return console.log(formatLive(loadLive()));
    }
    case 'app': {
      console.log(`Downloading Chompyy ${cliVersion()} for Mac…`);
      const at = await installApp();
      console.log(`Installed ${at} and opened it. Look for the cookie in your menu bar.`);
      return;
    }
    case 'history': {
      const scan = scanHistory();
      if (values.digest) return console.log(buildDigest(scan.sessions).text || '(nothing to read)');
      const { included, text } = buildDigest(scan.sessions);
      const retention = historyRetention();
      const projects = [...new Set(scan.sessions.map((s) => s.project))];
      const info = {
        sessions: scan.sessions.length,
        projects: projects.length,
        projectNames: projects.map((p) => p.split('/').pop()),
        from: scan.from,
        to: scan.to,
        skipped: scan.skipped,
        digest: { sessions: included.length, chars: text.length },
        retention,
      };
      if (values.json) return json(info);
      console.log(`${info.sessions} interactive sessions in ${info.projects} projects, ${(scan.from ?? '').slice(0, 10)} to ${(scan.to ?? '').slice(0, 10)}`);
      console.log(`Skipped: ${scan.skipped.headless} headless runs, ${scan.skipped.temp} in temp folders, ${scan.skipped.empty} empty`);
      console.log(`Would send: the newest ${included.length} sessions, ${text.length} characters (see it: chompyy history --digest)`);
      console.log(`Claude Code keeps transcripts ${retention.days} days${retention.isDefault ? ' (default; raise it with chompyy keep-history 365)' : ''}`);
      return;
    }
    case 'coldstart': {
      const sub = args[0];
      if (sub === 'show') {
        const cs = loadColdStart();
        if (values.json) return json(cs);
        return console.log(cs ? formatColdStart(cs) : 'No cold start yet. Run `chompyy coldstart`.');
      }
      if (sub === 'accept') {
        const list = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        const r = acceptColdStart({ taste: list(values.taste), cards: list(values.cards) }, now);
        if (values.json) return json(r);
        console.log(`Added ${r.taste.length} taste line(s) to taste.md and ${r.cards.length} card(s) to suggested${r.cards.length ? ` (${r.cards.map((c) => `#${c.id}`).join(', ')})` : ''}.`);
        draftPending(now);
        return;
      }
      if (sub === 'forget') return console.log(forgetColdStart() ? 'Forgot the cold start proposals. Accepted taste lines stay in taste.md.' : 'Nothing to forget.');
      if (sub) throw new Error('Usage: chompyy coldstart [show|accept|forget]');
      await freshQuota();
      if (!values.force && !windowActive(now)) throw new Error('No active 5-hour window: reading your history would start one. Try again while you are using Claude Code, or add --force.');
      const config = loadConfig();
      if (!claudeAvailable(config.claudeBin)) throw new Error(`Can't find Claude Code (\`${config.claudeBin}\`).`);
      const cs = await runColdStart(scanHistory(), new ClaudeRunner(config.claudeBin), { model: config.coldStartModel, cwd: chompyyHome(), now, existing: loadBoard().cards.map((c) => c.title) });
      if (values.json) return json(cs);
      console.log(formatColdStart(cs));
      return;
    }
    case 'keep-history': {
      const days = Number(need(args[0], 'chompyy keep-history <days>'));
      if (!Number.isInteger(days) || days < 1) throw new Error('Days must be a whole number, e.g. 365.');
      const r = keepHistory(days);
      console.log(`Claude Code now keeps transcripts for ${days} days (was ${r.before ?? '30, the default'}). Changed ${r.path}.`);
      return;
    }
    case 'version':
      console.log(cliVersion());
      return;
    case 'projects': {
      const list = recentProjects(loadBoard());
      if (values.json) return json(list);
      for (const p of list) console.log(`${p.name.padEnd(28)} ${p.path}${p.isGit ? '' : '  (not a git repo)'}`);
      return;
    }
    case 'five-star': {
      // Options for "what would have made it a 5?", written for this card; cached on the card.
      const id = need(args[0], 'chompyy five-star <id>');
      const card = getCard(loadBoard(), id);
      if (card.fiveStarOptions?.length) return json(card.fiveStarOptions);
      await freshQuota();
      // A model call with no active window would start one, so fall back to generic options then.
      if (!windowActive(now) || !claudeAvailable(loadConfig().claudeBin)) return json(GENERIC_FIVE_STAR);
      try {
        const view = cardView(card);
        const options = await draftFiveStarOptions(
          { idea: card.idea, blueprint: card.blueprint, summary: fullOutput(card) ?? card.run?.summary, files: view.files },
          new ClaudeRunner(loadConfig().claudeBin),
          { model: loadConfig().blueprintModel, cwd: chompyyHome() },
        );
        updateBoard((b) => {
          getCard(b, id).fiveStarOptions = options;
        });
        return json(options);
      } catch {
        return json(GENERIC_FIVE_STAR);
      }
    }
    case 'signals': {
      const path = homePath('signals.jsonl');
      const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [];
      const items = lines.flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      if (values.json) return json(items.reverse());
      for (const s of items) {
        if (s.kind === 'coldstart') {
          console.log(`${s.at.slice(0, 16)}  coldstart  kept: ${[...s.accepted.taste, ...s.accepted.cards].join('; ') || '-'}  left out: ${[...s.declined.taste, ...s.declined.cards].join('; ') || '-'}`);
          continue;
        }
        console.log(`${s.at.slice(0, 16)}  #${s.card}  ${s.kind ?? 'rating'}  ${s.rating ? `${s.rating}/5 ` : ''}${s.reason ?? s.text ?? ''}${s.toFive ? `  → to make it a 5: ${s.toFive.join('; ')}` : ''}`);
      }
      return;
    }
    case 'edit-blueprint': {
      const id = need(args[0], 'chompyy edit-blueprint <id>  (new blueprint on stdin)');
      const text = await readStdin();
      const card = updateBoard((b) => editBlueprint(b, id, text, now));
      console.log(`✏️  #${card.id} blueprint updated.`);
      return;
    }
    case 'edit-idea': {
      const id = need(args[0], 'chompyy edit-idea <id>  (new idea on stdin)');
      const text = await readStdin();
      const card = updateBoard((b) => editIdea(b, id, text, now));
      console.log(`✏️  #${card.id} idea updated: ${card.title}`);
      if (card.blueprint) console.log(`   Its blueprint was drafted from the old idea; redraft with: chompyy blueprint ${card.id}`);
      return;
    }
    case 'answer': {
      const id = need(args[0], 'chompyy answer <id>  (answers on stdin)');
      const text = args.slice(1).join(' ').trim() || (await readStdin());
      const card = updateBoard((b) => answerCard(b, id, text, now));
      console.log(`💬 #${card.id} answered and back in approved; the next away run continues it.`);
      return;
    }
    case 'eat-tokens': {
      await freshQuota();
      const snapshot = loadSnapshot();
      console.log(statusText(snapshot, now));
      const view = windowView(snapshot?.fiveHour, now);
      if (!view.known) {
        console.log('\nNo leftover window can be planned: refresh the Claude Code status line first.');
        return;
      }
      const eligible = loadBoard().cards.filter((card) => card.column === 'approved' || card.column === 'later');
      const runs = readRuns();
      if (!eligible.length) {
        console.log('\nNo cards to consider. Park an idea with `chompyy later "<idea>"`.');
        return;
      }
      console.log(`\n${Math.round(view.leftPct)}% left until reset (${formatDuration(view.msLeft)}). Choose from these cards:`);
      for (const card of eligible) {
        const state = card.column === 'approved' ? 'approved · ready' : 'later · approve to run';
        console.log(`  #${card.id} ${card.title} [${state}]`);
        if (card.column === 'later' && !card.blueprint?.trim()) console.log('      blueprint needed before approval');
        console.log(`      ${formatCostRange(costRange(card, runs))}`);
      }
      console.log('\nThis is a read-only list. Start selected work with `chompyy away <duration>`.');
      return;
    }
    case 'later': {
      const idea = need(args.join(' ').trim(), 'chompyy later "<idea>"');
      const card = updateBoard((b) => addCard(b, idea, process.cwd(), now, 'later', branchOf(process.cwd())));
      console.log(`📥 #${card.id} parked in later: ${card.title}`);
      if (values['no-blueprint']) {
        updateBoard((b) => {
          getCard(b, card.id).noAutoDraft = true;
        });
        return;
      }
      if (!claudeAvailable(loadConfig().claudeBin)) {
        console.log(`   (claude CLI not found; draft the blueprint later with \`chompyy blueprint ${card.id}\`)`);
        return;
      }
      if (values.wait) {
        try {
          console.log('\n' + (await blueprintCard(card.id)));
        } catch (err) {
          console.log(`   blueprint failed: ${err instanceof Error ? err.message : err}`);
        }
        return;
      }
      await freshQuota();
      if (!windowActive(now)) {
        console.log('   the blueprint waits until your 5-hour window is active (drafting now would start a new window)');
        return;
      }
      const waiting = quotaEmpty(now);
      if (waiting) {
        updateBoard((b) => {
          getCard(b, card.id).blueprintWaiting = waiting;
        });
        console.log(`   ${waiting}`);
        return;
      }
      updateBoard((b) => {
        getCard(b, card.id).draftingAt = now.toISOString();
      });
      blueprintInBackground(card.id);
      console.log(`   drafting the blueprint in the background; see it with \`chompyy show ${card.id}\``);
      return;
    }
    case 'board': {
      const cols = (values.column ?? []).flatMap((c) => c.split(',')) as Column[];
      const bad = cols.filter((c) => !COLUMNS.includes(c));
      if (bad.length) throw new Error(`Unknown column(s): ${bad.join(', ')}. Columns: ${COLUMNS.join(', ')}`);
      if (values.json) return json(loadBoard().cards.filter((c) => !cols.length || cols.includes(c.column)));
      console.log(formatBoard(loadBoard(), cols.length ? cols : COLUMNS));
      return;
    }
    case 'show': {
      const card = getCard(loadBoard(), need(args[0], 'chompyy show <id>'));
      if (values.json) return json(cardView(card));
      console.log(formatCard(card));
      if (!card.run) console.log(`\n${formatCostRange(costRange(card, readRuns()))}`);
      else if (card.run.cost?.fiveHourPct != null) console.log(`used ${card.run.cost.fiveHourPct}% of the 5h window${card.run.trigger ? ` · started by the ${card.run.trigger} trigger` : ''}`);
      return;
    }
    case 'tokens': {
      // Exact tokens per run (tokens.ts). Runs from before 2026-11-19 are filled in from their saved stream logs.
      const filled = backfillTokens();
      const rows = readRuns().filter((r) => r.tokens);
      if (values.json) return json(rows.map((r) => ({ at: r.at, card: r.card, title: r.title, status: r.status, ...r.tokens })));
      if (filled) console.log(`Filled in exact tokens for ${filled} earlier run(s) from their logs.\n`);
      if (!rows.length) return console.log('No runs with exact token counts yet: they are recorded from the next away run on.');
      for (const r of rows.slice(-20)) console.log(`${r.at.slice(0, 16).replace('T', ' ')}  #${r.card.padEnd(4)} ${formatTokens(r.tokens!)}\n                    ${r.title}`);
      const sum = rows.reduce((a, r) => a + r.tokens!.costUsd, 0);
      const all = rows.reduce((a, r) => a + totalTokens(r.tokens!), 0);
      console.log(`\n${rows.length} run(s): ${compact(all)} tokens, $${sum.toFixed(2)} at API prices (median $${median(rows.map((r) => r.tokens!.costUsd)).toFixed(2)} per run)`);
      return;
    }
    case 'picture': {
      const id = need(args[0], 'chompyy picture <id> [--model sonnet]');
      await freshQuota();
      if (!values.force && !windowActive(now)) throw new Error('No active 5-hour window: drawing would start one. Add --force to draw anyway.');
      const path = await pictureCard(id, values.model);
      if (!values.quiet) console.log(`Drew the picture for #${id}: ${path}`);
      return;
    }
    case 'blueprint': {
      if (values['all-later']) {
        await freshQuota();
        if (!claudeAvailable(loadConfig().claudeBin)) throw new Error('claude CLI not found: drafting needs it.');
        // Same rule as background drafting (card #20): with 0% left, every draft would only hit the limit.
        const waiting = quotaEmpty(now);
        if (waiting) {
          updateBoard((b) => claimDrafts(b, now, waiting)); // marks the later cards "waiting for quota"
          console.log(`Nothing drafted: ${waiting}. They draft on their own once quota is back.`);
          return;
        }
        const plan = draftAllPlan(loadBoard(), windowActive(now), now);
        if (!plan.ids.length) {
          console.log(plan.message);
          return;
        }
        // Mark them all first so background drafting and the app don't start a second draft of the same card.
        updateBoard((b) => {
          for (const id of plan.ids) getCard(b, id).draftingAt = new Date().toISOString();
        });
        const failed: string[] = [];
        for (const [i, id] of plan.ids.entries()) {
          updateBoard((b) => {
            getCard(b, id).draftingAt = new Date().toISOString(); // fresh, so a long queue doesn't look stale
          });
          if (!values.quiet) console.log(`Drafting #${id} (${i + 1} of ${plan.ids.length})…`);
          try {
            await blueprintCard(id, values.model); // a failure is kept on the card as blueprintError
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (isUsageLimit(message)) {
              // Out of quota mid-way: the rest would fail the same way. They wait for the reset instead (card #20).
              const left = plan.ids.slice(i + 1);
              updateBoard((b) => { for (const l of left) delete getCard(b, l).draftingAt; claimDrafts(b, new Date(), quotaEmpty(new Date()) ?? 'waiting for quota: the usage limit was hit'); });
              console.log(`Drafted ${i} of ${plan.ids.length}: the usage limit was hit at #${id}. The rest draft on their own once quota is back.`);
              process.exitCode = i === 0 ? 1 : 0;
              return;
            }
            failed.push(id);
            if (!values.quiet) console.log(`   #${id} failed: ${message}`);
          }
        }
        const done = plan.ids.length - failed.length;
        console.log(`Drafted ${done} of ${plan.ids.length} blueprint${plan.ids.length === 1 ? '' : 's'}${failed.length ? `; failed: ${failed.map((f) => '#' + f).join(', ')} (see each card)` : ''}.`);
        if (done === 0) process.exitCode = 1;
        return;
      }
      const id = need(args[0], 'chompyy blueprint <id> [--model haiku]');
      const text = await blueprintCard(id, values.model);
      if (!values.quiet) console.log(text);
      return;
    }
    case 'approve': {
      const id = need(args[0], 'chompyy approve <id> [--allow network:host] [--allow "command:swiftc *"]');
      // The permission plan: what you allow here is all the run gets beyond the box's defaults (none by default).
      const allow = values.allow ?? [];
      const bad = allow.filter((a) => !parsePermission(a));
      if (bad.length) throw new Error(`Not a permission: ${bad.join(', ')}. Use network:<domain> or "command:<program> *".`);
      // Advice cards (chompyy advise): what approving does depends on the lane, not an away run.
      const adv = getCard(loadBoard(), id);
      if (adv.advice && adv.advice.lane !== 'work') {
        if (adv.column !== 'suggested' && adv.column !== 'later') throw new Error(`Card #${adv.id} is in ${adv.column}; only a suggested card can be approved.`);
        console.log(updateBoard((b) => approveAdvice(getCard(b, id), now)));
        for (const line of updateBoard((b) => applyDue(b, now))) console.log(`   ${line}`);
        return;
      }
      const card = updateBoard((b) => {
        const c = moveCard(b, id, 'approved', now);
        if (allow.length) c.permissions = [...new Set(allow)];
        else delete c.permissions;
        return c;
      });
      console.log(`✅ #${card.id} approved: ${card.title}${card.permissions?.length ? `\n   allowed: ${card.permissions.join(', ')}` : ''}`);
      for (const o of overlaps(card, loadBoard().cards)) {
        console.log(`   ⚠️  #${o.id} "${o.title}" may touch the same files (${o.files.slice(0, 3).join(', ')}). Keeping both can conflict; Run again fixes that.`);
      }
      return;
    }
    case 'drop': {
      const card = updateBoard((b) => dropCard(b, need(args[0], 'chompyy drop <id>'), now));
      console.log(`🗑  #${card.id} dropped: ${card.title}`);
      return;
    }
    case 'preflight': {
      // Run the repo's checks on clean latest main, in the away box and outside it (research/away-readiness.md).
      const root = gitRoot(args[0] ?? process.cwd());
      if (!root) throw new Error('Not in a git repo. Usage: chompyy preflight [path-to-repo]');
      const config = loadConfig();
      console.log(`Checking ${root} on its latest main, in the away box and outside it…`);
      const result = await preflight(root, { cacheDir: homePath('cache', 'tools'), denyRead: config.denyReadPaths, timeoutMs: config.checkTimeoutMin * 60_000, ...(values.ref ? { ref: values.ref } : {}) });
      const before = loadProfile(root);
      saveProfile({ root, checks: result.results.map((r) => r.check), updatedAt: result.at, preflight: result, ...(before?.needs ? { needs: before.needs } : {}) });
      if (values.json) return json(result);
      console.log(formatPreflight(result));
      return;
    }
    case 'run-card': {
      // A worker started by an away run: one card in its own process, so a crash ends only this card.
      const id = need(args[0], 'chompyy run-card <id> --timeout <ms>');
      const config = loadConfig();
      await runCard(id, Number(values.timeout) || config.cardTimeoutMin * 60_000, awayDeps(config, freshQuota), values.trigger);
      return;
    }
    case 'away': {
      const ms = parseDuration(need(args[0], 'chompyy away <1h|30m> [--dry-run] [--force]'));
      const config = loadConfig();
      await freshQuota(true);
      const gate = budgetGate(loadSnapshot(), config, now);
      console.log(statusText(loadSnapshot(), now));
      console.log(`gate       ${gate.ok ? 'open' : values.force ? 'closed, forced open' : 'closed'}${[...gate.reasons, ...gate.notes].map((r) => `\n           · ${r}`).join('')}\n`);
      await runAway(ms, { dryRun: values['dry-run'], force: values.force }, now, freshQuota);
      return;
    }
    case 'tick': {
      // Run by the LaunchAgent every 5 minutes. Prints one line per tick to tick.log.
      await freshQuota();
      const config = loadConfig();
      // Approved settings advice goes in once no Claude Code session is active.
      try {
        updateBoard((b) => applyDue(b, now));
      } catch {}
      const board = loadBoard();
      // Refreshes that waited for quota (refresh.ts) go as soon as there is some again.
      if (board.cards.some((c) => c.column === 'review' && c.refresh?.state === 'waiting') && !refreshGate(loadSnapshot(), now)) {
        await withRefreshLock(() => refreshClashing(refreshDeps(config, freshQuota)));
      }
      const d = decideTrigger(now, loadSnapshot(), config, loadTriggerState().fired, awayQueue(board).length, Boolean(awayRunning()));
      const stamp = now.toISOString().slice(0, 16);
      if (!d.fire) {
        noteTick(now, d.why);
        // Nightly consolidation: at bedtime, distil taste even when no card runs.
        if (config.bedtime && config.dream && bedtimeKey(now, config.bedtime, config.bedtimeWindowMin) && !awayRunning() && windowActive(now) && dreamDue(now)) {
          console.log(`${stamp} bedtime · nightly read: ${await dreamNow(now).catch((e) => String(e))}`);
        } else if (config.bedtime && bedtimeKey(now, config.bedtime, config.bedtimeWindowMin) && !awayRunning() && windowActive(now) && distillDue(board, now, 12 * 3600_000)) {
          console.log(`${stamp} bedtime · taste: ${await distillNow(now).catch((e) => String(e))}`);
        } else if (values.json || process.stdout.isTTY) console.log(`${stamp} ${d.why}`);
        return;
      }
      markFired(d.key, now, d.why);
      console.log(`${stamp} ▶ ${d.why}: away for ${formatDuration(d.durationMs)}`);
      await runAway(d.durationMs, { trigger: d.kind }, now, freshQuota);
      return;
    }
    case 'triggers': {
      const sub = args[0];
      if (sub === 'on') {
        const path = installAgent();
        const c = loadConfig();
        console.log(`Triggers on: ${path} runs \`chompyy tick\` every 5 minutes.`);
        console.log(`  last hour before a reset: ${c.lastHourTrigger ? `on (with ≥${c.lastHourMinLeftPct}% left)` : 'off'} · bedtime: ${c.bedtime ?? 'not set (chompyy bedtime 23:30)'} · missed reset: ${c.missedReset ? 'on' : 'off'}`);
        return;
      }
      if (sub === 'off') return console.log(uninstallAgent() ? 'Triggers off: removed the LaunchAgent.' : 'Triggers were already off.');
      if (sub) throw new Error('Usage: chompyy triggers [on|off]');
      const c = loadConfig();
      const st = loadTriggerState();
      if (values.json) return json({ installed: agentInstalled(), lastHour: c.lastHourTrigger, lastHourMinLeftPct: c.lastHourMinLeftPct, bedtime: c.bedtime, missedReset: c.missedReset, ...st });
      console.log(`LaunchAgent  ${agentInstalled() ? 'on (every 5 minutes)' : 'off (turn on: chompyy triggers on)'}`);
      console.log(`last hour    ${c.lastHourTrigger ? `on, with ≥${c.lastHourMinLeftPct}% of the window left` : 'off'}`);
      console.log(`bedtime      ${c.bedtime ?? 'not set'}`);
      console.log(`missed reset ${c.missedReset ? 'on, approved cards run on the first tick after an unused reset' : 'off'}`);
      if (st.lastTickAt) console.log(`last tick    ${st.lastTickAt.slice(0, 16).replace('T', ' ')}: ${st.lastDecision ?? ''}`);
      return;
    }
    case 'bedtime': {
      const v = need(args[0], 'chompyy bedtime <23:30|off>');
      if (v === 'off') {
        setConfig('bedtime', null);
        return console.log('Bedtime trigger off.');
      }
      parseClock(v);
      setConfig('bedtime', v);
      console.log(`Bedtime set to ${v}: approved cards run then, with the window that is left.${agentInstalled() ? '' : ' Turn triggers on with `chompyy triggers on`.'}`);
      return;
    }
    case 'plan-price': {
      const v = need(args[0], 'chompyy plan-price <dollars per month | auto>');
      const n = Number(v);
      if (v !== 'auto' && !(Number.isFinite(n) && n > 0)) throw new Error('Usage: chompyy plan-price <dollars per month | auto>');
      setConfig('planPriceUsd', v === 'auto' ? null : n);
      console.log(v === 'auto' ? 'Plan price: the list price for the plan Chompyy sees.' : `Plan price: $${n} a month.`);
      return;
    }
    case 'last-hour': {
      const v = need(args[0], 'chompyy last-hour <on|off>');
      if (v !== 'on' && v !== 'off') throw new Error('Usage: chompyy last-hour <on|off>');
      setConfig('lastHourTrigger', v === 'on');
      console.log(`Last-hour trigger ${v}.${v === 'on' && !agentInstalled() ? ' Turn triggers on with `chompyy triggers on`.' : ''}`);
      return;
    }
    case 'missed-reset': {
      const v = need(args[0], 'chompyy missed-reset <on|off>');
      if (v !== 'on' && v !== 'off') throw new Error('Usage: chompyy missed-reset <on|off>');
      setConfig('missedReset', v === 'on');
      console.log(`Missed-reset trigger ${v}.${v === 'on' ? ` Only cards already approved (chompyy approve) run; the budget gate still decides.${agentInstalled() ? '' : ' Turn triggers on with `chompyy triggers on`.'}` : ''}`);
      return;
    }
    case 'trace': {
      const q = need(args[0], 'chompyy trace <conversation id> [--json]   (ids: chompyy usage --json)');
      const ticked = new Set(cachedWorkspaces(now).filter((w) => w.ticked).map((w) => w.path));
      const t = traceSession(q, { showPrompts: (ws) => ticked.has(ws) });
      if (!t) throw new Error(q.startsWith('chompyy-card-') ? 'Away runs keep no transcript (only their recorded totals, in chompyy usage).' : `No conversation "${q}" on this Mac.`);
      if (values.json) return json(t);
      console.log(formatTrace(t));
      return;
    }
    case 'usage': {
      const period = (values.period ?? '') as Period;
      if (values.period && !PERIODS.includes(period)) throw new Error(`Usage: chompyy usage [--period ${PERIODS.join('|')}] [--days 7] [--json]`);
      const days = period ? periodDays(period, now) : values.days ? Number(values.days) : 7;
      if (!Number.isInteger(days) || days < 1 || days > 400) throw new Error('Usage: chompyy usage [--period today|7d|30d|month] [--days 7] [--json]');
      // Titles only for workspaces the nightly read may see (your ticks); numbers count everywhere.
      const ticked = new Set(cachedWorkspaces(now).filter((w) => w.ticked).map((w) => w.path));
      const canShow = (ws: string) => ticked.has(ws);
      const ledger = loadLedger();
      const view = usageView(ledger, now, days, 25, canShow);
      const to = now.toISOString();
      const cmp = compare(ledger, now, { label: loadLiveState().plan ?? null, priceUsd: loadConfig().planPriceUsd });
      const kinds = byKind(ledger, view.from, to);
      const prs = prCosts(ledger, view.from, to, canShow);
      // For the app: 12 weeks of days (the calendar), this week (the menu bar), the chosen period with kinds of
      // work and pull requests, and the comparisons, in one call.
      if (values.json && values.app) {
        const long = usageView(ledger, now, 84, 0, canShow);
        const week = usageView(ledger, now, 7, 10, canShow);
        return json({ generatedAt: to, period: period || `${days}d`, days: long.days, today: long.today, week, view: { ...view, byKind: kinds, prs }, compare: cmp, unpriced: long.unpriced });
      }
      if (values.json) return json({ ...view, byKind: kinds, prs, compare: cmp });
      console.log(formatUsage(view, homedir()));
      console.log(formatExtras(kinds, prs, cmp));
      return;
    }
    case 'dream': {
      const sub = args[0];
      if (sub === 'workspaces') {
        if (values.json) return json(cachedWorkspaces(now, 0));
        return console.log(formatWorkspaces(cachedWorkspaces(now, 0)));
      }
      if (sub === 'tick' || sub === 'untick') {
        const w = setTicked(need(args.slice(1).join(' ') || undefined, `chompyy dream ${sub} <folder>`), sub === 'tick', now);
        return console.log(`${w.ticked ? 'Ticked' : 'Unticked'} ${w.path}: the nightly read ${w.ticked ? 'will learn from' : "won't read"} its sessions.`);
      }
      if (sub === 'on' || sub === 'off') {
        setConfig('dream', sub === 'on');
        return console.log(`Nightly read ${sub}.`);
      }
      if (sub) throw new Error('Usage: chompyy dream [workspaces | tick <folder> | untick <folder> | on | off] [--dry-run] [--force] [--since 7d]');
      console.log(await dreamNow(now, { force: Boolean(values.force), dryRun: Boolean(values['dry-run']), sinceMs: values.since ? parseDuration(values.since) : undefined }));
      return;
    }
    case 'distill': {
      console.log(await distillNow(now, Boolean(values.force)));
      return;
    }
    case 'detect': {
      const r = detect({ days: values.days ? Number(values.days) : 30, now });
      if (values.json) return json(r);
      console.log(detectText(r, { all: Boolean(values.all), projects: projectsDir().replace(homedir(), '~') }).join('\n'));
      return;
    }
    case 'advise': {
      // The detective, step 3: findings become suggested cards. `advise apply`: apply approved settings advice
      // once no Claude Code session is active (the app asks every minute).
      if (args[0] === 'apply') {
        const lines = updateBoard((b) => applyDue(b, now));
        if (values.json) return json(lines);
        return console.log(lines.length ? lines.join('\n') : 'Nothing waiting to be applied.');
      }
      const res = updateBoard((b) => runAdvise(b, now));
      if (values.json) return json({ added: res.added.map((c) => c.id), updated: res.updated.map((c) => c.id), skipped: res.skipped });
      return console.log(adviseText(res));
    }
    case 'hook': {
      // Claude Code's UserPromptSubmit hook. Must never fail loudly or stop a prompt by accident.
      if (args[0] !== 'prompt') return;
      try {
        const out = runHook(await readStdin());
        if (out) console.log(out);
      } catch {
        /* let the prompt through */
      }
      return;
    }
    case 'nudge': {
      const sub = args[0];
      if (sub === 'on' || sub === 'off') return console.log(setNudge(sub === 'on', sub === 'on' ? hookCommand() : undefined));
      if (sub === 'due') {
        // The app asks every minute; each conversation going cold is reported once.
        const due = (nudgeInstalled() ? takeGoingCold(now.getTime()) : []).map((d) => ({ ...d, ...coldWarningText(d) }));
        if (values.json) return json(due);
        return console.log(due.length ? due.map((d) => `${d.title}\n  ${d.body}`).join('\n') : 'Nothing about to go cold.');
      }
      if (values.json) return json(impact());
      return console.log([nudgeText(nudgeInstalled()), impact().line].join('\n'));
    }
    case 'premise': {
      const ends = allWindowEnds(loadSamples(), now.getTime());
      archiveWindowEnds(loadSamples(), now.getTime());
      const p = premise(ends);
      if (values.json) return json({ ...p, windows: ends });
      console.log(premiseText(p).join('\n'));
      return;
    }
    case 'trends': {
      const lines = trendLines(readRuns(), readSignals(), now);
      console.log(lines.length ? lines.join('\n') : 'Not enough runs yet for trends (needs 3).');
      return;
    }
    case 'report': {
      const since = values.all ? null : lastReportAt();
      syncTasteFile(now);
      const cards = cardsSince(loadBoard(), since);
      const store = loadStore();
      const signals = readSignals();
      const morning = morningLine(cards, tasteChangesSince(store, since));
      const question = nextQuestion(store, signals);
      const footer = [...(question ? formatQuestion(question, signals) : []), ...trendLines(readRuns(), signals, now)];
      console.log(formatReport(cards, since, (c) => ({ files: changedFiles(c), questions: questionsOf(c) }), { header: morning ? [morning] : [], footer }));
      markReported(now);
      return;
    }
    case 'diff': {
      console.log(diffCard(getCard(loadBoard(), need(args[0], 'chompyy diff <id>'))));
      return;
    }
    case 'keep': {
      const id = need(args[0], 'chompyy keep <id>');
      const card = getCard(loadBoard(), id);
      const clash = clashOf(card);
      if (clash) {
        // Don't hand the clash to you: Chompyy brings the card onto the new main, checks it, then keeps it (refresh.ts).
        updateBoard((b) => {
          getCard(b, id).keepWhenRefreshed = true;
        });
        startBackground(['refresh', '--clashing'], 'refresh.log');
        console.log(`#${id} clashes with ${clash.branch} (${clash.files.join(', ')}): other cards were kept since it ran. Chompyy is bringing it up to date and will keep it once its checks pass.`);
        return;
      }
      keepNow(id, now);
      return;
    }
    case 'refresh': {
      const config = loadConfig();
      const deps = refreshDeps(config, freshQuota);
      await freshQuota();
      const ran = await withRefreshLock(async () => {
        if (args[0]) await refreshCard(args[0], deps);
        else await refreshClashing(deps);
      });
      if (!ran) console.log('A refresh is already running; it will go round again to include this.');
      return;
    }
    case 'undo': {
      const id = need(args[0], 'chompyy undo <id>');
      const adv = getCard(loadBoard(), id);
      if (adv.advice && adv.advice.lane !== 'work') return console.log(updateBoard((b) => undoAdvice(getCard(b, id), now)));
      console.log(undoCard(getCard(loadBoard(), id)));
      updateBoard((b) => {
        const card = getCard(b, id);
        card.outcome = 'undone';
        card.column = 'done';
        card.updatedAt = now.toISOString();
        recordOutcome(card, 'undone', now);
        return card;
      });
      return;
    }
    case 'redo': {
      const id = need(args[0], 'chompyy redo <id>');
      const before = getCard(loadBoard(), id);
      if (before.column !== 'review' && before.column !== 'done') throw new Error(`Card #${id} is in ${before.column}; only cards that ran can be run again.`);
      if (before.run) console.log(undoCard(before));
      const card = updateBoard((b) => {
        const c = getCard(b, id);
        c.column = 'approved';
        c.approvedAt = now.toISOString();
        c.updatedAt = c.approvedAt;
        delete c.run;
        delete c.outcome;
        return c;
      });
      console.log(`🔁 #${card.id} back in approved; it runs again from your latest code on the next away run.`);
      return;
    }
    case 'rate': {
      const usage = 'chompyy rate <id> <1-5> ["optional reason"]';
      const id = need(args[0], usage);
      const score = Number(need(args[1], usage));
      const reason = args.slice(2).join(' ').trim() || undefined;
      const toFive = (values['to-five'] ?? []).map((t) => t.trim()).filter(Boolean);
      const card = updateBoard((b) => rateCard(b, id, score, reason, now, toFive));
      console.log(`⭐ #${card.id} rated ${score}/5${reason ? ` ("${reason}")` : ''}. Saved to signals.jsonl${card.column === 'review' ? '; keep or undo it when you’re ready' : ''}.`);
      return;
    }
    case 'taste': {
      const sub = args[0];
      const removed = syncTasteFile(now);
      if (removed.length) console.log(`Retired ${removed.join(', ')}: you removed ${removed.length === 1 ? 'it' : 'them'} from taste.md.\n`);
      if (sub === 'list') {
        if (values.json) return json(loadStore());
        return console.log(formatPrefs(loadStore(), readSignals()));
      }
      if (sub === 'why') return console.log(formatWhy(getPref(loadStore(), need(args[1], 'chompyy taste why <id>')), readSignals()));
      if (sub === 'yes' || sub === 'not-now' || sub === 'never') {
        const p = answerPreference(need(args[1], `chompyy taste ${sub} <id>`), sub as Answer, now);
        const said = { yes: `✓ Added to taste.md: "${p.text}". Agents follow it from now on.`, 'not-now': `Okay, not now. Chompyy asks again only when there's more evidence.`, never: `🔕 Won't ask about "${p.text}" again.` };
        return console.log(said[sub as Answer]);
      }
      if (sub === 'retire') {
        const p = retirePreference(need(args[1], 'chompyy taste retire <id>'), now);
        return console.log(`Retired ${p.id}: "${p.text}". It's kept in \`chompyy taste list\` with the reason.`);
      }
      if (sub) throw new Error('Usage: chompyy taste [list | why <id> | yes|not-now|never <id> | retire <id>]');
      const { path, text, created } = readTaste();
      if (created) console.log(`(created ${path})\n`);
      console.log(text);
      return;
    }
    case undefined:
    case 'help':
      console.log(HELP);
      return;
    default:
      throw new Error(`Unknown command "${command}". Run \`chompyy help\`.`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`chompyy: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
