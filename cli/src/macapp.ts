// `chompyy app`: download the Mac app from this version's GitHub Release into ~/Applications and open it.
// The app is a thin window over this CLI, so the two versions are kept in step. The download is checked against
// the SHA-256 published next to it, and the app's code signature is checked, before anything is opened (#24).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = 'BranchWork-HQ/Chompyy';

/** The CLI's own version, from its package.json. */
export function cliVersion(): string {
  const pkg = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version;
}

export function appZipUrl(version: string): string {
  return `https://github.com/${REPO}/releases/download/v${version}/Chompyy-${version}.zip`;
}

/** The release's checksum file: `<sha256>  Chompyy-<version>.zip`, written by mac/Scripts/build-app.sh --release. */
export const checksumUrl = (version: string) => `${appZipUrl(version)}.sha256`;

/** The hash in a `shasum -a 256` line, or null when the text isn't one. */
export function parseChecksum(text: string): string | null {
  const m = text.trim().match(/^([0-9a-f]{64})\b/i);
  return m ? m[1]!.toLowerCase() : null;
}

export interface AppDeps {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Runs a command (ditto, codesign, open, pkill); throws when it fails. */
  exec: (cmd: string, args: string[]) => void;
  platform: string;
  appsDir: string;
}

const defaultDeps = (): AppDeps => ({
  fetch: (url) => fetch(url),
  exec: (cmd, args) => {
    execFileSync(cmd, args, { stdio: 'ignore' });
  },
  platform: process.platform,
  appsDir: join(homedir(), 'Applications'),
});

/** Install (or update) Chompyy.app. Returns where it went. */
export async function installApp(opts: { version?: string; open?: boolean } = {}, deps: AppDeps = defaultDeps()): Promise<string> {
  if (deps.platform !== 'darwin') throw new Error('The Chompyy app is macOS only for now. The CLI works everywhere: `chompyy help`.');
  const version = opts.version ?? cliVersion();
  const url = appZipUrl(version);
  const res = await deps.fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the app (HTTP ${res.status}) from ${url}`);
  const sumRes = await deps.fetch(checksumUrl(version));
  const want = sumRes.ok ? parseChecksum(Buffer.from(await sumRes.arrayBuffer()).toString('utf8')) : null;
  if (!want) throw new Error(`The release has no checksum (${checksumUrl(version)}), so Chompyy won't open its download. Nothing was installed.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== want) throw new Error(`The download doesn't match the release's checksum (got ${got.slice(0, 12)}…, expected ${want.slice(0, 12)}…). Nothing was installed.`);

  const tmp = mkdtempSync(join(tmpdir(), 'chompyy-app-'));
  try {
    const zip = join(tmp, 'Chompyy.zip');
    writeFileSync(zip, bytes);
    deps.exec('ditto', ['-x', '-k', zip, tmp]);
    const unpacked = join(tmp, 'Chompyy.app');
    if (!existsSync(unpacked)) throw new Error('The download had no Chompyy.app in it.');
    try {
      deps.exec('codesign', ['--verify', '--deep', '--strict', unpacked]);
    } catch {
      throw new Error("The app's code signature doesn't check out (codesign --verify), so it wasn't installed.");
    }

    mkdirSync(deps.appsDir, { recursive: true });
    const target = join(deps.appsDir, 'Chompyy.app');
    try {
      deps.exec('pkill', ['-x', 'Chompyy']); // an older copy may be running
    } catch {}
    rmSync(target, { recursive: true, force: true });
    renameSync(unpacked, target);
    if (opts.open !== false) deps.exec('open', [target]);
    return target;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
