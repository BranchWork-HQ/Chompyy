import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configuredMcp, detect, detectText, installedSkills, isAutomated, readSession, ruleC1, ruleS2, ruleS3, ruleS5, scan, type Scan } from '../src/detect.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'chompyy-detect-'));
  dirs.push(d);
  return d;
};

const NOW = Date.parse('2026-11-23T12:00:00Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** One assistant turn as Claude Code logs it. */
const turn = (id: string, at: number, o: { write?: number; read?: number; h1?: boolean; miss?: string; tools?: { name: string; input?: object }[] } = {}) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    cwd: '/work/app',
    timestamp: iso(at),
    message: {
      id,
      usage: { input_tokens: 5, output_tokens: 10, cache_read_input_tokens: o.read ?? 0, cache_creation_input_tokens: o.write ?? 0, cache_creation: { ephemeral_1h_input_tokens: o.h1 ? o.write ?? 0 : 0 } },
      content: (o.tools ?? []).map((t) => ({ type: 'tool_use', name: t.name, input: t.input ?? {} })),
      ...(o.miss ? { diagnostics: { cache_miss_reason: { type: o.miss } } } : {}),
    },
  });

function projects(sessions: Record<string, string[]>): string {
  const root = temp();
  for (const [path, lines] of Object.entries(sessions)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), lines.join('\n') + '\n');
  }
  return root;
}

describe('reading transcripts', () => {
  it('counts each request once, with its cache miss reason, skills and MCP calls', () => {
    const root = projects({
      '-work-app/s1.jsonl': [
        turn('m1', NOW - 120 * MIN, { write: 50_000, h1: true }),
        turn('m1', NOW - 120 * MIN, { write: 50_000, h1: true, tools: [{ name: 'Skill', input: { skill: 'tdd' } }] }), // same request, second block
        turn('m2', NOW - 30 * MIN, { write: 90_000, miss: 'previous_message_not_found', tools: [{ name: 'mcp__figma__get' }] }),
        JSON.stringify({ type: 'user', message: { content: '<command-name>/review</command-name>' } }),
      ],
    });
    const s = scan({ root, now: new Date(NOW) });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]!.turns.map((t) => [t.cacheWrite, t.miss ?? null])).toEqual([[50_000, null], [90_000, 'previous_message_not_found']]);
    expect(Object.fromEntries(s.skills)).toEqual({ tdd: 1 });
    expect(Object.fromEntries(s.commands)).toEqual({ review: 1 });
    expect(s.mcp.get('figma')?.calls).toBe(1);
  });

  it('leaves out automated runs in temp folders and sessions older than the window', () => {
    const root = projects({
      '-private-tmp-bench/a.jsonl': [turn('x', NOW - MIN, { write: 1 })],
      '-var-folders-p--T-bw-judge/b.jsonl': [turn('y', NOW - MIN, { write: 1 })],
      '-work-old/c.jsonl': [turn('z', NOW - 40 * 86_400_000, { write: 1 })],
    });
    utimesSync(join(root, '-work-old/c.jsonl'), new Date(NOW - 40 * 86_400_000), new Date(NOW - 40 * 86_400_000));
    expect(scan({ root, now: new Date(NOW) }).sessions).toEqual([]);
    expect(isAutomated('-Users-me-code')).toBe(false);
    expect(readSession(join(root, '-work-old/c.jsonl'))?.turns).toHaveLength(1);
  });
});

describe('C1: coming back after the cache expired', () => {
  const sessionWith = (gapsMin: number[], h1 = true): Scan['sessions'][number] => {
    let at = NOW - 3 * 86_400_000;
    const turns = [{ at, cacheRead: 0, cacheWrite: 20_000, wrote1h: h1 }];
    for (const g of gapsMin) {
      at += g * MIN;
      turns.push({ at, cacheRead: 0, cacheWrite: 100_000, wrote1h: h1, ...(g > 0 ? { miss: 'previous_message_not_found' } : {}) } as never);
    }
    return { id: 's', cwd: '/w', turns };
  };
  const scanOf = (sessions: Scan['sessions']): Scan => ({ sessions, skills: new Map(), commands: new Map(), mcp: new Map(), firstAt: 0, lastAt: 0 });

  it('fires on 3 returns past the 1-hour lifetime, with measured sizes and share', () => {
    const [f] = ruleC1(scanOf([sessionWith([90, 120, 61])]), NOW);
    expect(f).toMatchObject({ rule: 'C1', basis: 'measured', lane: 'habit' });
    expect(f!.say).toMatch(/^3 returns .* median 100k tokens rewritten each, 300k in all, 94% of your cache writes/);
    expect(f!.fix).not.toMatch(/ping/);
  });

  it("doesn't count a miss within the lifetime (not a cold return), and stays quiet under the threshold", () => {
    expect(ruleC1(scanOf([sessionWith([30, 50, 59])]), NOW)).toEqual([]);
  });

  it('uses the 5-minute lifetime when the earlier turn wrote a 5-minute cache', () => {
    expect(ruleC1(scanOf([sessionWith([6, 7, 8], false)]), NOW)).toHaveLength(1);
  });
});

