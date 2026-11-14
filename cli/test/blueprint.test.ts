import { describe, expect, it } from 'vitest';
import { blueprintPrompt, cleanBlueprint, draftBlueprint } from '../src/blueprint.js';
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

  it('drafts with the configured cheap model and no tools', async () => {
    const { runner, calls } = fake('Sure! Here it is:\n\n## Goal\nA digest.\n\n## Scope\n- 5 papers\n');
    const text = await draftBlueprint(card, runner, { model: 'haiku', cwd: '/tmp' });
    expect(text).toBe('## Goal\nA digest.\n\n## Scope\n- 5 papers');
    expect(calls[0]).toMatchObject({ model: 'haiku', tools: '', cwd: '/tmp' });
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
