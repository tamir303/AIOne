import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react's own automatic afterEach-cleanup only registers
// itself when a global `afterEach` exists (i.e. `test.globals: true` in the
// Vitest config); this repo's vitest.config.ts doesn't set that, so without
// this, multiple `render()` calls across tests in the same file pile up in
// the same jsdom document instead of unmounting between tests.
afterEach(() => {
  cleanup();
});
