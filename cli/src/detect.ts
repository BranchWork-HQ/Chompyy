// `chompyy detect` (FEATURES §8, step 2 of the detective): runs the rulebook (research/detective/RULEBOOK.md) on
// your own local files and lists what it finds. This first version covers the two chapters that weigh most:
// startup tax (S2–S5: what loads before you type) and cache (C1, C2: context rebuilt from scratch).
//
// The rulebook's personality applies to every finding: evidence first with a count, measured vs estimated
// labelled, what it doesn't prove said out loud, no dollars on a subscription, smallest fix first.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { projectsDir } from './dream.js';

export type Lane = 'settings' | 'work' | 'habit';

export interface Finding {
  /** The rulebook rule, e.g. "S3". */
  rule: string;
  title: string;
  /** What it saw, with counts. */
  say: string;
  basis: 'measured' | 'estimated';
  /** What the evidence doesn't prove. */
  notProve?: string;
  fix: string;
  lane: Lane;
}

// ---------- reading the transcripts ----------

export interface Turn {
  at: number;
  cacheRead: number;
  cacheWrite: number;
  /** The previous turn's cache lifetime decides when a return is "cold". */
  wrote1h: boolean;
  miss?: string;
  missedTokens?: number;
}

export interface Session {
  id: string;
  cwd: string;
  turns: Turn[];
}

export interface Scan {
  sessions: Session[];
  skills: Map<string, number>;
  commands: Map<string, number>;
  mcp: Map<string, { calls: number; projects: Set<string> }>;
  firstAt: number;
  lastAt: number;
}

/**
 * Folders under ~/.claude/projects made by automated runs in temp folders (benchmarks, sandboxes, Chompyy's own
 * cards): not your sessions, so they don't count for or against you.
 */
export const isAutomated = (folder: string) => /^-private-|^-var-folders-|^-tmp-|-T-|chompyy-worktrees|\.chompyy-worktrees/.test(folder);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function readSession(file: string): Session | null {
  const turns = new Map<string, Turn>();
  let cwd = '';
  let id = basename(file, '.jsonl');
  const skills = new Map<string, number>();
  const commands = new Map<string, number>();
  const mcp = new Map<string, number>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"') && !line.includes('<command-name>')) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    if (typeof e.sessionId === 'string') id = e.sessionId;
    const msg = e.message as { id?: string; usage?: Record<string, unknown>; content?: unknown; diagnostics?: Record<string, unknown> } | undefined;
    const content = msg?.content;
    if (typeof content === 'string' || Array.isArray(content)) {
      const text = typeof content === 'string' ? content : content.map((b: { text?: string }) => (typeof b?.text === 'string' ? b.text : '')).join('');
      for (const m of text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) commands.set(m[1]!, (commands.get(m[1]!) ?? 0) + 1);
    }
    if (e.type !== 'assistant' || !msg?.usage || e.isSidechain) continue;
    if (Array.isArray(content)) {
      for (const b of content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (b?.type !== 'tool_use' || !b.name) continue;
        if (b.name === 'Skill' && typeof b.input?.skill === 'string') skills.set(b.input.skill, (skills.get(b.input.skill) ?? 0) + 1);
        if (b.name.startsWith('mcp__')) {
          const server = b.name.split('__')[1]!;
          mcp.set(server, (mcp.get(server) ?? 0) + 1);
        }
      }
    }
    const u = msg.usage;
    const cc = (u.cache_creation ?? {}) as Record<string, unknown>;
    const diag = (msg.diagnostics ?? (e.diagnostics as Record<string, unknown> | undefined)) ?? {};
    const reason = (diag.cache_miss_reason ?? {}) as { type?: string; cache_missed_input_tokens?: number };
    const key = msg.id ?? `${turns.size}`;
    const turn: Turn = {
      at: Date.parse(String(e.timestamp ?? '')) || 0,
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      wrote1h: num(cc.ephemeral_1h_input_tokens) > 0,
      ...(reason.type ? { miss: reason.type } : {}),
      ...(reason.cache_missed_input_tokens ? { missedTokens: num(reason.cache_missed_input_tokens) } : {}),
    };
    // One request is logged once per content block: keep the first time and the largest numbers.
    const had = turns.get(key);
    turns.set(key, had ? { ...turn, at: had.at || turn.at, miss: had.miss ?? turn.miss, cacheWrite: Math.max(had.cacheWrite, turn.cacheWrite), cacheRead: Math.max(had.cacheRead, turn.cacheRead) } : turn);
  }
  if (!turns.size) return null;
  const session: Session & { skills?: Map<string, number>; commands?: Map<string, number>; mcp?: Map<string, number> } = {
    id,
    cwd,
    turns: [...turns.values()].filter((t) => t.at).sort((a, b) => a.at - b.at),
  };
  return Object.assign(session, { skills, commands, mcp });
}

