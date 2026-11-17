// Reads your Claude Code history for the cold start (spec §5.9). Runs locally and changes nothing.
// From each interactive session it keeps only: the folder, the dates, what you typed (cleaned, secrets
// removed) and the last thing Claude said. Headless runs (Chompyy's own, benchmarks, scripts) are skipped.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { findGitRoot, isTemp } from './projects.js';

export interface Session {
  /** Short id used in the digest and in the model's citations: S1, S2, … (newest first). */
  id: string;
  file: string;
  cwd: string;
  /** Git root of cwd when there is one, else cwd. */
  project: string;
  projectName: string;
  started: string;
  ended: string;
  /** Everything you typed, cleaned and redacted, in order. */
  prompts: string[];
  /** The last thing Claude said in the session (often an offer you never answered). */
  lastReply: string | null;
}

export interface HistoryScan {
  sessions: Session[];
  skipped: { headless: number; temp: number; empty: number; unreadable: number };
  from: string | null;
  to: string | null;
}

// ---------- redaction ----------

const SECRET_PATTERNS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[secret]'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{16,}/g, '[secret]'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '[secret]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[secret]'],
  [/\bnpm_[A-Za-z0-9]{30,}/g, '[secret]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[secret]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[secret]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[secret]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[secret]'], // JWT
  // keep "password=" so the sentence still reads
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, (_m, name, sep) => `${name}${sep}[secret]`],
  // long random-looking strings (mixed case and digits), not paths or slugs
  [/[A-Za-z0-9+_=-]{32,}/g, (m) => (/[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m) && (m.match(/-/g)?.length ?? 0) < 3 ? '[secret]' : m)],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

/** Remove things that look like secrets or personal contact details. */
export function redact(text: string): string {
  let out = text;
  for (const [re, to] of SECRET_PATTERNS) out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to as (...m: string[]) => string);
  return out;
}

// ---------- reading one transcript ----------

/** Turn a user message into what you actually typed, or null if it isn't something you typed. */
export function cleanPrompt(content: unknown): string | null {
  let text: string;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    // Arrays hold tool results or text blocks; only plain text blocks are typed words.
    if (content.some((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result')) return null;
    text = content
      .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n');
  } else return null;

  // A slash command arrives as tags: keep it as "/name args".
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? '';
    const name = cmd[1]!.trim();
    return name ? `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}` : null;
  }
  if (/^\s*<(local-command|bash-|system-reminder|task-notification|user-prompt-submit-hook)/.test(text)) return null;
  if (/^\s*(Caveat:|\[Request interrupted|This session is being continued from a previous conversation)/.test(text)) return null;
  text = text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted text]')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[Image[^\]]*\]/g, '[image]')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text : null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('\n');
}

interface Parsed {
  entrypoint: string | null;
  cwd: string | null;
  started: string | null;
  ended: string | null;
  prompts: string[];
  lastReply: string | null;
}

export function parseTranscript(raw: string): Parsed {
  const p: Parsed = { entrypoint: null, cwd: null, started: null, ended: null, prompts: [], lastReply: null };
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!p.entrypoint && typeof o.entrypoint === 'string') p.entrypoint = o.entrypoint;
    if (!p.cwd && typeof o.cwd === 'string') p.cwd = o.cwd;
    if (typeof o.timestamp === 'string') {
      p.started ??= o.timestamp;
      p.ended = o.timestamp;
    }
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    const message = o.message as { content?: unknown } | undefined;
    if (o.type === 'user') {
      const typed = cleanPrompt(message?.content);
      if (typed) p.prompts.push(typed);
    } else if (o.type === 'assistant') {
      const t = textOf(message?.content).trim();
      if (t) p.lastReply = t;
    }
  }
  return p;
}

// ---------- scanning all of it ----------

