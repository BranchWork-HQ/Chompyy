import { defineConfig } from 'vitest/config';

// Many tests run real git (worktrees, merges, clones) and take seconds. Vitest's default 5 s limit made them
// flaky whenever the Mac was busy, e.g. while an away card and Chompyy's own check ran at once (2026-11-18).
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['test/setup.ts'],
  },
});
