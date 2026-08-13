import { Hono } from 'hono';
import { db, approvals } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:gate');
const router = new Hono();

// POST /gate/plan-review — body: { runId, decision: 'approved' | 'rejected', reason?: string }
// This is the only place a human's plan-review decision is recorded. The
// worker (apps/worker/src/gate/approver.ts) polls this table by
// (runId, gate) and blocks the Run until a row like this one exists — it
// never inserts a 'confirm'-tier decision itself.
router.post('/plan-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision, reason } = body;

    logger.info('plan review', { runId, decision });

    // Record the approval. This table is append-only at the DB level in
    // later hardening; for the vertical slice we only ever insert here.
    const [approval] = await db
      .insert(approvals)
      .values({
        runId,
        gate: 'plan-review',
        actionClass: 'file_write',
        actionSummary: 'Plan review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
        reason: typeof reason === 'string' ? reason : undefined,
      })
      .returning();

    return c.json({ approved: true, approvalId: approval.id });
  } catch (error) {
    logger.error('error in plan-review', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /gate/diff-review — body: { runId, decision: 'approved' | 'rejected', reason?: string }
// Same contract as /plan-review, for the diff-review gate.
router.post('/diff-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision, reason } = body;

    logger.info('diff review', { runId, decision });

    const [approval] = await db
      .insert(approvals)
      .values({
        runId,
        gate: 'diff-review',
        actionClass: 'file_write',
        actionSummary: 'Diff review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
        reason: typeof reason === 'string' ? reason : undefined,
      })
      .returning();

    return c.json({ approved: true, approvalId: approval.id });
  } catch (error) {
    logger.error('error in diff-review', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
