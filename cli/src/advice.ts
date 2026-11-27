// The detective, step 3: Advice cards (FEATURES.md §6, research/detective/RULEBOOK.md "Fix lanes"). Each detect
// finding becomes a suggested card you approve or drop. What approving does depends on the lane:
//   settings  the exact change shown on the card, applied when no Claude Code session is active (so no open
//             conversation's cache is thrown away), backed up first; Undo puts it back if nothing changed it since
//   habit     nothing to apply: the card is marked "trying", with the baseline it will be checked against
//   manual    something only you can do (claude.ai settings, files outside a repo): marked "done by you"
//   work      a normal card: blueprint, away run on its own branch, keep or undo
// Every card states before it's applied what will be measured afterwards and what counts as "worked" (rule 7).
import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { addCard, type BoardData, type Card } from './board.js';
import { detect, isAutomated, type DetectResult, type Finding } from './detect.js';
import { projectsDir } from './dream.js';
import { homePath } from './home.js';
import { claudeSettingsPath, nudgeInstalled } from './nudge.js';
import { gitRoot } from './workspace.js';
import type { AdviceResult } from './didwork.js';

export type AdviceLane = 'settings' | 'habit' | 'manual' | 'work';

/** One value in a JSON settings file: `key` is the path inside it. `from` undefined = the key wasn't there. */
export interface SettingChange {
  file: string;
  key: string[];
  from?: unknown;
  to: unknown;
}

export interface Advice {
  /** Stable across runs, so the same finding updates its card instead of adding another. */
  key: string;
  rule: string;
  lane: AdviceLane;
  basis: Finding['basis'];
  tokens?: number;
  /** Before → after, registered before the fix. */
  check: string;
  /** The card's picture, in three short steps: what Chompyy saw, what changes, how it's checked. */
  saw?: string;
  doing?: string;
  checkShort?: string;
  /** Your own numbers behind it, as bars (the app draws them). `highlight` marks the bar the fix aims for. */
  chart?: { title: string; bars: { label: string; value: number; highlight?: boolean }[]; note?: string };
  changes?: SettingChange[];
  /** Skill folders copied into ~/.claude/skills before the change (the few skills you use from a plugin). */
  copies?: { from: string; to: string }[];
  state?: 'waiting' | 'applied' | 'trying' | 'done' | 'undone' | 'failed';
  /** Why it's still waiting, or why applying failed. */
  note?: string;
  since?: string;
  backups?: string[];
  /** What the check compares against, registered with the card before it's applied (rule 7). */
  baseline?: {
    /** S3 plugin: tokens its unused skills add to every session start. */
    perStart?: number;
    /** S3 manual: the skills to turn off. */
    names?: string[];
    /** S2: the file's size when the card was made. */
    lines?: number;
    tokens?: number;
  };
  /** Did it work? (didwork.ts): the latest measurement against `check`. */
  result?: AdviceResult;
}

export interface AdviceDraft {
  title: string;
  idea: string;
  cwd: string;
  plan: string | null;
  advice: Advice;
}

/** Don't touch settings while a Claude Code session was active this recently. */
export const IDLE_BEFORE_APPLY_MS = 10 * 60_000;

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
const tilde = (p: string) => p.replace(homedir(), '~');
const describeKey = (c: SettingChange) => `\`${tilde(c.file)}\`: \`${c.key.map((x, i) => (i ? `["${x}"]` : x)).join('')}\`: ${JSON.stringify(c.from ?? '(not set)')} → ${JSON.stringify(c.to)}`;

function plan(f: Finding, a: Advice, what: string): string {
  return [
    `**Evidence** (${f.basis}): ${f.say}`,
    f.notProve ? `**Not proven:** ${f.notProve}` : '',
    what,
    `**Check:** ${a.check}`,
  ].filter(Boolean).join('\n\n');
}

const settingsWhat = (changes: SettingChange[]) =>
  [
    '**The change:**',
    ...changes.map((c) => `- ${describeKey(c)}`),
    '',
    'Applied once no Claude Code session has run for 10 minutes, so no open cache is lost. Backed up; Undo restores it.',
  ].join('\n');

