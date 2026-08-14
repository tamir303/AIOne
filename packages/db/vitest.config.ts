import { defineConfig } from 'vitest/config';

// Deliberately generic: this file is shared by this ticket's round-trip
// tests (#16) and the append-only proof tests (#17, merged separately on a
// different branch) — both hit a real Postgres instance rather than a
// mock, so nothing here should assume one test file's naming or layout.
export default defineConfig({
  test: {
    // vitest 4's own defaults only exclude node_modules and .git — dist
    // isn't excluded out of the box, and tsconfig's "include": ["src/**/*"]
    // compiles *.test.ts into dist/*.test.js too. Without this, a stale
    // compiled dist/**/*.test.js left over from an earlier `pnpm build`
    // gets picked up alongside the real src/**/*.test.ts sources and run
    // a second time.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    // These tests do real inserts/deletes against a shared Postgres
    // instance (the same docker-compose/CI service used across this
    // package's test files) rather than a mock or a per-file sandboxed
    // database. Running test files in parallel workers risks one file's
    // fixture setup/teardown interleaving with another's — keep it
    // sequential so round-trip and append-only assertions can't observe
    // each other's in-flight state.
    fileParallelism: false,
    // Real network round trips to Postgres are slower than the in-memory/
    // mocked unit tests elsewhere in the monorepo; the 5s vitest default
    // is too tight for a chain of several sequential inserts plus cleanup.
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
