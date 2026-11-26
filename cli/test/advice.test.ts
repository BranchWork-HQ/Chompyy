import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviceFrom, applyDue, approveAdvice, IDLE_BEFORE_APPLY_MS, undoAdvice, upsertAdvice } from '../src/advice.js';
import { awayQueue, dropCard, type BoardData } from '../src/board.js';
import type { DetectResult } from '../src/detect.js';

const NOW = new Date('2026-11-26T12:00:00Z');
const PLUGIN = 'mattpocock-skills@claude-plugins-official';

function settingsFile(json: object = { enabledPlugins: { [PLUGIN]: true, 'swift-lsp@claude-plugins-official': true }, theme: 'dark' }): string {
  const p = join(mkdtempSync(join(tmpdir(), 'chompyy-advice-')), 'settings.json');
  writeFileSync(p, JSON.stringify(json));
  return p;
}

const result: DetectResult = {
  scanned: { sessions: 27, days: 30, skills: 42, mcpServers: 0, startTokens: 46_000, coldWeek: { count: 16, tokens: 2_500_000 }, coldWeeks: [{ from: '2026-10-29T12:00:00Z', count: 14, tokens: 1_400_000 }, { from: '2026-11-05T12:00:00Z', count: 11, tokens: 800_000 }, { from: '2026-11-12T12:00:00Z', count: 15, tokens: 2_400_000 }, { from: '2026-11-19T12:00:00Z', count: 16, tokens: 2_500_000 }] },
  findings: [
    { rule: 'C1', title: 'Coming back after the cache expired', say: '31 times…', basis: 'measured', fix: 'Before a long break, /compact.', lane: 'habit', tokens: 4_900_000 },
    {
      rule: 'S3',
      title: 'Skills you never use still load every session',
      say: '38 of 42…',
      basis: 'estimated',
      fix: 'Turn off plugins.',
      lane: 'settings',
      tokens: 89_000,
      targets: { plugins: [{ id: PLUGIN, skills: 25, tokens: 2_100 }], synced: ['docs', 'pdf', 'xlsx'], yours: [] },
    },
  ],
};

const board = (): BoardData => ({ nextId: 1, cards: [] });

describe('advice cards from detect', () => {
  it('makes a habit card with its baseline, one settings card per unused plugin, and a manual one for synced skills', () => {
    const settings = settingsFile();
    const drafts = adviceFrom(result, { nudgeOn: false, settings });
    expect(drafts.map((d) => [d.advice.key, d.advice.lane])).toEqual([
      ['C1', 'habit'],
      [`S3:plugin:${PLUGIN}`, 'settings'],
      ['S3:synced', 'manual'],
    ]);
    expect(drafts[0]!.advice.check).toContain('16 (2.5M rebuilt) in the week before');
    expect(drafts[0]!.idea).toContain('chompyy nudge on');
    const plugin = drafts[1]!;
    expect(plugin.title).toBe('Turn off the mattpocock-skills plugin (25 skills, never used)');
    expect(plugin.advice.changes).toEqual([{ file: settings, key: ['enabledPlugins', PLUGIN], from: true, to: false }]);
    expect(plugin.plan).toContain('true → false');
    expect(plugin.plan).toContain('A session start costs about 46k now');
    expect(drafts[2]!.plan).toContain('docs, pdf, xlsx');
    // The card's picture: three short steps and a chart of your own numbers.
    expect(drafts[0]!.advice.chart!.bars.map((b) => b.value)).toEqual([1_400_000, 800_000, 2_400_000, 2_500_000]);
    expect(drafts[0]!.advice.chart!.bars.at(-1)!.label).toBe('Last 7 days');
    expect(plugin.advice.chart!.bars).toEqual([{ label: 'Now', value: 46_000 }, { label: 'After', value: 43_900, highlight: true }]);
    expect(plugin.advice.saw).toContain('25 skills you never used');
    expect(drafts[2]!.advice.doing).toContain('Only you can');
  });

  it('adds them to suggested once, refreshes them, and never brings back one you dropped', () => {
    const b = board();
    const drafts = adviceFrom(result, { settings: settingsFile() });
    const first = upsertAdvice(b, drafts, NOW);
    expect(first.added).toHaveLength(3);
    expect(b.cards.every((c) => c.column === 'suggested' && c.source === 'detect' && c.workspace === 'advice' && c.blueprint)).toBe(true);
    const again = upsertAdvice(b, drafts, NOW);
    expect([again.added.length, again.updated.length]).toEqual([0, 3]);
    dropCard(b, b.cards[2]!.id, NOW);
    expect(upsertAdvice(b, drafts, NOW)).toMatchObject({ added: [], skipped: 1 });
  });
});

