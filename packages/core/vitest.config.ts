import { defineConfig } from 'vitest/config';

/**
 * vitest 4's own defaults only exclude `node_modules` and `.git` — `dist`
 * is no longer excluded out of the box. Without this, a stale compiled
 * `dist/**\/*.test.js` left over from an earlier build (tsc doesn't clean
 * `dist` between runs) gets picked up alongside the real `src/**\/*.test.ts`
 * sources and run as if it were current, which is exactly the kind of
 * false failure/false pass this abstraction's tests need to avoid.
 *
 * Scoped to `src/providers/**` only (rather than all of `src/**`): the rest
 * of this package's tests (e.g. `egress-policy.test.ts`) use Node's built-in
 * `node:test` runner, per this package's original convention — see the
 * `test` script in package.json, which runs the two suites separately.
 * vitest can't collect a `node:test`-based file (it reports "No test suite
 * found" even though the file's own assertions did run), so the two runners
 * must not be pointed at each other's files.
 */
export default defineConfig({
  test: {
    include: ['src/providers/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
