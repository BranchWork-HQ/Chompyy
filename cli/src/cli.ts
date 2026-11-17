#!/usr/bin/env node
// chompyy: park ideas, blueprint them, run approved cards while you're away.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { away } from './away.js';
import { draftBlueprint, draftFiveStarOptions, GENERIC_FIVE_STAR } from './blueprint.js';
import { addCard, COLUMNS, dropCard, formatBoard, formatCard, getCard, loadBoard, moveCard, updateBoard, type Column } from './board.js';
import { loadConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { chompyyHome, homePath } from './home.js';
import { loadSnapshot, mergeSnapshot, parseStatusline, saveSnapshot, statusLineText, statusText, windowView } from './quota.js';
import { cardsSince, formatReport, lastReportAt, markReported, rateCard, readTaste } from './report.js';
import { changedFiles, diffCard, keepCard, questionsOf, undoCard } from './review.js';
import { ClaudeRunner, claudeAvailable } from './runner.js';
import { commitLeftovers, planWorkspace, prepareWorkspace } from './workspace.js';
import { answerCard, appState, cardView, editBlueprint, recordCliLocation } from './appstate.js';
import { refreshLiveQuota } from './livequota.js';
import { recentProjects } from './projects.js';
import { cliVersion, installApp } from './macapp.js';
import { buildDigest, historyRetention, scanHistory } from './history.js';
import { acceptColdStart, forgetColdStart, formatColdStart, loadColdStart, runColdStart } from './coldstart.js';
import { keepHistory } from './claudesettings.js';

const HELP = `chompyy: use the 5-hour window capacity that would reset unused

Quota
  chompyy statusline            Claude Code statusLine command: reads JSON on stdin, saves a snapshot
  chompyy status                % left, time to reset, pace, weekly used, staleness
  chompyy quota [--refresh]     read live quota from Anthropic now (uses Claude Code's saved login; sends no message)
  chompyy eat-tokens            show leftover quota and cards you could choose to run (read-only)

Board
  chompyy later "<idea>"        park an idea in later (blueprint drafted in the background)
        --no-blueprint            don't draft one   --wait   draft it now, in the foreground
  chompyy board [--column c]    cards by column (suggested later approved running review done)
  chompyy show <id>             one card: blueprint, last run, what the agent said
  chompyy blueprint <id>        (re)draft the blueprint with a cheap model  [--model haiku]
  chompyy approve <id>          later → approved (needs a blueprint)
  chompyy edit-blueprint <id>   replace the blueprint with text from stdin
  chompyy drop <id>             remove a card (kept in archive.jsonl)

Away
  chompyy away <1h|30m|1h30m>   run approved cards headless, one at a time, until the time is up
        --dry-run                 print the plan, start nothing
        --force                   skip the budget gate (the duration still holds)

Back
  chompyy report [--all]        what ran, and the one thing to do about each
  chompyy diff <id>             the change it made
  chompyy keep <id>             merge its branch into your current branch
  chompyy undo <id>             throw it away (removes its branch; yours are untouched)
  chompyy answer <id>           answer the run's questions (stdin); the card goes back to approved
  chompyy redo <id>             throw this attempt away and run it again from your latest code
  chompyy rate <id> <1-5> ["why"] [--to-five "change" ...]   rate a result; --to-five = what would have made it a 5
  chompyy five-star <id>        options for "what would have made it a 5?" (JSON)
  chompyy taste                 show taste.md
  chompyy signals [--json]      everything Chompyy has recorded from you: ratings, edits, answers

Get to know you (cold start)
  chompyy history [--digest]    what Chompyy would read from your Claude Code history (local; --digest = the exact text it would send)
  chompyy coldstart [--force]   read your history once and propose taste lines and suggested cards (one model call)
  chompyy coldstart show        the proposals    accept --taste t1,t2 --cards c1    forget
  chompyy keep-history <days>   keep Claude Code transcripts longer (cleanupPeriodDays; default 30)

App
  chompyy app                   install (or update) the Mac app in ~/Applications and open it
  chompyy version               this CLI's version
  chompyy projects [--json]     recent project folders (from Claude Code history and past cards)
  chompyy state --json          everything the Mac app shows, in one JSON (board, show, status also take --json)

State lives in ${chompyyHome()} (override with CHOMPYY_HOME).`;

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
    const text = await draftBlueprint(card, new ClaudeRunner(config.claudeBin), {
      model: model ?? config.blueprintModel,
      // Run in the card's folder so the model can read the repo (read-only tools only).
      cwd: existsSync(card.cwd) ? card.cwd : chompyyHome(),
    });
    updateBoard((b) => {
      const c = getCard(b, id);
      c.blueprint = text;
      delete c.blueprintError;
      delete c.draftingAt;
      c.updatedAt = new Date().toISOString();
    });
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateBoard((b) => {
      const c = getCard(b, id);
      c.blueprintError = message;
      delete c.draftingAt;
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

/**
 * Draft blueprints that are waiting, but only while a window is active: drafting is a model call, and
 * with no active window it would start a new 5-hour window. Called whenever quota is fresh.
 */
function draftPending(now: Date): void {
  if (!windowActive(now) || !claudeAvailable(loadConfig().claudeBin)) return;
  const stale = now.getTime() - 3 * 60_000;
  const ids = updateBoard((b) => {
    const due = b.cards.filter(
      (c) => (c.column === 'later' || c.column === 'suggested') && !c.blueprint && !c.blueprintError && !c.noAutoDraft && (!c.draftingAt || Date.parse(c.draftingAt) < stale),
    );
    for (const c of due) c.draftingAt = now.toISOString();
    return due.map((c) => c.id);
  });
  for (const id of ids) blueprintInBackground(id);
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

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'no-blueprint': { type: 'boolean' },
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
      'to-five': { type: 'string', multiple: true },
      digest: { type: 'boolean' },
      taste: { type: 'string' },
      cards: { type: 'string' },
    },
  });
  const [command, ...args] = values.help ? ["help"] : positionals;
  const now = new Date();
  const json = (data: unknown) => console.log(JSON.stringify(data, null, 2));
  if (command !== 'statusline') recordCliLocation();
  /** Fresh quota before anything that reads it (at most every 5 minutes unless forced). */
  const freshQuota = async (force = false) => {
    if (loadConfig().quotaSource !== 'api') return null;
    try {
      return await refreshLiveQuota({ force });
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
        console.log(statusLineText(snap, now));
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
      const r = await freshQuota(Boolean(values.refresh));
      if (r) console.log(r.message);
      else if (loadConfig().quotaSource !== 'api') console.log('quotaSource is "statusline" in config.json; live reading is off.');
      console.log(statusText(loadSnapshot(), now));
      return;
    }
    case 'state': {
      await freshQuota(Boolean(values.refresh));
      draftPending(now);
      return json(appState(loadBoard(), loadSnapshot(), loadConfig(), now));
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
      const cs = await runColdStart(scanHistory(), new ClaudeRunner(config.claudeBin), { model: config.coldStartModel, cwd: chompyyHome(), now });
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
      if (!eligible.length) {
        console.log('\nNo cards to consider. Park an idea with `chompyy later "<idea>"`.');
        return;
      }
      console.log(`\n${Math.round(view.leftPct)}% left until reset (${formatDuration(view.msLeft)}). Choose from these cards:`);
      for (const card of eligible) {
        const state = card.column === 'approved' ? 'approved · ready' : 'later · approve to run';
        console.log(`  #${card.id} ${card.title} [${state}]`);
        if (card.column === 'later' && !card.blueprint?.trim()) console.log('      blueprint needed before approval');
      }
      console.log('\nThis is a read-only list. Start selected work with `chompyy away <duration>`.');
      return;
    }
    case 'later': {
      const idea = need(args.join(' ').trim(), 'chompyy later "<idea>"');
      const card = updateBoard((b) => addCard(b, idea, process.cwd(), now));
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
      return;
    }
    case 'blueprint': {
      const id = need(args[0], 'chompyy blueprint <id> [--model haiku]');
      const text = await blueprintCard(id, values.model);
      if (!values.quiet) console.log(text);
      return;
    }
    case 'approve': {
      const card = updateBoard((b) => moveCard(b, need(args[0], 'chompyy approve <id>'), 'approved', now));
      console.log(`✅ #${card.id} approved: ${card.title}`);
      return;
    }
    case 'drop': {
      const card = updateBoard((b) => dropCard(b, need(args[0], 'chompyy drop <id>'), now));
      console.log(`🗑  #${card.id} dropped: ${card.title}`);
      return;
    }
    case 'away': {
      const ms = parseDuration(need(args[0], 'chompyy away <1h|30m> [--dry-run] [--force]'));
      const config = loadConfig();
      await freshQuota(true);
      const gate = budgetGate(loadSnapshot(), config, now);
      console.log(statusText(loadSnapshot(), now));
      console.log(`gate       ${gate.ok ? 'open' : values.force ? 'closed, forced open' : 'closed'}${[...gate.reasons, ...gate.notes].map((r) => `\n           · ${r}`).join('')}\n`);
      await away(
        ms,
        {
          runner: new ClaudeRunner(config.claudeBin),
          config,
          now: () => Date.now(),
          snapshot: loadSnapshot,
          plan: planWorkspace,
          prepare: prepareWorkspace,
          commitLeftovers,
          refreshQuota: async () => {
            await freshQuota(true);
          },
          out: (line) => console.log(line),
        },
        { dryRun: values['dry-run'], force: values.force },
      );
      return;
    }
    case 'report': {
      const since = values.all ? null : lastReportAt();
      console.log(formatReport(cardsSince(loadBoard(), since), since, (c) => ({ files: changedFiles(c), questions: questionsOf(c) })));
      markReported(now);
      return;
    }
    case 'diff': {
      console.log(diffCard(getCard(loadBoard(), need(args[0], 'chompyy diff <id>'))));
      return;
    }
    case 'keep': {
      const id = need(args[0], 'chompyy keep <id>');
      console.log(keepCard(getCard(loadBoard(), id)));
      updateBoard((b) => {
        const card = getCard(b, id);
        card.outcome = 'kept';
        card.column = 'done';
        card.updatedAt = now.toISOString();
        return card;
      });
      return;
    }
    case 'undo': {
      const id = need(args[0], 'chompyy undo <id>');
      console.log(undoCard(getCard(loadBoard(), id)));
      updateBoard((b) => {
        const card = getCard(b, id);
        card.outcome = 'undone';
        card.column = 'done';
        card.updatedAt = now.toISOString();
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