/** Your sessions from the last `days` days (by file time), automated runs left out. */
export function scan(opts: { days?: number; now?: Date; root?: string } = {}): Scan {
  const now = (opts.now ?? new Date()).getTime();
  const since = now - (opts.days ?? 30) * 86_400_000;
  const root = opts.root ?? projectsDir();
  const out: Scan = { sessions: [], skills: new Map(), commands: new Map(), mcp: new Map(), firstAt: Infinity, lastAt: 0 };
  if (!existsSync(root)) return { ...out, firstAt: 0 };
  for (const folder of readdirSync(root)) {
    if (isAutomated(folder)) continue;
    const dir = join(root, folder);
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const n of names) {
      const file = join(dir, n);
      try {
        if (statSync(file).mtimeMs < since) continue;
      } catch {
        continue;
      }
      const s = readSession(file) as (Session & { skills: Map<string, number>; commands: Map<string, number>; mcp: Map<string, number> }) | null;
      if (!s || !s.turns.length) continue;
      out.sessions.push({ id: s.id, cwd: s.cwd, turns: s.turns });
      out.firstAt = Math.min(out.firstAt, s.turns[0]!.at);
      out.lastAt = Math.max(out.lastAt, s.turns.at(-1)!.at);
      for (const [k, v] of s.skills) out.skills.set(k, (out.skills.get(k) ?? 0) + v);
      for (const [k, v] of s.commands) out.commands.set(k, (out.commands.get(k) ?? 0) + v);
      for (const [k, v] of s.mcp) {
        const m = out.mcp.get(k) ?? { calls: 0, projects: new Set<string>() };
        m.calls += v;
        m.projects.add(s.cwd);
        out.mcp.set(k, m);
      }
    }
  }
  if (out.firstAt === Infinity) out.firstAt = 0;
  return out;
}

// ---------- reading your setup ----------

export interface InstalledSkill {
  name: string;
  /** "plugin:name" for plugin skills, as the Skill tool calls them. */
  calledAs: string;
  descriptionTokens: number;
  source: 'yours' | 'plugin' | 'synced';
  installedAt: number;
}

/** Characters ÷ 4: every tool uses this; label it estimated. */
export const tokensOf = (text: string) => Math.ceil(text.length / 4);

function skillAt(file: string, source: InstalledSkill['source'], plugin?: string): InstalledSkill | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || basename(dirname(file));
  const description = front.match(/^description:\s*([\s\S]*?)(?=\n[a-z_-]+:|$)/m)?.[1]?.trim() ?? '';
  return { name, calledAs: plugin ? `${plugin}:${name}` : name, descriptionTokens: tokensOf(`${name}: ${description}`), source, installedAt: statSync(file).mtimeMs };
}

const skillFiles = (dir: string, depth = 3): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isFile() && n.name === 'SKILL.md') out.push(p);
    else if (n.isDirectory() && depth > 0 && n.name !== 'node_modules' && !n.name.startsWith('_archived')) out.push(...skillFiles(p, depth - 1));
  }
  return out;
};

/** A plugin's skills: the ones its manifest lists (it can ship more than it exposes), else everything under skills/. */
function pluginSkillFiles(installPath: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8')) as { skills?: unknown };
    if (Array.isArray(manifest.skills)) {
      return manifest.skills.filter((p): p is string => typeof p === 'string').map((p) => (p.endsWith('SKILL.md') ? join(installPath, p) : join(installPath, p, 'SKILL.md'))).filter(existsSync);
    }
  } catch {}
  return skillFiles(join(installPath, 'skills'), 2);
}

