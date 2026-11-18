// History cold start (spec §5.9): one model call over a digest of your Claude Code history proposes a first
// taste.md and a few suggested cards. Nothing is added until you accept it. Every proposal must cite your
// sessions, and the citations are checked against the digest, so the model can't invent evidence.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { addCard, updateBoard, type BoardData, type Card } from './board.js';
import { appendJsonl, homePath, readJson, writeJson } from './home.js';
import { buildDigest, pickPrompts, type HistoryScan, type Session } from './history.js';
import { insertUnderHeading, readTaste } from './taste.js';
import type { Runner } from './runner.js';
import { branchOf } from './workspace.js';

export type ProposalStatus = 'proposed' | 'accepted' | 'declined';

export interface TasteProposal {
  id: string;
  scope: string;
  text: string;
  sessions: string[];
  lastSeen: string;
  status: ProposalStatus;
}

export interface CardProposal {
  id: string;
  title: string;
  idea: string;
  project: string;
  why: string;
  quote: string;
  sessions: string[];
  status: ProposalStatus;
  cardId?: string;
}

export interface ColdStart {
  generatedAt: string;
  model: string;
  scanned: { sessions: number; included: number; projects: number; from: string | null; to: string | null };
  taste: TasteProposal[];
  cards: CardProposal[];
  /** Proposals thrown out because their evidence didn't check out. */
  dropped: { taste: number; cards: number };
}

/** A preference must show up in this many separate sessions (spec §5.8: 3 confirmations). */
export const MIN_TASTE_SESSIONS = 3;

export function coldStartPath(): string {
  return homePath('coldstart.json');
}

export function loadColdStart(): ColdStart | null {
  return readJson<ColdStart | null>(coldStartPath(), null);
}

export function coldStartPrompt(digest: string, existing: string[] = []): string {
  return `Below is a digest of one developer's Claude Code sessions: their own words ("> " lines), newest
session first, and the last thing Claude said in each session. Do two jobs.

1. TASTE: how this person likes work done. Only preferences visible in at least ${MIN_TASTE_SESSIONS} DIFFERENT sessions
   (corrections like "no, ..." or "don't ..." are the strongest evidence). Write each as an instruction to
   an agent, at most 20 words, e.g. "Explain in plain words, one step at a time". Scope is "Everywhere" or a
   project name from the digest. Write it as the instruction itself, never about the person ("they
   often ask…"). Only about how work should be done: nothing about their health,
   relationships, money, identity or private life.

2. CARDS: small tasks they would likely want an agent to do unattended while they're away, grounded in
   what they said: ideas they parked ("later", "next time", "之後"), offers Claude made at the end of a
   session that were never taken up, work abandoned midway, TODOs they mentioned, routines repeated often.
   Each card must be one self-contained task an agent can finish in under 30 minutes inside that project
   folder, with no installs, no network services, no decision only the person can make, and nothing
   outward (no push, publish, send or post). Skip anything a later session shows was already done.

${existing.length ? `Already on their board (don't propose these again, or anything that is the same task in other words):
${existing.map((t) => `- ${t}`).join('\n')}

` : ''}Fewer, stronger proposals beat many weak ones: at most 8 taste lines and 6 cards; empty lists are fine.

Reply with ONLY this JSON, no prose:
{"taste":[{"scope":"Everywhere","text":"...","sessions":["S3","S9","S12"]}],
 "cards":[{"title":"at most 8 words","idea":"2-4 sentences, as they would write it to park the idea",
   "project":"the exact folder path from the session header","why":"one sentence to them, saying 'you' (e.g. 'You said you'd add a changelog later.')",
   "sessions":["S4"],"quote":"3-15 words copied exactly from that session's lines in the digest"}]}

Digest:
${digest}`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[…"“”'‘’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The text the model saw for one session, to check a quote against. */
function sessionText(s: Session): string {
  return norm([...pickPrompts(s.prompts), s.lastReply ?? ''].join(' '));
}

function parseJson(output: string): { taste?: unknown[]; cards?: unknown[] } {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not reply with JSON.');
  return JSON.parse(output.slice(start, end + 1)) as { taste?: unknown[]; cards?: unknown[] };
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toUpperCase()))] : []);

