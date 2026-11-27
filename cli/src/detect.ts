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
  /** Tokens it costs over the scan, for ranking the summary (per-session costs times the sessions seen). */
  tokens?: number;
  /** How `tokens` was reached, when it isn't a plain measured total, e.g. "~3.1k × 214 sessions". */
  tokensHow?: string;
  /** What a fix would act on (S3): plugins none of whose skills you used, and unused synced or own skills. */
  targets?: {
    /** `keep`: the few skills you did use, to copy into ~/.claude/skills before the plugin goes off. */
    plugins?: { id: string; skills: number; tokens: number; keep?: { name: string; dir: string }[] }[];
    synced?: string[];
    yours?: { name: string; file: string }[];
  };
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
  /** What happened just before a `tools_changed` rebuild: deferred tools loaded (by server), or a command run. */
  loaded?: string[];
  after?: string;
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
  // What changed since the last request: read back when the next request says the tool list changed.
  let loaded: string[] = [];
  let after = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"assistant"') && !line.includes('<command-name>') && !line.includes('deferred_tools_record')) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof e.cwd === 'string') cwd = e.cwd;
    const att = e.attachment as { type?: string; entries?: { name?: string }[] } | undefined;
    if (e.type === 'attachment' && att?.type === 'deferred_tools_record' && att.entries?.length) {
      // Tool Search loaded these tools into the list; an MCP tool counts as its server.
      loaded = [...new Set(att.entries.map((x) => String(x.name ?? '')).filter(Boolean).map((n) => (n.startsWith('mcp__') ? n.split('__')[1]! : n)))];
      continue;
    }
    if (typeof e.sessionId === 'string') id = e.sessionId;
    const msg = e.message as { id?: string; usage?: Record<string, unknown>; content?: unknown; diagnostics?: Record<string, unknown> } | undefined;
    const content = msg?.content;
    if (typeof content === 'string' || Array.isArray(content)) {
      const text = typeof content === 'string' ? content : content.map((b: { text?: string }) => (typeof b?.text === 'string' ? b.text : '')).join('');
      for (const m of text.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) {
        commands.set(m[1]!, (commands.get(m[1]!) ?? 0) + 1);
        if (/^(mcp|model|plugin|config|permissions)$/.test(m[1]!)) after = `/${m[1]}`;
      }
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
    if (!had) {
      if (turn.miss === 'tools_changed') {
        if (loaded.length) turn.loaded = loaded;
        if (after) turn.after = after;
      }
      loaded = [];
      after = '';
    }
    turns.set(key, had ? { ...turn, at: had.at || turn.at, miss: had.miss ?? turn.miss, loaded: had.loaded, after: had.after, cacheWrite: Math.max(had.cacheWrite, turn.cacheWrite), cacheRead: Math.max(had.cacheRead, turn.cacheRead) } : turn);
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
  /** For plugin skills: the plugin's id in enabledPlugins ("name@marketplace"). */
  plugin?: string;
  /** Where the SKILL.md is. */
  file?: string;
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
  return { name, calledAs: plugin ? `${plugin}:${name}` : name, descriptionTokens: tokensOf(`${name}: ${description}`), source, installedAt: statSync(file).mtimeMs, file };
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
        if (s) skills.push({ ...s, plugin: id });
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
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
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
      say: `${home(f)} is ${lines} lines (~${fmt(tokens)} tokens), loaded in ${sessions} sessions.`,
      basis: 'estimated',
      tokens: tokens * sessions,
      tokensHow: `~${fmt(tokens)} × ${sessions} sessions`,
      notProve: "Long isn't wrong: some lines stop repeat mistakes.",
      fix: 'Tier it: keep rules and key paths; move workflows into skills and guides into files read on demand. Every moved rule says where it went.',
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
      title: 'Unused skills load every session',
      say: `${unused.length} of ${skills.length} skills unused in ${s.sessions.length} sessions over ${Math.round(spanDays)} days (${parts.map(([src, l]) => `${l.length} ${label[src]}`).join(', ')}): ~${fmt(tokens)} tokens every session start. E.g. ${unused.slice(0, 5).map((k) => k.calledAs).join(', ')}.`,
      basis: 'estimated',
      tokens: tokens * s.sessions.length,
      tokensHow: `~${fmt(tokens)} × ${s.sessions.length} sessions`,
      notProve: "Unused so far doesn't mean never needed.",
      targets: {
        // A plugin you never use goes off whole; one you use a little (≤3 skills, 10+ unused) goes off after
        // copying the ones you use into your own skills.
        plugins: [...new Set(skills.filter((k) => k.plugin).map((k) => k.plugin!))].flatMap((id) => {
          const of = skills.filter((k) => k.plugin === id);
          const kept = of.filter(isUsed);
          const idle = of.filter((k) => !isUsed(k));
          if (kept.length > 3 || (kept.length && idle.length < 10)) return [];
          return [{
            id,
            skills: idle.length,
            tokens: idle.reduce((a, k) => a + k.descriptionTokens, 0),
            ...(kept.length ? { keep: kept.map((k) => ({ name: k.name, dir: dirname(k.file ?? '') })) } : {}),
          }];
        }),
        synced: bySource('synced').map((k) => k.name),
        yours: bySource('yours').map((k) => ({ name: k.name, file: k.file ?? '' })),
      },
      fix: [
        bySource('plugin').length ? 'Turn off unused plugins (/plugin)' : '',
        bySource('synced').length ? 'turn off unused synced skills in claude.ai settings' : '',
        bySource('yours').length ? 'move your unused skills out of ~/.claude/skills (an _archived folder inside still loads)' : '',
      ].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.',
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
      title: 'Unused MCP servers',
      say: `${idle.length} MCP server${idle.length > 1 ? 's' : ''} never called in ${s.sessions.length} sessions: ${idle.map((m) => `${m.name} (${m.scope === 'user' ? 'all projects' : home(m.scope)})`).join(', ')}.`,
      basis: 'estimated',
      notProve: 'With Tool Search (the default), an idle server costs little at startup. One that reconnects mid-session still rebuilds the cache.',
      fix: 'Remove it, or move it to the one project that uses it.',
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
      say: `${home(f)} is ${lines} lines (${Math.round(bytes / 1000)} KB); only the first 200 lines or 25 KB load.`,
      basis: 'measured',
      fix: 'Compress it to one line per memory; move duplicates out.',
      lane: 'work',
    });
  }
  return out;
}

