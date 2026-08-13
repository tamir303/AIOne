/**
 * Run enforcement: cost quotas and idle timeouts.
 */
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';
import { eq } from 'drizzle-orm';
import type { WorkerRun } from './types.js';
import { getIdleTimeout } from './config.js';

const logger = createLogger('run:enforcement');

/**
 * Check if a Run has exceeded its idle timeout while waiting at a gate.
 * If so, mark it as expired and return true.
 * @returns true if the run was expired, false otherwise
 */
export async function checkAndExpireIdleRun(run: WorkerRun): Promise<boolean> {
  // Only check timeout for runs waiting at a gate
  if (run.status !== 'awaiting_approval') {
    return false;
  }

  // Get the idle timeout (in minutes)
  const timeoutMinutes = getIdleTimeout(run.idleTimeoutMinutes);
  if (timeoutMinutes === null) {
    // No timeout configured
    return false;
  }

  // Check if gateEnteredAt is set
  if (!run.gateEnteredAt) {
    // This shouldn't happen if status is awaiting_approval, but be safe
    return false;
  }

  // Calculate elapsed time
  const now = new Date();
  const elapsedMs = now.getTime() - run.gateEnteredAt.getTime();
  const elapsedMinutes = elapsedMs / (1000 * 60);

  if (elapsedMinutes > timeoutMinutes) {
    logger.info('run idle timeout exceeded, marking as expired', {
      runId: run.id,
      elapsedMinutes: Math.round(elapsedMinutes),
      timeoutMinutes,
    });

    await db
      .update(runs)
      .set({
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id));

    return true;
  }

  return false;
}

/**
 * Check if a Run has exceeded its cost quota.
 * @param tokensBeforeCall - Tokens already used in the run
 * @param tokenCost - Tokens this call will cost
 * @param costQuotaTokens - The quota, or null if unlimited
 * @returns true if adding tokenCost would exceed the quota
 */
export function wouldExceedCostQuota(
  tokensBeforeCall: bigint,
  tokenCost: bigint,
  costQuotaTokens: bigint | null,
): boolean {
  if (costQuotaTokens === null) {
    // No quota
    return false;
  }

  const totalTokens = tokensBeforeCall + tokenCost;
  return totalTokens > costQuotaTokens;
}

/**
 * Update a Run's token usage after a model call.
 */
export async function updateRunTokenUsage(
  runId: string,
  tokensUsed: bigint,
): Promise<void> {
  await db
    .update(runs)
    .set({
      tokensUsed,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

/**
 * Record when a Run enters a gate-blocked state.
 */
export async function recordGateEntryTime(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({
      gateEnteredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}

/**
 * Clear the gate entry time when a Run leaves the gate.
 */
export async function clearGateEntryTime(runId: string): Promise<void> {
  await db
    .update(runs)
    .set({
      gateEnteredAt: null,
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId));
}
