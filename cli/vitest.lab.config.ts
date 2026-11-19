import { defineConfig } from 'vitest/config';

// The lab (`npm run lab`): slow end-to-end nights with the real CLI and a fake agent. Not part of `npm test`.
export default defineConfig({
  test: {
    include: ['lab/**/*.lab.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
