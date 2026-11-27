// Picture first: every card opens with a diagram of what the task will do, drawn by an agent following
// the diagram-design skill (vendored in cli/vendor/diagram-design, MIT). One HTML + SVG file per card,
// in Chompyy's skin; the dark copy is made by swapping tokens (the skill's inversion rule), no second call.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from './board.js';
import { homePath } from './home.js';
import type { Runner } from './runner.js';
import { chosenType, suggestTypes, typeHint, type TypeSuggestion } from './picturetype.js';

export interface PictureInfo {
  path: string;
  darkPath: string;
  at: string;
  /** Hash of the blueprint it was drawn from; a different blueprint means the picture is out of date. */
  blueprintHash: string;
  /** What the skill's own self-check said ("OK" or its complaints); null when python3 isn't available. */
  check: string | null;
  /** The visual type the agent drew and its reason (from its leading comment); null if it didn't say. */
  type?: string | null;
  why?: string | null;
  /** What the card's text suggested, strongest first, with the evidence. */
  suggested?: TypeSuggestion[];
}

export function skillDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'diagram-design');
}

export const blueprintHash = (text: string | null) => createHash('sha256').update(text ?? '').digest('hex').slice(0, 16);

export function picturePrompt(card: Pick<Card, 'id' | 'title' | 'idea' | 'blueprint'>, suggestions = suggestTypes(card)): string {
  return `You are drawing the picture for a task card in Chompyy, unattended. Nobody can answer questions,
so don't ask any: decide and draw.

Use the diagram-design skill in this folder. Read SKILL.md first. The style guide
(references/style-guide.md) is already customized for Chompyy, so skip the first-time style gate and
onboarding, and take every color from it (never the colors in the example files). Then pick ONE visual
type and read only that type's reference, plus references/primitives-core.md or
references/layout-budget.md if you need exact markup. Start from assets/template.html.

Which type: the card's text was checked for signals (below). They are hints, not orders.
${typeHint(suggestions)}

Who looks at it: the person deciding in ten seconds whether to approve this task. The picture must show
what the task will DO and WHY it helps: the thing it produces or changes and how it fits, not the
blueprint's headings. Don't draw four boxes called Goal / Changes / Won't touch / Done when. Put the accent on the 1 or 2 things this task actually creates or changes. Keep it small:
at most 7 nodes. Title (h1): the task in plain words. Eyebrow: "<Type> · Card #${card.id}".

Rendering rules for Chompyy:
- Remove the Google Fonts <link>; keep the font stacks (Chompyy renders offline).
- Static only: no <script>, no motion.
- Use viewBox width 960 and the matching min-width, as the template does.
- Follow the taste gate (SKILL.md §9) before you answer.

Reply with ONLY the complete HTML document, from <!DOCTYPE html> to </html>. No commentary.

The task:
Title: ${card.title}
Idea: ${card.idea}

Blueprint (agreed scope):
${card.blueprint ?? '(none yet)'}`;
}

/** The HTML document in the model's reply. */
export function extractHtml(output: string): string {
  const start = output.search(/<!DOCTYPE html>|<html[\s>]/i);
  const end = output.toLowerCase().lastIndexOf('</html>');
  if (start < 0 || end < start) throw new Error('The picture model did not reply with an HTML document.');
  return output.slice(start, end + '</html>'.length);
}

