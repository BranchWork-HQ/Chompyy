// Taste distiller (spec §5.8, FEATURES §7): signals → candidate preferences → one-tap questions → taste.md.
//
// - Evidence first: every preference cites signals (ratings, "what would have made it a 5?" picks, blueprint
//   edits, keep/undo, answers). Citations are checked against signals.jsonl, so the model can't invent any.
// - Learn only from governed work: signals of cards you approved, ran or rated. Drafts you dropped don't count.
// - Asked, not assumed: a candidate becomes a question after 3 separate cards (or right away when you stated
//   it yourself in a rating). Only a "yes" writes it to taste.md, with a valid-from date.
// - Never silently deleted: contradicted or removed preferences are retired with the reason and evidence.
// - Your edits win: delete a learned line from taste.md and the preference is retired.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BoardData, Card } from './board.js';
import { appendJsonl, homePath, readJson, writeJson } from './home.js';
import type { Runner } from './runner.js';

// ---------- taste.md ----------

export const TASTE_STUB = `# taste.md

What Chompyy has learned about how you like work done. Plain text: edit it freely, your edits win.
Learned lines end with an id like "p3"; delete the line and Chompyy retires that preference.

## Everywhere
`;

export function tastePath(): string {
  return homePath('taste.md');
}

export function readTaste(): { path: string; text: string; created: boolean } {
  const path = tastePath();
  if (existsSync(path)) return { path, text: readFileSync(path, 'utf8'), created: false };
  writeFileSync(path, TASTE_STUB);
  return { path, text: TASTE_STUB, created: true };
}

/** Insert a line at the end of a "## <scope>" section, creating the section if needed. */
export function insertUnderHeading(text: string, scope: string, line: string): string {
  const out = text.endsWith('\n') ? text : `${text}\n`;
  const heading = `## ${scope}`;
  const rows = out.split('\n');
  const at = rows.findIndex((l) => l.trim() === heading);
  if (at < 0) return `${out.trimEnd()}\n\n${heading}\n${line}\n`;
  let end = at + 1;
  while (end < rows.length && !rows[end]!.startsWith('## ')) end++;
  while (end > at + 1 && rows[end - 1]!.trim() === '') end--; // after the section's last line
  rows.splice(end, 0, line);
  return rows.join('\n');
}

/** taste.md for agents: drop the header comment so prompts carry only the preferences. Empty when nothing learned. */
export function tasteForPrompt(): string {
  const path = tastePath();
  if (!existsSync(path)) return '';
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\s+\((learned|from your history)[^)]*\)\s*$/, ''));
  const kept = lines.filter((l) => /^\s*[-*]\s+\S/.test(l) || l.startsWith('## '));
  // Only headings, no preferences: nothing to say.
  if (!kept.some((l) => !l.startsWith('## '))) return '';
  return kept.join('\n').replace(/(## [^\n]+\n)(?=## |$)/g, '').trim();
}

// ---------- signals ----------

/** 'chat': something you said in an everyday coding session, found by the nightly read (dream.ts), in your exact words. */
export type SignalKind = 'rating' | 'blueprint-edit' | 'answer' | 'outcome' | 'coldstart' | 'taste-answer' | 'chat';

export interface Signal {
  /** "s<line number>" in signals.jsonl: stable because the file is append-only. */
  id: string;
  kind: SignalKind;
  at: string;
  card?: string;
  title?: string;
  raw: Record<string, unknown>;
}

export function signalsPath(): string {
  return homePath('signals.jsonl');
}

export function readSignals(): Signal[] {
  const path = signalsPath();
  if (!existsSync(path)) return [];
  const out: Signal[] = [];
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        out.push({
          id: `s${i + 1}`,
          kind: (raw.kind as SignalKind) ?? 'rating',
          at: String(raw.at ?? ''),
          ...(raw.card != null ? { card: String(raw.card) } : {}),
          ...(raw.title ? { title: String(raw.title) } : {}),
          raw,
        });
      } catch {}
    });
  return out;
}

