import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coldWarningText, impact, warnOutcomes, decide, goingCold, takeGoingCold, hookCommand, loadNudges, nudgeInstalled, nudgeText, outcomes, runHook, setNudge, type NudgeEvent } from '../src/nudge.js';

const MIN = 60_000;
const T0 = Date.parse('2026-11-26T09:00:00Z');
const dir = () => mkdtempSync(join(tmpdir(), 'chompyy-nudge-'));

const reply = (at: number, read: number, write = 0, o: { sidechain?: boolean } = {}) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: o.sidechain ?? false,
    timestamp: new Date(at).toISOString(),
    message: { usage: { input_tokens: 3, cache_read_input_tokens: read, cache_creation_input_tokens: write } },
  });

function transcript(lines: string[]): string {
  const p = join(dir(), 's1.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

/** A conversation that started at 22k and was at 180k when you left it at T0. */
const big = () => transcript([reply(T0 - 90 * MIN, 0, 22_000), JSON.stringify({ type: 'user', message: { content: 'hi' } }), reply(T0, 170_000, 10_000)]);

describe('the cold-return nudge', () => {
  it('stops the first message after the cache expired, priced from this conversation', () => {
    const d = decide({ session_id: 's1', transcript_path: big(), prompt: 'carry on' }, T0 + 75 * MIN, []);
    expect(d.block).toBe(true);
    if (!d.block) return;
    expect(d.reason).toContain('sat for 1h15m');
    expect(d.reason).toContain('180k tokens');
    expect(d.reason).toContain('starts at about 22k');
    expect(d.reason).toContain('/compact');
    expect(d.event.kind).toBe('stopped');
  });

  it('lets it through when the cache is still warm, the conversation is small, or it is a command', () => {
    const t = big();
    expect(decide({ session_id: 's1', transcript_path: t, prompt: 'go' }, T0 + 50 * MIN, []).block).toBe(false);
    expect(decide({ session_id: 's1', transcript_path: t, prompt: '/compact' }, T0 + 3 * 60 * MIN, []).block).toBe(false);
    expect(decide({ session_id: 's1', transcript_path: t, prompt: '<task-notification>done' }, T0 + 3 * 60 * MIN, []).block).toBe(false);
    const small = transcript([reply(T0, 20_000, 1_000)]);
    expect(decide({ session_id: 's1', transcript_path: small, prompt: 'go' }, T0 + 3 * 60 * MIN, []).block).toBe(false);
    expect(decide({ session_id: 's1', transcript_path: join(dir(), 'missing.jsonl'), prompt: 'go' }, T0, []).block).toBe(false);
  });

  it('ignores subagent replies when finding the last one', () => {
    const t = transcript([reply(T0, 170_000, 10_000), reply(T0 + 70 * MIN, 5_000, 0, { sidechain: true })]);
    expect(decide({ session_id: 's1', transcript_path: t, prompt: 'go' }, T0 + 75 * MIN, []).block).toBe(true);
  });

  it('stops only once per break: sending again goes through and is logged', () => {
    const t = big();
    const input = JSON.stringify({ session_id: 's1', transcript_path: t, prompt: 'carry on' });
    expect(JSON.parse(runHook(input, T0 + 75 * MIN))).toMatchObject({ decision: 'block' });
    expect(runHook(input, T0 + 76 * MIN)).toBe('');
    expect(loadNudges().map((e) => e.kind)).toEqual(['stopped', 'sent']);
    expect(outcomes()[0]).toMatchObject({ did: 'sent', saved: 0 });
  });

  it('never fails on bad input', () => {
    expect(runHook('not json')).toBe('');
    expect(runHook('{}')).toBe('');
  });
});

describe('what the stops did', () => {
  const stop = (t: string, at: number): NudgeEvent => ({ at: new Date(at).toISOString(), kind: 'stopped', session: 's1', transcript: t, idleMs: 75 * MIN, context: 180_000, fresh: 22_000 });

  it('counts a small next reply as compacted, and no next reply as left', () => {
    const compacted = transcript([reply(T0, 170_000, 10_000), reply(T0 + 80 * MIN, 0, 15_000)]);
    const left = big();
    const list = outcomes([stop(compacted, T0 + 75 * MIN), { ...stop(left, T0 + 75 * MIN), session: 's2' }]);
    expect(list.map((o) => [o.did, o.saved])).toEqual([
      ['compacted', 165_000],
      ['left', 158_000],
    ]);
    const text = nudgeText(true, list, T0 + 90 * MIN);
    expect(text).toContain('stopped 2 times. You compacted 1, left or started fresh 1, sent anyway 0.');
    expect(text).toContain('About 323k tokens not written again.');
  });
});

describe('installing the hook', () => {
  it('adds its hook next to yours, backs the file up, and removes only its own', () => {
    const path = join(dir(), 'settings.json');
    const theirs = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other.sh' }] }], Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] }, model: 'opus' };
    writeFileSync(path, JSON.stringify(theirs));
    setNudge(true, '"node" "/opt/chompyy/dist/cli.js" hook prompt # chompyy nudge', path);
    expect(nudgeInstalled(path)).toBe(true);
    expect(existsSync(`${path}.chompyy-backup`)).toBe(true);
    const on = JSON.parse(readFileSync(path, 'utf8'));
    expect(on.hooks.UserPromptSubmit).toHaveLength(2);
    expect(on.model).toBe('opus');
    setNudge(false, undefined, path);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(theirs);
  });

  it('refuses to point the hook at a one-off npx copy', () => {
    expect(() => hookCommand('/Users/x/.npm/_npx/abc/node_modules/chompyy/dist/cli.js')).toThrow(/npm install -g chompyy/);
    expect(hookCommand('/usr/local/lib/node_modules/chompyy/dist/cli.js', '/usr/local/bin/node')).toBe('"/usr/local/bin/node" "/usr/local/lib/node_modules/chompyy/dist/cli.js" hook prompt # chompyy nudge');
  });
});

describe('before it goes cold', () => {
  /** A projects folder with one conversation whose last reply was at T0 (file written then too). */
  function projects(folder = '-Users-me-app', context = 180_000): string {
    const root = dir();
    mkdirSync(join(root, folder));
    const p = join(root, folder, 'abc.jsonl');
    writeFileSync(p, [reply(T0 - 90 * MIN, 0, 22_000), JSON.stringify({ type: 'user', cwd: '/Users/me/app', message: { content: 'x' } }), reply(T0, context - 10_000, 10_000)].join('\n') + '\n');
    utimesSync(p, new Date(T0), new Date(T0));
    return root;
  }

  it('reports a big conversation 45-60 minutes into a pause, with when it goes cold', () => {
    const due = goingCold(T0 + 50 * MIN, projects(), []);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ session: 'abc', project: 'app', context: 180_003, fresh: 22_003, coldAt: new Date(T0 + 60 * MIN).toISOString() });
    const text = coldWarningText(due[0]!);
    expect(text.title).toMatch(/^app: 180k conversation goes cold at /);
    expect(text.body).toContain('/compact now');
  });

  it('stays quiet too early, too late, for small conversations and for automated folders', () => {
    expect(goingCold(T0 + 30 * MIN, projects(), [])).toEqual([]);
    expect(goingCold(T0 + 61 * MIN, projects(), [])).toEqual([]);
    expect(goingCold(T0 + 50 * MIN, projects('-Users-me-app', 20_000), [])).toEqual([]);
    expect(goingCold(T0 + 50 * MIN, projects('-private-var-folders-x'), [])).toEqual([]);
  });

  it('reports each break once and logs it', () => {
    process.env.CHOMPYY_CLAUDE_PROJECTS = projects();
    try {
      expect(takeGoingCold(T0 + 50 * MIN)).toHaveLength(1);
      expect(takeGoingCold(T0 + 51 * MIN)).toEqual([]);
      expect(loadNudges().map((e) => e.kind)).toEqual(['warned']);
    } finally {
      delete process.env.CHOMPYY_CLAUDE_PROJECTS;
    }
  });
});

