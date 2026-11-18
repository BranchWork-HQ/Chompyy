import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { draftBlueprint } from '../src/blueprint.js';
import { applyPermissions, blueprintNeeds, commandPattern, hostsInErrors, parsePermission, planFor, recordNeeds } from '../src/permissions.js';
import { ClaudeRunner, type RunRequest } from '../src/runner.js';

describe('a permission is one plain domain or one program, nothing else', () => {
  it('accepts the two shapes', () => {
    expect(parsePermission('network:registry.npmjs.org')).toEqual({ kind: 'network', value: 'registry.npmjs.org' });
    expect(parsePermission('command:swiftc *')).toEqual({ kind: 'command', value: 'swiftc *' });
  });
  it('refuses anything that could smuggle more', () => {
    for (const bad of ['network:*', 'network:https://x.com/a', 'network:x.com; rm -rf ~', 'command:swiftc; curl x', 'command:a && b', 'command:$(evil)', 'command:', 'shell:ls', 'command:a | b']) {
      expect(parsePermission(bad)).toBeNull();
    }
  });
  it('turns a blocked command into a pattern for its program', () => {
    expect(commandPattern('/usr/bin/swiftc -typecheck Sources/*.swift')).toBe('swiftc *');
    expect(commandPattern('$(curl x)')).toBeNull();
  });
});

describe('learning what a run needed', () => {
  it('finds the hosts in network errors, and nothing in ordinary output', () => {
    expect(hostsInErrors('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/vitest failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org')).toEqual(['registry.npmjs.org']);
    expect(hostsInErrors('see https://example.com for docs')).toEqual([]);
  });

  it('remembers blocks per repo, counting runs', () => {
    const one = recordNeeds([], { commands: ['swiftc *'], hosts: [] }, '13', 't1');
    const two = recordNeeds(one, { commands: ['swiftc *'], hosts: ['registry.npmjs.org'] }, '17', 't2');
    expect(two).toEqual([
      { id: 'command:swiftc *', kind: 'command', value: 'swiftc *', runs: 2, lastCard: '17', lastAt: 't2' },
      { id: 'network:registry.npmjs.org', kind: 'network', value: 'registry.npmjs.org', runs: 1, lastCard: '17', lastAt: 't2' },
    ]);
  });

  // 2026-11-18: card #17's swiftc was "denied because it needed approval" at 3 AM. Now the runner notes it.
  it('the runner reports a blocked command (by its id) and the host of a network error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chompyy-needs-'));
    const bin = join(dir, 'claude');
    const events = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'swiftc -typecheck a.swift' } }] } },
      { type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: 't1' },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'npm error getaddrinfo ENOTFOUND registry.npmjs.org' }] } },
      { type: 'result', result: 'done' },
    ];
    writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on('end', () => { for (const e of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(e) + '\\n'); });\n`);
    chmodSync(bin, 0o755);
    const res = await new ClaudeRunner(bin).run({ prompt: 'go', cwd: dir, timeoutMs: 20_000, loopRepeat: 5 });
    expect(res.needs).toEqual({ commands: ['swiftc *'], hosts: ['registry.npmjs.org'] });
  }, 20_000);
});

describe('the plan on a card', () => {
  const bp = `## Goal\nx\n\n## Needs\n- network: docs.swift.org: read the SwiftUI menu bar docs\n- command: \`swiftc\`: typecheck the app\n- network: not a domain!: nope`;
  it("reads the blueprint's Needs, skipping anything malformed", () => {
    expect(blueprintNeeds(bp)).toEqual([
      { kind: 'network', value: 'docs.swift.org', why: 'read the SwiftUI menu bar docs' },
      { kind: 'command', value: 'swiftc *', why: 'typecheck the app' },
    ]);
    expect(blueprintNeeds('## Goal\nno needs here')).toEqual([]);
  });

  it('combines blueprint, earlier runs and preflight, once each, blueprint reasons first', () => {
    const recorded = recordNeeds([], { commands: ['swiftc *'], hosts: ['github.com'] }, '13', 't');
    const plan = planFor(bp, recorded, ['registry.npmjs.org']);
    expect(plan.map((p) => [p.id, p.source])).toEqual([
      ['network:docs.swift.org', 'blueprint'],
      ['command:swiftc *', 'blueprint'],
      ['network:github.com', 'earlier runs'],
      ['network:registry.npmjs.org', 'preflight'],
    ]);
    expect(plan[2]!.why).toMatch(/earlier run here was blocked reaching github.com \(1×, last on #13\)/);
  });

  it('gives a run exactly what was allowed', () => {
    expect(applyPermissions(['network:docs.swift.org', 'command:swiftc *', 'command:bad; x'])).toEqual({ allowedTools: ['Bash(swiftc *)'], domains: ['docs.swift.org'] });
    expect(applyPermissions(undefined)).toEqual({ allowedTools: [], domains: [] });
  });
});

describe('drafting can research', () => {
  it('allows the web tools up front (headless runs refuse anything not allowed)', async () => {
    let req: RunRequest | undefined;
    const runner = { run: async (r: RunRequest) => { req = r; return { exitCode: 0, output: '## Goal\nx', stderr: '', timedOut: false, durationMs: 1 }; } };
    await draftBlueprint({ idea: 'i', cwd: '/r' }, runner, { model: 'haiku', cwd: '/r' });
    expect(req!.tools).toContain('WebSearch');
    expect(req!.allowedTools).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch']));
  });
});
