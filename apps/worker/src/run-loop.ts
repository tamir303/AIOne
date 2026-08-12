import { Diff } from '@aione/core';
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';
import { eq } from 'drizzle-orm';
import { planFromPrompt } from './orchestrator/index.js';
import { classifyActionSafely } from './gate/classifier.js';
import { requestApproval } from './gate/approver.js';
import type { WorkerRun } from './types.js';
import {
  checkAndExpireIdleRun,
  wouldExceedCostQuota,
  recordGateEntryTime,
  clearGateEntryTime,
} from './run-enforcement.js';

const logger = createLogger('run-loop');

export async function processRun(run: WorkerRun): Promise<void> {
  logger.info('processing run', { runId: run.id, status: run.status });

  try {
    // Check for idle timeout at gates and expire if needed
    const wasExpired = await checkAndExpireIdleRun(run);
    if (wasExpired) {
      logger.info('run was expired due to idle timeout', { runId: run.id });
      return;
    }

    // Skip processing if already expired
    if (run.status === 'expired') {
      logger.info('run is expired, skipping', { runId: run.id });
      return;
    }

    // Stub: generate a plan
    if (!run.plan && run.status === 'planning') {
      const plan = await planFromPrompt('stub prompt');

      await db
        .update(runs)
        .set({
          plan,
          status: 'awaiting_approval',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id));

      logger.info('plan generated', { runId: run.id });

      // Record entry into gate state
      await recordGateEntryTime(run.id);

      // Classify the action, then request approval through the gate.
      // Every state-changing step goes through classify -> requestApproval;
      // there is no path that writes a plan without it.
      const planActionClass = classifyActionSafely({ type: 'file_write' });
      await requestApproval(
        { ...run, plan, status: 'awaiting_approval' },
        planActionClass,
        'Plan generated: will create backend API and frontend UI',
      );

      logger.info('plan approved', { runId: run.id });

      // Clear gate entry time now that approval is granted
      await clearGateEntryTime(run.id);
    }

    // Stub: generate a diff
    if (run.plan && !run.diff) {
      const diff: Diff = {
        files: [
          { path: 'api/routes/feature.ts', added: 50, removed: 0 },
          { path: 'components/Feature.tsx', added: 30, removed: 0 },
        ],
        summary: 'Added feature endpoints and UI components',
      };

      await db
        .update(runs)
        .set({
          diff,
          status: 'awaiting_approval',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id));

      logger.info('diff generated', { runId: run.id });

      // Record entry into gate state
      await recordGateEntryTime(run.id);

      const diffActionClass = classifyActionSafely({ type: 'file_write' });
      await requestApproval(
        { ...run, diff, status: 'awaiting_approval' },
        diffActionClass,
        'Diff: 80 lines added across 2 files',
      );

      logger.info('diff approved', { runId: run.id });

      // Clear gate entry time now that approval is granted
      await clearGateEntryTime(run.id);
    }

    // Mark done
    if (run.plan && run.diff) {
      await db
        .update(runs)
        .set({
          status: 'done',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, run.id));

      logger.info('run completed', { runId: run.id });
    }
  } catch (error) {
    logger.error(
      'error processing run',
      error instanceof Error ? error : { error: String(error) },
    );
    await db
      .update(runs)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(runs.id, run.id));
  }
}
