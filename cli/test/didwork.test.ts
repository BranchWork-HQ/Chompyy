import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Advice } from '../src/advice.js';
import { undoAdvice } from '../src/advice.js';
import type { BoardData, Card } from '../src/board.js';
import type { Scan, Session, Turn } from '../src/detect.js';
import { checkC1, checkC2, checkClaudeMd, checkPlugin, checkSkillsGone, checkWorked, measurable, workedText } from '../src/didwork.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const SINCE = Date.parse('2026-11-26T12:00:00Z');
const PLUGIN = 'mattpocock-skills@claude-plugins-official';

const t = (at: number, o: Partial<Turn> = {}): Turn => ({ at, cacheRead: 0, cacheWrite: 0, wrote1h: true, ...o });
/** A session with a cold return at `at` (two hours after its first turn). */
const cold = (at: number, tokens = 100_000): Session => ({ id: `c${at}`, cwd: '/w', turns: [t(at - 2 * HOUR, { cacheWrite: 40_000 }), t(at, { cacheWrite: tokens, miss: 'previous_message_not_found' })] });
const scanOf = (sessions: Session[]): Scan => ({ sessions, skills: new Map(), commands: new Map(), mcp: new Map(), firstAt: 0, lastAt: 0 });
const days = (from: number, n: number, every = 1) => Array.from({ length: n }, (_, i) => from + (i * every + 0.5) * DAY);

describe('C1: cold returns, the week before vs the second week after', () => {
  const before = days(SINCE - 7 * DAY, 6).map((d) => cold(d));

  it('is too early before two weeks, with the reading so far and the day the verdict comes', () => {
    const r = checkC1(SINCE, SINCE + 4 * DAY, scanOf([...before, cold(SINCE + DAY)]));
    expect(r.verdict).toBe('too-early');
    expect(r.line).toBe('So far 1 cold return in 4 days (about 2 a week), against 6 the week before you started. The verdict comes on Dec 10.');
  });

  it('worked at a third fewer in week two, with the saving in tokens and the session counts beside it', () => {
    const after = days(SINCE + 7 * DAY, 4).map((d) => cold(d));
    const r = checkC1(SINCE, SINCE + 15 * DAY, scanOf([...before, ...after]));
    expect(r).toMatchObject({ verdict: 'worked', method: 'before-after', before: 6, after: 4, saved: 200_000 });
    expect(r.line).toContain('6 → 4 (200k fewer tokens rebuilt): it worked');
    expect(r.also).toContain("before/after can't tell the two apart");
  });

  it('a regression is shown as one, signed, never as zero', () => {
    const after = days(SINCE + 7 * DAY, 7).map((d) => cold(d, 150_000));
    const r = checkC1(SINCE, SINCE + 15 * DAY, scanOf([...before, ...after]));
    expect(r).toMatchObject({ verdict: 'worse', saved: -450_000 });
    expect(r.line).toContain('450k more tokens rebuilt');
  });

  it('says so when there is nothing to compare against', () => {
    expect(checkC1(SINCE, SINCE + 15 * DAY, scanOf([])).verdict).toBe('cant-tell');
  });
});

describe('C2: mid-session rebuilds', () => {
  const rebuild = (at: number): Session => ({ id: `r${at}`, cwd: '/w', turns: [t(at, { miss: 'tools_changed', missedTokens: 60_000 })] });
  it('worked if there are none in the two weeks after', () => {
    const r = checkC2(SINCE, SINCE + 15 * DAY, scanOf([rebuild(SINCE - 3 * DAY), rebuild(SINCE - DAY)]));
    expect(r).toMatchObject({ verdict: 'worked', before: 2, after: 0, saved: 120_000 });
  });
  it('not none is not worked', () => {
    const r = checkC2(SINCE, SINCE + 15 * DAY, scanOf([rebuild(SINCE - 3 * DAY), rebuild(SINCE - DAY), rebuild(SINCE + 2 * DAY)]));
    expect(r.verdict).toBe('short');
  });
});

/** A ~/.claude with one plugin of `n` skills, on or off. */
function claudeDir(on: boolean, n = 3): string {
  const dir = mkdtempSync(join(tmpdir(), 'chompyy-didwork-'));
  const install = join(dir, 'plugins', 'cache', 'mp');
  for (let i = 0; i < n; i++) {
    mkdirSync(join(install, 'skills', `s${i}`), { recursive: true });
    writeFileSync(join(install, 'skills', `s${i}`, 'SKILL.md'), `---\nname: s${i}\ndescription: ${'x'.repeat(400)}\n---\nbody`);
  }
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { [PLUGIN]: [{ installPath: install }] } }));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ enabledPlugins: { [PLUGIN]: on } }));
  return dir;
}

const pluginAdvice = (dir: string): Advice => ({
  key: `S3:plugin:${PLUGIN}`,
  rule: 'S3',
  lane: 'settings',
  basis: 'estimated',
  check: 'New sessions start about 309 tokens smaller.',
  changes: [{ file: join(dir, 'settings.json'), key: ['enabledPlugins', PLUGIN], from: true, to: false }],
  baseline: { perStart: 309 },
  state: 'applied',
  since: new Date(SINCE).toISOString(),
});

