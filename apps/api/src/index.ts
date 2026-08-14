import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Loaded from the repo root regardless of cwd, so `.env` stays the single
// source of truth documented in the root .env.example — dotenv/config's
// default (process.cwd()) only works when run from the repo root, which
// `pnpm --filter` does not do. Must run before @clerk/hono's import (via
// ./app.js), since clerkMiddleware() reads CLERK_SECRET_KEY when invoked.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { serve } from '@hono/node-server';
import { createLogger } from '@aione/utils';
import app from './app.js';

const logger = createLogger('api');

// Start server
// Hono v3 has no built-in Node listener; @hono/node-server bridges the
// fetch-shaped app to an actual Node http.Server. Without this, "starting
// on port X" would only ever log — nothing would be listening.
const port = parseInt(process.env.API_PORT || '3001', 10);
logger.info(`api starting on port ${port}`);

serve({ fetch: app.fetch, port });
