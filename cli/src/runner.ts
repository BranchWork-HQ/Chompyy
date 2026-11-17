// The one seam: something that runs a prompt headless. ClaudeRunner wraps `claude -p`;
// tests pass a fake.
import { spawn, spawnSync } from 'node:child_process';

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
}

export interface RunResult {
  exitCode: number | null;
  output: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Set when the circuit breaker stopped the run: why. */
  stuck?: string;
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
  const result = events.find((e) => (e as { type?: string }).type === 'result') as { result?: string } | undefined;
  if (typeof result?.result === 'string') return result.result;
  return events
    .filter((e) => (e as { type?: string }).type === 'assistant')
    .flatMap((e) => ((e as { message?: { content?: { type?: string; text?: string }[] } }).message?.content ?? []))
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
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
      if (child.pid) active.add(child.pid);
      const killAll = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      let output = '';
      let stderr = '';
      let timedOut = false;
      let stuck: string | undefined;
      const events: unknown[] = [];
      const watch = req.loopRepeat ? new LoopWatch(req.loopRepeat) : null;
      let partial = '';
      child.stdout.on('data', (d: Buffer) => {
        if (!watch) {
          output += d.toString();
          return;
        }
        partial += d.toString();
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          events.push(event);
          const why = stuck ? null : watch.feed(event);
          if (why) {
            stuck = why;
            killAll('SIGTERM');
            setTimeout(() => killAll('SIGKILL'), 5000).unref();
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        timedOut = true;
        killAll('SIGTERM');
        setTimeout(() => killAll('SIGKILL'), 5000).unref();
      }, req.timeoutMs);
      const done = (exitCode: number | null) => {
        clearTimeout(timer);
        if (child.pid) active.delete(child.pid);
        if (watch) {
          if (partial.trim()) {
            try {
              events.push(JSON.parse(partial));
            } catch {}
          }
          output = streamText(events);
        }
        resolve({ exitCode, output, stderr, timedOut, durationMs: Date.now() - started, ...(stuck ? { stuck } : {}) });
      };
      child.on('error', (err) => {
        stderr += String(err);
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
