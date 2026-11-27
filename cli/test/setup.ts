import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

// Tests never touch the real ~/.chompyy: every test starts in a throwaway home, even one that forgets
// useTempHome (which still sets its own). On 2026-11-21 three tests placed outside useTempHome's describe ran
// liveSet on the real home and pointed the live app at a deleted temp repo.
beforeEach(() => {
  process.env.CHOMPYY_HOME = mkdtempSync(join(tmpdir(), 'chompyy-default-home-'));
});

// Tests never replace the real ~/Applications/Chompyy.app (the live update installs the app there).
process.env.CHOMPYY_APPLICATIONS ??= mkdtempSync(join(tmpdir(), 'chompyy-applications-'));

// Tests never read the real Claude Code sessions on this Mac (the nightly read, dream.ts).
process.env.CHOMPYY_CLAUDE_PROJECTS ??= mkdtempSync(join(tmpdir(), 'chompyy-no-sessions-'));

// Many tests run git with execFileSync, which blocks the worker. Vitest's worker talks to the main process over
// a channel with a 60 s reply timeout, and a reply can only be read when the event loop is free. Without a pause,
// a file whose tests block for over 60 s in total (review.test.ts: ~74 s) fails the whole run with
// "Timeout calling onTaskUpdate" even though every test passed. Every away card's check then read "npm test
// fails, same as main" (2026-11-18). Yielding after each test lets the replies through.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

// Tests never edit the real ~/.claude/settings.json (`chompyy nudge on` adds a hook there).
process.env.CHOMPYY_CLAUDE_SETTINGS ??= join(mkdtempSync(join(tmpdir(), 'chompyy-claude-settings-')), 'settings.json');
