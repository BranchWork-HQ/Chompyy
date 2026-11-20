// The lab night (research/away-readiness.md, step 5): a whole away night against a throwaway repo, with the
// real CLI and a fake agent (fake-claude.mjs), so a new bug fails here instead of on a real night. A tool for
// Chompyy's own development, not a user feature: `npm run lab` (it isn't part of `npm test` or the package).
//
// The night: four approved cards on a repo with a remote.
//   #1 adds a file (clean)           #2 and #3 change the same line (they will clash)
//   #4 breaks the repo's test (Chompyy's own check must catch it, whatever the agent says)
// Then: keep #1 and #2 → #3 now clashes → Chompyy refreshes it by itself → keep #3 → undo #4.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'dist', 'cli.js');
const FAKE = join(here, 'fake-claude.mjs');

let root = '';
let home = '';
let repo = '';
const g = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=lab', '-c', 'user.email=lab@lab', ...a], { encoding: 'utf8' }).trim();
const chompyy = (...args: string[]) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CHOMPYY_HOME: home }, timeout: 300_000 });
type LabCard = { id: string; column: string; outcome?: string; run?: { status: string; base?: { commit: string }; verified?: { result: string; why: string }; tokens?: { output: number; costUsd: number } }; refresh?: { state: string; by?: string; why?: string } };
const board = () => JSON.parse(readFileSync(join(home, 'board.json'), 'utf8')) as { cards: LabCard[] };
const card = (id: string) => board().cards.find((c) => c.id === id)!;

function waitFor(what: string, ok: () => boolean, ms = 120_000): void {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}\nrefresh.log:\n${existsSync(join(home, 'refresh.log')) ? readFileSync(join(home, 'refresh.log'), 'utf8') : '(none)'}`);
    execFileSync('sleep', ['0.5']);
  }
}

beforeAll(() => {
  if (!existsSync(CLI)) throw new Error('Build first: npm run build (npm run lab does it for you).');
  root = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-lab-')));
  home = join(root, 'home');
  repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  mkdirSync(home);
  // The repo: a test that fails when broken.txt exists or a conflict marker is left anywhere.
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'shared.txt'), 'title: old\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'lab', private: true, scripts: { test: 'node test.js' } }));
  writeFileSync(
    join(repo, 'test.js'),
    `const fs = require('fs');
if (fs.existsSync('broken.txt')) { console.error('FAIL broken.txt exists'); process.exit(1); }
if (/^(<{7}|>{7})/m.test(fs.readFileSync('shared.txt', 'utf8'))) { console.error('FAIL conflict markers'); process.exit(1); }
console.log('ok');
`,
  );
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'lab repo');
  execFileSync('git', ['clone', '-q', '--bare', repo, origin]);
  g(repo, 'remote', 'add', 'origin', origin);
  g(repo, 'fetch', '-q', 'origin');
  g(repo, 'branch', '-q', '--set-upstream-to=origin/main', 'main');

  writeFileSync(join(home, 'config.json'), JSON.stringify({ claudeBin: FAKE, quotaSource: 'statusline', pictures: false }));
  const now = new Date().toISOString();
  const mk = (id: string, title: string, lab: string) => ({
    id, title, idea: title, cwd: repo, column: 'approved', createdAt: now, updatedAt: now, approvedAt: now,
    blueprint: `## Goal\n${title}\n\n## Scope\n${lab}\n\n## How it's checked\nnpm test`,
  });
  writeFileSync(join(home, 'board.json'), JSON.stringify({
    nextId: 5,
    cards: [
      mk('1', 'add notes', 'lab: append notes.txt | first note'),
      mk('2', 'title two', 'lab: replace shared.txt | title: old | title: two'),
      mk('3', 'title three', 'lab: replace shared.txt | title: old | title: three'),
      mk('4', 'break the test', 'lab: append broken.txt | oops'),
    ],
  }));
});

afterAll(() => {
  if (process.env.LAB_KEEP) console.log(`lab folder kept: ${root}`);
  else rmSync(root, { recursive: true, force: true });
});

describe('a lab night', () => {
  it('preflight proves the repo\'s check passes in the away box', () => {
    const out = chompyy('preflight', repo);
    expect(out).toMatch(/npm test/);
    expect(out).not.toMatch(/broken on main/i);
  });

  it('the away run takes every approved card through run → Chompyy\'s own check → review', () => {
    const out = chompyy('away', '20m', '--force');
    expect(out).toMatch(/Done\. 4 card\(s\) in review/);
    const main = g(repo, 'rev-parse', 'main');
    for (const id of ['1', '2', '3', '4']) {
      const c = card(id);
      expect(c.column, `#${id}`).toBe('review');
      expect(c.run!.status, `#${id}`).toBe('ok');
      expect(c.run!.base!.commit, `#${id} starts from the latest main`).toBe(main);
      expect(c.run!.tokens, `#${id} exact tokens`).toMatchObject({ output: 200, costUsd: 0.0123 });
    }
  });

  it("Chompyy's own check passes good cards and catches the broken one (the agent said 'passed' for all)", () => {
    for (const id of ['1', '2', '3']) expect(card(id).run!.verified, `#${id}`).toMatchObject({ result: 'passed' });
    expect(card('4').run!.verified).toMatchObject({ result: 'failed' });
  });

  it('keeping #2 makes #3 clash; Chompyy brings #3 up to date by itself', () => {
    chompyy('keep', '1');
    const out = chompyy('keep', '2');
    expect(out).toMatch(/Checking #3.* in the background/);
    waitFor('#3 to be refreshed', () => card('3').refresh?.state === 'done' && !existsSync(join(home, 'refresh.lock')));
    expect(card('3').refresh).toMatchObject({ state: 'done', by: 'agent' });
    expect(card('3').run!.verified).toMatchObject({ result: 'passed' });
  });

  it('#3 then keeps cleanly and main has all three changes', () => {
    chompyy('keep', '3');
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toMatch(/title: two[\s\S]*title: three|title: three[\s\S]*title: two/);
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('first note\n');
    expect(execFileSync('node', ['test.js'], { cwd: repo, encoding: 'utf8' })).toMatch(/ok/);
  });

  it('pressing Keep on a clashing card keeps it by itself once refreshed', () => {
    // A fifth card that clashes with what's on main now.
    const before = board();
    const now = new Date().toISOString();
    before.cards.push({ id: '5', title: 'title five', column: 'approved' } as LabCard);
    Object.assign(before.cards.at(-1)!, { idea: 'title five', cwd: repo, createdAt: now, updatedAt: now, approvedAt: now, blueprint: '## Scope\nlab: replace shared.txt | title: two | title: five' });
    writeFileSync(join(home, 'board.json'), JSON.stringify({ ...before, nextId: 6 }));
    chompyy('away', '10m', '--force');
    // Meanwhile main moves: the same line changes on main.
    writeFileSync(join(repo, 'shared.txt'), readFileSync(join(repo, 'shared.txt'), 'utf8').replace('title: two', 'title: TWO'));
    g(repo, 'commit', '-qam', 'you changed the title on main');
    expect(chompyy('keep', '5')).toMatch(/clashes with main.*will keep it once its checks pass/s);
    waitFor('#5 to keep itself', () => card('5').outcome === 'kept');
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toMatch(/title: five/);
  });

  it('undo throws #4 away and leaves main alone', () => {
    const main = g(repo, 'rev-parse', 'main');
    chompyy('undo', '4');
    expect(card('4').outcome).toBe('undone');
    expect(g(repo, 'rev-parse', 'main')).toBe(main);
    expect(existsSync(join(repo, 'broken.txt'))).toBe(false);
  });
});
