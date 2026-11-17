// Which diagram fits a card? Signals in the card's text point to one of the diagram-design skill's
// visual types (cli/vendor/diagram-design/SKILL.md §3). No model call: phrases and structure in the
// idea and blueprint are counted, each match is kept as evidence, and the top suggestions go to the
// drawing agent, which may still pick another type if it says why.
import type { Card } from './board.js';

export interface TypeSuggestion {
  /** The skill's name for the type, e.g. "State machine". */
  type: string;
  /** Its reference file in the skill, e.g. "type-state.md". */
  ref: string;
  score: number;
  /** What in the card pointed here, e.g. ['"moves to review"', '3 statuses']. */
  evidence: string[];
}

interface Rule {
  type: string;
  ref: string;
  /** Phrases (regex sources, case-insensitive, word-bounded by the caller's text). */
  phrases: string[];
  /** Phrase matches needed before the rule counts. */
  min?: number;
  /** Multiplier: specific types outrank generic ones when both match. */
  weight?: number;
  /** Extra structural evidence from the text: returns [points, label] or null. */
  structure?: (text: string) => [number, string] | null;
  /** Only add the structural points when the phrases matched too. */
  structureNeedsPhrases?: boolean;
}

const FILE = /\b[\w./-]+\.(?:ts|tsx|js|mjs|swift|py|go|rs|rb|java|kt|md|json|yaml|yml|toml|sql|sh|css|html)\b/g;
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