describe('what the warnings did, and the trend', () => {
  const warned = (t: string): NudgeEvent => ({ at: new Date(T0 + 50 * MIN).toISOString(), kind: 'warned', session: 's1', transcript: t, idleMs: 50 * MIN, context: 180_000, coldAt: new Date(T0 + 60 * MIN).toISOString() });

  it('counts only a compact before the cache went cold as saved', () => {
    const compacted = transcript([reply(T0, 170_000, 10_000), reply(T0 + 52 * MIN, 0, 12_000)]);
    const continued = transcript([reply(T0, 170_000, 10_000), reply(T0 + 52 * MIN, 180_000, 500)]);
    const cold = transcript([reply(T0, 170_000, 10_000), reply(T0 + 90 * MIN, 0, 180_000)]);
    const left = transcript([reply(T0, 170_000, 10_000)]);
    expect(warnOutcomes([compacted, continued, cold, left].map(warned)).map((o) => [o.did, o.saved])).toEqual([
      ['compacted', 168_000 - 3],
      ['continued', 0],
      ['cold', 0],
      ['left', 0],
    ]);
  });

  it('measures cold returns this week against last week from the transcripts', () => {
    const root = dir();
    mkdirSync(join(root, '-Users-me-app'));
    const NOW = Date.parse('2026-11-26T12:00:00Z');
    const DAY = 86_400_000;
    const back = (at: number, write: number) =>
      JSON.stringify({ type: 'assistant', sessionId: 'a', timestamp: new Date(at).toISOString(), message: { id: `m${at}`, usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: write, cache_creation: { ephemeral_1h_input_tokens: write } }, diagnostics: { cache_miss_reason: { type: 'previous_message_not_found' } } } });
    const lines = [back(NOW - 10 * DAY, 50_000), back(NOW - 10 * DAY + 2 * 3600_000, 100_000), back(NOW - 2 * DAY, 50_000), back(NOW - 2 * DAY + 3 * 3600_000, 120_000), back(NOW - 2 * DAY + 5 * 3600_000, 130_000)];
    writeFileSync(join(root, '-Users-me-app', 'a.jsonl'), lines.join('\n') + '\n');
    const i = impact(true, NOW, root, []);
    expect(i.thisWeek).toEqual({ count: 3, tokens: 300_000 });
    expect(i.lastWeek).toEqual({ count: 1, tokens: 100_000 });
    expect(i.line).toBe('Cold returns this week: 3 (300k rebuilt), last week 1 (100k).');
  });
});