// Colors from the skill's default skin (examples) → Chompyy light, then Chompyy light → dark.
const TO_CHOMPYY: [RegExp, string][] = [
  [/#f5f5f5\b/gi, '#faf3e8'],
  [/#ececec\b/gi, '#f2e8d9'],
  [/#2d3142\b/gi, '#3a2a1f'],
  [/#4f5d75\b/gi, '#6b5141'],
  [/#5a6580\b/gi, '#735a48'],
  [/#bfc0c0\b/gi, '#ddd0bd'],
  [/#bf4520\b/gi, '#a8481c'],
  [/rgba\(\s*45\s*,\s*49\s*,\s*66\s*,/gi, 'rgba(58,42,31,'],
  [/rgba\(\s*191\s*,\s*69\s*,\s*32\s*,/gi, 'rgba(168,72,28,'],
];
const TO_DARK: [RegExp, string][] = [
  [/#faf3e8\b/gi, '#1e1915'],
  [/#f2e8d9\b/gi, '#2a231d'],
  [/#ffffff\b|#fff\b(?![0-9a-f])/gi, '#26201b'],
  [/(fill|background(?:-color)?)(=|:\s*)"?white\b/gi, '$1$2"#26201b'],
  [/#3a2a1f\b/gi, '#f6eee3'],
  [/#6b5141\b/gi, '#d0c1af'],
  [/#735a48\b/gi, '#b5a28f'],
  [/#ddd0bd\b/gi, 'rgba(208,193,175,0.25)'],
  [/#a8481c\b/gi, '#f0a066'],
  [/#2e5aa8\b/gi, '#86aee6'],
  [/rgba\(\s*58\s*,\s*42\s*,\s*31\s*,/gi, 'rgba(246,238,227,'],
  [/rgba\(\s*168\s*,\s*72\s*,\s*28\s*,/gi, 'rgba(240,160,102,'],
];
const apply = (html: string, map: [RegExp, string][]) => map.reduce((s, [re, to]) => s.replace(re, to), html);

/** Make it safe and offline: no scripts, no remote fonts or images; Chompyy colors. */
export function cleanPicture(html: string): string {
  const out = html
    .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  if (!/<svg[\s>]/i.test(out)) throw new Error('The picture has no diagram (<svg>) in it.');
  if (/(src|href)\s*=\s*["']https?:/i.test(out.replace(/xmlns(:\w+)?="[^"]*"/g, ''))) throw new Error('The picture loads something from the internet.');
  return apply(out, TO_CHOMPYY);
}

export const darkPicture = (html: string) => apply(html, TO_DARK);

/** The skill's own self-check (accessibility contract, single-file safety, content inside the viewBox). */
function selfCheck(file: string): string | null {
  const r = spawnSync('python3', [join(skillDir(), 'scripts', 'self_check.py'), file], { encoding: 'utf8', timeout: 20_000 });
  if (r.error) return null;
  return (r.stdout + r.stderr).trim().split('\n').slice(0, 12).join('\n') || (r.status === 0 ? 'OK' : `exit ${r.status}`);
}

export async function drawPicture(
  card: Pick<Card, 'id' | 'title' | 'idea' | 'blueprint'>,
  runner: Runner,
  opts: { model: string; now: Date; timeoutMs?: number },
): Promise<PictureInfo> {
  if (!card.blueprint) throw new Error(`Card #${card.id} has no blueprint to draw yet.`);
  if (!existsSync(join(skillDir(), 'SKILL.md'))) throw new Error('The diagram-design skill is missing from this install.');
  const suggested = suggestTypes(card);
  const result = await runner.run({ prompt: picturePrompt(card, suggested), cwd: skillDir(), model: opts.model, tools: 'Read,Glob,Grep', timeoutMs: opts.timeoutMs ?? 300_000 });
  if (result.timedOut) throw new Error('Drawing the picture timed out.');
  if (result.exitCode !== 0) throw new Error(`claude exited with ${result.exitCode}: ${result.stderr.trim().slice(0, 300)}`);
  const html = cleanPicture(extractHtml(result.output));
  const chose = chosenType(html);
  const path = homePath('pictures', `${card.id}.html`);
  const darkPath = homePath('pictures', `${card.id}-dark.html`);
  writeFileSync(path, html);
  writeFileSync(darkPath, darkPicture(html));
  return {
    path, darkPath, at: opts.now.toISOString(), blueprintHash: blueprintHash(card.blueprint), check: selfCheck(path),
    type: chose?.type ?? null, why: chose?.why ?? null, suggested,
  };
}
