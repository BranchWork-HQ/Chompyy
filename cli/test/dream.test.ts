import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkFindings, dream, loadDream, readLogPath, scanSessions, setTicked, stripSession, workspaces, DESKTOP } from '../src/dream.js';
import { chompyyHome } from '../src/home.js';
import type { RunRequest, RunResult, Runner } from '../src/runner.js';
import { promote, readSignals, type Preference } from '../src/taste.js';
import { NOW, useTempHome } from './helpers.js';

// The nightly read (2026-11-20): Chompyy reads your everyday coding sessions offline, like a dream, and only
// proposes. Measured first: research/nightly-read/ (3.5M raw tokens a day → ~21k stripped; Opus picked).

const at = (min: number) => new Date(NOW.getTime() - 3600_000 + min * 60_000).toISOString();
const line = (o: Record<string, unknown>) => JSON.stringify(o);
const you = (cwd: string, min: number, text: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', timestamp: at(min), cwd, entrypoint: 'cli', message: { role: 'user', content: text }, ...extra });
const claude = (cwd: string, min: number, content: unknown[]) => line({ type: 'assistant', timestamp: at(min), cwd, message: { role: 'assistant', content } });

let projects: string;
let repo: string;
let plain: string;

function session(dir: string, name: string, lines: string[]): string {
  mkdirSync(join(projects, dir), { recursive: true });
  const file = join(projects, dir, `${name}.jsonl`);
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

class FakeRunner implements Runner {
  prompts: string[] = [];
  constructor(private reply: (prompt: string) => string) {}
  async run(req: RunRequest): Promise<RunResult> {
    this.prompts.push(req.prompt);
    return {
      exitCode: 0, output: this.reply(req.prompt), stderr: '', timedOut: false, durationMs: 5,
      tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, thinking: 0, costUsd: 0.05, turns: 1, models: ['claude-opus-5-5'] },
    };
  }
}

describe('the nightly read', () => {
  useTempHome();

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'chompyy-projects-'));
    process.env.CHOMPYY_CLAUDE_PROJECTS = projects;
    repo = mkdtempSync(join(tmpdir(), 'chompyy-repo-'));
    execFileSync('git', ['init', '-q', repo]);
    plain = mkdtempSync(join(tmpdir(), 'chompyy-plain-'));
    session('repo', 'a1', [
      you(repo, 1, 'make the report shorter'),
      claude(repo, 2, [{ type: 'text', text: 'Here is a long report…' }, { type: 'tool_use', name: 'Edit', input: { file_path: '/x/report.md' } }]),
      line({ type: 'user', timestamp: at(3), cwd: repo, message: { content: [{ type: 'tool_result', content: 'SECRET FILE CONTENTS that must not be read' }] } }),
      line({ type: 'user', timestamp: at(4), cwd: repo, message: { content: [{ type: 'tool_result', content: 'The user doesn\'t want to proceed with this tool use. The tool use was rejected' }] } }),
      you(repo, 5, 'i want to build a robust system,\nrn it feels like we are just patching things up'),
      you(repo, 6, '<command-name>/clear</command-name>'),
    ]);
    session('repo', 'a2', [you(repo, 10, 'can you draw it as a diagram first'), claude(repo, 11, [{ type: 'text', text: 'Sure.' }])]);
    session('desktop', 'd1', [line({ type: 'user', timestamp: at(7), cwd: plain, entrypoint: 'claude-desktop', message: { content: 'help me do this hw' } })]);
    session('plain', 'p1', [you(plain, 8, 'hi')]);
    session('chompyy', 'c1', [you(join(chompyyHome(), 'worktrees', '3'), 9, 'a card run')]);
  });

  it('finds the workspaces: coding folders start ticked, the desktop app and plain folders do not, Chompyy\'s own runs are skipped', () => {
    const list = workspaces(loadDream(), scanSessions());
    const byPath = Object.fromEntries(list.map((w) => [w.path, w]));
    expect(byPath[repo]).toMatchObject({ kind: 'repo', sessions: 2, ticked: true });
    expect(byPath[DESKTOP]).toMatchObject({ kind: 'desktop', ticked: false });
    expect(byPath[plain]).toMatchObject({ kind: 'folder', ticked: false });
    expect(list.some((w) => w.path.startsWith(chompyyHome()))).toBe(false);
  });

  it('tick and untick are remembered', () => {
    setTicked('desktop', true, NOW);
    setTicked(repo, false, NOW);
    const list = workspaces(loadDream(), scanSessions());
    expect(list.find((w) => w.path === DESKTOP)!.ticked).toBe(true);
    expect(list.find((w) => w.path === repo)!.ticked).toBe(false);
  });

  it('strips a session to the conversation: your words, Claude\'s replies, one line per tool call, ⚑ for a turned-down tool; no tool output', () => {
    const s = stripSession(join(projects, 'repo', 'a1.jsonl'), repo, '')!;
    expect(s.text).toContain('YOU: make the report shorter');
    expect(s.text).toContain('CLAUDE: Here is a long report');
    expect(s.text).toContain('[Edit: /x/report.md]');
    expect(s.text).toContain('⚑ YOU TURNED DOWN THIS TOOL USE');
    expect(s.text).not.toContain('SECRET FILE CONTENTS');
    expect(s.text).not.toContain('/clear');
    expect(s.you.map((y) => y.text)).toEqual(['make the report shorter', 'i want to build a robust system,\nrn it feels like we are just patching things up']);
    expect(stripSession(join(projects, 'repo', 'a1.jsonl'), repo, at(4))!.you).toHaveLength(1); // only what came after
  });

  it('keeps only findings whose quotes are your exact words, even across lines or under the wrong session label', () => {
    const s1 = stripSession(join(projects, 'repo', 'a1.jsonl'), repo, '')!;
    const s2 = stripSession(join(projects, 'repo', 'a2.jsonl'), repo, '')!;
    const out = JSON.stringify([
      { rule: 'Build systems, not patches.', session: 'S1', quotes: ['robust system, rn it feels like we are just patching'], strength: 'stated' },
      { rule: 'Show a diagram first.', session: 'S1', quotes: ['draw it as a diagram first'], strength: 'stated' }, // really in S2
      { rule: 'Made up.', session: 'S1', quotes: ['i love long reports'], strength: 'stated' },
      { rule: 'No quote.', session: 'S2', quotes: [] },
      { rule: 'Claude said it, not you.', session: 'S1', quotes: ['Here is a long report'] },
    ]);
    const { findings, dropped } = checkFindings(`Sure:\n${out}`, new Map([['S1', s1], ['S2', s2]]));
    expect(findings.map((f) => f.rule)).toEqual(['Build systems, not patches.', 'Show a diagram first.']);
    expect(findings[1]!.session).toBe(s2);
    expect(findings[0]!.at).toBe(at(5));
    expect(dropped).toBe(3);
  });

  it('reads the ticked workspaces once, saves what it read on your Mac, and turns real quotes into chat signals', async () => {
    const runner = new FakeRunner(() => JSON.stringify([
      { rule: 'Build systems, not patches.', why: 'asked for a robust system', session: 'S2', quotes: ['rn it feels like we are just patching things up'], strength: 'stated' },
      { rule: 'Invented.', session: 'S1', quotes: ['never said this'] },
    ]));
    const r = await dream(runner, { model: 'opus', now: NOW });
    expect(runner.prompts).toHaveLength(1);
    expect(runner.prompts[0]).toContain('make the report shorter');
    expect(runner.prompts[0]).not.toContain('help me do this hw'); // desktop app: not ticked
    expect(runner.prompts[0]).not.toContain('a card run');
    expect(r).toMatchObject({ sessions: 2, signals: 1, dropped: 1 });
    expect(r.tokens).toMatchObject({ input: 1000, output: 200 });
    const chat = readSignals().filter((s) => s.kind === 'chat');
    expect(chat).toHaveLength(1);
    expect(chat[0]!.raw).toMatchObject({ session: 'a1', workspace: repo, rule: 'Build systems, not patches.', quote: 'rn it feels like we are just patching things up' });
    expect(readFileSync(readLogPath(NOW), 'utf8')).toContain('YOU: can you draw it as a diagram first');

    // The next night: nothing new, no model call.
    const again = await dream(runner, { model: 'opus', now: new Date(NOW.getTime() + 86400_000) });
    expect(again.sessions).toBe(0);
    expect(runner.prompts).toHaveLength(1);
  });

  it('a dry run strips and saves the preview but calls no model and marks nothing read', async () => {
    const runner = new FakeRunner(() => '[]');
    const r = await dream(runner, { model: 'opus', now: NOW, dryRun: true });
    expect(r.sessions).toBe(2);
    expect(runner.prompts).toHaveLength(0);
    expect(loadDream().readThrough).toEqual({});
  });

  it('a model failure keeps the sessions unread for the next night', async () => {
    const runner: Runner = { run: async () => ({ exitCode: 1, output: '', stderr: 'rate limited', timedOut: false, durationMs: 1 }) };
    const r = await dream(runner, { model: 'opus', now: NOW });
    expect(r.error).toMatch(/rate limited/);
    expect(loadDream().readThrough).toEqual({});
  });
});

