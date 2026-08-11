import { ApprovalToken, ActionClass, getDecision } from '@aione/core';
import { db, approvals } from '@aione/db';
import { createLogger, GateError } from '@aione/utils';
import type { WorkerRun } from '../types.js';

const logger = createLogger('gate:approver');

export async function requestApproval(
  run: WorkerRun,
  actionClass: ActionClass,
  actionSummary: string,
): Promise<ApprovalToken> {
  const decision = getDecision(actionClass, run.trustTier);

  logger.info('requesting approval', {
    runId: run.id,
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
        actionClass,
        actionSummary,
        decision: 'approved',
        tier: run.trustTier,
      })
      .returning();

    logger.info('auto-approved', { runId: run.id, approvalId: approval.id });
    return ApprovalToken.create(run.id);
  }

  // decision === 'confirm'
  // In the vertical slice, we stub the human approval.
  // In Phase 2+, this waits on a webhook from the API triggered by the
  // web UI's plan-review / diff-review screens.
  logger.info('awaiting human approval', { runId: run.id });

  // Stub: approve after 1 second (for testing)
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const [approval] = await db
    .insert(approvals)
    .values({
      runId: run.id,
      actionClass,
      actionSummary,
      decision: 'approved',
      tier: run.trustTier,
    })
    .returning();

  logger.info('human approved', { runId: run.id, approvalId: approval.id });
  return ApprovalToken.create(run.id);
}
