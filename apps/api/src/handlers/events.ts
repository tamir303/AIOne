import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:events');
const router = new Hono();

// GET /events/:runId (SSE) — mounted at the top level in index.ts so the
// real path is /events/:runId, matching apps/web/src/api.ts's streamRun().
router.get('/:runId', async (c) => {
  const runId = c.req.param('runId');

  logger.info('sse connected', { runId });

  return c.streamText(async (stream) => {
    // Stub: stream the current run state once, then keep the connection
    // alive with pings. Drizzle requires the eq() helper for .where() —
    // passing a plain object matches nothing and silently returns [].
    const [run] = await db.select().from(runs).where(eq(runs.id, runId));

    if (run) {
      await stream.write(`data: ${JSON.stringify({ type: 'run', run })}\n\n`);

      // Keep connection alive
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await stream.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
      }
    }
  });
});

export default router;
