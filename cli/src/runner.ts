// The one seam: something that runs a prompt headless. ClaudeRunner wraps `claude -p`;
// tests pass a fake.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { commandPattern, hostsInErrors, type RunNeeds } from './permissions.js';

export interface RunRequest {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  model?: string | null;
  maxTurns?: number | null;
  /** --tools value; "" disables all tools (used for blueprints). */
  tools?: string;
  permissionMode?: string | null;
  permissionPrompts?: string | null;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** Passed as --settings (JSON), e.g. the sandbox for away runs. */
  settings?: Record<string, unknown>;
  extraArgs?: string[];
  /** Extra environment variables for the agent and the commands it runs. */
  env?: Record<string, string>;
  /**
   * Watch the run as it happens (stream-json): stop it when it loops. Repeating the same tool call this many
   * times trips the breaker; 0 or unset = plain text output, no watching.
   */
  loopRepeat?: number;
  /** Stop the run when the agent prints nothing for this long (a hung command or a stalled agent); 0/unset = off. */
  idleTimeoutMs?: number;
  /** Stop the run after the sandbox or permissions blocked it this many times (it's stuck on something it can't do); 0/unset = off. */
  maxDenied?: number;
  /** Called with the agent's pid (its process group) as soon as it starts. */
  onSpawn?: (pid: number) => void;
  /** Also write the raw output to this file, up to `rawLogMaxBytes`: memory stays small, the full trail is on disk. */
  rawLogPath?: string;
  rawLogMaxBytes?: number;
}

/** The raw output written to disk, cut off after `max` bytes (with a note saying so). */
export class RawLog {
  private fd: number | null = null;
  private written = 0;
  constructor(path: string | undefined, private max = 50 * 1024 * 1024) {
    if (!path) return;
    try {
      this.fd = openSync(path, 'w');
    } catch {}
  }
  write(chunk: string): void {
    if (this.fd === null) return;
    const room = this.max - this.written;
    const buf = Buffer.from(chunk);
    if (buf.length <= room) {
      writeSync(this.fd, buf);
      this.written += buf.length;
      return;
    }
    if (room > 0) writeSync(this.fd, buf.subarray(0, room));
    writeSync(this.fd, `\n[raw log cut off at ${this.max} bytes]\n`);
    this.written = this.max;
    this.close();
  }
  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }
}

export interface RunResult {
  exitCode: number | null;
  output: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Set when the circuit breaker stopped the run: why. */
  stuck?: string;
  /** Set when the run was stopped for making no progress: why. */
  stalled?: string;
  /** What the run was blocked on (commands needing approval, hosts it tried), for the next permission plan. */
  needs?: RunNeeds;
}

export interface Runner {
  run(req: RunRequest): Promise<RunResult>;
}

export function claudeArgs(req: RunRequest): string[] {
  const args = req.loopRepeat
    ? ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']
    : ['-p', '--output-format', 'text', '--no-session-persistence'];
  if (req.model) args.push('--model', req.model);
  if (req.maxTurns) args.push('--max-turns', String(req.maxTurns));
  if (req.tools !== undefined) args.push('--tools', req.tools);
  if (req.permissionMode) args.push('--permission-mode', req.permissionMode);
  if (req.permissionPrompts) args.push('--permission-prompts', req.permissionPrompts);
  if (req.allowedTools?.length) args.push('--allowedTools', ...req.allowedTools);
  if (req.disallowedTools?.length) args.push('--disallowedTools', ...req.disallowedTools);
  if (req.settings) args.push('--settings', JSON.stringify(req.settings));
  if (req.extraArgs?.length) args.push(...req.extraArgs);
  return args;
}

/**
 * Circuit breaker (ralph-claude-code, codeburn guard): notices a run going in circles.
 * - the same tool call (tool + exact input) `repeat` times among the last 20 calls, or
 * - the same shell command failing `repeat - 1` times in a row.
 */
export class LoopWatch {
  private calls: string[] = [];
  private pending = new Map<string, string>();
  private lastFailed = '';
  private failStreak = 0;
  constructor(private repeat: number) {}

