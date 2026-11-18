import { afterEach } from 'vitest';

// Many tests run git with execFileSync, which blocks the worker. Vitest's worker talks to the main process over
// a channel with a 60 s reply timeout, and a reply can only be read when the event loop is free. Without a pause,
// a file whose tests block for over 60 s in total (review.test.ts: ~74 s) fails the whole run with
// "Timeout calling onTaskUpdate" even though every test passed. Every away card's check then read "npm test
// fails, same as main" (2026-11-18). Yielding after each test lets the replies through.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
