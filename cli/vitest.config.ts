import { defineConfig } from 'vitest/config';

// Git-heavy tests (worktrees, merges) can pass 5 s on a busy laptop.
export default defineConfig({ test: { testTimeout: 15_000 } });