/** Your skills (~/.claude/skills, including account-synced ones) and the skills of enabled plugins. */
export function installedSkills(claudeDir = join(homedir(), '.claude')): InstalledSkill[] {
  const skills: InstalledSkill[] = [];
  const mine = join(claudeDir, 'skills');
  for (const f of skillFiles(mine)) {
    const s = skillAt(f, f.includes('/synced/') ? 'synced' : 'yours');
    if (s) skills.push(s);
  }
  let enabled: Record<string, boolean> = {};
  try {
    enabled = (JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean> }).enabledPlugins ?? {};
  } catch {}
  let installed: Record<string, { installPath?: string }[]> = {};
  try {
    const j = JSON.parse(readFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8')) as { plugins?: typeof installed };
    installed = j.plugins ?? (j as typeof installed);
  } catch {}
  for (const [id, on] of Object.entries(enabled)) {
    if (!on) continue;
    const plugin = id.split('@')[0]!;
    for (const inst of installed[id] ?? []) {
      if (!inst.installPath) continue;
      for (const f of pluginSkillFiles(inst.installPath)) {
        const s = skillAt(f, 'plugin', plugin);
        if (s) skills.push(s);
      }
    }
  }
  return skills;
}

export interface McpServer {
  name: string;
  scope: string;
}

/** MCP servers from ~/.claude.json (user and per-project) and each project's .mcp.json. */
export function configuredMcp(workspaces: string[], home = homedir()): McpServer[] {
  const out: McpServer[] = [];
  try {
    const j = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as { mcpServers?: Record<string, unknown>; projects?: Record<string, { mcpServers?: Record<string, unknown> }> };
    for (const n of Object.keys(j.mcpServers ?? {})) out.push({ name: n, scope: 'user' });
    for (const [p, v] of Object.entries(j.projects ?? {})) for (const n of Object.keys(v.mcpServers ?? {})) out.push({ name: n, scope: p });
  } catch {}
  for (const w of new Set(workspaces)) {
    try {
      const j = JSON.parse(readFileSync(join(w, '.mcp.json'), 'utf8')) as { mcpServers?: Record<string, unknown> };
      for (const n of Object.keys(j.mcpServers ?? {})) out.push({ name: n, scope: w });
    } catch {}
  }
  return out;
}

// ---------- the rules ----------

const DAY = 86_400_000;
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};
const home = (p: string) => p.replace(homedir(), '~');

/** S2: CLAUDE.md over 200 lines or 2,000 tokens, charged to the sessions that load it. */
export function ruleS2(s: Scan, claudeDir = join(homedir(), '.claude')): Finding[] {
  const files = new Map<string, number>(); // file → sessions that load it
  const userMd = join(claudeDir, 'CLAUDE.md');
  for (const ses of s.sessions) {
    for (const f of [userMd, ses.cwd ? join(ses.cwd, 'CLAUDE.md') : '']) if (f && existsSync(f)) files.set(f, (files.get(f) ?? 0) + 1);
  }
  const out: Finding[] = [];
  for (const [f, sessions] of files) {
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n').length;
    const tokens = tokensOf(text);
    if (lines <= 200 && tokens <= 2000) continue;
    out.push({
      rule: 'S2',
      title: 'CLAUDE.md is long',
      say: `${home(f)} is ${lines} lines (~${fmt(tokens)} tokens) and loads in every session there: ${sessions} sessions in this scan.`,
      basis: 'estimated',
      notProve: "Long isn't wrong: lines that stop the agent repeating a mistake earn their place.",
      fix: 'A card to tier it: keep identity, critical rules and key paths; move workflows into skills and long guides into files it reads when needed. No rule deleted without saying where it went.',
      lane: 'work',
    });
  }
  return out;
}