describe('two sightings', () => {
  useTempHome();
  const chat = (id: string, session: string) => ({ id, kind: 'chat' as const, at: NOW.toISOString(), raw: { session, quote: 'q' } });
  const pref = (evidence: string[]): Preference => ({
    id: 'p1', scope: 'Everywhere', text: 't', noticed: 'n', status: 'candidate', evidence, stated: false, createdAt: '', updatedAt: '',
  });

  it('a rule seen in one session waits; seen in two different sessions it is asked', () => {
    const byId = new Map([chat('s1', 'a'), chat('s2', 'a'), chat('s3', 'b')].map((s) => [s.id, s]));
    const once = pref(['s1', 's2']); // twice, but in the same session
    promote(once, byId);
    expect(once.status).toBe('candidate');
    const twice = pref(['s1', 's3']);
    promote(twice, byId);
    expect(twice.status).toBe('ready');
  });

  it('a session and two cards also make three sightings', () => {
    const byId = new Map<string, Parameters<typeof promote>[1] extends Map<string, infer S> ? S : never>([
      ['s1', chat('s1', 'a')],
      ['s2', { id: 's2', kind: 'rating', at: '', card: '4', raw: { rating: 3 } }],
      ['s3', { id: 's3', kind: 'rating', at: '', card: '5', raw: { rating: 3 } }],
    ]);
    const p = pref(['s1', 's2', 's3']);
    promote(p, byId);
    expect(p.status).toBe('ready');
  });
});