describe('S3: a plugin turned off is re-counted', () => {
  it('worked: its skills no longer load, and the setting is as Chompyy left it', () => {
    const dir = claudeDir(false);
    const r = checkPlugin(pluginAdvice(dir), SINCE, SINCE + DAY, null);
    expect(r).toMatchObject({ verdict: 'worked', method: 'recount', provenance: 'intact', before: 309, after: 0, saved: 309, per: 'session start' });
    expect(r.line).toContain('it worked');
  });

  it('turned back on since: not claimed, whatever the count says', () => {
    const dir = claudeDir(true);
    const r = checkPlugin(pluginAdvice(dir), SINCE, SINCE + DAY, null);
    expect(r).toMatchObject({ verdict: 'cant-tell', provenance: 'changed' });
    expect(r.line).toContain('Not claimed');
  });

  it('puts whole session starts beside it after 3 days, never added to the re-count', () => {
    const dir = claudeDir(false);
    const start = (at: number, n: number): Session => ({ id: `s${at}`, cwd: '/w', turns: [t(at, { cacheWrite: n })] });
    const s = scanOf([...days(SINCE - 7 * DAY, 6).map((d) => start(d, 46_000)), ...days(SINCE, 6, 0.5).map((d) => start(d, 45_500))]);
    const r = checkPlugin(pluginAdvice(dir), SINCE, SINCE + 4 * DAY, s);
    expect(r.saved).toBe(309);
    expect(r.also).toContain('46.0k → 45.5k (500 smaller');
  });
});

describe('re-counting what only you can do', () => {
  it('synced skills: which still load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chompyy-didwork-'));
    mkdirSync(join(dir, 'skills', 'synced', 'pdf'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'synced', 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: read pdfs\n---\n');
    const a: Advice = { key: 'S3:synced', rule: 'S3', lane: 'manual', basis: 'estimated', check: '', baseline: { names: ['pdf', 'docx', 'xlsx', 'pptx'] } };
    const r = checkSkillsGone(a, SINCE, dir);
    expect(r).toMatchObject({ verdict: 'worked', before: 4, after: 1 });
    expect(r.line).toContain('3 of the 4 skills no longer load; 1 still does');
  });

  it('older cards without a baseline: the names come from the card\'s own instructions', () => {
    const a: Advice = { key: 'S3:synced', rule: 'S3', lane: 'manual', basis: 'estimated', check: '' };
    const plan = "**What to do (only you can):** these skills come from your claude.ai account. In claude.ai settings, turn off the ones you don't use: docx, pdf, xlsx. Then press \"I've done it\".";
    expect(checkSkillsGone(a, SINCE, mkdtempSync(join(tmpdir(), 'chompyy-didwork-')), plan)).toMatchObject({ verdict: 'worked', before: 3, after: 0 });
  });

  it('CLAUDE.md: re-measured against the size on the card', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'chompyy-didwork-')), 'CLAUDE.md');
    writeFileSync(file, 'rule\n'.repeat(120));
    const r = checkClaudeMd({ key: `S2:${file}`, rule: 'S2', lane: 'work', basis: 'estimated', check: '', baseline: { lines: 340, tokens: 5200 } }, SINCE);
    expect(r).toMatchObject({ verdict: 'worked', before: 5200, after: 150, saved: 5050 });
    expect(r.line).toContain('340 → 121 lines');
  });
});

describe('the board', () => {
  const card = (id: string, advice: Advice, column: Card['column'] = 'done'): Card => ({ id, title: `card ${id}`, idea: '', cwd: '/', column, createdAt: '', updatedAt: new Date(SINCE).toISOString(), advice } as Card);

  it('measures applied, tried and done cards; not suggested, waiting or undone ones', () => {
    const dir = claudeDir(false);
    expect(measurable(card('1', pluginAdvice(dir)))).toBe(true);
    expect(measurable(card('2', { ...pluginAdvice(dir), state: 'waiting' }, 'approved'))).toBe(false);
    expect(measurable(card('3', { ...pluginAdvice(dir), state: undefined }, 'suggested'))).toBe(false);
    expect(measurable(card('4', { ...pluginAdvice(dir), state: 'undone' }))).toBe(false);
  });

  it('writes the result on the card, prints it, and Undo clears it', () => {
    const dir = claudeDir(false);
    const b: BoardData = { nextId: 2, cards: [card('1', pluginAdvice(dir))] };
    const root = mkdtempSync(join(tmpdir(), 'chompyy-didwork-projects-'));
    const measured = checkWorked(b, new Date(SINCE + DAY), { root });
    expect(measured[0]!.advice!.result?.verdict).toBe('worked');
    const text = workedText(measured);
    expect(text).toContain('✅ #1 card 1');
    expect(text).toContain('Re-counted (strongest): ~309 tokens off every session start, from 1 fix.');
    undoAdvice(b.cards[0]!, new Date(SINCE + 2 * DAY));
    expect(b.cards[0]!.advice!.result).toBeUndefined();
  });

  it('a habit verdict, once due, is kept (the transcripts behind it get cleaned up)', () => {
    const habit: Advice = { key: 'C1', rule: 'C1', lane: 'habit', basis: 'measured', check: '', state: 'trying', since: new Date(SINCE).toISOString(), result: { at: '', verdict: 'worked', method: 'before-after', line: 'kept' } };
    const b: BoardData = { nextId: 2, cards: [card('1', habit)] };
    checkWorked(b, new Date(SINCE + 30 * DAY), { root: mkdtempSync(join(tmpdir(), 'chompyy-didwork-projects-')) });
    expect(b.cards[0]!.advice!.result!.line).toBe('kept');
  });

  it('says what to do when nothing is measured yet', () => {
    expect(workedText([])).toContain('approve an advice card');
  });
});
