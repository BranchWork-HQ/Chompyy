import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBoard } from '../src/board.js';
import { acceptColdStart, addTasteLines, forgetColdStart, loadColdStart, runColdStart, validateProposals } from '../src/coldstart.js';
import { keepHistory } from '../src/claudesettings.js';
import type { HistoryScan, Session } from '../src/history.js';
import type { Runner } from '../src/runner.js';
import { NOW, useTempHome } from './helpers.js';

const session = (id: string, prompts: string[], project = '/repo', lastReply: string | null = null): Session => ({
  id, file: '', cwd: project, project, projectName: project.split('/').pop()!, started: '2026-11-01T00:00:00Z', ended: `2026-11-1${id.slice(1)}T00:00:00Z`, prompts, lastReply,
});
const sessions = [
  session('S1', ['explain it in plain words please', 'we should add a changelog later']),
  session('S2', ['no, use plain words, step by step']),
  session('S3', ['plain words again please'], '/repo', 'Want me to write tests for the parser next?'),
  session('S4', ['unrelated'], '/other'),
];
const exists = (p: string) => p === '/repo' || p === '/other';

const good = {
  taste: [
    { scope: 'Everywhere', text: 'Explain in plain words, step by step', sessions: ['S1', 'S2', 'S3'] },
    { scope: 'Everywhere', text: 'Likes emojis', sessions: ['S1', 'S2'] }, // only 2 sessions
    { scope: 'Everywhere', text: 'Uses tabs', sessions: ['S1', 'S9', 'S99'] }, // made-up sessions
  ],
  cards: [
    { title: 'Add a changelog', idea: 'Write CHANGELOG.md from git history.', project: '/repo', why: 'You said you would add one later.', sessions: ['S1'], quote: 'we should add a changelog later' },
    { title: 'Parser tests', idea: 'Write tests for the parser.', project: '/repo', why: 'Claude offered and you never answered.', sessions: ['S3'], quote: 'write tests for the parser next' },
    { title: 'Invented', idea: 'x', project: '/repo', why: 'y', sessions: ['S1'], quote: 'you asked for a rocket ship' }, // not said
    { title: 'Wrong folder', idea: 'x', project: '/nowhere', why: 'y', sessions: ['S1'], quote: 'we should add a changelog later' },
  ],
};

describe('validateProposals', () => {
  it('keeps only proposals whose evidence checks out', () => {
    const r = validateProposals(good, sessions, exists);
    expect(r.taste.map((t) => t.text)).toEqual(['Explain in plain words, step by step']);
    expect(r.taste[0]!.lastSeen).toBe('2026-11-13');
    expect(r.cards.map((c) => c.title)).toEqual(['Add a changelog', 'Parser tests']);
    expect(r.dropped).toEqual({ taste: 2, cards: 2 });
  });
});

