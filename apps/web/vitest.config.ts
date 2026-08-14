import { defineConfig } from 'vitest/config';

// Same shape as packages/core/vitest.config.ts and packages/db/vitest.config.ts
// (defineConfig from 'vitest/config', explicit exclude so a stale compiled
// dist/**/*.test.js left over from `tsc --noEmit`/`vite build` can't get
// picked up alongside the real src/**/*.test.tsx sources — see those two
// files for the full rationale).
//
// This package additionally needs a DOM environment and a setup file: its
// tests render React components (jsdom) and assert on them with jest-dom
// matchers like toBeInTheDocument (setupFiles).
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
  },
});
