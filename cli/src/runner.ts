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
  extraArgs?: string[];
}

export interface RunResult {
  exitCode: number | null;
  output: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface Runner {
  run(req: RunRequest): Promise<RunResult>;
}

export function claudeArgs(req: RunRequest): string[] {
  const args = ['-p', '--output-format', 'text', '--no-session-persistence'];
  if (req.model) args.push('--model', req.model);
  if (req.maxTurns) args.push('--max-turns', String(req.maxTurns));
  if (req.tools !== undefined) args.push('--tools', req.tools);
  if (req.permissionMode) args.push('--permission-mode', req.permissionMode);
  if (req.permissionPrompts) args.push('--permission-prompts', req.permissionPrompts);
  if (req.allowedTools?.length) args.push('--allowedTools', ...req.allowedTools);
  if (req.disallowedTools?.length) args.push('--disallowedTools', ...req.disallowedTools);
  if (req.extraArgs?.length) args.push(...req.extraArgs);
  return args;
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
      const child = spawn(this.bin, claudeArgs(req), { cwd: req.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
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
      child.stdout.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        timedOut = true;
        killAll('SIGTERM');
        setTimeout(() => killAll('SIGKILL'), 5000).unref();
      }, req.timeoutMs);
      const done = (exitCode: number | null) => {
        clearTimeout(timer);
        if (child.pid) active.delete(child.pid);
        resolve({ exitCode, output, stderr, timedOut, durationMs: Date.now() - started });
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
