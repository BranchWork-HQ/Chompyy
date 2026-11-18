import { describe, expect, it } from 'vitest';
import { blueprintPrompt, cleanBlueprint, draftAllPlan, draftBlueprint, laterToDraft } from '../src/blueprint.js';
import type { BoardData, Card } from '../src/board.js';
import { claudeArgs, type RunRequest, type Runner } from '../src/runner.js';

const fake = (output: string, exitCode = 0) => {
  const calls: RunRequest[] = [];
  const runner: Runner = {
    async run(req) {
      calls.push(req);
      return { exitCode, output, stderr: exitCode ? 'auth error' : '', timedOut: false, durationMs: 5 };
    },
  };
  return { runner, calls };
};

const card = { idea: 'Digest of caching papers', cwd: '/repo' };

describe('blueprint', () => {
  it('asks for every template section', () => {
    const p = blueprintPrompt(card);
    for (const h of ['## Goal', '## Scope', '## Out of scope', '## Shape', "## How it's checked"]) expect(p).toContain(h);
    expect(p).toContain('Digest of caching papers');
  });

  it('drafts with the configured cheap model; it can read files and the web, never write or run commands', async () => {
    const { runner, calls } = fake('Sure! Here it is:\n\n## Goal\nA digest.\n\n## Scope\n- 5 papers\n');
    const text = await draftBlueprint(card, runner, { model: 'haiku', cwd: '/tmp' });
    expect(text).toBe('## Goal\nA digest.\n\n## Scope\n- 5 papers');
    expect(calls[0]).toMatchObject({ model: 'haiku', tools: 'Read,Glob,Grep,WebSearch,WebFetch', cwd: '/tmp' });
    expect(calls[0]!.tools).not.toMatch(/Bash|Edit|Write/);
  });

  it('fails on a bad exit or a reply without a goal', async () => {
    await expect(draftBlueprint(card, fake('', 1).runner, { model: 'haiku', cwd: '/' })).rejects.toThrow(/exited with 1/);
    expect(() => cleanBlueprint('I cannot help')).toThrow(/Goal/);
  });
});

describe('claudeArgs', () => {
  it('builds a headless call with caps and tool rules', () => {
    const args = claudeArgs({
      prompt: 'x',
      cwd: '/w',
      timeoutMs: 1,
      model: 'sonnet',
      maxTurns: 20,
      permissionMode: 'acceptEdits',
      permissionPrompts: 'none',
      allowedTools: ['Read', 'Bash(npm test *)'],
      disallowedTools: ['Bash(git push *)'],
    });
    expect(args.slice(0, 4)).toEqual(['-p', '--output-format', 'text', '--no-session-persistence']);
    expect(args.join(' ')).toContain('--model sonnet --max-turns 20 --permission-mode acceptEdits --permission-prompts none');
    expect(args.join(' ')).toContain('--allowedTools Read Bash(npm test *) --disallowedTools Bash(git push *)');
    expect(args).not.toContain('x'); // the prompt goes on stdin
  });

  it('leaves out what is not set', () => {
    expect(claudeArgs({ prompt: 'x', cwd: '/', timeoutMs: 1, model: null, maxTurns: null })).toEqual(['-p', '--output-format', 'text', '--no-session-persistence']);
  });
});

describe('five-star options', () => {
  it('cleans the model reply into up to 4 short options', async () => {
    const { draftFiveStarOptions } = await import('../src/blueprint.js');
    const runner = { run: async () => ({ exitCode: 0, output: '1. Put the answers in a separate file\n- Harder questions\n"Link each question to the Tour page"\n\nMore code snippets\nExtra', stderr: '', timedOut: false, durationMs: 1 }) };
    expect(await draftFiveStarOptions({ idea: 'quiz', blueprint: 'bp' }, runner, { model: 'haiku', cwd: '/tmp' })).toEqual([
      'Put the answers in a separate file', 'Harder questions', 'Link each question to the Tour page', 'More code snippets',
    ]);
  });
});

describe('draft all later', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const mk = (id: string, extra: Partial<Card> = {}): Card => ({
    id, title: id, idea: id, cwd: '/repo', column: 'later', blueprint: null,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), ...extra,
  });
  const board: BoardData = {
    nextId: 9,
    cards: [
      mk('1'), // later, no blueprint: picked
      mk('2', { blueprint: '## Goal\nedited by hand' }), // has a blueprint (edited): left alone
      mk('3', { blueprintError: 'timed out' }), // failed before: retried
      mk('4', { draftingAt: new Date(now.getTime() - 30_000).toISOString() }), // drafting now: skipped
      mk('5', { draftingAt: new Date(now.getTime() - 10 * 60_000).toISOString() }), // stale draft: picked
      mk('6', { column: 'suggested' }), // not later
      mk('7', { column: 'approved' }), // not later
      mk('8', { blueprint: '   ' }), // blank counts as none
    ],
  };

  it('picks only later cards with no blueprint that are not being drafted', () => {
    expect(laterToDraft(board, now).map((c) => c.id)).toEqual(['1', '3', '5', '8']);
  });

  it('drafts nothing with no active window and says why', () => {
    const plan = draftAllPlan(board, false, now);
    expect(plan.ids).toEqual([]);
    expect(plan.message).toMatch(/No active 5-hour window/);
  });

  it('with a window, plans the picked cards; with none to draft, says so', () => {
    expect(draftAllPlan(board, true, now)).toEqual({ ids: ['1', '3', '5', '8'] });
    const allDone: BoardData = { nextId: 2, cards: [mk('1', { blueprint: '## Goal\nx' })] };
    const plan = draftAllPlan(allDone, true, now);
    expect(plan.ids).toEqual([]);
    expect(plan.message).toMatch(/already has a blueprint/);
  });
});