export function recordOutcome(card: Card, outcome: 'kept' | 'undone', now: Date): void {
  appendJsonl(signalsPath(), { at: now.toISOString(), card: card.id, title: card.title, kind: 'outcome', outcome, checks: card.run?.checks?.result ?? null });
}

/** Cards whose signals may teach taste: approved, ran or rated (spec: learn only from approved or rated work). */
export function governedCards(cards: Card[]): Set<string> {
  const archive = homePath('archive.jsonl');
  const dropped: Card[] = existsSync(archive)
    ? readFileSync(archive, 'utf8')
        .split('\n')
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l) as Card] : [];
          } catch {
            return [];
          }
        })
    : [];
  return new Set([...cards, ...dropped].filter((c) => c.approvedAt || c.run || c.rating || c.outcome).map((c) => c.id));
}

/** How strong a signal is as evidence. Concrete changes you made beat feelings. */
export function signalWeight(s: Signal): number {
  if (s.kind === 'blueprint-edit') return 3;
  if (s.kind === 'outcome') return s.raw.outcome === 'undone' ? 3 : 1;
  if (s.kind === 'rating') return Array.isArray(s.raw.toFive) && s.raw.toFive.length ? 3 : s.raw.reason ? 2 : 1;
  if (s.kind === 'answer') return 1;
  if (s.kind === 'chat') return 2;
  return 0;
}

