import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Loaded from the repo root regardless of cwd, so `.env` stays the single
// source of truth documented in the root .env.example — dotenv/config's
// default (process.cwd()) only works when run from the repo root, which
// `pnpm --filter` does not do. Must run before @clerk/hono's import, since
// clerkMiddleware() reads CLERK_SECRET_KEY when invoked below.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { clerkMiddleware } from '@clerk/hono';
import { createLogger } from '@aione/utils';
import gateRouter from './handlers/gate.js';
import eventsRouter from './handlers/events.js';
import runsRouter from './handlers/runs.js';
import workspacesRouter, { projectsRouter } from './handlers/workspaces.js';
import { errorMiddleware } from './middleware/errors.js';

const logger = createLogger('api');
const app = new Hono();

// Middleware: request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.debug('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  });
});

// Attaches Clerk auth info to context for every route via getAuth(c); it
// does not itself require a signed-in user — each handler that needs one
// checks getAuth(c).userId and returns 401 on its own.
app.use('*', clerkMiddleware());

errorMiddleware(app);

// Routes
app.route('/gate', gateRouter);
app.route('/events', eventsRouter);
app.route('/runs', runsRouter);
app.route('/workspaces', workspacesRouter);
app.route('/projects', projectsRouter);

// Health check
app.get('/health', (c) => c.json({ ok: true }));

// Start server
// Hono v3 has no built-in Node listener; @hono/node-server bridges the
// fetch-shaped app to an actual Node http.Server. Without this, "starting
// on port X" would only ever log — nothing would be listening.
const port = parseInt(process.env.API_PORT || '3001', 10);
logger.info(`api starting on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