/** S3: installed skills with no use, when there's enough history to say so. */
export function ruleS3(s: Scan, skills: InstalledSkill[], now: number): Finding[] {
  const spanDays = s.sessions.length ? (s.lastAt - s.firstAt) / DAY : 0;
  if (s.sessions.length < 20 || spanDays < 14) return [];
  const used = new Set([...s.skills.keys(), ...s.commands.keys()]);
  const isUsed = (k: InstalledSkill) => used.has(k.calledAs) || used.has(k.name) || [...used].some((u) => u.endsWith(`:${k.name}`));
  const unused = skills.filter((k) => !isUsed(k) && now - k.installedAt > DAY && !/chompyy/i.test(k.name));
  if (unused.length < 5) return [];
  const tokens = unused.reduce((a, k) => a + k.descriptionTokens, 0);
  const bySource = (src: InstalledSkill['source']) => unused.filter((k) => k.source === src);
  const parts = (['plugin', 'synced', 'yours'] as const).map((src) => [src, bySource(src)] as const).filter(([, l]) => l.length);
  const label = { plugin: 'from plugins', synced: 'synced from your claude.ai account', yours: 'in ~/.claude/skills' };
  return [
    {
      rule: 'S3',
      title: 'Skills you never use still load every session',
      say: `${unused.length} of ${skills.length} installed skills had no use in ${s.sessions.length} sessions over ${Math.round(spanDays)} days (${parts.map(([src, l]) => `${l.length} ${label[src]}`).join(', ')}). Their names and descriptions add ~${fmt(tokens)} tokens to every session start. Examples: ${unused.slice(0, 5).map((k) => k.calledAs).join(', ')}.`,
      basis: 'estimated',
      notProve: "Not seeing a skill used doesn't prove you'll never need it.",
      fix: [
        bySource('plugin').length ? 'Turn off plugins you don\'t use (`/plugin`, or enabledPlugins in ~/.claude/settings.json)' : '',
        bySource('synced').length ? 'turn off synced skills you don\'t use in claude.ai settings' : '',
        bySource('yours').length ? 'move your own unused skills outside ~/.claude/skills (an _archived folder inside still loads)' : '',
      ].filter(Boolean).join('; ') + '.',
      lane: 'settings',
    },
  ];
}

/** S4: configured MCP servers with no calls. */
export function ruleS4(s: Scan, servers: McpServer[]): Finding[] {
  if (s.sessions.length < 2) return [];
  const idle = servers.filter((m) => !s.mcp.has(m.name));
  if (!idle.length) return [];
  return [
    {
      rule: 'S4',
      title: 'MCP servers you never call',
      say: `${idle.length} configured MCP server${idle.length > 1 ? 's were' : ' was'} never called in ${s.sessions.length} sessions: ${idle.map((m) => `${m.name} (${m.scope === 'user' ? 'all projects' : home(m.scope)})`).join(', ')}.`,
      basis: 'estimated',
      notProve: "With Tool Search deferral (the default now) an idle server costs little at startup. A server that reconnects mid-session does cost a cache rebuild, though (C2).",
      fix: 'Remove it, or move it to the one project that needs it.',
      lane: 'settings',
    },
  ];
}

/** S5: MEMORY.md past what Claude Code loads (200 lines or 25 KB). */
export function ruleS5(root = projectsDir()): Finding[] {
  const out: Finding[] = [];
  if (!existsSync(root)) return out;
  for (const folder of readdirSync(root)) {
    if (isAutomated(folder)) continue;
    const f = join(root, folder, 'memory', 'MEMORY.md');
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n').length;
    const bytes = Buffer.byteLength(text);
    if (lines <= 200 && bytes <= 25_000) continue;
    out.push({
      rule: 'S5',
      title: 'MEMORY.md is cut off',
      say: `${home(f)} is ${lines} lines (${Math.round(bytes / 1000)} KB). Claude Code loads only the first 200 lines or 25 KB, so the rest never reaches the agent.`,
      basis: 'measured',
      fix: 'Compress the index to one line per memory, and move duplicates out.',
      lane: 'work',
    });
  }
  return out;
}