/** One line per signal, for the distiller prompt and for "why do you think that?". */
export function describeSignal(s: Signal, max = 400): string {
  const cut = (v: unknown, n = max) => {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const card = s.card ? `card #${s.card} "${s.title ?? ''}"` : '';
  switch (s.kind) {
    case 'rating': {
      const toFive = Array.isArray(s.raw.toFive) && s.raw.toFive.length ? ` · to make it a 5: ${(s.raw.toFive as string[]).join('; ')}` : '';
      return `rated ${card} ${s.raw.rating}/5${s.raw.reason ? ` "${cut(s.raw.reason)}"` : ''}${toFive}`;
    }
    case 'blueprint-edit':
      return `edited the blueprint of ${card}\n    before: ${cut(s.raw.before)}\n    after: ${cut(s.raw.after)}`;
    case 'outcome':
      return `${s.raw.outcome === 'undone' ? 'undid' : 'kept'} the result of ${card}`;
    case 'answer':
      return `answered the questions of ${card}: "${cut(s.raw.text)}"`;
    case 'chat': {
      const where = String(s.raw.workspace ?? '').split('/').pop() || 'a session';
      return `said in a session in ${where} on ${s.at.slice(0, 10)}: "${cut(s.raw.quote)}"${s.raw.why ? ` (${cut(s.raw.why, 200)})` : ''}`;
    }
    default:
      return `${s.kind} ${card}`;
  }
}

/** Short receipts for the report: "undid #3, #5 · edited blueprint of #7". */
export function receipts(signals: Signal[]): string {
  const groups = new Map<string, string[]>();
  for (const s of signals) {
    const verb =
      s.kind === 'outcome' ? (s.raw.outcome === 'undone' ? 'undid' : 'kept')
      : s.kind === 'blueprint-edit' ? 'edited the blueprint of'
      : s.kind === 'rating' ? (Array.isArray(s.raw.toFive) && s.raw.toFive.length ? 'asked for a change on' : 'rated')
      : s.kind === 'answer' ? 'answered' : s.kind === 'chat' ? 'said it in sessions on' : s.kind;
    const ids = groups.get(verb) ?? [];
    const label = s.card ? `#${s.card}` : s.kind === 'chat' ? s.at.slice(5, 10) : '';
    if (label && !ids.includes(label)) ids.push(label);
    groups.set(verb, ids);
  }
  return [...groups].map(([verb, ids]) => `${verb} ${ids.join(', ')}`).join(' · ');
}

// ---------- preferences ----------

/**
 * candidate: some evidence, not enough to ask · ready: ask in the next report · active: you said yes, in taste.md
 * snoozed: "not now", asked again once more evidence comes in · muted: "don't ask about this" · retired: contradicted or removed
 */
export type PrefStatus = 'candidate' | 'ready' | 'active' | 'snoozed' | 'muted' | 'retired';

export interface Preference {
  id: string;
  scope: string;
  /** The preference as an instruction to an agent. */
  text: string;
  /** What Chompyy noticed, said to you: "You undid 3 cards that added tests you didn't ask for." */
  noticed: string;
  status: PrefStatus;
  /** Signal ids supporting it. */
  evidence: string[];
  /** You said it yourself with a reason (a rating's why or a to-a-5 pick): may be asked right away. */
  stated: boolean;
  createdAt: string;
  updatedAt: string;
  /** When you said yes; it is in force from then. */
  validFrom?: string;
  retiredAt?: string;
  retiredBecause?: string;
  /** Signal ids that contradicted it. */
  against?: string[];
  /** Separate cards and sessions behind it when you said "not now"; asked again once there are more. */
  snoozedAtCards?: number;
  /** Written to taste.md (so a missing line means you removed it). */
  rendered?: boolean;
}

export interface TasteStore {
  nextId: number;
  lastDistillAt?: string;
  /** Last signal id the distiller has seen (s<n>). */
  seenThrough?: number;
  prefs: Preference[];
}

/** A preference needs this many separate cards before Chompyy asks (FEATURES §7: 3 confirmations). */
export const MIN_CARDS = 3;
/** …or this many separate everyday sessions where you said it (the nightly read; "a mistake made a second time"). */
export const MIN_SESSIONS = 2;

export function storePath(): string {
  return homePath('preferences.json');
}

export function loadStore(): TasteStore {
  return readJson<TasteStore>(storePath(), { nextId: 1, prefs: [] });
}

export function saveStore(store: TasteStore): void {
  writeJson(storePath(), store);
}

export function getPref(store: TasteStore, id: string): Preference {
  const p = store.prefs.find((x) => x.id === id.trim().toLowerCase());
  if (!p) throw new Error(`No preference "${id}". See \`chompyy taste list\`.`);
  return p;
}

export function distinctCards(evidence: string[], byId: Map<string, Signal>): number {
  return new Set(evidence.map((id) => byId.get(id)?.card).filter(Boolean)).size;
}

/** Separate everyday sessions behind it (chat signals from the nightly read). */
export function distinctSessions(evidence: string[], byId: Map<string, Signal>): number {
  return new Set(evidence.map((id) => byId.get(id)).filter((s) => s?.kind === 'chat').map((s) => String(s!.raw.session))).size;
}

/** Separate places it was seen: cards plus sessions. */
export function sightings(evidence: string[], byId: Map<string, Signal>): number {
  return distinctCards(evidence, byId) + distinctSessions(evidence, byId);
}

/** Strength for ordering questions: separate cards first, then how concrete the signals are. */
export function strength(p: Preference, byId: Map<string, Signal>): number {
  const weight = p.evidence.reduce((sum, id) => sum + (byId.get(id) ? signalWeight(byId.get(id)!) : 0), 0);
  return sightings(p.evidence, byId) * 10 + weight + (p.stated ? 5 : 0);
}

/** Promote candidates with enough evidence; wake snoozed ones that gained a card. */
export function promote(p: Preference, byId: Map<string, Signal>): void {
  const cards = distinctCards(p.evidence, byId);
  const sessions = distinctSessions(p.evidence, byId);
  const enough = cards >= MIN_CARDS || sessions >= MIN_SESSIONS || cards + sessions >= MIN_CARDS || (p.stated && cards >= 1);
  if (p.status === 'candidate' && enough) p.status = 'ready';
  if (p.status === 'snoozed' && cards + sessions > (p.snoozedAtCards ?? 0)) p.status = 'ready';
}

// ---------- the distiller ----------

export function distillPrompt(signals: Signal[], prefs: Preference[]): string {
  const open = prefs.filter((p) => ['candidate', 'ready', 'active', 'snoozed'].includes(p.status));
  const muted = prefs.filter((p) => p.status === 'muted' || (p.status === 'retired' && !p.validFrom));
  return `You learn one developer's taste: how they like an agent to do work. Below are signals from cards an agent
ran for them unattended: their ratings and reasons, "what would have made it a 5?" picks, edits they made to a
blueprint before approving it, results they kept or undid, and answers to the agent's questions. Also things
they said to their AI in everyday coding sessions ("said in a session"), in their exact words, each with what
the nightly read thought it showed. The same point said in different sessions is one preference: cite them all.

Find preferences that would change what an agent does in a DIFFERENT task next week. A preference must be
supported by the signals you cite. Prefer patterns across separate cards or sessions. A reason the person wrote or a
change they picked counts as "stated". Write each as an instruction to an agent, at most 20 words, e.g.
"Don't add tests unless the blueprint asks for them". Write "noticed" as one sentence to the person saying
"you", with the receipts, e.g. "You undid 3 cards that added tests you didn't ask for."

Not preferences: one-off details of a single task, moods, anything true only for one card, secrets, and
anything about their health, relationships, money, identity or private life.

Scope is "Everywhere", or a project folder name if it only applies there.
${open.length ? `
Preferences already known (extend one by giving its id, instead of creating a duplicate):
${open.map((p) => `- ${p.id} [${p.status}] ${p.text}`).join('\n')}
` : ''}${muted.length ? `
The person declined these; never propose them again, nor the same thing in other words:
${muted.map((p) => `- ${p.text}`).join('\n')}
` : ''}
If a signal clearly goes against a known preference (they undid work that followed it, or rated it down
because of it), list it under "contradicted".

Reply with ONLY this JSON, no prose; empty lists are fine and fewer, stronger items beat many weak ones:
{"candidates":[{"id":null,"scope":"Everywhere","text":"...","noticed":"...","signals":["s3","s9"],"stated":false}],
 "contradicted":[{"id":"p2","signals":["s14"],"why":"one sentence"}]}

Signals:
${signals.map((s) => `${s.id} (${s.at.slice(0, 10)}) ${describeSignal(s)}`).join('\n')}`;
}

interface RawDistill {
  candidates?: unknown[];
  contradicted?: unknown[];
}

function parseJson(output: string): RawDistill {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The model did not reply with JSON.');
  return JSON.parse(output.slice(start, end + 1)) as RawDistill;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sigIds = (v: unknown, valid: Set<string>) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()))].filter((x) => valid.has(x)) : [];