const RULES: Rule[] = [
  {
    type: 'State machine', ref: 'type-state.md', weight: 1.3,
    phrases: ['status(?:es)?', 'states?', 'transitions?', 'moves? (?:from|to|into|back)', 'lifecycle', 'retr(?:y|ies)', 'cancel(?:led|s)?', 'pending', 'stale', 'expires?', 'resets?', 'becomes?', 'column'],
    min: 2,
  },
  {
    type: 'Architecture delta', ref: 'type-architecture-delta.md', weight: 1.2,
    phrases: ['adds?', 'replaces?', 'removes?', 'renames?', 'moves? .{0,20} (?:to|into) ', 'splits?', 'new (?:module|file|component|service|command)', 'refactor', 'migrat(?:e|ion)'],
    min: 2,
    structure: (t) => {
      const files = new Set(t.match(FILE) ?? []);
      return files.size >= 3 ? [files.size * 0.5, `${files.size} files touched`] : null;
    },
    structureNeedsPhrases: true,
  },
  {
    type: 'Steps', ref: 'type-steps.md',
    phrases: ['first', 'then', 'next', 'finally', 'step \\d', 'after that'],
    min: 2,
    structure: (t) => {
      const n = count(t, /^\s*\d+[.)]\s/gm);
      return n >= 3 ? [n * 0.4, `${n} numbered steps`] : null;
    },
  },
  {
    type: 'Flowchart', ref: 'type-flowchart.md', weight: 1.1,
    phrases: ['if', 'else', 'otherwise', 'unless', 'when .{0,30} (?:fails?|missing|empty)', 'fall ?back', 'refuses?', 'decides?', 'either', 'or else', 'only when', 'in that case'],
    min: 2,
  },
  {
    type: 'Data flow', ref: 'type-data-flow.md',
    phrases: ['inputs?', 'outputs?', 'reads?', 'writes?', 'parses?', 'transforms?', 'computes?', 'derives?', 'pipeline', 'feeds?', 'turns .{0,30} into', '→|->', 'formula', '= .{1,40} ÷'],
    min: 3,
  },
  {
    type: 'Sequence', ref: 'type-sequence.md', weight: 1.2,
    phrases: ['requests?', 'responses?', 'calls?', 'sends?', 'replies', 'api', 'endpoint', 'hooks?', 'client', 'server', 'handshake', 'webhook', 'round[- ]trip'],
    min: 3,
  },
  {
    type: 'Timeline', ref: 'type-timeline.md',
    phrases: ['timeline', 'milestones?', 'deadline', 'by (?:mon|tues|wednes|thurs|fri|satur|sun)day', 'q[1-4]', '\\d{4}-\\d{2}-\\d{2}', 'week \\d', 'phase \\d', 'release'],
    min: 2,
  },
  {
    type: 'Gantt', ref: 'type-gantt.md', weight: 1.2,
    phrases: ['schedule', 'durations?', '\\d+ (?:days?|weeks?|hours?)', 'in parallel', 'overlap', 'blocks? on', 'critical path'],
    min: 3,
  },
  {
    type: 'Bar chart', ref: 'type-bar.md', weight: 1.1,
    phrases: ['benchmarks?', 'compare .{0,20}(?:numbers|results|cost|tokens)', 'per (?:model|tool|project|day)', 'top \\d+', 'ranking', 'measure(?:d|s)?'],
    min: 1,
    structure: (t) => {
      const n = count(t, /\b\d+(?:\.\d+)?\s?%/g);
      return n >= 3 ? [n / 2, `${n} percentages`] : null;
    },
  },
  {
    type: 'Line chart', ref: 'type-line.md', weight: 1.1,
    phrases: ['over time', 'trends?', 'per (?:day|week|month)', 'before and after', 'growth', 'declin(?:e|ing)', 'history of'],
    min: 2,
  },
  {
    type: 'Quadrant', ref: 'type-quadrant.md', weight: 1.2,
    phrases: ['vs\\.?', 'versus', 'trade-?offs?', 'options?', 'compare', 'priorit(?:y|ize|ise)', 'effort', 'impact'],
    min: 3,
  },
  {
    type: 'Tree', ref: 'type-tree.md',
    phrases: ['hierarchy', 'folders?', 'director(?:y|ies)', 'parent', 'children', 'sub-?(?:folder|section|task)s?', 'nested'],
    min: 2,
  },
  {
    type: 'Layer stack', ref: 'type-layers.md',
    phrases: ['layers?', 'stack', 'tiers?', 'levels? of', 'on top of', 'underneath', 'abstraction'],
    min: 2,
  },
  {
    type: 'Swimlane', ref: 'type-swimlane.md', weight: 1.2,
    phrases: ['hand ?offs?', 'you (?:approve|review|answer)', 'the agent', 'the user', 'reviewer', 'owner', 'who does'],
    min: 3,
  },
  {
    type: 'ER / data model', ref: 'type-er.md', weight: 1.2,
    phrases: ['tables?', 'schema', 'fields?', 'entit(?:y|ies)', 'records?', 'foreign key', 'relations?(?:hip)?s?', 'json shape', 'interface \\w+'],
    min: 3,
  },
  {
    type: 'Dependency graph', ref: 'type-dependency.md', weight: 1.2,
    phrases: ['depends on', 'dependenc(?:y|ies)', 'imports?', 'requires', 'cycles?', 'circular'],
    min: 2,
  },
  {
    type: 'Loop', ref: 'type-loop.md', weight: 1.3,
    phrases: ['loop', 'cycle', 'feedback', 'feeds back', 'again and again', 'learns? from', 'closed loop', 'repeat(?:s|ed)?'],
    min: 2,
  },
  {
    type: 'User journey', ref: 'type-journey.md', weight: 1.2,
    phrases: ['user journey', 'experience', 'onboarding', 'first (?:run|time|launch)', 'feels?', 'frustrat', 'delight', 'tester'],
    min: 2,
  },
  {
    type: 'Fishbone', ref: 'type-fishbone.md', weight: 1.3,
    phrases: ['root cause', 'why (?:it|does|did)', 'causes?', 'diagnos', 'investigat', 'bug', 'regression'],
    min: 3,
  },
  {
    type: 'Sankey', ref: 'type-sankey.md', weight: 1.3,
    phrases: ['split(?:s)? into', 'share of', 'breakdown', 'where .{0,20} goes', 'budget', 'allocation', 'flows? into'],
    min: 2,
  },
  {
    type: 'Waterfall', ref: 'type-waterfall.md', weight: 1.3,
    phrases: ['bridge', 'adds up', 'from \\d+.{0,20} to \\d+', 'net (?:change|effect)', 'deltas?'],
    min: 2,
  },
  {
    type: 'Treemap', ref: 'type-treemap.md', weight: 1.2,
    phrases: ['part of (?:the )?whole', 'biggest', 'proportion', 'what .{0,20} is made of', 'sizes?'],
    min: 2,
  },
  {
    type: 'Deployment', ref: 'type-deployment.md', weight: 1.2,
    phrases: ['deploy', 'hosts?', 'containers?', 'launchagent', 'daemon', 'release zip', 'install(?:er|s)?', 'ports?', 'runs on'],
    min: 2,
  },
  {
    type: 'Requirement traceability', ref: 'type-requirement-traceability.md', weight: 1.2,
    phrases: ['requirements?', 'acceptance', 'covered by', 'test(?:s)? for each', 'spec §', 'traceab'],
    min: 2,
  },
  {
    type: 'Unit Grid', ref: 'type-unit-grid.md', weight: 1.2,
    phrases: ['out of 100', 'percent of', 'share left', 'used of', 'window left'],
    min: 2,
  },
];

