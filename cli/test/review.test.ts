import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Card, RunStatus } from '../src/board.js';
import { formatReport } from '../src/report.js';
import { changedFiles, firstQuestions, keepCard, questionsOf, undoCard } from '../src/review.js';
import { prepareWorkspace } from '../src/workspace.js';
import { NOW, useTempHome } from './helpers.js';

const ranCard = (id: string, status: RunStatus, extra: Partial<Card> = {}): Card => ({
  id, title: `card ${id}`, idea: 'i', cwd: '/x', column: 'review', blueprint: 'bp',
  createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  run: { status, startedAt: '', finishedAt: '', durationMs: 42_000, exitCode: 0, workdir: '/x/w', summary: 'long agent text' },
  ...extra,
});

describe('firstQuestions', () => {
  it('keeps top-level items, strips markdown, skips sub-points', () => {
    const md = `# Questions\n\nIntro.\n\n1. **What is the repo practising?** Options:\n   - (a) keep it generic\n2. **Who is it for?** Just you?\n3. Third\n`;
    expect(firstQuestions(md)).toEqual(['What is the repo practising?', 'Who is it for? Just you?']);
  });

  it('shortens long questions', () => {
    const q = firstQuestions(`- ${'x'.repeat(200)}`)[0];
    expect(q.length).toBeLessThanOrEqual(90);
    expect(q.endsWith('…')).toBe(true);
  });
});

describe('formatReport', () => {
  const facts = (c: Card) => (c.id === '2' ? { files: ['README.md', 'QUESTIONS.md'], questions: ['What is it for?'] } : { files: [], questions: [] });

  it('puts the cards that need you first and leads each with one action', () => {
    const text = formatReport([ranCard('1', 'ok'), ranCard('2', 'questions')], null, facts);
    expect(text.indexOf('#2')).toBeLessThan(text.indexOf('#1'));
    expect(text).toContain('→ Answer its question, then keep or undo');
    expect(text).toContain('· What is it for?');
    expect(text).toContain('changed: README.md, QUESTIONS.md');
    expect(text).toContain('More on a card: chompyy show 2 · diff 2 · keep 2 · undo 2');
  });

  it('leaves out paths and the raw agent text', () => {
    const text = formatReport([ranCard('1', 'ok')], null, facts);
    expect(text).not.toContain('/x/w');
    expect(text).not.toContain('long agent text');
  });

  it('says plainly when nothing is new', () => {
    expect(formatReport([], '2026-11-13', facts)).toBe('Nothing new since your last report.');
  });
});

describe('keep and undo', () => {
  useTempHome();
  const temps: string[] = [];
  afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  beforeAll(() => {
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) process.env[k] = 't';
    for (const k of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) process.env[k] = 't@t';
  });

  /** A repo with one commit, and a card that "ran" on chompyy/<id> adding a file and QUESTIONS.md. */
  function setup(id: string) {
    const repo = mkdtempSync(join(tmpdir(), 'chompyy-review-'));
    temps.push(repo);
    const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'README.md'), '# demo\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'init');
    const base = ranCard(id, 'questions', { cwd: repo });
    const ws = prepareWorkspace(base);
    writeFileSync(join(ws.dir, 'NEW.md'), 'new\n');
    writeFileSync(join(ws.dir, 'QUESTIONS.md'), '1. Is this right?\n');
    git(ws.dir, 'add', '.');
    git(ws.dir, 'commit', '-qm', 'work');
    const card: Card = { ...base, run: { ...base.run!, workdir: ws.dir, branch: ws.branch } };
    return { repo, card, git };
  }

  it('reports changed files and questions from the branch', () => {
    const { card } = setup('5');
    expect(changedFiles(card).sort()).toEqual(['NEW.md', 'QUESTIONS.md']);
    expect(questionsOf(card)).toEqual(['Is this right?']);
  });

  it('keep merges the branch and tidies up', () => {
    const { repo, card, git } = setup('6');
    keepCard(card);
    expect(existsSync(join(repo, 'NEW.md'))).toBe(true);
    expect(existsSync(card.run!.workdir)).toBe(false);
    expect(git(repo, 'branch', '--list', 'chompyy/6')).toBe('');
  });

  it('keep refuses when the repo has uncommitted changes', () => {
    const { repo, card } = setup('7');
    writeFileSync(join(repo, 'README.md'), '# edited\n');
    expect(() => keepCard(card)).toThrow(/uncommitted changes/);
  });

  it('undo removes the branch and leaves your branch untouched', () => {
    const { repo, card, git } = setup('8');
    const before = git(repo, 'rev-parse', 'HEAD');
    undoCard(card);
    expect(git(repo, 'branch', '--list', 'chompyy/8')).toBe('');
    expect(existsSync(card.run!.workdir)).toBe(false);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(existsSync(join(repo, 'NEW.md'))).toBe(false);
  });
});
