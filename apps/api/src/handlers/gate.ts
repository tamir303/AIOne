import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, runs, approvals } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:gate');
const router = new Hono();

// POST /gate/plan-review
router.post('/plan-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision } = body;

    logger.info('plan review', { runId, decision });

    // Record the approval. This table is append-only at the DB level in
    // later hardening; for the vertical slice we only ever insert here.
    const [approval] = await db
      .insert(approvals)
      .values({
        runId,
        actionClass: 'file_write',
        actionSummary: 'Plan review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
      })
      .returning();

    return c.json({ approved: true, approvalId: approval.id });
  } catch (error) {
    logger.error('error in plan-review', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /gate/diff-review
router.post('/diff-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision } = body;

    logger.info('diff review', { runId, decision });

    const [approval] = await db
      .insert(approvals)
      .values({
        runId,
        actionClass: 'file_write',
        actionSummary: 'Diff review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
      })
      .returning();

    return c.json({ approved: true, approvalId: approval.id });
  } catch (error) {
    logger.error('error in diff-review', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /events/:runId (SSE)
router.get('/events/:runId', async (c) => {
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