  /** Feed one stream-json event; returns why it is stuck, or null. */
  feed(event: unknown): string | null {
    const e = event as { type?: string; message?: { content?: unknown } };
    const content = Array.isArray(e.message?.content) ? (e.message!.content as Record<string, unknown>[]) : [];
    if (e.type === 'assistant') {
      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        // The free-text description can differ between otherwise identical calls.
        const { description: _d, ...input } = (block.input ?? {}) as Record<string, unknown>;
        const sig = `${block.name}(${JSON.stringify(input)})`;
        this.pending.set(String(block.id), sig);
        this.calls = [...this.calls, sig].slice(-20);
        const times = this.calls.filter((c) => c === sig).length;
        if (times >= this.repeat) return `called ${short(sig)} ${times} times`;
      }
    }
    if (e.type === 'user') {
      for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const sig = this.pending.get(String(block.tool_use_id)) ?? '';
        if (!sig.startsWith('Bash(')) continue;
        if (block.is_error) {
          this.failStreak = sig === this.lastFailed ? this.failStreak + 1 : 1;
          this.lastFailed = sig;
          if (this.failStreak >= Math.max(2, this.repeat - 1)) return `${short(sig)} failed ${this.failStreak} times in a row`;
        } else if (sig === this.lastFailed) {
          this.failStreak = 0;
          this.lastFailed = '';
        }
      }
    }
    return null;
  }
}

function short(sig: string): string {
  return sig.length > 120 ? `${sig.slice(0, 117)}…` : sig;
}

/** The final text of a stream-json run: the result event, else the assistant's text blocks. */
export function streamText(events: unknown[]): string {
  const t = new FinalText();
  for (const e of events) t.feed(e);
  return t.text();
}

/**
 * Keeps only what the final text needs: the result event, else the assistant's text blocks (capped).
 * Not every event: with --verbose the stream carries whole tool results (file reads, build logs), and keeping
 * them all is what ran an 8-hour away out of memory on 2026-11-17.
 */
export class FinalText {
  private result: string | null = null;
  private texts: string[] = [];
  private size = 0;
  constructor(private max = 256 * 1024) {}

  feed(event: unknown): void {
    const e = event as { type?: string; result?: unknown; message?: { content?: { type?: string; text?: string }[] } };
    if (e.type === 'result' && typeof e.result === 'string') this.result = e.result;
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) return;
    for (const b of e.message.content) {
      if (b?.type !== 'text' || !b.text) continue;
      this.texts.push(b.text);
      this.size += b.text.length;
      while (this.size > this.max && this.texts.length > 1) this.size -= this.texts.shift()!.length;
    }
  }

  text(): string {
    return this.result ?? this.texts.join('\n');
  }
}

/** A stream-json line longer than this is a giant tool result we don't need: skip it rather than buffer it. */
export const MAX_LINE = 4 * 1024 * 1024;

/**
 * Splits a stream into lines in constant memory per line: looks for newlines only in the new chunk (never
 * re-splits what is buffered), and drops a line once it grows past `maxLine`.
 */
export class LineReader {
  private buf = '';
  private skipping = false;
  constructor(private onLine: (line: string) => void, private maxLine = MAX_LINE) {}

  push(chunk: string): void {
    let start = 0;
    let nl: number;
    while ((nl = chunk.indexOf('\n', start)) !== -1) {
      if (!this.skipping) {
        const line = this.buf + chunk.slice(start, nl);
        if (line.length <= this.maxLine) this.onLine(line);
      }
      this.buf = '';
      this.skipping = false;
      start = nl + 1;
    }
    if (this.skipping || start === chunk.length) return;
    if (this.buf.length + chunk.length - start > this.maxLine) {
      this.buf = '';
      this.skipping = true;
    } else this.buf += chunk.slice(start);
  }

  end(): void {
    if (!this.skipping && this.buf.trim()) this.onLine(this.buf);
    this.buf = '';
    this.skipping = false;
  }
}

/** Text that keeps its head and its tail once it passes `max` (CHECKS is at the end, the summary at the start). */
export class CappedText {
  private head = '';
  private tail = '';
  private dropped = 0;
  constructor(private max = 2 * 1024 * 1024) {}

  push(chunk: string): void {
    const half = this.max / 2;
    if (this.head.length < half) {
      const take = chunk.slice(0, half - this.head.length);
      this.head += take;
      chunk = chunk.slice(take.length);
    }
    this.tail += chunk;
    if (this.tail.length > half) {
      this.dropped += this.tail.length - half;
      this.tail = this.tail.slice(-half);
    }
  }

  toString(): string {
    return this.dropped ? `${this.head}\n[… ${this.dropped} characters cut …]\n${this.tail}` : this.head + this.tail;
  }
}

/** Process groups of agents still running, so Ctrl-C on chompyy stops them too. */
const active = new Set<number>();
let handlersInstalled = false;
function stopActiveOnExit(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      for (const pid of active) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {}
      }
      process.exit(130);
    });
  }
}

export class ClaudeRunner implements Runner {
  constructor(private bin = 'claude') {}