/** Read every interactive Claude Code session on this Mac, newest first. */
export function scanHistory(opts: { claudeDir?: string; maxSessions?: number; isTemp?: (p: string) => boolean } = {}): HistoryScan {
  const temp = opts.isTemp ?? isTemp;
  const claudeDir = opts.claudeDir ?? join(homedir(), '.claude', 'projects');
  const scan: HistoryScan = { sessions: [], skipped: { headless: 0, temp: 0, empty: 0, unreadable: 0 }, from: null, to: null };
  if (!existsSync(claudeDir)) return scan;

  const files: { file: string; mtime: number }[] = [];
  for (const dir of readdirSync(claudeDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = join(claudeDir, dir.name);
    for (const f of readdirSync(folder)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        files.push({ file: join(folder, f), mtime: statSync(join(folder, f)).mtimeMs });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);

  const found: Omit<Session, 'id'>[] = [];
  for (const { file } of files) {
    if (opts.maxSessions && found.length >= opts.maxSessions) break;
    let parsed: Parsed;
    try {
      parsed = parseTranscript(readFileSync(file, 'utf8'));
    } catch {
      scan.skipped.unreadable++;
      continue;
    }
    // Headless runs (`claude -p`, SDK) are agents talking, not you.
    if (parsed.entrypoint === 'sdk-cli' || parsed.entrypoint === 'sdk-ts' || parsed.entrypoint === 'sdk-py') {
      scan.skipped.headless++;
      continue;
    }
    if (!parsed.cwd || temp(parsed.cwd) || parsed.cwd.includes('/.branchwork/')) {
      scan.skipped.temp++;
      continue;
    }
    if (parsed.prompts.length === 0) {
      scan.skipped.empty++;
      continue;
    }
    let project = parsed.cwd;
    const root = existsSync(parsed.cwd) ? findGitRoot(parsed.cwd) : null;
    if (root && root !== homedir()) {
      try {
        project = realpathSync.native(root);
      } catch {
        project = root;
      }
    }
    found.push({
      file,
      cwd: parsed.cwd,
      project,
      projectName: basename(project),
      started: parsed.started ?? '',
      ended: parsed.ended ?? '',
      prompts: parsed.prompts.map(redact),
      lastReply: parsed.lastReply ? redact(parsed.lastReply) : null,
    });
  }
  found.sort((a, b) => b.ended.localeCompare(a.ended));
  scan.sessions = found.map((s, i) => ({ id: `S${i + 1}`, ...s }));
  const times = found.flatMap((s) => [s.started, s.ended]).filter(Boolean).sort();
  scan.from = times[0] ?? null;
  scan.to = times[times.length - 1] ?? null;
  return scan;
}

// ---------- the digest sent to the model ----------

/** Words that mark an idea for later, in English and Chinese. */
const LATER = /\b(later|todo|to-do|next time|someday|some day|remind me|come back|eventually|follow[- ]up|not now|backlog|park|wishlist|nice to have)\b|之後|以後|下次|有空|待辦|晚點|再來|改天/i;
/** Words that mark a correction: the clearest taste evidence. */
const CORRECTION = /^(no\b|nope|don'?t|do not|stop|instead|actually|wrong|that'?s not|not what|please don'?t|never)|不要|不是|別|改成|太長|太多/i;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Which prompts of a session go in the digest: the start, ideas for later, corrections, and the end. */
export function pickPrompts(prompts: string[], max = 14): string[] {
  const keep = new Set<number>();
  const add = (i: number) => {
    if (i >= 0 && i < prompts.length && keep.size < max) keep.add(i);
  };
  [0, 1, 2].forEach(add);
  prompts.forEach((p, i) => LATER.test(p) && add(i));
  prompts.forEach((p, i) => CORRECTION.test(p) && add(i));
  [prompts.length - 3, prompts.length - 2, prompts.length - 1].forEach(add);
  return [...keep].sort((a, b) => a - b).map((i) => prompts[i]!);
}

/** The digest: one block per session, newest first, until the size cap. */
export function buildDigest(sessions: Session[], maxChars = 60_000): { text: string; included: Session[] } {
  const blocks: string[] = [];
  const included: Session[] = [];
  let size = 0;
  for (const s of sessions) {
    const lines = [
      `### ${s.id} · ${s.projectName} (${s.project}) · ${s.ended.slice(0, 10)} · ${s.prompts.length} prompts`,
      ...pickPrompts(s.prompts).map((p) => `> ${clip(p, 300)}`),
      ...(s.lastReply ? [`Claude ended with: ${clip(s.lastReply.replace(/\s+/g, ' '), 450)}`] : []),
    ];
    const block = lines.join('\n');
    if (size + block.length > maxChars && included.length > 0) break;
    blocks.push(block);
    included.push(s);
    size += block.length + 2;
  }
  return { text: blocks.join('\n\n'), included };
}

/** How long Claude Code keeps transcripts (`cleanupPeriodDays`, default 30). */
export function historyRetention(settingsPath = join(homedir(), '.claude', 'settings.json')): { days: number; isDefault: boolean } {
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8')) as { cleanupPeriodDays?: unknown };
    if (typeof s.cleanupPeriodDays === 'number') return { days: s.cleanupPeriodDays, isDefault: false };
  } catch {}
  return { days: 30, isDefault: true };
}
