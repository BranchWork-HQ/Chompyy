#!/usr/bin/env node
// A stand-in for `claude -p` in the lab night (night.lab.ts). It does what a card's blueprint says in plain
// "lab:" lines, resolves refresh merges by keeping both sides, and prints stream-json with a real-shaped
// result event (usage, cost), so the whole pipeline runs without spending tokens.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  console.log('0.0.0 (lab fake)');
  process.exit(0);
}
const prompt = readFileSync(0, 'utf8');
const git = (...a) => execFileSync('git', ['-c', 'user.name=lab', '-c', 'user.email=lab@lab', ...a], { encoding: 'utf8' });
let said = '';

if (/^# Bring card #\d+ up to date with/m.test(prompt)) {
  // Refresh: keep both sides of every conflict, then finish the merge.
  const files = [...prompt.matchAll(/^- (\S+)$/gm)].map((m) => m[1]).filter((f) => existsSync(f));
  for (const f of files) writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !/^(<{7}|={7}|>{7})( |$)/.test(l)).join('\n'));
  git('add', ...files);
  git('commit', '--no-edit', '-q');
  said = `Kept both sides in ${files.join(', ')}.`;
} else {
  // A card: "lab: append <file> | <text>" and "lab: replace <file> | <old> | <new>" lines in the blueprint.
  for (const m of prompt.matchAll(/^lab: (append|replace) (\S+) \| ([^|\n]*?)(?: \| ([^\n]*))?$/gm)) {
    const [, op, file, a, b] = m;
    if (op === 'append') appendFileSync(file, `${a}\n`);
    else writeFileSync(file, readFileSync(file, 'utf8').replace(a, b));
  }
  git('add', '-A');
  git('commit', '-qm', 'lab card');
  said = 'Did what the blueprint said.';
}

const out = (e) => process.stdout.write(JSON.stringify(e) + '\n');
out({ type: 'system', subtype: 'init' });
out({ type: 'assistant', message: { content: [{ type: 'text', text: said }] } });
out({
  type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: 0.0123,
  result: `${said}\nCHECKS: passed — node test.js`,
  usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 800, output_tokens_details: { thinking_tokens: 20 } },
  modelUsage: { 'lab-fake': {} },
});