export interface DistillChanges {
  added: string[];
  extended: string[];
  ready: string[];
  retired: string[];
  /** Items thrown out because their evidence didn't check out. */
  dropped: number;
}

/** Apply the model's reply to the store. Only evidence that exists and is governed is kept. */
export function applyDistill(store: TasteStore, raw: RawDistill, signals: Signal[], now: Date): DistillChanges {
  const at = now.toISOString();
  const byId = new Map(signals.map((s) => [s.id, s]));
  const valid = new Set(signals.map((s) => s.id));
  const changes: DistillChanges = { added: [], extended: [], ready: [], retired: [], dropped: 0 };
  const muted = new Set(store.prefs.filter((p) => p.status === 'muted').map((p) => p.text.toLowerCase()));

  for (const item of raw.candidates ?? []) {
    const o = (item ?? {}) as Record<string, unknown>;
    const evidence = sigIds(o.signals, valid);
    const text = str(o.text, 200);
    const oid = typeof o.id === 'string' ? o.id.trim().toLowerCase() : '';
    const existing = oid ? store.prefs.find((p) => p.id === oid) : undefined;
    if (!evidence.length || (!existing && (!text || muted.has(text.toLowerCase())))) {
      changes.dropped++;
      continue;
    }
    if (existing) {
      if (existing.status === 'muted' || existing.status === 'retired') continue;
      const fresh = evidence.filter((e) => !existing.evidence.includes(e));
      if (!fresh.length) continue;
      existing.evidence.push(...fresh);
      existing.stated ||= o.stated === true;
      const noticed = str(o.noticed, 300);
      if (noticed) existing.noticed = noticed;
      existing.updatedAt = at;
      changes.extended.push(existing.id);
      const before = existing.status;
      promote(existing, byId);
      if (before !== 'ready' && existing.status === 'ready') changes.ready.push(existing.id);
      continue;
    }
    const p: Preference = {
      id: `p${store.nextId++}`,
      scope: str(o.scope, 60) || 'Everywhere',
      text,
      noticed: str(o.noticed, 300) || text,
      status: 'candidate',
      evidence,
      stated: o.stated === true && evidence.some((e) => byId.get(e)?.kind === 'rating'),
      createdAt: at,
      updatedAt: at,
    };
    promote(p, byId);
    store.prefs.push(p);
    changes.added.push(p.id);
    if (p.status === 'ready') changes.ready.push(p.id);
  }

  for (const item of raw.contradicted ?? []) {
    const o = (item ?? {}) as Record<string, unknown>;
    const oid = typeof o.id === 'string' ? o.id.trim().toLowerCase() : '';
    const p = oid ? store.prefs.find((x) => x.id === oid) : undefined;
    const against = sigIds(o.signals, valid).filter((e) => !p?.evidence.includes(e));
    if (!p || !against.length || p.status === 'retired' || p.status === 'muted') {
      changes.dropped++;
      continue;
    }
    retire(p, str(o.why, 300) || 'later signals went against it', now, against);
    changes.retired.push(p.id);
  }
  return changes;
}

