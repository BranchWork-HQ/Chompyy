// Suggest tasks for a repo: one press, a few cards that would use capacity that otherwise resets unused. One model
// call over a digest of the repo: what it wants to become (README, roadmap and vision docs, open issues) and what
// the code shows (TODO/FIXME, recent commits), plus your taste and the cards you already have.
//
// Every task must name its source, and the source is checked against the digest, so the model can't invent one
// (the same rule as the history cold start). Nothing runs: the cards land in Suggested for you to approve.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { addCard, type BoardData, type Card } from './board.js';
import type { Runner } from './runner.js';
import { readTaste } from './taste.js';

export interface SuggestedTask {
  title: string;
  idea: string;
  why: string;
  source: string;
  size: 'small' | 'medium';
  kind: 'vision' | 'chore';
}

export interface RepoDigest {
  text: string;
  /** Everything a task may cite: file paths, issue numbers (#12), commit hashes. */
  sources: Set<string>;
}

/** Vision and convention docs, in order of how much they say about where the repo is going. */
const DOCS = ['README.md', 'VISION.md', 'ROADMAP.md', 'FEATURES.md', 'PLAN.md', 'TODO.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'];
const PER_DOC = 6000;
const MAX_DIGEST = 40_000;

/**
 * git in a repo Chompyy didn't make: no hooks, no fsmonitor, nothing inherited from the caller's GIT_* (rulebook
 * T4). Read-only commands only.
 */
function safeGit(repo: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8', env, timeout: 15_000, maxBuffer: 4 << 20 });
  return r.status === 0 ? r.stdout : '';
}

/** Open issues through your own `gh`, when the repo is on GitHub and gh is logged in. Optional: [] otherwise. */
export function openIssues(repo: string): { number: number; title: string }[] {
  const r = spawnSync('gh', ['issue', 'list', '--state', 'open', '--limit', '30', '--json', 'number,title'], { cwd: repo, encoding: 'utf8', timeout: 20_000 });
  if (r.status !== 0) return [];
  try {
    return (JSON.parse(r.stdout) as { number: number; title: string }[]).filter((i) => Number.isInteger(i.number) && typeof i.title === 'string');
  } catch {
    return [];
  }
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}\n[… cut at ${n} characters]` : text);

export function repoDigest(repo: string, opts: { issues?: { number: number; title: string }[]; existing?: string[] } = {}): RepoDigest {
  const sources = new Set<string>();
  const parts: string[] = [`# Repository: ${basename(repo)}`];
  const docs = DOCS.filter((d) => existsSync(join(repo, d)));
  // Up to 5 more Markdown files at the top of docs/ (design notes, specs).
  try {
    const dir = join(repo, 'docs');
    if (statSync(dir).isDirectory()) {
      docs.push(...readdirSync(dir).filter((n) => n.endsWith('.md')).sort().slice(0, 5).map((n) => `docs/${n}`));
    }
  } catch {}
  for (const d of docs) {
    try {
      parts.push(`## File: ${d}\n${clip(readFileSync(join(repo, d), 'utf8'), PER_DOC)}`);
      sources.add(d);
    } catch {}
  }
  const issues = opts.issues ?? [];
  if (issues.length) {
    parts.push(`## Open issues\n${issues.map((i) => `#${i.number} ${i.title}`).join('\n')}`);
    for (const i of issues) sources.add(`#${i.number}`);
  }
  const todos = safeGit(repo, ['grep', '-n', '-I', '-w', '-E', 'TODO|FIXME|HACK|XXX', '--', '.', ':!*.min.*', ':!**/vendor/**', ':!**/node_modules/**', ':!*.lock', ':!package-lock.json'])
    .split('\n').filter(Boolean).slice(0, 60);
  if (todos.length) {
    parts.push(`## TODO/FIXME in the code (path:line: text)\n${todos.map((l) => l.slice(0, 200)).join('\n')}`);
    for (const l of todos) sources.add(l.split(':')[0]!);
  }
  const commits = safeGit(repo, ['log', '--no-merges', '--format=%h %s', '-n', '20']).split('\n').filter(Boolean);
  if (commits.length) {
    parts.push(`## Recent commits\n${commits.join('\n')}`);
    for (const c of commits) sources.add(c.split(' ')[0]!);
  }
  // Tracked files: a task may also cite one it would change.
  for (const f of safeGit(repo, ['ls-files']).split('\n').filter(Boolean).slice(0, 5000)) sources.add(f);
  const taste = readTaste().text.trim();
  if (taste) parts.push(`## How the owner likes work done (taste.md)\n${clip(taste, 4000)}`);
  if (opts.existing?.length) parts.push(`## Cards already on the board (don't repeat these)\n${opts.existing.slice(0, 60).map((t) => `- ${t}`).join('\n')}`);
  parts.push(`## SOURCES you may cite\nAny file path above or tracked in the repo, an issue number like #12 from the list, or a commit hash from the list.`);
  return { text: clip(parts.join('\n\n'), MAX_DIGEST), sources };
}