/** Each return after the cache expired: when, and what it wrote again (C1's test, shared with the nudge's trend). */
export function coldReturns(s: Scan, since: number): { at: number; tokens: number }[] {
  const out: { at: number; tokens: number }[] = [];
  for (const ses of s.sessions) {
    for (let i = 1; i < ses.turns.length; i++) {
      const t = ses.turns[i]!;
      const prev = ses.turns[i - 1]!;
      if (t.at < since || t.miss !== 'previous_message_not_found') continue;
      const ttl = prev.wrote1h ? 60 * 60_000 : 5 * 60_000;
      if (t.at - prev.at > ttl) out.push({ at: t.at, tokens: t.cacheWrite });
    }
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
      say: `${cold.length} returns in 14 days after the cache expired (an hour idle): median ${fmt(median(cold))} tokens rewritten each, ${fmt(coldWrites)} in all, ${Math.round(share * 100)}% of your cache writes.`,
      basis: 'measured',
      notProve: "Some were worth it: context you'd otherwise rebuild.",
      tokens: coldWrites,
      // Never automated keep-warm pings (rulebook T2).
      fix: 'Before a long break: /compact, or leave a note and start fresh.',
      lane: 'habit',
    },
  ];
}

/** C2: the cache thrown away mid-session (the tool list or earlier messages changed), with what caused it. */
export function ruleC2(s: Scan): Finding[] {
  const hits: Turn[] = [];
  let sessionsHit = 0;
  for (const ses of s.sessions) {
    const here = ses.turns.filter((t) => t.miss === 'tools_changed' || t.miss === 'messages_changed');
    hits.push(...here);
    if (here.length) sessionsHit++;
  }
  const size = (t: Turn) => t.missedTokens ?? t.cacheWrite;
  if (sessionsHit < 2 && !hits.some((t) => size(t) >= 50_000)) return [];
  const total = hits.reduce((a, t) => a + size(t), 0);
  // Group by cause: "loaded claude-in-chrome", "/mcp", or unknown.
  const causes = new Map<string, Turn[]>();
  for (const t of hits) {
    const cause = t.miss === 'messages_changed' ? 'messages' : t.loaded?.length ? `loaded ${t.loaded.join(', ')}` : t.after ?? 'tools';
    causes.set(cause, [...(causes.get(cause) ?? []), t]);
  }
  const sorted = [...causes].sort((x, y) => y[1].reduce((a, t) => a + size(t), 0) - x[1].reduce((a, t) => a + size(t), 0));
  const said = (cause: string, ts: Turn[]) => {
    const n = ts.length === 1 ? 'once' : `${ts.length}×`;
    const sizes = ts.map((t) => fmt(size(t))).join(', ');
    if (cause.startsWith('loaded ')) return `${n} after ${cause.slice(7)}'s tools loaded mid-session (${sizes})`;
    if (cause.startsWith('/')) return `${n} after ${cause} (${sizes})`;
    if (cause === 'messages') return `${n} after earlier messages changed (${sizes})`;
    return `${n} after the tool list changed, cause not logged (${sizes})`;
  };
  const fixes: string[] = [];
  const servers = [...new Set(hits.flatMap((t) => t.loaded ?? []))];
  if (servers.length) fixes.push(`Load ${servers.join(', ')} at the start of a session, or give that work its own session.`);
  if (hits.some((t) => t.after)) fixes.push('Change MCP servers, models or plugins between sessions.');
  if (hits.some((t) => t.miss === 'tools_changed' && !t.loaded?.length && !t.after)) fixes.push('Likely an MCP server reconnecting: turn flaky ones off for that project.');
  if (hits.some((t) => t.miss === 'messages_changed')) fixes.push('Rewinding or editing old messages rewrites the cache: start fresh instead.');
  return [
    {
      rule: 'C2',
      title: 'Cache thrown away mid-session',
      say: `${hits.length} full rewrite${hits.length > 1 ? 's' : ''} mid-session in ${sessionsHit} session${sessionsHit > 1 ? 's' : ''}: ${sorted.map(([c, ts]) => said(c, ts)).join('; ')}.`,
      basis: 'measured',
      tokens: total,
      fix: fixes.join(' '),
      lane: 'habit',
    },
  ];
}