  run(req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      // The prompt goes in on stdin: no argument-length limits, nothing in `ps`.
      // Own process group, so a timeout also stops commands the agent started (tests, builds).
      const child = spawn(this.bin, claudeArgs(req), { cwd: req.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, ...req.env } });
      stopActiveOnExit();
      if (child.pid) {
        active.add(child.pid);
        req.onSpawn?.(child.pid);
      }
      const killAll = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      const text = new CappedText();
      const stderr = new CappedText(256 * 1024);
      let timedOut = false;
      let stuck: string | undefined;
      const final = new FinalText();
      let denied = 0;
      const deniedTools = new Map<string, number>();
      // What it was blocked on: blocked Bash calls link back to their command by id; hosts come from error text.
      const bashCommands = new Map<string, string>();
      const neededCommands = new Set<string>();
      const neededHosts = new Set<string>();
      const raw = new RawLog(req.rawLogPath, req.rawLogMaxBytes);
      const watch = req.loopRepeat ? new LoopWatch(req.loopRepeat) : null;
      const lines = new LineReader((line) => {
        if (!line.trim()) return;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        final.feed(event);
        const ev = event as { type?: string; subtype?: string; tool_name?: string; tool_use_id?: string; message?: { content?: unknown } };
        if (Array.isArray(ev.message?.content)) {
          for (const b of ev.message!.content as { type?: string; id?: string; name?: string; input?: { command?: string }; content?: unknown }[]) {
            if (b?.type === 'tool_use' && b.name === 'Bash' && b.id && typeof b.input?.command === 'string') bashCommands.set(b.id, b.input.command);
            if (b?.type === 'tool_result') {
              const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
              for (const h of hostsInErrors(text.slice(0, 20_000))) neededHosts.add(h);
            }
          }
        }
        if (ev.type === 'system' && ev.subtype === 'permission_denied') {
          if (ev.tool_name === 'Bash' && ev.tool_use_id) {
            const pattern = commandPattern(bashCommands.get(ev.tool_use_id) ?? '');
            if (pattern) neededCommands.add(pattern);
          }
          // A blocked action isn't progress. Thousands of them (npm retrying with no network) mean it's stuck.
          denied++;
          deniedTools.set(ev.tool_name ?? '?', (deniedTools.get(ev.tool_name ?? '?') ?? 0) + 1);
          if (req.maxDenied && denied >= req.maxDenied && !stuck) {
            const top = [...deniedTools.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?';
            stuck = `the sandbox blocked it ${denied} times (mostly ${top === 'SandboxNetworkAccess' ? 'network access: away runs are offline' : top})`;
            killAll('SIGTERM');
            setTimeout(() => killAll('SIGKILL'), 5000).unref();
          }
          return;
        }
        poke();
        const why = stuck ? null : watch!.feed(event);
        if (why) {
          stuck = why;
          killAll('SIGTERM');
          setTimeout(() => killAll('SIGKILL'), 5000).unref();
        }
      });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      // No-progress watchdog: any output counts as progress (stream-json prints every tool call and result).
      let stalled: string | undefined;
      let idle: NodeJS.Timeout | undefined;
      const poke = () => {
        if (!req.idleTimeoutMs) return;
        clearTimeout(idle);
        idle = setTimeout(() => {
          stalled = `no progress for ${Math.round(req.idleTimeoutMs! / 60_000)}m`;
          killAll('SIGTERM');
          setTimeout(() => killAll('SIGKILL'), 5000).unref();
        }, req.idleTimeoutMs);
      };
      poke();
      child.stdout.on('data', (d: string) => {
        if (!watch) poke(); // with stream-json, a line counts as progress only if it isn't a blocked action
        raw.write(d);
        if (watch) lines.push(d);
        else text.push(d);
      });
      child.stderr.on('data', (d: string) => {
        poke();
        stderr.push(d);
      });
      const timer = setTimeout(() => {
        timedOut = true;
        killAll('SIGTERM');
        setTimeout(() => killAll('SIGKILL'), 5000).unref();
      }, req.timeoutMs);
      const done = (exitCode: number | null) => {
        clearTimeout(timer);
        clearTimeout(idle);
        raw.close();
        if (child.pid) active.delete(child.pid);
        if (watch) lines.end();
        const output = watch ? final.text() : text.toString();
        resolve({ exitCode, output, stderr: stderr.toString(), timedOut, durationMs: Date.now() - started, ...(stuck ? { stuck } : {}), ...(stalled ? { stalled } : {}),
          ...(neededCommands.size || neededHosts.size ? { needs: { commands: [...neededCommands], hosts: [...neededHosts] } } : {}) });
      };
      child.on('error', (err) => {
        stderr.push(String(err));
        done(null);
      });
      child.on('close', (code) => done(code));
      child.stdin.on('error', () => {}); // child may exit before reading
      child.stdin.end(req.prompt);
    });
  }
}

export function claudeAvailable(bin = 'claude'): boolean {
  const r = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 });
  return r.status === 0;
}