/** Keep only proposals whose evidence is real: cited sessions exist, enough of them, quotes really said. */
export function validateProposals(raw: { taste?: unknown[]; cards?: unknown[] }, included: Session[], exists: (p: string) => boolean = existsSync) {
  const byId = new Map(included.map((s) => [s.id, s]));
  const projects = new Set(included.map((s) => s.project));
  const dropped = { taste: 0, cards: 0 };

  const taste: TasteProposal[] = [];
  for (const t of raw.taste ?? []) {
    const o = (t ?? {}) as Record<string, unknown>;
    const sessions = ids(o.sessions).filter((id) => byId.has(id));
    const text = str(o.text, 200);
    if (!text || sessions.length < MIN_TASTE_SESSIONS) {
      dropped.taste++;
      continue;
    }
    const lastSeen = sessions.map((id) => byId.get(id)!.ended).sort().pop() ?? '';
    taste.push({ id: `t${taste.length + 1}`, scope: str(o.scope, 60) || 'Everywhere', text, sessions, lastSeen: lastSeen.slice(0, 10), status: 'proposed' });
    if (taste.length >= 8) break;
  }

  const cards: CardProposal[] = [];
  for (const c of raw.cards ?? []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const sessions = ids(o.sessions).filter((id) => byId.has(id));
    const quote = str(o.quote, 300);
    const project = str(o.project, 500);
    const idea = str(o.idea, 1200);
    const title = str(o.title, 80);
    const quoted = quote.length >= 8 && sessions.some((id) => sessionText(byId.get(id)!).includes(norm(quote)));
    if (!title || !idea || !sessions.length || !quoted || !projects.has(project) || !exists(project)) {
      dropped.cards++;
      continue;
    }
    cards.push({ id: `c${cards.length + 1}`, title, idea, project, why: str(o.why, 300), quote, sessions, status: 'proposed' });
    if (cards.length >= 6) break;
  }
  return { taste, cards, dropped };
}

