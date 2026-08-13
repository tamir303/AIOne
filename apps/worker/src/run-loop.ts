import { Diff } from '@aione/core';
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';
import { eq } from 'drizzle-orm';
import { planFromPrompt } from './orchestrator/index.js';
import { classifyActionSafely } from './gate/classifier.js';
import { requestApproval } from './gate/approver.js';
import type { WorkerRun } from './types.js';
import { checkAndExpireIdleRun, recordGateEntryTime, clearGateEntryTime } from './run-enforcement.js';

const logger = createLogger('run-loop');

// processRun advances a Run by at most one step per call — see poll.ts.
// Each call below does exactly one DB write and returns; the plan-review
// and diff-review gates are each their own step, so a run parked on a
// human decision costs nothing but a cheap SELECT per tick until that
// decision shows up.
//
// Cost-quota enforcement (wouldExceedCostQuota in run-enforcement.ts) is
// intentionally not wired in here yet: plan/diff generation below are still
// stubs, not real model calls, so there is nothing to bound the cost of.
// It belongs at the point a real model call is made (see #2/#3/#4).
export async function processRun(run: WorkerRun): Promise<void> {
  logger.info('processing run', { runId: run.id, status: run.status });

  try {
    // Step 0: a Run sitting at a gate (awaiting_approval) can idle out
    // before a human ever decides. Check this before generating the next
    // step so an expired Run never gets a fresh plan/diff written under it.
    const wasExpired = await checkAndExpireIdleRun(run);
    if (wasExpired) {
      logger.info('run expired due to idle timeout', { runId: run.id });
      return;
    }

    // Step 1: generate the plan, then stop. The plan is not reviewed in
    // this same call — the next tick evaluates the plan-review gate.
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

      logger.info('plan generated, awaiting plan-review', { runId: run.id });

      // Record entry into the gate-blocked state so the idle timeout has a
      // start time to measure from.
      await recordGateEntryTime(run.id);
      return;
    }

    // Step 2: evaluate the plan-review gate. Every state-changing step goes
    // through classify -> requestApproval; there is no path that moves past
    // a generated plan without it. A 'pending' outcome leaves the Run at
    // 'awaiting_approval' so this step re-runs on the next tick.
    if (run.plan && !run.diff && run.status === 'awaiting_approval') {
      const planActionClass = classifyActionSafely({ type: 'file_write' });
      const outcome = await requestApproval(
        run,
        'plan-review',
        planActionClass,
        'Plan generated: will create backend API and frontend UI',
      );

      if (outcome.status === 'pending') {
        return;
      }

      if (outcome.status === 'rejected') {
        // A rejection is a real rejection: stop advancing the Run. The
        // plan is preserved (not cleared) so the next attempt has the
        // prior context available rather than starting from nothing.
        await db
          .update(runs)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(eq(runs.id, run.id));

        logger.info('plan rejected', { runId: run.id, reason: outcome.reason });

        // Leaving the gate either way, approved or rejected.
        await clearGateEntryTime(run.id);
        return;
      }

      // Approved: move to 'executing' and stop. The diff is generated on
      // the next tick, keeping this step to a single DB write.
      await db
        .update(runs)
        .set({ status: 'executing', updatedAt: new Date() })
        .where(eq(runs.id, run.id));

      logger.info('plan approved', { runId: run.id });

      // Clear gate entry time now that the Run has left the gate.
      await clearGateEntryTime(run.id);
      return;
    }

    // Step 3: generate the diff now that the plan is approved, then stop.
    if (run.plan && !run.diff && run.status === 'executing') {
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

      logger.info('diff generated, awaiting diff-review', { runId: run.id });

      // Record entry into the gate-blocked state.
      await recordGateEntryTime(run.id);
      return;
    }

    // Step 4: evaluate the diff-review gate.
    if (run.plan && run.diff && run.status === 'awaiting_approval') {
      const diffActionClass = classifyActionSafely({ type: 'file_write' });
      const outcome = await requestApproval(
        run,
        'diff-review',
        diffActionClass,
        'Diff: 80 lines added across 2 files',
      );

      if (outcome.status === 'pending') {
        return;
      }

      if (outcome.status === 'rejected') {
        // Same contract as the plan-review rejection: stop, keep the diff
        // (and plan) intact rather than losing prior context.
        await db
          .update(runs)
          .set({ status: 'rejected', updatedAt: new Date() })
          .where(eq(runs.id, run.id));

        logger.info('diff rejected', { runId: run.id, reason: outcome.reason });

        await clearGateEntryTime(run.id);
        return;
      }

      logger.info('diff approved', { runId: run.id });

      await db
        .update(runs)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(runs.id, run.id));

      // Clear gate entry time now that the Run has left the gate.
      await clearGateEntryTime(run.id);

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
