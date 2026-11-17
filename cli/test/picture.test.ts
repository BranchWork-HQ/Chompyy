import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blueprintHash, cleanPicture, darkPicture, drawPicture, extractHtml, picturePrompt, skillDir } from '../src/picture.js';
import type { RunRequest, Runner } from '../src/runner.js';
import { NOW, useTempHome } from './helpers.js';

const doc = `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Geist" rel="stylesheet">
<style>:root{--color-paper:#f5f5f5}</style></head><body>
<svg viewBox="0 0 960 400" xmlns="http://www.w3.org/2000/svg" role="img"><rect fill="#F5F5F5"/><rect fill="#ffffff" stroke="rgba(45,49,66,0.12)"/>
<text fill="#2d3142" onclick="alert(1)">Node</text><rect stroke="#bf4520"/></svg>
<script>alert(1)</script></body></html>`;

const card = { id: '6', title: 'Write the allowance spec', idea: 'Write it up', blueprint: '## Goal\nA spec' };

describe('picture', () => {
  it('finds the HTML document in the reply', () => {
    expect(extractHtml(`Sure!\n${doc}\nDone.`)).toBe(doc);
    expect(() => extractHtml('no html here')).toThrow(/did not reply with an HTML document/);
  });

  it('makes it offline and safe, in Chompyy colors', () => {
    const html = cleanPicture(doc);
    expect(html).not.toMatch(/fonts\.googleapis|<script|onclick/);
    expect(html).toContain('#faf3e8');
    expect(html).not.toMatch(/#f5f5f5|#2d3142|#bf4520|rgba\(45,49,66/i);
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"'); // the namespace is not a download
    expect(() => cleanPicture('<html><body><svg></svg><img src="https://x.io/a.png"></body></html>')).toThrow(/internet/);
    expect(() => cleanPicture('<html><body>no diagram</body></html>')).toThrow(/no diagram/);
  });

  it('makes the dark copy by swapping tokens', () => {
    const dark = darkPicture(cleanPicture(doc));
    expect(dark).toContain('#1e1915'); // paper
    expect(dark).toContain('#f6eee3'); // ink
    expect(dark).toContain('#f0a066'); // accent
    expect(dark).toContain('#26201b'); // white node fill
    expect(dark).toContain('rgba(246,238,227,0.12)'); // hairline
    expect(dark).not.toMatch(/#faf3e8|#3a2a1f|#a8481c|#ffffff/i);
  });

  it('asks for a picture of what the task does, not the blueprint headings', () => {
    const p = picturePrompt(card);
    expect(p).toContain('Use the diagram-design skill in this folder');
    expect(p).toContain("Don't draw four boxes called Goal / Changes / Won't touch / Done when");
    expect(p).toContain('Card #6');
    expect(p).toContain('## Goal\nA spec');
    expect(existsSync(join(skillDir(), 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(skillDir(), 'references', 'style-guide.md'), 'utf8')).toContain('Chompyy skin');
  });
});

describe('drawPicture', () => {
  const home = useTempHome();
  it('runs in the skill folder with read-only tools and saves light and dark copies', async () => {
    let req: RunRequest | undefined;
    const runner: Runner = { run: async (r) => ((req = r), { exitCode: 0, output: doc, stderr: '', timedOut: false, durationMs: 1 }) };
    const info = await drawPicture(card, runner, { model: 'sonnet', now: NOW });
    expect(req).toMatchObject({ cwd: skillDir(), tools: 'Read,Glob,Grep', model: 'sonnet' });
    expect(info.path).toBe(join(home(), 'pictures', '6.html'));
    expect(readFileSync(info.darkPath, 'utf8')).toContain('#1e1915');
    expect(info.blueprintHash).toBe(blueprintHash(card.blueprint));
    expect(blueprintHash('other')).not.toBe(info.blueprintHash);
  });
  it('needs a blueprint', async () => {
    await expect(drawPicture({ ...card, blueprint: null }, {} as Runner, { model: 'm', now: NOW })).rejects.toThrow(/no blueprint/);
  });
});