/** C1: coming back after the cache expired, so the whole context is written again. */
export function ruleC1(s: Scan, now: number): Finding[] {
  const since = now - 14 * DAY;
  const cold: number[] = [];
  let allWrites = 0;
  for (const ses of s.sessions) {
    for (let i = 0; i < ses.turns.length; i++) {
      const t = ses.turns[i]!;
      if (t.at < since) continue;
      allWrites += t.cacheWrite;
      const prev = ses.turns[i - 1];
      if (!prev || t.miss !== 'previous_message_not_found') continue;
      const ttl = prev.wrote1h ? 60 * 60_000 : 5 * 60_000;
      if (t.at - prev.at > ttl) cold.push(t.cacheWrite);
    }
  }
  const coldWrites = cold.reduce((a, b) => a + b, 0);
  const share = allWrites ? coldWrites / allWrites : 0;
  if (cold.length < 3 && share < 0.05) return [];
  return [
    {
      rule: 'C1',
      title: 'Coming back after the cache expired',
      say: `${cold.length} times in the last 14 days you came back to a session after its cache had expired (an hour for the main conversation), so the whole context was written again: median ${fmt(median(cold))} tokens each, ${fmt(coldWrites)} in all, ${Math.round(share * 100)}% of your cache writes.`,
      basis: 'measured',
      notProve: "Some of these returns were worth it: a long session with context you'd otherwise have to rebuild.",
      fix: 'Before a long break, finish the thought and leave a short note; start fresh from the note when you return. Or /compact before leaving so the rewrite is small. Never automated keep-warm pings (rulebook T2).',
      lane: 'habit',
    },
  ];
}

/** C2: the cache thrown away mid-session (the tool list or earlier messages changed). */
export function ruleC2(s: Scan): Finding[] {
  const hits: { reason: string; tokens: number }[] = [];
  for (const ses of s.sessions) for (const t of ses.turns) if (t.miss === 'tools_changed' || t.miss === 'messages_changed') hits.push({ reason: t.miss, tokens: t.missedTokens ?? t.cacheWrite });
  const sessionsHit = s.sessions.filter((ses) => ses.turns.some((t) => t.miss === 'tools_changed' || t.miss === 'messages_changed')).length;
  if (sessionsHit < 2 && !hits.some((h) => h.tokens >= 50_000)) return [];
  const tools = hits.filter((h) => h.reason === 'tools_changed');
  return [
    {
      rule: 'C2',
      title: 'Cache thrown away mid-session',
      say: `${hits.length} time${hits.length > 1 ? 's' : ''} in ${sessionsHit} session${sessionsHit > 1 ? 's' : ''} the cache was rebuilt mid-session (${tools.length} because the tool list changed, ${hits.length - tools.length} because earlier messages changed): ${hits.map((h) => fmt(h.tokens)).join(', ')} tokens re-cached.`,
      basis: 'measured',
      fix: 'Usually an MCP server connecting or disconnecting, a /mcp toggle, a model switch or a settings change mid-session. Keep flaky servers off for that project; change models or settings between sessions.',
      lane: 'habit',
    },
  ];
}

export interface DetectResult {
  scanned: { sessions: number; days: number; skills: number; mcpServers: number };
  findings: Finding[];
}

export function detect(opts: { days?: number; now?: Date; root?: string; claudeDir?: string; home?: string } = {}): DetectResult {
  const now = (opts.now ?? new Date()).getTime();
  const s = scan({ days: opts.days ?? 30, now: new Date(now), ...(opts.root ? { root: opts.root } : {}) });
  const skills = installedSkills(opts.claudeDir);
  const servers = configuredMcp(s.sessions.map((x) => x.cwd).filter(Boolean), opts.home);
  const findings = [
    ...ruleC1(s, now),
    ...ruleC2(s),
    ...ruleS3(s, skills, now),
    ...ruleS2(s, opts.claudeDir),
    ...ruleS4(s, servers),
    ...ruleS5(opts.root),
  ];
  return { scanned: { sessions: s.sessions.length, days: opts.days ?? 30, skills: skills.length, mcpServers: servers.length }, findings };
}

export function detectText(r: DetectResult): string[] {
  const lines = [`Read ${r.scanned.sessions} of your sessions from the last ${r.scanned.days} days (automated runs left out), ${r.scanned.skills} installed skills, ${r.scanned.mcpServers} MCP servers.`];
  if (!r.findings.length) return [...lines, 'Nothing to fix in what this version checks (startup tax and cache).'];
  for (const f of r.findings) {
    lines.push('', `${f.rule} · ${f.title} (${f.basis})`, `  ${f.say}`);
    if (f.notProve) lines.push(`  What this doesn't prove: ${f.notProve}`);
    lines.push(`  Fix (${f.lane}): ${f.fix}`);
  }
  return lines;
}
