import { defineConfig } from 'vitest/config';

// Mirrors packages/core/vitest.config.ts and apps/worker/vitest.config.ts:
// `dist` isn't excluded by vitest 4's own defaults, and tsc doesn't clean
// `dist` between builds, so a stale compiled `dist/**/*.test.js` would
// otherwise get collected alongside the real `src/**/*.test.ts` sources.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    // This package's tests connect to a real Postgres instance (see
    // src/approvals-append-only.test.ts's own comment for why) rather than
    // running against mocks, so they run sequentially with a generous
    // timeout instead of vitest's default concurrency/timeout tuned for
    // pure unit tests.
    testTimeout: 15000,
  },
});
