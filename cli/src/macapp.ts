// `chompyy app`: download the Mac app from this version's GitHub Release into ~/Applications and open it.
// The app is a thin window over this CLI, so the two versions are kept in step.
import { execFileSync } from 'node:child_process';
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

export interface AppDeps {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Runs a command (ditto, open, pkill). */
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

  const tmp = mkdtempSync(join(tmpdir(), 'chompyy-app-'));
  try {
    const zip = join(tmp, 'Chompyy.zip');
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    deps.exec('ditto', ['-x', '-k', zip, tmp]);
    const unpacked = join(tmp, 'Chompyy.app');
    if (!existsSync(unpacked)) throw new Error('The download had no Chompyy.app in it.');

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
