import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createLogger } from '@aione/utils';
import gateRouter from './handlers/gate';
import { errorMiddleware } from './middleware/errors';

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

errorMiddleware(app);

// Routes
app.route('/gate', gateRouter);

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
