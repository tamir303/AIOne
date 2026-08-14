import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// @aione/core, @aione/db, and @aione/utils are only publish-mapped to
// ./dist via their package.json "exports", but CI's test step runs before
// the build step (see .github/workflows/ci.yml). Aliasing straight to
// source keeps the api's tests independent of build order instead of
// requiring `pnpm -r build` to have already run — same convention as
// apps/worker/vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@aione/core': path.resolve(dirname, '../../packages/core/src/index.ts'),
      '@aione/db': path.resolve(dirname, '../../packages/db/src/index.ts'),
      '@aione/utils': path.resolve(dirname, '../../packages/utils/src/index.ts'),
    },
  },
  test: {
    // See apps/worker/vitest.config.ts for why this is spelled out
    // explicitly rather than relying on vitest's own default excludes.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Must run (and finish) before any test file's own static imports are
    // evaluated — see vitest.setup.ts for why that ordering matters here.
    setupFiles: ['./vitest.setup.ts'],
    // workspaces.test.ts (#18) and files.test.ts (#32) both do real inserts/
    // deletes against the same shared Postgres tables (workspaces, projects
    // — files.test.ts additionally touches sessions/project_files). Running
    // test files in parallel workers lets one file's beforeEach cleanup race
    // another file's in-flight fixtures/assertions — same reasoning as
    // packages/db/vitest.config.ts's fileParallelism: false.
    fileParallelism: false,
  },
});