describe('cold start', () => {
  useTempHome();
  const scan: HistoryScan = { sessions, skipped: { headless: 0, temp: 0, empty: 0, unreadable: 0 }, from: '2026-11-01', to: '2026-11-14' };
  const runner = (output: string): Runner & { prompts: string[] } => {
    const prompts: string[] = [];
    return { prompts, run: async (req) => (prompts.push(req.prompt), { exitCode: 0, output, stderr: '', timedOut: false, durationMs: 1 }) };
  };

  it('runs once with no tools, saves proposals, and accepting adds taste lines and suggested cards', async () => {
    // Projects must exist on disk, so point the sessions and cards at this test's home folder.
    const home = process.env.CHOMPYY_HOME!;
    const scanHere = { ...scan, sessions: sessions.map((s) => ({ ...s, project: home, cwd: home })) };
    const reply = JSON.stringify({ taste: good.taste.slice(0, 1), cards: good.cards.slice(0, 2).map((c) => ({ ...c, project: home })) });
    const cs = await runColdStart(scanHere, runner(`Here you go:\n${reply}`), { model: 'sonnet', cwd: home, now: NOW });
    expect(cs.taste).toHaveLength(1);
    expect(cs.cards).toHaveLength(2);
    expect(loadColdStart()!.scanned).toMatchObject({ sessions: 4, projects: 1 });

    const accepted = acceptColdStart({ taste: ['t1'], cards: ['c2'] }, NOW);
    expect(accepted.cards[0]).toMatchObject({ column: 'suggested', title: 'Parser tests', source: 'history', why: 'Claude offered and you never answered.' });
    expect(loadBoard().cards.map((c) => c.title)).toEqual(['Parser tests']);
    expect(readFileSync(join(home, 'taste.md'), 'utf8')).toMatch(/## Everywhere\n- Explain in plain words, step by step {2}\(from your history · seen in 3 sessions · last 2026-11-13\)/);
    expect(loadColdStart()!.cards.map((c) => c.status)).toEqual(['declined', 'accepted']);
    const signal = JSON.parse(readFileSync(join(home, 'signals.jsonl'), 'utf8').trim());
    expect(signal).toMatchObject({ kind: 'coldstart', accepted: { cards: ['Parser tests'] }, declined: { cards: ['Add a changelog'] } });

    // accepting again adds nothing twice
    expect(acceptColdStart({ taste: ['t1'], cards: ['c2'] }, NOW).cards).toHaveLength(0);
    expect(() => acceptColdStart({ taste: ['t9'], cards: [] }, NOW)).toThrow(/No proposal "t9"/);
    expect(forgetColdStart()).toBe(true);
    expect(loadColdStart()).toBeNull();
  });

  it('sends a prompt with the digest and no tools, and says so when the reply is not JSON', async () => {
    const r = runner('sorry, no');
    let req: { tools?: string } = {};
    const spy: Runner = { run: async (x) => ((req = x), r.run(x)) };
    await expect(runColdStart(scan, spy, { model: 'sonnet', cwd: '/tmp', now: NOW })).rejects.toThrow(/did not reply with JSON/);
    expect(req.tools).toBe('');
    expect(r.prompts[0]).toContain('### S1 · repo (/repo)');
    expect(r.prompts[0]).toContain('at least 3 DIFFERENT sessions');
    expect(r.prompts[0]).toContain("saying 'you'");
    expect(r.prompts[0]).toContain('never about the person');
  });

  it("tells the model what's already on the board and drops exact repeats", async () => {
    const home = process.env.CHOMPYY_HOME!;
    const scanHere = { ...scan, sessions: sessions.map((s) => ({ ...s, project: home, cwd: home })) };
    const r = runner(JSON.stringify({ cards: good.cards.slice(0, 2).map((c) => ({ ...c, project: home })) }));
    const cs = await runColdStart(scanHere, r, { model: 'm', cwd: home, now: NOW, existing: ['Add a Changelog'] });
    expect(r.prompts[0]).toContain("Already on their board (don't propose these again");
    expect(r.prompts[0]).toContain('- Add a Changelog');
    expect(cs.cards.map((c) => [c.id, c.title])).toEqual([['c1', 'Parser tests']]);
    expect(cs.dropped.cards).toBe(1);
  });

  it('refuses with no history', async () => {
    await expect(runColdStart({ ...scan, sessions: [] }, runner('{}'), { model: 'm', cwd: '/tmp', now: NOW })).rejects.toThrow(/No Claude Code sessions/);
  });
});

describe('addTasteLines', () => {
  it('adds under the right heading, after its last line, and creates missing headings', () => {
    const text = '# taste.md\n\n## Everywhere\n- mine\n\n## go-repo\n- other\n';
    const out = addTasteLines(text, [
      { id: 't1', scope: 'Everywhere', text: 'A', sessions: ['S1', 'S2', 'S3'], lastSeen: '2026-11-13', status: 'proposed' },
      { id: 't2', scope: 'web', text: 'B', sessions: ['S1', 'S2', 'S3'], lastSeen: '2026-11-13', status: 'proposed' },
    ]);
    expect(out).toBe('# taste.md\n\n## Everywhere\n- mine\n- A  (from your history · seen in 3 sessions · last 2026-11-13)\n\n## go-repo\n- other\n\n## web\n- B  (from your history · seen in 3 sessions · last 2026-11-13)\n');
  });
});

describe('keepHistory', () => {
  it('sets cleanupPeriodDays, keeps other settings and a backup, and refuses broken JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chompyy-set-'));
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{"theme":"dark"}');
    expect(keepHistory(365, path)).toEqual({ path, before: null });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ theme: 'dark', cleanupPeriodDays: 365 });
    expect(existsSync(`${path}.chompyy-backup`)).toBe(true);
    writeFileSync(path, '{broken');
    expect(() => keepHistory(90, path)).toThrow(/isn't valid JSON/);
    expect(readFileSync(path, 'utf8')).toBe('{broken');
    rmSync(dir, { recursive: true, force: true });
  });
});
