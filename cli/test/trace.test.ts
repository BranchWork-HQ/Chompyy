import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resultTokens, traceSession } from '../src/trace.js';
import { loadLedger, usageView } from '../src/usage.js';
import { useTempHome } from './helpers.js';

// One conversation, turn by turn (2026-11-21): a subset of codeburn's `sessions --why` (MIT).

let projects: string;
let t = 0;
const at = () => new Date(Date.UTC(2026, 10, 21, 10, 0, t++)).toISOString();
const you = (text: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/work/app', timestamp: at(), message: { role: 'user', content: text }, ...extra });
const claude = (id: string, usage: { i?: number; o?: number; read?: number; w1?: number }, tools: { id: string; name: string; input?: Record<string, unknown> }[] = [], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant', sessionId: 's1', cwd: '/work/app', requestId: `r${id}`, timestamp: at(), ...extra,
    message: {
      id, model: 'claude-opus-5-5',
      usage: { input_tokens: usage.i ?? 1, output_tokens: usage.o ?? 10, cache_read_input_tokens: usage.read ?? 0, cache_creation_input_tokens: usage.w1 ?? 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: usage.w1 ?? 0 } },
      content: tools.map((x) => ({ type: 'tool_use', ...x })),
    },
  });
const result = (id: string, content: unknown) => JSON.stringify({ type: 'user', sessionId: 's1', cwd: '/work/app', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });

function session(lines: string[], name = 's1'): void {
  mkdirSync(join(projects, 'app'), { recursive: true });
  writeFileSync(join(projects, 'app', `${name}.jsonl`), lines.join('\n') + '\n');
}

describe('the conversation trace', () => {
  useTempHome();
  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'chompyy-trace-'));
    process.env.CHOMPYY_CLAUDE_PROJECTS = projects;
    t = 0;
  });

  it('groups requests into turns by prompt, counts each request once, and sizes the context', () => {
    session([
      you('first ask'),
      claude('a', { read: 50_000, w1: 1000 }, [{ id: 't1', name: 'Read', input: { file_path: '/work/app/x.ts' } }]),
      claude('a', { read: 50_000, w1: 1000 }, [{ id: 't2', name: 'Bash', input: { command: 'npm test' } }]), // same request, next block
      result('t1', 'x'.repeat(400)),
      claude('b', { read: 51_000 }),
      you('second ask'),
      claude('c', { read: 52_000 }),
    ]);
    const tr = traceSession('s1')!;
    expect(tr.turns.map((x) => [x.prompt, x.requests.length])).toEqual([['first ask', 2], ['second ask', 1]]);
    expect(tr.turns[0]!.requests[0]!.tools.map((x) => x.name)).toEqual(['Read', 'Bash']);
    expect(tr.turns[0]!.requests[0]!.tools[0]).toMatchObject({ resultChars: 400, resultTokens: 100 });
    expect(tr.turns[0]!.contextPeak).toBe(51_001);
    expect(tr.requests).toBe(3);
  });

  it('counts an image as an image, not as its base64 text (the screenshot bug)', () => {
    expect(resultTokens([{ type: 'image', source: { type: 'base64', data: 'A'.repeat(600_000) } }]).tokens).toBe(1600);
    expect(resultTokens([{ type: 'text', text: 'abcd'.repeat(100) }]).tokens).toBe(100);
  });

  it('a big result is a "carry" finding, capped by what the next request really wrote to the cache', () => {
    session([
      you('read the log'),
      claude('a', { read: 10_000 }, [{ id: 't1', name: 'Read', input: { file_path: '/work/app/huge.log' } }]),
      result('t1', 'x'.repeat(400_000)), // ~100k tokens by characters
      claude('b', { read: 10_000, w1: 30_000 }), // but only 30k were written: that's the cap
      claude('c', { read: 40_000 }),
      claude('d', { read: 40_000 }),
    ]);
    const carry = traceSession('s1')!.findings.find((f) => f.kind === 'carry')!;
    expect(carry).toMatchObject({ tool: 'Read', label: 'app/huge.log', tokens: 30_001, laterRequests: 3 });
    expect(carry.usd).toBeLessThan(traceSession('s1')!.costUsd);
  });

  it('hides your prompts for a workspace you did not tick, but still shows the numbers', () => {
    session([you('my private ask'), claude('a', {})]);
    const tr = traceSession('s1', { showPrompts: () => false })!;
    expect(tr.turns[0]!.prompt).toBeNull();
    expect(tr.promptsHidden).toBe(true);
    expect(tr.requests).toBe(1);
  });

  it('strips the pasted-content tag from a pasted prompt', () => {
    session([you('<pasted_content id="x">New face, no mouth</pasted_content>'), claude('a', {})]);
    expect(traceSession('s1')!.turns[0]!.prompt).toBe('New face, no mouth');
  });

  it("a subagent working in another folder doesn't decide the conversation's folder or hide its title", () => {
    mkdirSync(join(projects, 'app', 's1', 'subagents'), { recursive: true });
    writeFileSync(join(projects, 'app', 's1', 'subagents', 'a.jsonl'), claude('h', {}, [], { cwd: '/tmp/elsewhere', agentId: 'a', timestamp: '2026-11-21T09:00:00Z' }) + '\n');
    session([you('ask'), claude('m', {}), JSON.stringify({ type: 'ai-title', sessionId: 's1', aiTitle: 'Real work' })]);
    const v = usageView(loadLedger(), new Date('2026-11-21T12:00:00Z'), 7, 10, (ws) => ws === '/work/app');
    expect(v.conversations[0]).toMatchObject({ workspace: '/work/app', title: 'Real work', private: false });
  });
});
