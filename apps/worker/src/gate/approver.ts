import { and, eq, desc } from 'drizzle-orm';
import { ApprovalToken, ActionClass, ReviewGate, getDecision } from '@aione/core';
import { db, approvals } from '@aione/db';
import { createLogger, GateError } from '@aione/utils';
import type { WorkerRun } from '../types.js';

const logger = createLogger('gate:approver');

/**
 * Outcome of a single, non-blocking check for whether `gate` has been
 * decided for `run`. There is no in-process wait here — the worker's own
 * poll loop (apps/worker/src/poll.ts) is the polling mechanism. A 'pending'
 * result means "nothing decided yet"; run-loop.ts must stop and let the
 * next tick re-check, not retry in a loop of its own.
 */
export type ApprovalOutcome =
  | { status: 'approved'; token: ApprovalToken }
  | { status: 'pending' }
  | { status: 'rejected'; reason?: string };

export async function requestApproval(
  run: WorkerRun,
  gate: ReviewGate,
  actionClass: ActionClass,
  actionSummary: string,
): Promise<ApprovalOutcome> {
  const decision = getDecision(actionClass, run.trustTier);

  logger.info('requesting approval', {
    runId: run.id,
    gate,
    actionClass,
    decision,
    tier: run.trustTier,
  });

  if (decision === 'deny') {
    throw new GateError(`Action ${actionClass} is denied in tier ${run.trustTier}`);
  }

  if (decision === 'auto') {
    // Auto-approve: create an approval record immediately. The record is
    // still written — auto-approval means "no human confirmation required",
    // not "no audit trail".
    const [approval] = await db
      .insert(approvals)
      .values({
        runId: run.id,
        gate,
        actionClass,
        actionSummary,
        decision: 'approved',
        tier: run.trustTier,
      })
      .returning();

    logger.info('auto-approved', { runId: run.id, gate, approvalId: approval.id });
    return { status: 'approved', token: ApprovalToken.create(run.id) };
  }

  // decision === 'confirm': block on the real approval row written by
  // apps/api/src/handlers/gate.ts's /plan-review and /diff-review endpoints
  // (hit by the web UI's Approve/Reject buttons). The worker never writes
  // this decision itself — it only reads. If a human hasn't decided yet,
  // this returns 'pending' and the caller stops for this tick; the Run
  // stays at 'awaiting_approval' and gets re-checked on the next poll tick.
  const [latest] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, run.id), eq(approvals.gate, gate)))
    .orderBy(desc(approvals.decidedAt))
    .limit(1);

  if (!latest) {
    logger.info('awaiting human approval', { runId: run.id, gate });
    return { status: 'pending' };
  }

  if (latest.decision === 'rejected') {
    logger.info('human rejected', { runId: run.id, gate, approvalId: latest.id });
    return { status: 'rejected', reason: latest.reason ?? undefined };
  }

  logger.info('human approved', { runId: run.id, gate, approvalId: latest.id });
  return { status: 'approved', token: ApprovalToken.create(run.id) };
}
