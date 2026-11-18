// The permission plan (research/away-readiness.md, step 3): an away run can't ask for approval at 3 AM, so the
// approval stage asks instead. A card's plan lists what its run may need beyond the box's defaults, from three
// sources: what earlier runs in this repo were blocked on, what preflight found, and what the blueprint itself
// says it needs. You tick what to allow when you approve; nothing is allowed by default, and allowed commands
// still run inside the box.

export type PermissionKind = 'network' | 'command';

export interface PlannedPermission {
  /** "network:registry.npmjs.org" or "command:swiftc *". */
  id: string;
  kind: PermissionKind;
  /** The domain, or the command pattern. */
  value: string;
  /** Why it's on the plan, for you. */
  why: string;
  source: 'earlier runs' | 'preflight' | 'blueprint';
}

/** What a repo's runs have been blocked on, kept in its profile. */
export interface RecordedNeed {
  id: string;
  kind: PermissionKind;
  value: string;
  /** How many runs hit it, and the last card that did. */
  runs: number;
  lastCard: string;
  lastAt: string;
}

/** What one run was blocked on (from the runner). */
export interface RunNeeds {
  /** Command patterns that needed approval, e.g. "swiftc *". */
  commands: string[];
  /** Hosts the shell tried to reach. */
  hosts: string[];
}

export const permissionId = (kind: PermissionKind, value: string) => `${kind}:${value}`;

export function parsePermission(id: string): { kind: PermissionKind; value: string } | null {
  const m = id.match(/^(network|command):(.+)$/);
  if (!m) return null;
  const value = m[2]!.trim();
  if (m[1] === 'network' && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return null; // a plain domain, nothing else
  if (m[1] === 'command' && (!value || /[;&|`$<>]/.test(value))) return null; // one command, no shell tricks
  return { kind: m[1] as PermissionKind, value };
}

/** A blocked command as a pattern to allow: its program name plus anything after ("swiftc *"). */
export function commandPattern(command: string): string | null {
  const first = command.trim().split(/\s+/)[0]?.replace(/^.*\//, '');
  if (!first || /[;&|`$<>()]/.test(first)) return null;
  return `${first} *`;
}

/** Hosts named in network errors ("ENOTFOUND registry.npmjs.org", "request to https://x/…"). */
export function hostsInErrors(text: string): string[] {
  if (!/ENOTFOUND|EAI_AGAIN|getaddrinfo|Could not resolve host|ECONNREFUSED|network request|unable to access/i.test(text)) return [];
  const hosts = new Set<string>();
  for (const m of text.matchAll(/(?:ENOTFOUND|EAI_AGAIN|getaddrinfo \w+|Could not resolve host:?)\s+([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1]!.toLowerCase());
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.add(m[1]!.toLowerCase());
  return [...hosts].filter((h) => h !== 'localhost').slice(0, 10);
}

/** The "## Needs" section a blueprint may carry: "- network: docs.swift.org: why" or "- command: swiftc: why". */
export function blueprintNeeds(blueprint: string | undefined): { kind: PermissionKind; value: string; why: string }[] {
  if (!blueprint) return [];
  const section = blueprint.split(/^## /m).find((s) => /^Needs\b/i.test(s));
  if (!section) return [];
  const needs: { kind: PermissionKind; value: string; why: string }[] = [];
  for (const line of section.split('\n').slice(1)) {
    const m = line.match(/^\s*[-*]\s*(network|command)\s*:\s*`?([^`:]+?)`?\s*(?::|—|-)\s*(.+)$/i);
    if (!m) continue;
    const kind = m[1]!.toLowerCase() as PermissionKind;
    const raw = m[2]!.trim();
    const value = kind === 'command' ? (raw.endsWith('*') ? raw : `${raw.split(/\s+/)[0]} *`) : raw.toLowerCase();
    if (parsePermission(permissionId(kind, value))) needs.push({ kind, value, why: m[3]!.trim() });
  }
  return needs;
}

/** Merge one run's blocked needs into the repo's record. */
export function recordNeeds(existing: RecordedNeed[], run: RunNeeds, cardId: string, at: string): RecordedNeed[] {
  const out = existing.map((n) => ({ ...n }));
  const add = (kind: PermissionKind, value: string) => {
    const id = permissionId(kind, value);
    if (!parsePermission(id)) return;
    const hit = out.find((n) => n.id === id);
    if (hit) Object.assign(hit, { runs: hit.runs + 1, lastCard: cardId, lastAt: at });
    else out.push({ id, kind, value, runs: 1, lastCard: cardId, lastAt: at });
  };
  for (const c of new Set(run.commands)) add('command', c);
  for (const h of new Set(run.hosts)) add('network', h);
  return out;
}

/** The plan for a card: earlier runs' blocks, preflight's network needs, and the blueprint's own Needs. */
export function planFor(blueprint: string | undefined, recorded: RecordedNeed[], preflightHosts: string[] = []): PlannedPermission[] {
  const plan: PlannedPermission[] = [];
  const push = (p: PlannedPermission) => {
    if (!plan.some((q) => q.id === p.id)) plan.push(p);
  };
  for (const n of blueprintNeeds(blueprint)) push({ id: permissionId(n.kind, n.value), kind: n.kind, value: n.value, why: n.why, source: 'blueprint' });
  for (const n of recorded) {
    const what = n.kind === 'network' ? `reaching ${n.value}` : `running ${n.value.replace(/ \*$/, '')}`;
    push({ id: n.id, kind: n.kind, value: n.value, why: `an earlier run here was blocked ${what} (${n.runs}×, last on #${n.lastCard})`, source: 'earlier runs' });
  }
  for (const h of preflightHosts) push({ id: permissionId('network', h), kind: 'network', value: h, why: "the repo's checks reach it", source: 'preflight' });
  return plan;
}

/** What a run gets from the permissions you allowed: extra tool rules and sandbox domains. */
export function applyPermissions(allowed: string[] | undefined): { allowedTools: string[]; domains: string[] } {
  const tools: string[] = [];
  const domains: string[] = [];
  for (const id of allowed ?? []) {
    const p = parsePermission(id);
    if (!p) continue;
    if (p.kind === 'network') domains.push(p.value);
    else tools.push(`Bash(${p.value})`);
  }
  return { allowedTools: tools, domains };
}