describe('S3: skills you never use', () => {
  function claudeDir(): string {
    const d = temp();
    const skill = (path: string, name: string) => {
      mkdirSync(join(d, path), { recursive: true });
      writeFileSync(join(d, path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${'does a thing '.repeat(10)}\n---\nbody`);
      utimesSync(join(d, path, 'SKILL.md'), new Date(NOW - 30 * 86_400_000), new Date(NOW - 30 * 86_400_000));
    };
    for (const n of ['a', 'b', 'c']) skill(`skills/${n}`, n);
    skill('skills/synced/acct/x', 'x');
    const plug = join(d, 'plugins', 'cache', 'p', '1.0');
    skill('plugins/cache/p/1.0/skills/shown', 'shown');
    skill('plugins/cache/p/1.0/skills/shown2', 'shown2');
    skill('plugins/cache/p/1.0/skills/hidden', 'hidden'); // shipped but not exposed by the manifest
    mkdirSync(join(plug, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plug, '.claude-plugin', 'plugin.json'), JSON.stringify({ skills: ['./skills/shown', './skills/shown2'] }));
    writeFileSync(join(d, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'p@m': [{ installPath: plug }] } }));
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p@m': true } }));
    return d;
  }
  const busy = (used: string[]): Scan => ({
    sessions: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, cwd: '/w', turns: [] })),
    skills: new Map(used.map((u) => [u, 1])),
    commands: new Map(),
    mcp: new Map(),
    firstAt: NOW - 20 * 86_400_000,
    lastAt: NOW,
  });

  it("reads your skills, synced ones, and the plugin skills its manifest exposes", () => {
    expect(installedSkills(claudeDir()).map((k) => `${k.source}:${k.calledAs}`).sort()).toEqual(['plugin:p:shown', 'plugin:p:shown2', 'synced:x', 'yours:a', 'yours:b', 'yours:c']);
  });

  it('fires at 5+ unused with enough history, and knows a plugin skill by its short name too', () => {
    const skills = installedSkills(claudeDir());
    expect(ruleS3(busy([]), skills, NOW)[0]!.say).toMatch(/^6 of 6 skills unused in 20 sessions over 20 days \(2 from plugins, 1 synced .*, 3 in ~\/.claude\/skills\)/);
    expect(ruleS3(busy(['shown']), skills, NOW)[0]!.say).toMatch(/^5 of 6/);
    expect(ruleS3(busy(['shown', 'a']), skills, NOW)).toEqual([]);
  });

  it("stays quiet without 20 sessions over 14 days: too little history to call anything unused", () => {
    const thin = { ...busy([]), firstAt: NOW - 5 * 86_400_000 };
    expect(ruleS3(thin, installedSkills(claudeDir()), NOW)).toEqual([]);
  });
});

describe('detect, end to end', () => {
  it('reports MCP servers you never call, and says when there is nothing to fix', () => {
    const home = temp();
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { figma: {} }, projects: { '/work/app': { mcpServers: { linear: {} } } } }));
    expect(configuredMcp([], home)).toEqual([{ name: 'figma', scope: 'user' }, { name: 'linear', scope: '/work/app' }]);
    const root = projects({ '-work-app/s1.jsonl': [turn('m1', NOW - MIN, { tools: [{ name: 'mcp__linear__list' }] })], '-work-app/s2.jsonl': [turn('m2', NOW - MIN)] });
    const r = detect({ root, now: new Date(NOW), claudeDir: temp(), home });
    expect(r.findings.map((f) => f.rule)).toEqual(['S4']);
    expect(r.findings[0]!.say).toMatch(/figma \(all projects\)/);
    const quiet = detect({ root, now: new Date(NOW), claudeDir: temp(), home: temp() });
    expect(detectText(quiet).join('\n')).toMatch(/Nothing to fix in what this version checks/);
  });
});

describe('S2 and S5: what loads before you type', () => {
  it('S2 flags a CLAUDE.md over 200 lines, charged to the sessions under it', () => {
    const repo = temp();
    writeFileSync(join(repo, 'CLAUDE.md'), Array.from({ length: 250 }, (_, i) => `rule ${i}`).join('\n'));
    const s: Scan = { sessions: [{ id: 'a', cwd: repo, turns: [] }, { id: 'b', cwd: repo, turns: [] }, { id: 'c', cwd: '/elsewhere', turns: [] }], skills: new Map(), commands: new Map(), mcp: new Map(), firstAt: 0, lastAt: 0 };
    const [f] = ruleS2(s, temp());
    expect(f!.say).toMatch(/is 250 lines .* loaded in 2 sessions/);
    writeFileSync(join(repo, 'CLAUDE.md'), 'short');
    expect(ruleS2(s, temp())).toEqual([]);
  });

  it('S5 flags a MEMORY.md past the 200 lines Claude Code loads', () => {
    const root = temp();
    mkdirSync(join(root, '-work-app', 'memory'), { recursive: true });
    writeFileSync(join(root, '-work-app', 'memory', 'MEMORY.md'), Array.from({ length: 241 }, (_, i) => `- [m${i}](m${i}.md)`).join('\n'));
    mkdirSync(join(root, '-private-tmp-x', 'memory'), { recursive: true });
    writeFileSync(join(root, '-private-tmp-x', 'memory', 'MEMORY.md'), 'x\n'.repeat(300));
    const found = ruleS5(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.say).toMatch(/241 lines .* only the first 200 lines/);
  });
});

describe('C2: cache thrown away mid-session, with its cause', () => {
  const deferred = (names: string[]) => JSON.stringify({ type: 'attachment', attachment: { type: 'deferred_tools_record', entries: names.map((name) => ({ name, description: 'x' })) } });
  it('names the server whose tools Tool Search loaded just before the rebuild', () => {
    const root = projects({
      '-work-app/s1.jsonl': [
        turn('m1', NOW - 10 * MIN, { write: 20_000, h1: true, tools: [{ name: 'ToolSearch', input: { query: 'select:mcp__claude-in-chrome__navigate' } }] }),
        deferred(['mcp__claude-in-chrome__navigate', 'mcp__claude-in-chrome__computer']),
        turn('m2', NOW - 9 * MIN, { write: 166_000, h1: true, miss: 'tools_changed' }),
        turn('m3', NOW - 8 * MIN, { write: 1_000, h1: true }),
      ],
    });
    const s = scan({ root, now: new Date(NOW) });
    expect(s.sessions[0]!.turns.map((t) => t.loaded ?? null)).toEqual([null, ['claude-in-chrome'], null]);
    const [f] = detect({ root, now: new Date(NOW), claudeDir: temp(), home: temp() }).findings;
    expect(f!.rule).toBe('C2');
    expect(f!.say).toMatch(/after claude-in-chrome's tools loaded mid-session \(166k\)/);
    expect(f!.fix).toMatch(/^Load claude-in-chrome at the start of a session/);
    expect(f!.tokens).toBe(166_000);
  });

  it("doesn't blame a load that came before an earlier, unchanged request; names /mcp when that came first", () => {
    const root = projects({
      '-work-app/s1.jsonl': [
        deferred(['WebSearch']),
        turn('m1', NOW - 10 * MIN, { write: 20_000, h1: true }),
        JSON.stringify({ type: 'user', message: { content: '<command-name>/mcp</command-name>' } }),
        turn('m2', NOW - 9 * MIN, { write: 80_000, h1: true, miss: 'tools_changed' }),
      ],
    });
    const [f] = detect({ root, now: new Date(NOW), claudeDir: temp(), home: temp() }).findings;
    expect(f!.say).toMatch(/once after \/mcp \(80k\)/);
    expect(f!.say).not.toMatch(/WebSearch/);
  });
});

describe('the one-screen summary', () => {
  const r = (findings: object[], sessions = 40) => ({ scanned: { sessions, days: 30, skills: 10, mcpServers: 1 }, findings }) as never;
  const f = (rule: string, title: string, tokens?: number, basis = 'measured') => ({ rule, title, say: 's', basis, fix: `Fix ${rule} first. Then more.`, lane: 'habit', ...(tokens === undefined ? {} : { tokens }) });
  it('ranks findings by tokens, starts with the biggest one, and keeps the evidence for --all', () => {
    const text = detectText(r([f('S4', 'Idle servers'), f('S3', 'Unused skills', 104_000, 'estimated'), f('C1', 'Cold returns', 5_100_000)])).join('\n');
    // Action first, then the ranked list; no rule IDs on screen.
    expect(text.split('\n')[0]).toBe('Start here: Fix C1 first.');
    expect(['Cold returns', 'Unused skills', 'Idle servers'].map((t) => text.indexOf(t))).toEqual([...['Cold returns', 'Unused skills', 'Idle servers'].map((t) => text.indexOf(t))].sort((x, y) => x - y));
    expect(text).toMatch(/5\.1M {2}Cold returns/);
    expect(text).toMatch(/~104k {2}Unused skills/);
    expect(text).not.toMatch(/Not proven|measured +C1/);
    expect(detectText(r([f('C1', 'Cold returns', 5)]), { all: true }).join('\n')).toMatch(/Fix: Fix C1 first\. Then more\./);
  });
  it('says where it looked when there are no sessions, instead of "nothing to fix"', () => {
    const text = detectText(r([], 0), { projects: '~/.claude/projects' }).join('\n');
    expect(text).toMatch(/No Claude Code sessions from the last 30 days in ~\/\.claude\/projects/);
    expect(text).not.toMatch(/Nothing to fix/);
  });
});
