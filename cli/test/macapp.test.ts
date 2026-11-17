import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appZipUrl, cliVersion, installApp, type AppDeps } from '../src/macapp.js';

const dirs: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'chompyy-app-test-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A real zip holding Chompyy.app/Contents/Info.plist, made the same way the release script does. */
function fakeZip(): Buffer {
  const src = temp();
  mkdirSync(join(src, 'Chompyy.app', 'Contents'), { recursive: true });
  writeFileSync(join(src, 'Chompyy.app', 'Contents', 'Info.plist'), 'new');
  const zip = join(src, 'app.zip');
  execFileSync('ditto', ['-c', '-k', '--keepParent', join(src, 'Chompyy.app'), zip]);
  return readFileSync(zip);
}

describe('chompyy app', () => {
  it('points at the release for this CLI version', () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(appZipUrl('0.1.0')).toBe('https://github.com/BranchWork-HQ/Chompyy/releases/download/v0.1.0/Chompyy-0.1.0.zip');
  });

  it('refuses on other systems', async () => {
    await expect(installApp({}, { platform: 'linux' } as AppDeps)).rejects.toThrow(/macOS only/);
  });

  it('says which URL failed', async () => {
    const deps = { platform: 'darwin', fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }) } as unknown as AppDeps;
    await expect(installApp({ version: '9.9.9' }, deps)).rejects.toThrow(/HTTP 404.*v9\.9\.9/);
  });

  it.skipIf(process.platform !== 'darwin')('replaces an older copy and opens it', async () => {
    const apps = temp();
    mkdirSync(join(apps, 'Chompyy.app', 'Contents'), { recursive: true });
    writeFileSync(join(apps, 'Chompyy.app', 'Contents', 'Info.plist'), 'old');
    const zip = fakeZip();
    const ran: string[] = [];
    const deps: AppDeps = {
      platform: 'darwin',
      appsDir: apps,
      fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer }),
      exec: (cmd, args) => {
        ran.push(cmd);
        if (cmd === 'ditto') execFileSync(cmd, args);
      },
    };
    const target = await installApp({ version: '0.1.0' }, deps);
    expect(target).toBe(join(apps, 'Chompyy.app'));
    expect(readFileSync(join(target, 'Contents', 'Info.plist'), 'utf8')).toBe('new');
    expect(ran).toEqual(['ditto', 'pkill', 'open']);
    expect(existsSync(target)).toBe(true);
  });
});