/** The cards detect's findings turn into. */
export function adviceFrom(r: DetectResult, opts: { nudgeOn?: boolean; settings?: string; skillsDir?: string } = {}): AdviceDraft[] {
  const out: AdviceDraft[] = [];
  const settings = opts.settings ?? claudeSettingsPath();
  const home = homedir();
  for (const f of r.findings) {
    if (f.rule === 'C1') {
      const w = r.scanned.coldWeek;
      const a: Advice = {
        key: 'C1',
        rule: 'C1',
        lane: 'habit',
        basis: f.basis,
        ...(f.tokens ? { tokens: f.tokens } : {}),
        check: w
          ? `Cold returns a week: ${w.count} before you start. It worked if week two has ${Math.floor((w.count * 2) / 3)} or fewer.`
          : 'Cold returns a week, against the week before you start.',
      };
      const fix = 'Before a long break: /compact, or leave a note and start fresh.' + (opts.nudgeOn ? '' : ' `chompyy nudge on` reminds you in time.');
      a.saw = `${k(f.tokens ?? 0)} tokens rewritten in 14 days: you came back after the cache expired`;
      a.doing = 'Before a break: /compact, or leave a note and start fresh';
      a.checkShort = w ? `Week two: ${Math.floor((w.count * 2) / 3)} or fewer cold returns (was ${w.count})` : 'Fewer cold returns a week';
      const weeks = r.scanned.coldWeeks ?? [];
      if (weeks.length) {
        a.chart = {
          title: 'Tokens rebuilt by cold returns, per week',
          bars: weeks.map((x, i) => ({ label: i === weeks.length - 1 ? 'Last 7 days' : `Week of ${new Date(x.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, value: x.tokens })),
          note: `Cold returns a week: ${weeks.map((x) => x.count).join(' · ')}. Goal: a third lower.`,
        };
      }
      out.push({ title: 'Stop paying for cold returns', idea: fix, cwd: home, plan: plan(f, a, `**Do:** ${fix}`), advice: a });
    } else if (f.rule === 'C2') {
      const a: Advice = { key: 'C2', rule: 'C2', lane: 'habit', basis: f.basis, ...(f.tokens ? { tokens: f.tokens } : {}), check: 'Mid-session rebuilds for two weeks after you start. It worked if there are none.', saw: `${k(f.tokens ?? 0)} tokens rewritten mid-session`, doing: 'Load tools at the start, or give that work its own session', checkShort: 'No mid-session rebuilds for two weeks' };
      out.push({ title: 'Keep the cache through a session', idea: f.fix, cwd: home, plan: plan(f, a, `**Do:** ${f.fix}`), advice: a });
    } else if (f.rule === 'S3') {
      const start = r.scanned.startTokens;
      for (const p of f.targets?.plugins ?? []) {
        const name = p.id.split('@')[0]!;
        const changes: SettingChange[] = [{ file: settings, key: ['enabledPlugins', p.id], from: true, to: false }];
        const copies = (p.keep ?? []).map((x) => ({ from: x.dir, to: join(opts.skillsDir ?? join(home, '.claude', 'skills'), x.name) }));
        const kept = (p.keep ?? []).map((x) => x.name);
        const a: Advice = {
          key: `S3:plugin:${p.id}`,
          rule: 'S3',
          lane: 'settings',
          basis: 'estimated',
          tokens: p.tokens * r.scanned.sessions,
          changes,
          baseline: { perStart: p.tokens },
          ...(copies.length ? { copies } : {}),
          saw: `${p.skills} unused skills load every session (~${k(p.tokens)} tokens)`,
          doing: kept.length ? `Copy ${kept.join(' and ')} to your skills, turn ${name} off. Undo restores it` : `Turn ${name} off. Undo restores it`,
          checkShort: `New sessions start ~${k(p.tokens)} tokens smaller`,
          ...(start ? { chart: { title: 'What a session start costs, in tokens', bars: [{ label: 'Now', value: start }, { label: 'After', value: Math.max(0, start - p.tokens), highlight: true }], note: `${Math.round((p.tokens / start) * 100) || '<1'}% off every session start, ${r.scanned.sessions} sessions a month.` } } : {}),
          check: `It worked if sessions start ~${k(p.tokens)} tokens smaller${start ? ` (now ~${k(start)})` : ''}${kept.length ? ` and ${kept.join(' and ')} still work${kept.length === 1 ? 's' : ''}` : ''}.`,
        };
        const say: Finding = {
          ...f,
          say: kept.length
            ? `You used ${kept.length} of ${p.skills + kept.length} ${name} skills (${kept.join(', ')}) in ${r.scanned.sessions} sessions. The other ${p.skills} add ~${k(p.tokens)} tokens every session start.`
            : `None of the ${p.skills} ${name} skills used in ${r.scanned.sessions} sessions: ~${k(p.tokens)} tokens every session start.`,
          notProve: kept.length ? `${f.notProve} Your copies won't get the plugin's updates (Undo brings them back).` : f.notProve,
        };
        const what = [
          copies.length ? `**First, keep the ones you use:** ${copies.map((c) => `copy \`${tilde(c.from)}\` to \`${tilde(c.to)}\``).join('; ')}. If a folder is already there, nothing is applied.` : '',
          settingsWhat(changes),
        ].filter(Boolean).join('\n\n');
        out.push({
          title: kept.length ? `Turn off ${name}, keep ${kept.join(' and ')}` : `Turn off ${name} (${p.skills} unused skills)`,
          idea: `~${k(p.tokens)} tokens off every session start.`,
          cwd: home,
          plan: plan(say, a, what),
          advice: a,
        });
      }
      const synced = f.targets?.synced ?? [];
      if (synced.length) {
        const a: Advice = { key: 'S3:synced', rule: 'S3', lane: 'manual', basis: 'estimated', baseline: { names: synced }, check: 'It worked if these no longer load.', saw: `${synced.length} skills synced from claude.ai, never used`, doing: 'Turn them off in claude.ai settings, then press "I\'ve done it"', checkShort: 'They no longer load' };
        const what = `**Do (only you can, in claude.ai settings):** turn off the ones you don't use: ${synced.join(', ')}. Then press "I've done it".`;
        out.push({ title: `Turn off ${synced.length} unused synced skills`, idea: `In claude.ai settings: ${synced.slice(0, 5).join(', ')}${synced.length > 5 ? ', …' : ''}`, cwd: home, plan: plan({ ...f, say: `${synced.length} skills synced from claude.ai, unused in ${r.scanned.sessions} sessions.` }, a, what), advice: a });
      }
      const yours = f.targets?.yours ?? [];
      if (yours.length) {
        const a: Advice = { key: 'S3:yours', rule: 'S3', lane: 'manual', basis: 'estimated', baseline: { names: yours.map((y) => y.name) }, check: 'It worked if these no longer load.', saw: `${yours.length} of your own skills, never used`, doing: 'Move them out of ~/.claude/skills', checkShort: 'They no longer load' };
        const what = `**Do:** move these out of \`~/.claude/skills\` (\`_archived\` inside still loads): ${yours.map((y) => y.name).join(', ')}.`;
        out.push({ title: `Archive ${yours.length} unused skills of yours`, idea: yours.slice(0, 5).map((y) => y.name).join(', ') + (yours.length > 5 ? ', …' : ''), cwd: home, plan: plan(f, a, what), advice: a });
      }
    } else if (f.rule === 'S2') {
      const file = f.say.match(/^(\S+CLAUDE\.md)/)?.[1]?.replace(/^~/, home) ?? '';
      const repo = file && basename(file) === 'CLAUDE.md' ? gitRoot(join(file, '..')) : null;
      let size: Advice['baseline'];
      try {
        const text = readFileSync(file, 'utf8');
        size = { lines: text.split('\n').length, tokens: Math.ceil(text.length / 4) };
      } catch {}
      const a: Advice = { key: `S2:${file}`, rule: 'S2', lane: repo ? 'work' : 'manual', basis: f.basis, ...(f.tokens ? { tokens: f.tokens } : {}), ...(size ? { baseline: size } : {}), check: 'It worked if it is under 200 lines and ~2k tokens, with no rule lost.', saw: `${size ? `${size.lines} lines (~${k(size.tokens!)} tokens)` : 'A long file'}, loaded every session there`, doing: 'Keep rules and key paths; move workflows into skills', checkShort: 'Under 200 lines and ~2k tokens' };
      if (repo) out.push({ title: `Shorten ${tilde(file)}`, idea: `${f.fix} File: ${file}.`, cwd: repo, plan: null, advice: a });
      else out.push({ title: `Shorten ${tilde(file)}`, idea: f.fix, cwd: home, plan: plan(f, a, `**Do:** ${f.fix}`), advice: a });
    } else if (f.rule === 'S4' || f.rule === 'S5') {
      const a: Advice = { key: `${f.rule}:${f.say.slice(0, 80)}`, rule: f.rule, lane: 'manual', basis: f.basis, check: 'It worked if detect no longer finds it.', saw: f.say.split(':')[0]!, doing: f.fix.replace(/\.$/, ''), checkShort: 'detect no longer finds it' };
      out.push({ title: f.title, idea: f.fix, cwd: home, plan: plan(f, a, `**Do:** ${f.fix}`), advice: a });
    }
  }
  return out;
}

/** Keys you dropped (not ones that expired unseen): those never come back. */
function droppedKeys(): Set<string> {
  const path = homePath('archive.jsonl');
  const keys = new Set<string>();
  if (!existsSync(path)) return keys;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    try {
      const c = JSON.parse(line) as Card & { expired?: boolean };
      if (c.advice?.key && !c.expired) keys.add(c.advice.key);
    } catch {}
  }
  return keys;
}

/** Add new advice as suggested cards, refresh the evidence on ones still suggested, skip ones you dealt with. */
export function upsertAdvice(board: BoardData, drafts: AdviceDraft[], now: Date): { added: Card[]; updated: Card[]; skipped: number } {
  const dropped = droppedKeys();
  const added: Card[] = [];
  const updated: Card[] = [];
  let skipped = 0;
  for (const d of drafts) {
    const had = board.cards.find((c) => c.advice?.key === d.advice.key);
    if (had) {
      if (had.column === 'suggested') {
        had.title = d.title;
        had.idea = d.idea;
        if (d.plan) had.blueprint = d.plan;
        had.advice = { ...d.advice };
        had.updatedAt = now.toISOString();
        updated.push(had);
      } else skipped++;
      continue;
    }
    if (dropped.has(d.advice.key)) {
      skipped++;
      continue;
    }
    const c = addCard(board, d.idea, d.cwd, now, 'suggested', d.advice.lane === 'work' ? null : 'advice');
    c.title = d.title;
    c.blueprint = d.plan;
    c.source = 'detect';
    c.why = `chompyy detect, rule ${d.advice.rule}${d.advice.tokens ? `: ${d.advice.basis === 'estimated' ? '~' : ''}${k(d.advice.tokens)} tokens` : ''}`;
    c.advice = { ...d.advice };
    added.push(c);
  }
  return { added, updated, skipped };
}

export function runAdvise(board: BoardData, now: Date, r = detect({ now })): { added: Card[]; updated: Card[]; skipped: number } {
  return upsertAdvice(board, adviceFrom(r, { nudgeOn: nudgeInstalled() }), now);
}

// ---------- approving, applying, undoing ----------

/** What approving an advice card does (the board already checked it's suggested or later). */
export function approveAdvice(c: Card, now: Date): string {
  const a = c.advice!;
  const at = now.toISOString();
  c.updatedAt = at;
  c.approvedAt = at;
  if (a.lane === 'settings') {
    c.column = 'approved';
    a.state = 'waiting';
    a.note = 'Applies once no Claude Code session has run for 10 minutes.';
    return `✅ #${c.id} approved. Applies once no Claude Code session has run for 10 minutes.`;
  }
  c.column = 'done';
  a.since = at;
  a.state = a.lane === 'habit' ? 'trying' : 'done';
  return a.lane === 'habit' ? `✅ #${c.id}: trying it from today. ${a.check}` : `✅ #${c.id} done. ${a.check}`;
}

/** When a Claude Code session last wrote its transcript (ms), so settings never change under an open conversation. */
export function lastSessionActivity(root = projectsDir()): number {
  let last = 0;
  try {
    for (const folder of readdirSync(root)) {
      if (isAutomated(folder)) continue;
      try {
        for (const f of readdirSync(join(root, folder))) {
          if (f.endsWith('.jsonl')) last = Math.max(last, statSync(join(root, folder, f)).mtimeMs);
        }
      } catch {}
    }
  } catch {}
  return last;
}

function getAt(obj: Record<string, unknown>, key: string[]): unknown {
  let cur: unknown = obj;
  for (const p of key) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
  return cur;
}

function setAt(obj: Record<string, unknown>, key: string[], value: unknown): void {
  let cur = obj;
  for (const p of key.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  if (value === undefined) delete cur[key.at(-1)!];
  else cur[key.at(-1)!] = value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Write `changes` (or undo them): every value must still be what we expect, or nothing is written. */
function writeChanges(changes: SettingChange[], undo: boolean, backupTag: string): string[] {
  const files = [...new Set(changes.map((c) => c.file))];
  const backups: string[] = [];
  const edited = new Map<string, Record<string, unknown>>();
  for (const file of files) {
    let json: Record<string, unknown> = {};
    if (existsSync(file)) {
      try {
        json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch {
        throw new Error(`${tilde(file)} isn't valid JSON, so Chompyy left it alone.`);
      }
    }
    for (const c of changes.filter((x) => x.file === file)) {
      const now = getAt(json, c.key);
      const expect = undo ? c.to : c.from;
      const target = undo ? c.from : c.to;
      if (same(now, target)) continue;
      if (!same(now, expect)) throw new Error(`${c.key.join('.')} in ${tilde(file)} is ${JSON.stringify(now ?? '(not set)')} now, not ${JSON.stringify(expect ?? '(not set)')}: it changed since, so Chompyy left it alone.`);
      setAt(json, c.key, target);
    }
    edited.set(file, json);
  }
  for (const [file, json] of edited) {
    if (existsSync(file)) {
      const backup = homePath('backups', `${backupTag}-${basename(file)}`);
      copyFileSync(file, backup);
      backups.push(backup);
    }
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  return backups;
}

/** Apply approved settings advice, if no session has been active for 10 minutes. Returns what happened. */
export function applyDue(board: BoardData, now: Date, lastActivity = lastSessionActivity()): string[] {
  const due = board.cards.filter((c) => c.advice?.lane === 'settings' && c.column === 'approved' && c.advice.state === 'waiting');
  if (!due.length) return [];
  const idle = now.getTime() - lastActivity;
  if (idle < IDLE_BEFORE_APPLY_MS) {
    const mins = Math.ceil((IDLE_BEFORE_APPLY_MS - idle) / 60_000);
    for (const c of due) c.advice!.note = `Waiting: a session ran ${Math.floor(idle / 60_000)} min ago. Retries in ~${mins} min.`;
    return due.map((c) => `#${c.id} waits: a Claude Code session is active.`);
  }
  return due.map((c) => {
    const a = c.advice!;
    c.updatedAt = now.toISOString();
    try {
      const clash = (a.copies ?? []).find((x) => existsSync(x.to));
      if (clash) throw new Error(`${tilde(clash.to)} already exists, so Chompyy changed nothing. Move it away and approve again, or drop the card.`);
      const missing = (a.copies ?? []).find((x) => !existsSync(x.from));
      if (missing) throw new Error(`${tilde(missing.from)} is gone (the plugin was updated?), so Chompyy changed nothing. Run chompyy advise again.`);
      for (const x of a.copies ?? []) cpSync(x.from, x.to, { recursive: true });
      try {
        a.backups = writeChanges(a.changes ?? [], false, `card-${c.id}-${now.getTime()}`);
      } catch (e) {
        for (const x of a.copies ?? []) rmSync(x.to, { recursive: true, force: true });
        throw e;
      }
      a.state = 'applied';
      a.since = now.toISOString();
      a.note = 'Applied. New sessions pick it up.';
      c.column = 'done';
      return `#${c.id} applied: ${c.title}`;
    } catch (e) {
      a.state = 'failed';
      a.note = (e as Error).message;
      c.column = 'done';
      return `#${c.id} not applied: ${a.note}`;
    }
  });
}

/** Undo an applied settings card (only if nothing changed the values since), or stop trying a habit. */
export function undoAdvice(c: Card, now: Date): string {
  const a = c.advice!;
  c.updatedAt = now.toISOString();
  // Undone: there is nothing left to measure.
  delete a.result;
  if (a.lane === 'settings' && a.state === 'applied') {
    a.backups = [...(a.backups ?? []), ...writeChanges(a.changes ?? [], true, `card-${c.id}-undo-${now.getTime()}`)];
    // The plugin is back on, so the copies would load twice: move them into Chompyy's backups (in case you edited them).
    for (const x of a.copies ?? []) {
      if (!existsSync(x.to)) continue;
      const kept = homePath('backups', `card-${c.id}-undo-${now.getTime()}-${basename(x.to)}`);
      renameSync(x.to, kept);
      a.backups.push(kept);
    }
    a.state = 'undone';
    a.note = 'Put back. New sessions pick it up.';
    return `↩️  #${c.id} undone: old settings back.`;
  }
  if (a.lane === 'settings' && a.state === 'waiting') {
    a.state = 'undone';
    a.note = 'Cancelled before it was applied.';
    c.column = 'done';
    return `↩️  #${c.id} cancelled: nothing changed.`;
  }
  a.state = 'undone';
  a.note = 'You stopped this one.';
  return `↩️  #${c.id} stopped.`;
}

export function adviseText(res: { added: Card[]; updated: Card[]; skipped: number }): string {
  const lines: string[] = [];
  if (!res.added.length && !res.updated.length) return `Nothing new to suggest${res.skipped ? ` (${res.skipped} you already dealt with)` : ''}.`;
  lines.push('Approve or drop on the board, or: chompyy approve <id> / chompyy drop <id>', '');
  if (res.added.length) lines.push(`${res.added.length} new:`, ...res.added.slice(0, 5).map((c) => `  #${c.id} ${c.title}`), ...(res.added.length > 5 ? [`  …and ${res.added.length - 5} more on the board`] : []));
  if (res.updated.length) lines.push(`${res.updated.length} updated with fresh numbers.`);
  return lines.join('\n');
}