export function suggestPrompt(digest: string, count: number): string {
  return [
    `You suggest tasks for a coding agent to run unattended in this repository while its owner is away, using plan capacity that would otherwise reset unused.`,
    `Below is a digest of the repository: its docs (what it wants to become), open issues, TODO/FIXME lines, recent commits, the owner's taste, and cards already on the board.`,
    ``,
    `Propose up to ${count} tasks. Mix two kinds:`,
    `- "vision": the next concrete step toward what the docs and issues say the project wants`,
    `- "chore": something the code shows needs doing (a TODO/FIXME, a missing test, a stale doc)`,
    ``,
    `Every task must be:`,
    `- doable unattended in one sitting (well under an hour of agent time), inside this repo, with no network, no publishing, no secrets`,
    `- checkable: the idea says how the result is checked (a test passes, a command runs, a file exists)`,
    `- grounded: "source" is exactly one file path, issue number (#12) or commit hash from the digest`,
    `- new: not the same as a card already on the board`,
    ``,
    `Reply with JSON only, no prose:`,
    `{"tasks":[{"title":"under 60 characters, starts with a verb","idea":"1-2 sentences: what to do and how it's checked","why":"one short line: why this now, from the source","source":"...","size":"small|medium","kind":"vision|chore"}]}`,
    ``,
    digest,
  ].join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Keep the tasks that cite a real source, aren't on the board already, and have what a card needs. */
export function validateTasks(raw: unknown, sources: Set<string>, existing: string[], count: number): { tasks: SuggestedTask[]; dropped: number } {
  const list = Array.isArray((raw as { tasks?: unknown })?.tasks) ? ((raw as { tasks: unknown[] }).tasks) : [];
  const have = new Set(existing.map(norm));
  const tasks: SuggestedTask[] = [];
  for (const t of list as Record<string, unknown>[]) {
    const title = typeof t?.title === 'string' ? t.title.trim() : '';
    const idea = typeof t?.idea === 'string' ? t.idea.trim() : '';
    const source = typeof t?.source === 'string' ? t.source.trim().replace(/^`|`$/g, '') : '';
    if (!title || !idea || !sources.has(source) || have.has(norm(title))) continue;
    have.add(norm(title));
    tasks.push({
      title: title.slice(0, 80),
      idea,
      why: typeof t.why === 'string' ? t.why.trim() : '',
      source,
      size: t.size === 'medium' ? 'medium' : 'small',
      kind: t.kind === 'chore' ? 'chore' : 'vision',
    });
    if (tasks.length >= count) break;
  }
  return { tasks, dropped: list.length - tasks.length };
}

function parseJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

export async function suggestTasks(repo: string, runner: Runner, opts: { model: string; cwd: string; existing: string[]; count?: number; issues?: { number: number; title: string }[] }): Promise<{ tasks: SuggestedTask[]; dropped: number }> {
  const count = opts.count ?? 5;
  const digest = repoDigest(repo, { existing: opts.existing, issues: opts.issues ?? openIssues(repo) });
  const result = await runner.run({ prompt: suggestPrompt(digest.text, count), cwd: opts.cwd, model: opts.model, tools: '', timeoutMs: 240_000 });
  if (result.timedOut) throw new Error('Suggesting tasks timed out. Try again.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  return validateTasks(parseJson(result.output), digest.sources, opts.existing, count);
}

/** The tasks as suggested cards in that repo, each saying where it came from. */
export function addSuggested(board: BoardData, repo: string, tasks: SuggestedTask[], now: Date): Card[] {
  return tasks.map((t) => {
    const c = addCard(board, t.idea, repo, now, 'suggested');
    c.title = t.title;
    c.source = 'suggest';
    c.why = `${t.kind === 'vision' ? 'Next step' : 'Chore'} from ${t.source} · ${t.size}${t.why ? `: ${t.why}` : ''}`;
    return c;
  });
}

export function suggestText(repo: string, cards: Card[], dropped: number): string {
  if (!cards.length) return `No new tasks for ${basename(repo)}${dropped ? ` (${dropped} dropped: no real source, or already on the board)` : ''}. Try again later, or park one yourself.`;
  return [
    `Approve the ones you want; they run while you're away.`,
    '',
    `${cards.length} suggested for ${basename(repo)}:`,
    ...cards.map((c) => `  #${c.id} ${c.title}\n      ${c.why}`),
    ...(dropped ? ['', `${dropped} dropped: no real source, or already on the board.`] : []),
  ].join('\n');
}
