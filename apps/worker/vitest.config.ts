import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// @aione/core and @aione/utils are only publish-mapped to ./dist via their
// package.json "exports", but CI's test step runs before the build step
// (see .github/workflows/ci.yml). Aliasing straight to source keeps the
// worker's tests independent of build order instead of requiring `pnpm -r
// build` to have already run.
export default defineConfig({
  resolve: {
    alias: {
      '@aione/core': path.resolve(dirname, '../../packages/core/src/index.ts'),
      '@aione/utils': path.resolve(dirname, '../../packages/utils/src/index.ts'),
    },
  },
  test: {
    // tsconfig's "include": ["src/**/*"] compiles *.test.ts into
    // dist/*.test.js too. If a dev (or CI step order change) runs `build`
    // before `test`, vitest's own default excludes don't reliably keep up
    // with this repo's outDir layout, so every test would run twice —
    // spell it out explicitly rather than relying on the default.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
