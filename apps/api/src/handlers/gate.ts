import { Hono } from 'hono';
import { db, approvals } from '@aione/db';
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

export default router;