export function retire(p: Preference, because: string, now: Date, against: string[] = []): void {
  p.status = 'retired';
  p.retiredAt = now.toISOString();
  p.retiredBecause = because;
  if (against.length) p.against = [...(p.against ?? []), ...against];
  p.updatedAt = p.retiredAt;
}

/** Signals the distiller should read: governed, about cards, not yet seen. */
export function newSignals(store: TasteStore, signals: Signal[], governed: Set<string>): Signal[] {
  const seen = store.seenThrough ?? 0;
  return signals.filter((s) => Number(s.id.slice(1)) > seen && signalWeight(s) > 0 && (s.kind === 'chat' || (s.card && governed.has(s.card))));
}

export interface DistillResult {
  changes: DistillChanges;
  read: number;
}

/** Read new signals with the model and update preferences.json. Runs at most once per call; nothing to read = no model call. */
export async function distill(board: BoardData, runner: Runner, opts: { model: string; cwd: string; now: Date }): Promise<DistillResult> {
  const store = loadStore();
  const signals = readSignals();
  const fresh = newSignals(store, signals, governedCards(board.cards));
  const empty: DistillChanges = { added: [], extended: [], ready: [], retired: [], dropped: 0 };
  if (!fresh.length) return { changes: empty, read: 0 };
  // Context: the evidence behind open preferences, so the model can extend or contradict them.
  const byId = new Map(signals.map((s) => [s.id, s]));
  const context = store.prefs
    .filter((p) => ['candidate', 'ready', 'active', 'snoozed'].includes(p.status))
    .flatMap((p) => p.evidence.map((e) => byId.get(e)!).filter(Boolean));
  const shown = [...new Map([...context, ...fresh].map((s) => [s.id, s])).values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const result = await runner.run({ prompt: distillPrompt(shown, store.prefs), cwd: opts.cwd, model: opts.model, tools: '', timeoutMs: 180_000 });
  if (result.timedOut) throw new Error('The distiller timed out.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  const changes = applyDistill(store, parseJson(result.output), shown, opts.now);
  store.seenThrough = Math.max(store.seenThrough ?? 0, ...signals.map((s) => Number(s.id.slice(1))));
  store.lastDistillAt = opts.now.toISOString();
  saveStore(store);
  syncTasteFile(opts.now);
  return { changes, read: fresh.length };
}

// ---------- asking ----------

/** The one question for the next report: the ready preference with the strongest evidence. */
export function nextQuestion(store: TasteStore, signals: Signal[]): Preference | null {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const ready = store.prefs.filter((p) => p.status === 'ready');
  ready.sort((a, b) => strength(b, byId) - strength(a, byId));
  return ready[0] ?? null;
}

export function formatQuestion(p: Preference, signals: Signal[]): string[] {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const ev = p.evidence.map((e) => byId.get(e)).filter((s): s is Signal => Boolean(s));
  return [
    `💭 ${p.noticed}`,
    `   From now on: "${p.text}"?`,
    `   Evidence: ${receipts(ev)}  (chompyy taste why ${p.id})`,
    `   chompyy taste yes ${p.id} · not-now ${p.id} · never ${p.id}`,
  ];
}

export type Answer = 'yes' | 'not-now' | 'never';

/** Your one-tap answer. Yes writes it to taste.md; the others are signals too, and Chompyy asks less after them. */
export function answerPreference(id: string, answer: Answer, now: Date): Preference {
  const store = loadStore();
  const p = getPref(store, id);
  if (p.status === 'retired') throw new Error(`${p.id} was retired: ${p.retiredBecause ?? ''}`);
  const at = now.toISOString();
  const byId = new Map(readSignals().map((s) => [s.id, s]));
  if (answer === 'yes') {
    p.status = 'active';
    p.validFrom = at;
  } else if (answer === 'not-now') {
    p.status = 'snoozed';
    p.snoozedAtCards = sightings(p.evidence, byId);
  } else {
    p.status = 'muted';
  }
  p.updatedAt = at;
  saveStore(store);
  appendJsonl(signalsPath(), { at, kind: 'taste-answer', pref: p.id, text: p.text, answer });
  syncTasteFile(now);
  return p;
}

/** You retire a preference yourself. */
export function retirePreference(id: string, now: Date): Preference {
  const store = loadStore();
  const p = getPref(store, id);
  retire(p, 'you retired it', now);
  saveStore(store);
  syncTasteFile(now);
  return p;
}

// ---------- taste.md stays in step ----------

const MARK = /\s+·\s+(p\d+)\)\s*$/;

export function learnedLine(p: Preference, signals: Signal[]): string {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const cards = [...new Set(p.evidence.map((e) => byId.get(e)?.card).filter(Boolean))].map((c) => `#${c}`);
  return `- ${p.text}  (learned ${(p.validFrom ?? '').slice(0, 10)}${cards.length ? ` · from cards ${cards.join(', ')}` : ''} · ${p.id})`;
}

/** Ids of learned lines present in taste.md. */
export function learnedIds(text: string): Set<string> {
  return new Set(text.split('\n').map((l) => l.match(MARK)?.[1]).filter((x): x is string => Boolean(x)));
}

/**
 * Bring taste.md and preferences.json in step. Your edits win: a learned line you deleted retires that
 * preference. Active preferences not written yet are added; retired ones are taken out. Returns ids retired.
 */
export function syncTasteFile(now: Date): string[] {
  const store = loadStore();
  const signals = readSignals();
  const { path, text } = readTaste();
  const present = learnedIds(text);
  const retiredByYou: string[] = [];
  for (const p of store.prefs) {
    if (p.status === 'active' && p.rendered && !present.has(p.id)) {
      retire(p, 'you removed it from taste.md', now);
      retiredByYou.push(p.id);
    }
  }
  let out = text
    .split('\n')
    .filter((l) => {
      const id = l.match(MARK)?.[1];
      if (!id) return true;
      const p = store.prefs.find((x) => x.id === id);
      return !p || p.status === 'active';
    })
    .join('\n');
  for (const p of store.prefs) {
    if (p.status === 'active' && !present.has(p.id)) out = insertUnderHeading(out, p.scope, learnedLine(p, signals));
    if (p.status === 'active') p.rendered = true;
    else delete p.rendered;
  }
  if (out !== text) writeFileSync(path, out);
  saveStore(store);
  return retiredByYou;
}

// ---------- views ----------

const STATUS_LABEL: Record<PrefStatus, string> = {
  candidate: '… candidate',
  ready: '💭 to ask',
  active: '✓ in taste.md',
  snoozed: '⏸ not now',
  muted: '🔕 never',
  retired: '✗ retired',
};

export function formatPrefs(store: TasteStore, signals: Signal[]): string {
  if (!store.prefs.length) return 'No preferences yet. They come from your ratings, blueprint edits and keep/undo; run `chompyy distill`.';
  const byId = new Map(signals.map((s) => [s.id, s]));
  const order: PrefStatus[] = ['ready', 'active', 'candidate', 'snoozed', 'muted', 'retired'];
  const out: string[] = [];
  for (const status of order) {
    for (const p of store.prefs.filter((x) => x.status === status)) {
      out.push(`${p.id.padEnd(4)} ${STATUS_LABEL[status].padEnd(15)} [${p.scope}] ${p.text}  (${distinctCards(p.evidence, byId)} cards, ${distinctSessions(p.evidence, byId)} sessions)`);
    }
  }
  out.push('', `Why: chompyy taste why <id> · answer: taste yes|not-now|never <id> · retire: taste retire <id>`);
  if (store.lastDistillAt) out.push(`Last distilled ${store.lastDistillAt.slice(0, 16).replace('T', ' ')}.`);
  return out.join('\n');
}

/** "Why do you think that?": every card, edit and quote behind a preference. */
export function formatWhy(p: Preference, signals: Signal[]): string {
  const byId = new Map(signals.map((s) => [s.id, s]));
  const out = [`${p.id} · ${STATUS_LABEL[p.status]} · [${p.scope}]`, `"${p.text}"`, '', p.noticed, ''];
  out.push('Evidence:');
  for (const e of p.evidence) {
    const s = byId.get(e);
    out.push(s ? `  ${s.at.slice(0, 10)}  ${describeSignal(s, 300)}` : `  ${e} (no longer in signals.jsonl)`);
  }
  if (p.against?.length) {
    out.push('', 'Against it:');
    for (const e of p.against) {
      const s = byId.get(e);
      if (s) out.push(`  ${s.at.slice(0, 10)}  ${describeSignal(s, 300)}`);
    }
  }
  if (p.stated) out.push('', 'You said this yourself in a rating, so it can be asked before 3 cards.');
  if (p.validFrom) out.push(`In force from ${p.validFrom.slice(0, 10)}.`);
  if (p.retiredAt) out.push(`Retired ${p.retiredAt.slice(0, 10)}: ${p.retiredBecause}.`);
  return out.join('\n');
}

/** What changed in taste since a moment, for the morning report. */
export function tasteChangesSince(store: TasteStore, since: string | null): { learned: number; retired: number; toAsk: number } {
  const after = (t?: string) => Boolean(t && (!since || t > since));
  return {
    learned: store.prefs.filter((p) => p.status === 'active' && after(p.validFrom)).length,
    retired: store.prefs.filter((p) => p.status === 'retired' && after(p.retiredAt)).length,
    toAsk: store.prefs.filter((p) => p.status === 'ready').length,
  };
}

/** Distill only when there is something new and it hasn't run in a while. */
export function distillDue(board: BoardData, now: Date, minGapMs = 6 * 3600_000): boolean {
  const store = loadStore();
  if (store.lastDistillAt && now.getTime() - Date.parse(store.lastDistillAt) < minGapMs) return false;
  return newSignals(store, readSignals(), governedCards(board.cards)).length > 0;
}
