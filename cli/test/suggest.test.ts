import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardData } from '../src/board.js';
import type { Runner } from '../src/runner.js';
import { addSuggested, repoDigest, suggestPrompt, suggestTasks, validateTasks } from '../src/suggest.js';

const NOW = new Date('2026-11-27T12:00:00Z');

/** A repo with a vision doc, a design note, a TODO and two commits. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chompyy-suggest-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# Notes app\nA notes app. Next: export to Markdown.\n');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'design.md'), '# Design\nSync comes after export.\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'parse.ts'), 'export const parse = (s: string) => s; // TODO: handle empty input\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Parser');
  writeFileSync(join(dir, 'src', 'store.ts'), 'export const store = {};\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Store');
  return dir;
}

const runner = (output: string): Runner & { prompts: string[] } => {
  const prompts: string[] = [];
  return { prompts, run: async (req) => (prompts.push(req.prompt), { exitCode: 0, output, stderr: '', timedOut: false, durationMs: 1 }) };
};

describe('the repo digest', () => {
  it('reads the vision docs, TODOs, commits and issues, and lists what a task may cite', () => {
    const r = repo();
    const d = repoDigest(r, { issues: [{ number: 12, title: 'Export to Markdown' }], existing: ['Add dark mode'] });
    expect(d.text).toContain('## File: README.md');
    expect(d.text).toContain('## File: docs/design.md');
    expect(d.text).toContain('src/parse.ts:1:');
    expect(d.text).toMatch(/## Recent commits\n[0-9a-f]+ Store\n[0-9a-f]+ Parser/);
    expect(d.text).toContain('#12 Export to Markdown');
    expect(d.text).toContain('- Add dark mode');
    for (const s of ['README.md', 'docs/design.md', 'src/parse.ts', 'src/store.ts', '#12']) expect(d.sources.has(s)).toBe(true);
    expect(suggestPrompt(d.text, 5)).toContain('Propose up to 5 tasks');
  });
});

describe('validating what the model proposed', () => {
  const sources = new Set(['README.md', '#12', 'src/parse.ts']);
  it('keeps tasks with a real source, drops invented sources and repeats of cards you have', () => {
    const raw = {
      tasks: [
        { title: 'Export notes to Markdown', idea: 'Add an export command; a test checks the output.', why: 'README says next', source: 'README.md', size: 'medium', kind: 'vision' },
        { title: 'Handle empty input in parse', idea: 'Return [] for ""; add a test.', source: 'src/parse.ts', size: 'small', kind: 'chore' },
        { title: 'Add sync', idea: 'Sync to the cloud.', source: 'docs/made-up.md', kind: 'vision' },
        { title: 'Add dark mode!', idea: 'Theme it.', source: '#12', kind: 'vision' },
      ],
    };
    const { tasks, dropped } = validateTasks(raw, sources, ['Add dark mode'], 5);
    expect(tasks.map((t) => [t.title, t.kind, t.size])).toEqual([
      ['Export notes to Markdown', 'vision', 'medium'],
      ['Handle empty input in parse', 'chore', 'small'],
    ]);
    expect(dropped).toBe(2);
  });

  it('survives prose around the JSON and caps the count', async () => {
    const r = repo();
    const out = `Here you go:\n${JSON.stringify({ tasks: [1, 2, 3].map((i) => ({ title: `Task ${i}`, idea: 'Do it; a test checks.', source: 'README.md' })) })}\nDone.`;
    const fake = runner(out);
    const res = await suggestTasks(r, fake, { model: 'sonnet', cwd: r, existing: [], count: 2, issues: [] });
    expect(res.tasks.map((t) => t.title)).toEqual(['Task 1', 'Task 2']);
    expect(fake.prompts[0]).toContain('## File: README.md');
  });
});

describe('the cards', () => {
  it('land in suggested, in that repo, saying where they came from', () => {
    const b: BoardData = { nextId: 1, cards: [] };
    const cards = addSuggested(b, '/work/notes', [{ title: 'Export notes to Markdown', idea: 'Add export.', why: 'README says next', source: 'README.md', size: 'medium', kind: 'vision' }], NOW);
    expect(cards[0]).toMatchObject({ column: 'suggested', cwd: '/work/notes', title: 'Export notes to Markdown', source: 'suggest', why: 'Next step from README.md · medium: README says next' });
  });
});