/** Blueprint sections that say what *not* to do or how it's checked: their words would mislead the signals. */
const SKIP_SECTION = /^(?:out of scope|won'?t touch|non-?goals|how it'?s checked|checks?|done when|questions)\b/i;

/** Card text the signals read: title, idea and the blueprint's goal/scope/shape, without code blocks. */
export function cardText(card: Pick<Card, 'title' | 'idea' | 'blueprint'>): string {
  const kept: string[] = [];
  let skip = false;
  for (const line of (card.blueprint ?? '').split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) skip = SKIP_SECTION.test(h[1]!.trim());
    else if (!skip) kept.push(line);
  }
  return [card.title, card.idea, kept.join('\n')].join('\n').replace(/```[\s\S]*?```/g, ' ');
}

/** Rank the visual types for a card, strongest first. Empty when nothing points anywhere. */
export function suggestTypes(card: Pick<Card, 'title' | 'idea' | 'blueprint'>, max = 3): TypeSuggestion[] {
  const text = cardText(card);
  const out: TypeSuggestion[] = [];
  for (const rule of RULES) {
    const evidence: string[] = [];
    let hits = 0;
    for (const p of rule.phrases) {
      const m = text.match(new RegExp(`(?<![\\w])(?:${p})(?![\\w])`, 'gi'));
      if (!m) continue;
      hits += m.length;
      evidence.push(`"${m[0].trim().toLowerCase()}"${m.length > 1 ? ` ×${m.length}` : ''}`);
    }
    const distinct = evidence.length;
    let score = distinct >= (rule.min ?? 1) ? distinct + Math.min(hits - distinct, distinct) * 0.25 : 0;
    const s = rule.structureNeedsPhrases && score === 0 ? null : rule.structure?.(text);
    if (s) {
      score += s[0];
      evidence.unshift(s[1]);
    }
    if (score > 0) out.push({ type: rule.type, ref: rule.ref, score: Math.round(score * (rule.weight ?? 1) * 10) / 10, evidence: evidence.slice(0, 5) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

/** The suggestion block for the drawing prompt. */
export function typeHint(suggestions: TypeSuggestion[]): string {
  const tail = 'HTML comment on the line right after <!DOCTYPE html>: <!-- type: <Type>; why: <one short reason> -->';
  if (!suggestions.length) {
    return [
      'No strong signal. Choose from the full visual-type guide in SKILL.md §3 by what the task produces; a',
      'flowchart only when there is real branching. If the task writes a document, picture what the document',
      `explains, not its headings. Put an ${tail}`,
    ].join('\n');
  }
  const [top, ...rest] = suggestions;
  const line = (s: TypeSuggestion) => `${s.type} (references/${s.ref}), because the card mentions ${s.evidence.join(', ')}`;
  return [
    `Suggested type: ${line(top!)}.`,
    ...(rest.length ? [`Also considered: ${rest.map(line).join('; ')}.`] : []),
    'Use the suggested type unless the task clearly fits another one in SKILL.md §3. Whichever you pick, put an',
    tail,
  ].join('\n');
}

/** The type and reason the drawing agent wrote in its leading comment, if any. */
export function chosenType(html: string): { type: string; why: string } | null {
  const m = html.match(/<!--\s*type:\s*([^;>]+?)\s*;\s*why:\s*([\s\S]*?)\s*-->/i);
  return m ? { type: m[1]!.trim(), why: m[2]!.trim() } : null;
}
