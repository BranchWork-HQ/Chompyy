import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isTemp, recentProjects } from '../src/projects.js';

describe('recentProjects', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('lists git repos from transcripts and code folders, newest first, skipping non-git and temp folders', () => {
    // In a temp folder (tests must not write to your home folder: away runs can't), told not to count as temp.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'chompyy-projects-test-'))); // /var → /private/var, as the code sees it
    dirs.push(root);
    const home = join(root, 'home');
    const repoA = join(home, 'code', 'alpha');
    const repoB = join(home, 'orca', 'beta');
    const plain = join(home, 'code', 'notes');
    for (const d of [join(repoA, '.git'), join(repoB, '.git'), join(repoA, 'src'), plain]) mkdirSync(d, { recursive: true });
    const claude = join(root, 'claude');
    mkdirSync(join(claude, 'p1'), { recursive: true });
    mkdirSync(join(claude, 'p2'), { recursive: true });
    writeFileSync(join(claude, 'p1', 's.jsonl'), JSON.stringify({ cwd: join(repoA, 'src') }) + '\n');
    writeFileSync(join(claude, 'p2', 's.jsonl'), JSON.stringify({ cwd: plain }) + '\n');
    utimesSync(join(repoB, '.git'), new Date('2020-01-01'), new Date('2020-01-01'));

    const list = recentProjects({ nextId: 1, cards: [] }, { claudeDir: claude, home, isTemp: (p) => !p.startsWith(root) && isTemp(p) });
    expect(list.map((p) => p.name)).toEqual(['alpha', 'beta']);
    expect(list[0]!.path).toBe(repoA);
  });
});
