import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { appZipUrl, checksumUrl, cliVersion, installApp, parseChecksum, type AppDeps } from '../src/macapp.js';

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

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** A release serving `zip`, and its checksum file (or `sum` instead, or none). */
function releaseDeps(apps: string, zip: Buffer, ran: string[], opts: { sum?: string | null; codesignFails?: boolean } = {}): AppDeps {
  const sum = opts.sum === undefined ? `${sha(zip)}  Chompyy-0.1.0.zip\n` : opts.sum;
  return {
    platform: 'darwin',
    appsDir: apps,
    fetch: async (url) => {
      if (url.endsWith('.sha256')) return sum === null ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, arrayBuffer: async () => ab(Buffer.from(sum)) };
      return { ok: true, status: 200, arrayBuffer: async () => ab(zip) };
    },
    exec: (cmd, args) => {
      ran.push(cmd);
      if (cmd === 'ditto') execFileSync(cmd, args);
      if (cmd === 'codesign' && opts.codesignFails) throw new Error('invalid signature');
    },
  };
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
    const deps = releaseDeps(apps, zip, ran);
    const target = await installApp({ version: '0.1.0' }, deps);
    expect(target).toBe(join(apps, 'Chompyy.app'));
    expect(readFileSync(join(target, 'Contents', 'Info.plist'), 'utf8')).toBe('new');
    expect(ran).toEqual(['ditto', 'codesign', 'pkill', 'open']);
    expect(existsSync(target)).toBe(true);
  });

  // #24: a tester wouldn't run a downloaded app that nothing checked.
  describe.skipIf(process.platform !== 'darwin')('checks the download before opening it (#24)', () => {
    const oldCopy = () => {
      const apps = temp();
      mkdirSync(join(apps, 'Chompyy.app', 'Contents'), { recursive: true });
      writeFileSync(join(apps, 'Chompyy.app', 'Contents', 'Info.plist'), 'old');
      return apps;
    };
    const untouched = (apps: string) => readFileSync(join(apps, 'Chompyy.app', 'Contents', 'Info.plist'), 'utf8') === 'old';

    it('reads the checksum file the release script writes', () => {
      expect(checksumUrl('0.3.0')).toBe('https://github.com/BranchWork-HQ/Chompyy/releases/download/v0.3.0/Chompyy-0.3.0.zip.sha256');
      expect(parseChecksum(`${'A'.repeat(64)}  Chompyy-0.3.0.zip\n`)).toBe('a'.repeat(64));
      expect(parseChecksum('<html>Not Found</html>')).toBeNull();
    });

    it('refuses a download that does not match the checksum, and leaves the old copy', async () => {
      const apps = oldCopy();
      const ran: string[] = [];
      await expect(installApp({ version: '0.1.0' }, releaseDeps(apps, fakeZip(), ran, { sum: `${'0'.repeat(64)}  x.zip` }))).rejects.toThrow(/doesn't match/);
      expect(ran).toEqual([]);
      expect(untouched(apps)).toBe(true);
    });

    it('refuses a release with no checksum', async () => {
      const apps = oldCopy();
      const ran: string[] = [];
      await expect(installApp({ version: '0.1.0' }, releaseDeps(apps, fakeZip(), ran, { sum: null }))).rejects.toThrow(/no checksum/);
      expect(ran).toEqual([]);
      expect(untouched(apps)).toBe(true);
    });

    it('refuses an app whose code signature fails, before replacing or opening anything', async () => {
      const apps = oldCopy();
      const ran: string[] = [];
      await expect(installApp({ version: '0.1.0' }, releaseDeps(apps, fakeZip(), ran, { codesignFails: true }))).rejects.toThrow(/code signature/);
      expect(ran).toEqual(['ditto', 'codesign']);
      expect(untouched(apps)).toBe(true);
    });
  });
});
