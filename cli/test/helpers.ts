import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/** Point CHOMPYY_HOME at a fresh temp folder for each test. Returns a getter for its path. */
export function useTempHome(): () => string {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chompyy-test-'));
    process.env.CHOMPYY_HOME = dir;
  });
  afterEach(() => {
    delete process.env.CHOMPYY_HOME;
    rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}

export const NOW = new Date('2026-11-13T12:00:00Z');
export const nowSec = Math.floor(NOW.getTime() / 1000);