export interface DetectResult {
  scanned: { sessions: number; days: number; skills: number; mcpServers: number; startTokens?: number; coldWeek?: { count: number; tokens: number }; coldWeeks?: { from: string; count: number; tokens: number }[] };
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
  // Baselines for the checks advice cards register before a fix: what a session start costs, and last week's cold returns.
  const starts = s.sessions.map((x) => x.turns[0]!).map((t) => t.cacheRead + t.cacheWrite).filter((n) => n > 0);
  const week = coldReturns(s, now - 7 * DAY);
  return {
    scanned: {
      sessions: s.sessions.length,
      days: opts.days ?? 30,
      skills: skills.length,
      mcpServers: servers.length,
      ...(starts.length ? { startTokens: median(starts) } : {}),
      coldWeek: { count: week.length, tokens: week.reduce((a, x) => a + x.tokens, 0) },
      // The last 4 weeks, oldest first: the advice card's chart.
      coldWeeks: [3, 2, 1, 0].map((w) => {
        const xs = coldReturns(s, now - (w + 1) * 7 * DAY).filter((x) => x.at < now - w * 7 * DAY);
        return { from: new Date(now - (w + 1) * 7 * DAY).toISOString(), count: xs.length, tokens: xs.reduce((a, x) => a + x.tokens, 0) };
      }),
    },
    findings,
  };
}

const short = (text: string) => text.split(/(?<=\.)\s/)[0]!;

/**
 * One screen: what it read, the findings ranked by tokens, and the one fix to start with. `all` adds each
 * finding's evidence, what it doesn't prove, and every fix.
 */
export function detectText(r: DetectResult, opts: { all?: boolean; projects?: string } = {}): string[] {
  const { sessions, days, skills, mcpServers } = r.scanned;
  if (!sessions) {
    return [
      `No Claude Code sessions from the last ${days} days in ${opts.projects ?? '~/.claude/projects'}.`,
      'detect reads the transcripts Claude Code keeps on this computer. Use Claude Code for a few days, then run it again.',
    ];
  }
  const read = `Read ${sessions} sessions (last ${days} days), ${skills} skills, ${mcpServers} MCP servers. Nothing left this computer.`;
  if (!r.findings.length) return ['Nothing to fix in what this version checks (startup tax and cache).', '', read];
  const ranked = [...r.findings].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1));
  const cost = (f: Finding) => (f.tokens === undefined ? '' : `${f.basis === 'estimated' ? '~' : ''}${fmt(f.tokens)}`);
  const cw = Math.max(...ranked.map((f) => cost(f).length));
  const w = Math.max(...ranked.map((f) => f.title.length));
  const lines = [`Start here: ${short(ranked[0]!.fix)}`, ''];
  for (const f of ranked.slice(0, opts.all ? undefined : 5)) lines.push(`  ${cost(f).padStart(cw)}  ${f.title.padEnd(w)}  ${f.basis}`);
  if (!opts.all && ranked.length > 5) lines.push(`  …and ${ranked.length - 5} more: chompyy detect --all`);
  lines.push('', read);
  if (sessions < 20) lines.push(`Only ${sessions} sessions: some checks need 20 over 14 days.`);
  if (!opts.all) {
    lines.push('Evidence and every fix: chompyy detect --all');
    return lines;
  }
  for (const f of ranked) {
    lines.push('', `${cost(f) ? `${cost(f)} · ` : ''}${f.title} (${f.basis}${f.tokensHow ? `: ${f.tokensHow}` : ''})`, `  ${f.say}`);
    if (f.notProve) lines.push(`  Not proven: ${f.notProve}`);
    lines.push(`  Fix: ${f.fix}`);
  }
  return lines;
}
