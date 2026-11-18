import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CappedText, ClaudeRunner, FinalText, LineReader, RawLog } from '../src/runner.js';

// An 8-hour away died of "JavaScript heap out of memory" on 2026-11-17: the runner kept every stream-json
// event (whole tool results) and re-split its growing buffer on every chunk.
describe('runner memory stays bounded', () => {
  it('splits lines across chunks and skips a giant line without buffering it', () => {
    const got: string[] = [];
    const r = new LineReader((l) => got.push(l), 10);
    r.push('ab');
    r.push('c\nde');
    r.push('f\n' + 'x'.repeat(8));
    r.push('x'.repeat(8)); // line now over 10: dropped
    r.push('xx\nok\nta');
    r.end();
    r.push('il');
    r.end();
    expect(got).toEqual(['abc', 'def', 'ok', 'ta', 'il']);
  });

  it('keeps only the final text, not every event', () => {
    const t = new FinalText(10);
    t.feed({ type: 'user', message: { content: [{ type: 'tool_result', content: 'huge' }] } });
    for (const text of ['aaaa', 'bbbb', 'cccc']) t.feed({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
    expect(t.text()).toBe('bbbb\ncccc');
    t.feed({ type: 'result', result: 'Done.\nCHECKS: passed — npm test' });
    expect(t.text()).toBe('Done.\nCHECKS: passed — npm test');
  });

  it('caps plain text but keeps its start and its end', () => {
    const c = new CappedText(8);
    c.push('HEAD');
    c.push('-'.repeat(100));
    c.push('TAIL');
    expect(c.toString()).toBe('HEAD\n[… 100 characters cut …]\nTAIL');
    const small = new CappedText(100);
    small.push('hi');
    expect(small.toString()).toBe('hi');
  });

  it('survives an agent that floods the stream with giant tool results', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chompyy-runner-'));
    const bin = join(dir, 'claude');
    // 40 tool results of 6 MB each (240 MB) on single lines, then the result. Before the fix all of it was kept.
    writeFileSync(bin, `#!/usr/bin/env node
const big = 'x'.repeat(6 * 1024 * 1024);
let i = 0;
function next() {
  if (i++ < 40) return process.stdout.write(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: String(i), content: big }] } }) + '\\n', next);
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '好 done' }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', result: 'Made it.\\nCHECKS: passed — npm test' }) + '\\n');
}
process.stdin.resume(); process.stdin.on('end', next);
`);
    chmodSync(bin, 0o755);
    const before = process.memoryUsage().heapUsed;
    const res = await new ClaudeRunner(bin).run({ prompt: 'go', cwd: dir, timeoutMs: 60_000, loopRepeat: 5 });
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('Made it.\nCHECKS: passed — npm test');
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(100 * 1024 * 1024);
  }, 60_000);
});

describe('no-progress watchdog', () => {
  const fake = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'chompyy-idle-'));
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\n${body}\n`);
    chmodSync(bin, 0o755);
    return { dir, bin };
  };

  it('stops an agent that goes silent', async () => {
    const { dir, bin } = fake('echo start; sleep 30; echo never');
    const res = await new ClaudeRunner(bin).run({ prompt: 'go', cwd: dir, timeoutMs: 60_000, idleTimeoutMs: 500 });
    expect(res.stalled).toBe('no progress for 0m');
    expect(res.durationMs).toBeLessThan(10_000);
    expect(res.timedOut).toBe(false);
  }, 20_000);

  it('leaves an agent that keeps printing alone', async () => {
    const { dir, bin } = fake('for i in 1 2 3 4 5; do echo tick $i; sleep 0.5; done');
    const res = await new ClaudeRunner(bin).run({ prompt: 'go', cwd: dir, timeoutMs: 60_000, idleTimeoutMs: 3000 });
    expect(res.stalled).toBeUndefined();
    expect(res.output).toMatch(/tick 5/);
  }, 20_000);
});

describe('raw log on disk', () => {
  it('writes the stream to disk and cuts it off at the cap', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'chompyy-raw-')), 'run.stream.jsonl');
    const log = new RawLog(path, 10);
    log.write('12345');
    log.write('67890abc');
    log.write('more');
    log.close();
    expect(readFileSync(path, 'utf8')).toBe('1234567890\n[raw log cut off at 10 bytes]\n');
  });
});
