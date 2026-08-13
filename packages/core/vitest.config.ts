import { defineConfig } from 'vitest/config';

/**
 * vitest 4's own defaults only exclude `node_modules` and `.git` — `dist`
 * is no longer excluded out of the box. Without this, a stale compiled
 * `dist/**\/*.test.js` left over from an earlier build (tsc doesn't clean
 * `dist` between runs) gets picked up alongside the real `src/**\/*.test.ts`
 * sources and run as if it were current, which is exactly the kind of
 * false failure/false pass this abstraction's tests need to avoid.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
