import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Loaded from the repo root regardless of cwd, so `.env` stays the single
// source of truth documented in the root .env.example — dotenv/config's
// default (process.cwd()) only works when run from the repo root, which
// `pnpm --filter` does not do. Must run before any import whose top-level
// code reads process.env.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { createLogger } from '@aione/utils';
import { startPolling } from './poll.js';

const logger = createLogger('worker');

const POLL_INTERVAL_MS = 2000;

async function main() {
  logger.info('worker starting');

  startPolling(POLL_INTERVAL_MS);
  logger.info('worker ready', { pollIntervalMs: POLL_INTERVAL_MS });

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  logger.error('worker crashed', error);
  process.exit(1);
});
