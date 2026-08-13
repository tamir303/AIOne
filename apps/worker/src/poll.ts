import { and, eq, ne } from 'drizzle-orm';
import { db, runs, sessions, projects } from '@aione/db';
import { createLogger } from '@aione/utils';
import type { RunId, SessionId, Plan, Diff, TrustTier } from '@aione/core';
import { processRun } from './run-loop.js';
import type { WorkerRun } from './types.js';

const logger = createLogger('poll');

// Run -> Session -> Project join to resolve trustTier, which lives on
// Project rather than Run (see types.ts). Excludes 'done'/'failed'/'rejected'
// so runs that can no longer advance on their own stop being re-fetched
// every tick. 'rejected' specifically means a human said no at a gate —
// see run-loop.ts — which is a stopping state, not a retryable one, until a
// later ticket adds a resubmission path.
async function fetchPendingRuns(): Promise<WorkerRun[]> {
  const rows = await db
    .select({
      id: runs.id,
      sessionId: runs.sessionId,
      status: runs.status,
      plan: runs.plan,
      diff: runs.diff,
      trustTier: projects.trustTier,
    })
    .from(runs)
    .innerJoin(sessions, eq(runs.sessionId, sessions.id))
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .where(
      and(
        ne(runs.status, 'done'),
        ne(runs.status, 'failed'),
        ne(runs.status, 'rejected'),
      ),
    );

  // The jsonb plan/diff columns and the varchar status/trustTier columns
  // are untyped at the database boundary (unknown / plain string). The
  // cast is safe here because run-loop.ts is the only writer of these
  // columns and always writes conforming values.
  return rows.map((row) => ({
    id: row.id as RunId,
    sessionId: row.sessionId as SessionId,
    status: row.status as WorkerRun['status'],
    plan: row.plan as Plan | undefined,
    diff: row.diff as Diff | undefined,
    trustTier: row.trustTier as TrustTier,
  }));
}

// processRun() only advances a run by one step per call (plan, then diff,
// then done — see run-loop.ts), so a run that isn't finished yet will be
// picked up again on the next tick and carried forward from there.
export async function pollOnce(): Promise<void> {
  const pending = await fetchPendingRuns();

  for (const run of pending) {
    try {
      await processRun(run);
    } catch (error) {
      // processRun already catches its own errors and marks the run
      // 'failed'; this catch exists only so one run's unexpected throw
      // can't stop the rest of the batch from being processed.
      logger.error('unexpected error advancing run', error instanceof Error ? error : { error: String(error) });
    }
  }
}

export function startPolling(intervalMs: number): () => void {
  const timer = setInterval(() => {
    pollOnce().catch((error) => {
      logger.error('poll tick failed', error instanceof Error ? error : { error: String(error) });
    });
  }, intervalMs);

  return () => clearInterval(timer);
}
