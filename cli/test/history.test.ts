import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDigest, cleanPrompt, historyRetention, parseTranscript, pickPrompts, redact, scanHistory, type Session } from '../src/history.js';

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'chompyy-hist-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const line = (o: object) => JSON.stringify(o);
function transcript(opts: { entrypoint?: string; cwd: string; prompts: string[]; reply?: string; at?: string }): string {
  const at = opts.at ?? '2026-11-10T10:00:00Z';
  return [
    ...opts.prompts.flatMap((p, i) => [
      line({ type: 'user', entrypoint: opts.entrypoint ?? 'cli', cwd: opts.cwd, timestamp: at.replace('10:00', `10:0${i}`), message: { role: 'user', content: p } }),
      line({ type: 'user', cwd: opts.cwd, timestamp: at, message: { content: [{ type: 'tool_result', content: 'file contents' }] } }),
    ]),
    line({ type: 'assistant', timestamp: at.replace('10:00', '11:00'), message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: opts.reply ?? 'Done.' }] } }),
    'not json',
  ].join('\n');
}

describe('redact', () => {
  it('removes keys, tokens, passwords and emails but keeps paths and prose', () => {
    const text = 'key sk-ant-api03-abcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz123456, password=hunter2, mail me at a.b@example.com, see /Users/me/code/very-long-project-name-here/src/index.ts';
    const out = redact(text);
    expect(out).not.toMatch(/sk-ant|ghp_|hunter2|example\.com/);
    expect(out).toContain('password=[secret]');
    expect(out).toContain('[email]');
    expect(out).toContain('/Users/me/code/very-long-project-name-here/src/index.ts');
  });
  it('removes long random strings and private keys', () => {
    expect(redact('token Ab3dEfGh1jKlMn0pQrStUvWxYz123456789')).toBe('token [secret]');
    expect(redact('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY----- ok')).toBe('[secret] ok');
  });
});

describe('cleanPrompt', () => {
  it('keeps typed words and slash commands, drops tool results and system lines', () => {
    expect(cleanPrompt('  fix   the bug ')).toBe('fix the bug');
    expect(cleanPrompt('<command-name>/later</command-name>\n<command-args>add a CHANGELOG</command-args>')).toBe('/later add a CHANGELOG');
    expect(cleanPrompt([{ type: 'tool_result', content: 'x' }])).toBeNull();
    expect(cleanPrompt('<local-command-stdout>ok</local-command-stdout>')).toBeNull();
    expect(cleanPrompt('This session is being continued from a previous conversation that ran out of context.')).toBeNull();
    expect(cleanPrompt([{ type: 'text', text: 'look at this' }, { type: 'image' }])).toBe('look at this');
    expect(cleanPrompt('here: <pasted_content id="1">secret logs</pasted_content id="1"> why?')).toBe('here: [pasted text] why?');
  });
});

describe('scanHistory', () => {
  it('reads interactive sessions newest first and skips headless and temp ones', () => {
    const claude = temp();
    const repo = temp();
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'src'));
    const put = (folder: string, name: string, text: string) => {
      mkdirSync(join(claude, folder), { recursive: true });
      writeFileSync(join(claude, folder, name), text);
    };
    put('a', 'old.jsonl', transcript({ cwd: join(repo, 'src'), prompts: ['first idea'], at: '2026-11-01T10:00:00Z' }));
    put('a', 'new.jsonl', transcript({ cwd: repo, prompts: ['do X', 'no, shorter'], reply: 'Want me to add tests later?', at: '2026-11-12T10:00:00Z' }));
    put('b', 'bot.jsonl', transcript({ entrypoint: 'sdk-cli', cwd: repo, prompts: ['Task: solve it'] }));
    put('c', 'tmp.jsonl', transcript({ cwd: '/private/tmp/x', prompts: ['scratch'] }));
    const scan = scanHistory({ claudeDir: claude, isTemp: (p) => p.startsWith('/private/tmp/') });
    expect(scan.sessions.map((s) => [s.id, s.prompts])).toEqual([
      ['S1', ['do X', 'no, shorter']],
      ['S2', ['first idea']],
    ]);
    expect(scan.sessions[1]!.project.endsWith(repo.split('/').pop()!)).toBe(true); // git root, not src/
    expect(scan.sessions[0]!.lastReply).toBe('Want me to add tests later?');
    expect(scan.skipped).toMatchObject({ headless: 1, temp: 1 });
  });
  it('parses timestamps and ignores broken lines', () => {
    const p = parseTranscript(transcript({ cwd: '/r', prompts: ['a', 'b'] }));
    expect(p.started).toBe('2026-11-10T10:00:00Z');
    expect(p.prompts).toEqual(['a', 'b']);
  });
});

describe('digest', () => {
  it('picks the start, ideas for later, corrections and the end', () => {
    const prompts = Array.from({ length: 30 }, (_, i) => `step ${i}`);
    prompts[10] = 'we can do the docs later';
    prompts[15] = "no, don't use tables";
    prompts[20] = '之後再做 dark mode';
    expect(pickPrompts(prompts)).toEqual(['step 0', 'step 1', 'step 2', 'we can do the docs later', "no, don't use tables", '之後再做 dark mode', 'step 27', 'step 28', 'step 29']);
  });
  it('stops at the size cap, newest first', () => {
    const s = (id: string): Session => ({ id, file: '', cwd: '/r', project: '/r', projectName: 'r', started: '2026-11-01', ended: '2026-11-02', prompts: ['x'.repeat(250)], lastReply: null });
    const d = buildDigest([s('S1'), s('S2'), s('S3')], 600);
    expect(d.included.map((x) => x.id)).toEqual(['S1', 'S2']);
    expect(d.text).toContain('### S1 · r (/r)');
  });
});

describe('historyRetention', () => {
  it('reads cleanupPeriodDays or reports the 30-day default', () => {
    const dir = temp();
    expect(historyRetention(join(dir, 'missing.json'))).toEqual({ days: 30, isDefault: true });
    writeFileSync(join(dir, 's.json'), '{"cleanupPeriodDays": 365}');
    expect(historyRetention(join(dir, 's.json'))).toEqual({ days: 365, isDefault: false });
  });
});
