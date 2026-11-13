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

export class ClaudeRunner implements Runner {
  constructor(private bin = 'claude') {}

  run(req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      // The prompt goes in on stdin: no argument-length limits, nothing in `ps`.
      const child = spawn(this.bin, claudeArgs(req), { cwd: req.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
      }, req.timeoutMs);
      const done = (exitCode: number | null) => {
        clearTimeout(timer);
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
