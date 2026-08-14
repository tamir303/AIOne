import { Hono } from 'hono';
import { clerkMiddleware } from '@clerk/hono';
import { createLogger } from '@aione/utils';
import gateRouter from './handlers/gate.js';
import eventsRouter from './handlers/events.js';
import runsRouter from './handlers/runs.js';
import workspacesRouter, { projectsRouter } from './handlers/workspaces.js';
import { errorMiddleware } from './middleware/errors.js';

// Builds the Hono app (routes, middleware, Clerk wiring) without starting a
// listener, so it can be imported directly by handler-level tests as well as
// by index.ts's serve() call. Callers that need env vars loaded (e.g.
// CLERK_SECRET_KEY for clerkMiddleware()) must do so before importing this
// module.
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

export default app;
