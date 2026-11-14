#!/usr/bin/env node
// chompyy: park ideas, blueprint them, run approved cards while you're away.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { away } from './away.js';
import { draftBlueprint } from './blueprint.js';
import { addCard, COLUMNS, dropCard, formatBoard, formatCard, getCard, loadBoard, moveCard, updateBoard, type Column } from './board.js';
import { loadConfig } from './config.js';
import { formatDuration, parseDuration } from './duration.js';
import { budgetGate } from './gate.js';
import { chompyyHome } from './home.js';
import { loadSnapshot, mergeSnapshot, parseStatusline, saveSnapshot, statusLineText, statusText, windowView } from './quota.js';
import { cardsSince, formatReport, lastReportAt, markReported, rateCard, readTaste } from './report.js';
import { changedFiles, diffCard, keepCard, questionsOf, undoCard } from './review.js';
import { ClaudeRunner, claudeAvailable } from './runner.js';
import { planWorkspace, prepareWorkspace } from './workspace.js';

const HELP = `chompyy: use the 5-hour window capacity that would reset unused

Quota
  chompyy statusline            Claude Code statusLine command: reads JSON on stdin, saves a snapshot
  chompyy status                % left, time to reset, pace, weekly used, staleness
  chompyy eat-tokens            show leftover quota and cards you could choose to run (read-only)

Board
  chompyy later "<idea>"        park an idea in later (blueprint drafted in the background)
        --no-blueprint            don't draft one   --wait   draft it now, in the foreground
  chompyy board [--column c]    cards by column (suggested later approved running review done)
  chompyy show <id>             one card: blueprint, last run, what the agent said
  chompyy blueprint <id>        (re)draft the blueprint with a cheap model  [--model haiku]
  chompyy approve <id>          later → approved (needs a blueprint)
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
  chompyy rate <id> <1-5> ["why"]   rate a result against its blueprint
  chompyy taste                 show taste.md

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
      cwd: chompyyHome(),
    });
    updateBoard((b) => {
      const c = getCard(b, id);
      c.blueprint = text;
      delete c.blueprintError;
      c.updatedAt = new Date().toISOString();
    });
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateBoard((b) => {
      getCard(b, id).blueprintError = message;
    });
    throw err;
  }
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
    },
  });
  const [command, ...args] = values.help ? ["help"] : positionals;
  const now = new Date();

  switch (command) {
    case 'statusline': {
      // Must never fail loudly: it runs on every status bar refresh.
      try {
        const snap = mergeSnapshot(loadSnapshot(), parseStatusline(await readStdin(), now));
        saveSnapshot(snap);
        console.log(statusLineText(snap, now));
      } catch {
        console.log('🍪');
      }
      return;
    }
    case 'status': {
      console.log(statusText(loadSnapshot(), now));
      return;
    }
    case 'eat-tokens': {
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
      if (values['no-blueprint']) return;
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
      blueprintInBackground(card.id);
      console.log(`   drafting the blueprint in the background; see it with \`chompyy show ${card.id}\``);
      return;
    }
    case 'board': {
      const cols = (values.column ?? []).flatMap((c) => c.split(',')) as Column[];
      const bad = cols.filter((c) => !COLUMNS.includes(c));
      if (bad.length) throw new Error(`Unknown column(s): ${bad.join(', ')}. Columns: ${COLUMNS.join(', ')}`);
      console.log(formatBoard(loadBoard(), cols.length ? cols : COLUMNS));
      return;
    }
    case 'show': {
      console.log(formatCard(getCard(loadBoard(), need(args[0], 'chompyy show <id>'))));
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
      console.log(keepCard(getCard(loadBoard(), need(args[0], 'chompyy keep <id>'))));
      return;
    }
    case 'undo': {
      console.log(undoCard(getCard(loadBoard(), need(args[0], 'chompyy undo <id>'))));
      return;
    }
    case 'rate': {
      const usage = 'chompyy rate <id> <1-5> ["optional reason"]';
      const id = need(args[0], usage);
      const score = Number(need(args[1], usage));
      const reason = args.slice(2).join(' ').trim() || undefined;
      const card = updateBoard((b) => rateCard(b, id, score, reason, now));
      console.log(`⭐ #${card.id} rated ${score}/5 and moved to done.`);
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