describe('approving', () => {
  it('a habit is tracked from today; a settings change waits, and never goes on an away run', () => {
    const b = board();
    upsertAdvice(b, adviceFrom(result, { settings: settingsFile() }), NOW);
    const [habit, plugin] = b.cards;
    approveAdvice(habit!, NOW);
    expect([habit!.column, habit!.advice!.state]).toEqual(['done', 'trying']);
    approveAdvice(plugin!, NOW);
    expect([plugin!.column, plugin!.advice!.state]).toEqual(['approved', 'waiting']);
    expect(awayQueue(b)).toEqual([]);
  });

  it('applies the exact change only once no session is active, backs it up, and undo puts it back', () => {
    const settings = settingsFile();
    const before = readFileSync(settings, 'utf8');
    const b = board();
    upsertAdvice(b, adviceFrom(result, { settings }), NOW);
    const plugin = b.cards[1]!;
    approveAdvice(plugin, NOW);

    expect(applyDue(b, NOW, NOW.getTime() - 2 * 60_000)[0]).toContain('waits');
    expect(plugin.advice!.note).toContain('active 2 min ago');
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe(true);

    expect(applyDue(b, NOW, NOW.getTime() - IDLE_BEFORE_APPLY_MS - 1)[0]).toContain('applied');
    const after = JSON.parse(readFileSync(settings, 'utf8'));
    expect(after.enabledPlugins).toEqual({ [PLUGIN]: false, 'swift-lsp@claude-plugins-official': true });
    expect(after.theme).toBe('dark');
    expect([plugin.column, plugin.advice!.state]).toEqual(['done', 'applied']);
    expect(readFileSync(plugin.advice!.backups![0]!, 'utf8')).toBe(before);

    undoAdvice(plugin, NOW);
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe(true);
    expect(plugin.advice!.state).toBe('undone');
  });

  it('leaves a value alone that changed since, both ways', () => {
    const settings = settingsFile({ enabledPlugins: { [PLUGIN]: 'something else' } });
    const b = board();
    upsertAdvice(b, adviceFrom(result, { settings }), NOW);
    const plugin = b.cards[1]!;
    approveAdvice(plugin, NOW);
    expect(applyDue(b, NOW, 0)[0]).toContain('changed since');
    expect(plugin.advice!.state).toBe('failed');
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe('something else');

    const s2 = settingsFile();
    const b2 = board();
    upsertAdvice(b2, adviceFrom(result, { settings: s2 }), NOW);
    approveAdvice(b2.cards[1]!, NOW);
    applyDue(b2, NOW, 0);
    writeFileSync(s2, JSON.stringify({ enabledPlugins: { [PLUGIN]: 'yours now' } }));
    expect(() => undoAdvice(b2.cards[1]!, NOW)).toThrow(/changed since/);
    expect(existsSync(s2)).toBe(true);
  });
});

describe('a plugin you use a little', () => {
  it('copies the skills you use into your own, turns the plugin off, and undo reverses both', () => {
    const root = mkdtempSync(join(tmpdir(), 'chompyy-advice-'));
    const src = join(root, 'plugin', 'skills', 'grilling');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), '---\nname: grilling\n---\nGrill.');
    const skillsDir = join(root, 'my-skills');
    const settings = settingsFile();
    const r: DetectResult = { ...result, findings: [{ ...result.findings[1]!, targets: { plugins: [{ id: PLUGIN, skills: 25, tokens: 2_100, keep: [{ name: 'grilling', dir: src }] }] } }] };
    const b = board();
    upsertAdvice(b, adviceFrom(r, { settings, skillsDir }), NOW);
    const c = b.cards[0]!;
    expect(c.title).toBe('Turn off 25 mattpocock-skills skills you never use (keep grilling)');
    expect(c.blueprint).toContain('copy');
    approveAdvice(c, NOW);
    applyDue(b, NOW, 0);
    expect(c.advice!.state).toBe('applied');
    expect(readFileSync(join(skillsDir, 'grilling', 'SKILL.md'), 'utf8')).toContain('Grill.');
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe(false);
    undoAdvice(c, NOW);
    expect(existsSync(join(skillsDir, 'grilling'))).toBe(false);
    expect(c.advice!.backups!.some((x) => x.endsWith('grilling') && existsSync(join(x, 'SKILL.md')))).toBe(true);
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe(true);
  });

  it("changes nothing when a skill folder of the same name is already yours", () => {
    const root = mkdtempSync(join(tmpdir(), 'chompyy-advice-'));
    const src = join(root, 'plugin', 'grilling');
    mkdirSync(src, { recursive: true });
    const skillsDir = join(root, 'my-skills');
    mkdirSync(join(skillsDir, 'grilling'), { recursive: true });
    const settings = settingsFile();
    const r: DetectResult = { ...result, findings: [{ ...result.findings[1]!, targets: { plugins: [{ id: PLUGIN, skills: 25, tokens: 2_100, keep: [{ name: 'grilling', dir: src }] }] } }] };
    const b = board();
    upsertAdvice(b, adviceFrom(r, { settings, skillsDir }), NOW);
    approveAdvice(b.cards[0]!, NOW);
    expect(applyDue(b, NOW, 0)[0]).toContain('already exists');
    expect(JSON.parse(readFileSync(settings, 'utf8')).enabledPlugins[PLUGIN]).toBe(true);
  });
});