/** Read the digest with the model and save the proposals to coldstart.json. */
export async function runColdStart(
  scan: HistoryScan,
  runner: Runner,
  opts: { model: string; cwd: string; now: Date; maxChars?: number; existing?: string[] },
): Promise<ColdStart> {
  if (!scan.sessions.length) throw new Error('No Claude Code sessions found to learn from yet. Use Claude Code for a while, then try again.');
  const { text, included } = buildDigest(scan.sessions, opts.maxChars);
  const result = await runner.run({ prompt: coldStartPrompt(text, opts.existing), cwd: opts.cwd, model: opts.model, tools: '', timeoutMs: 240_000 });
  if (result.timedOut) throw new Error('Reading your history timed out. Try again.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  const { taste, cards: proposed, dropped } = validateProposals(parseJson(result.output), included);
  // Same title as a card you already have: drop it even if the model ignored the list.
  const have = new Set((opts.existing ?? []).map(norm));
  const cards = proposed.filter((c) => !have.has(norm(c.title))).map((c, i) => ({ ...c, id: `c${i + 1}` }));
  dropped.cards += proposed.length - cards.length;
  const cs: ColdStart = {
    generatedAt: opts.now.toISOString(),
    model: opts.model,
    scanned: { sessions: scan.sessions.length, included: included.length, projects: new Set(scan.sessions.map((s) => s.project)).size, from: scan.from, to: scan.to },
    taste,
    cards,
    dropped,
  };
  writeJson(coldStartPath(), cs);
  return cs;
}

/** Add the taste lines under their scope heading in taste.md. Your own lines are never touched. */
export function addTasteLines(text: string, lines: TasteProposal[]): string {
  let out = text;
  for (const t of lines) out = insertUnderHeading(out, t.scope, `- ${t.text}  (from your history · seen in ${t.sessions.length} sessions · last ${t.lastSeen})`);
  return out;
}

/** Accept the chosen proposals; the rest of what's still proposed is declined (also a signal). */
export function acceptColdStart(choice: { taste: string[]; cards: string[] }, now: Date): { taste: TasteProposal[]; cards: Card[] } {
  const cs = loadColdStart();
  if (!cs) throw new Error('Nothing to accept yet. Run `chompyy coldstart` first.');
  const pickT = new Set(choice.taste.map((s) => s.toLowerCase()));
  const pickC = new Set(choice.cards.map((s) => s.toLowerCase()));
  for (const id of [...pickT, ...pickC]) {
    if (![...cs.taste, ...cs.cards].some((p) => p.id === id)) throw new Error(`No proposal "${id}". See \`chompyy coldstart show\`.`);
  }

  const tasteNow = cs.taste.filter((t) => t.status === 'proposed' && pickT.has(t.id));
  const cardsNow = cs.cards.filter((c) => c.status === 'proposed' && pickC.has(c.id));

  if (tasteNow.length) {
    const { path, text } = readTaste();
    writeFileSync(path, addTasteLines(text, tasteNow));
  }
  const made: Card[] = updateBoard((b: BoardData) =>
    cardsNow.map((p) => {
      const card = addCard(b, p.idea, p.project, now, 'suggested', branchOf(p.project));
      card.title = p.title;
      card.why = p.why;
      card.source = 'history';
      p.cardId = card.id;
      return card;
    }),
  );

  for (const t of cs.taste) if (t.status === 'proposed') t.status = pickT.has(t.id) ? 'accepted' : 'declined';
  for (const c of cs.cards) if (c.status === 'proposed') c.status = pickC.has(c.id) ? 'accepted' : 'declined';
  writeJson(coldStartPath(), cs);

  appendJsonl(homePath('signals.jsonl'), {
    at: now.toISOString(),
    kind: 'coldstart',
    accepted: { taste: tasteNow.map((t) => t.text), cards: cardsNow.map((c) => c.title) },
    declined: {
      taste: cs.taste.filter((t) => t.status === 'declined').map((t) => t.text),
      cards: cs.cards.filter((c) => c.status === 'declined').map((c) => c.title),
    },
  });
  return { taste: tasteNow, cards: made };
}

/** Forget the cold start's proposals. Accepted taste lines stay in taste.md, where you can edit them. */
export function forgetColdStart(): boolean {
  const path = coldStartPath();
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export function formatColdStart(cs: ColdStart): string {
  const mark = (s: ProposalStatus) => (s === 'accepted' ? '✓' : s === 'declined' ? '✗' : '·');
  const out = [
    `Read ${cs.scanned.included} of ${cs.scanned.sessions} sessions in ${cs.scanned.projects} projects (${(cs.scanned.from ?? '').slice(0, 10)} to ${(cs.scanned.to ?? '').slice(0, 10)}).`,
    '',
    `Taste (each seen in ${MIN_TASTE_SESSIONS}+ sessions):`,
    ...(cs.taste.length ? cs.taste.map((t) => `  ${mark(t.status)} ${t.id}  [${t.scope}] ${t.text}  (${t.sessions.length} sessions)`) : ['  (nothing seen often enough yet)']),
    '',
    'Suggested cards:',
    ...(cs.cards.length
      ? cs.cards.flatMap((c) => [`  ${mark(c.status)} ${c.id}  ${c.title}  · ${c.project.split('/').pop()}`, `       why: ${c.why}`, `       you said: "${c.quote}"`])
      : ['  (no grounded ideas found)']),
  ];
  if (cs.dropped.taste || cs.dropped.cards) out.push('', `Thrown out for weak evidence: ${cs.dropped.taste} taste, ${cs.dropped.cards} cards.`);
  if ([...cs.taste, ...cs.cards].some((p) => p.status === 'proposed')) out.push('', 'Accept with: chompyy coldstart accept --taste t1,t2 --cards c1  (the rest are declined)');
  return out.join('\n');
}
