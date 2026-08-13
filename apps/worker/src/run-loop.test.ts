import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunId, SessionId } from '@aione/core';
import type { WorkerRun } from './types.js';

// --- Fake persistence layer ---------------------------------------------
//
// This exercises the real gate mechanism (run-loop.ts + gate/approver.ts)
// against an in-memory stand-in for Postgres, so the test proves the actual
// regression this ticket fixes: a Run must not advance past a plan/diff
// review gate until a real approval row exists, and a rejection must stop
// it rather than being silently overridden by a timeout.
const hoisted = vi.hoisted(() => {
  return {
    runRow: {} as Record<string, unknown>,
    approvalRows: [] as Array<Record<string, unknown>>,
    nextId: { current: 1 },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => (row: Record<string, unknown>) => row[col] === val,
  and:
    (...preds: Array<(row: Record<string, unknown>) => boolean>) =>
    (row: Record<string, unknown>) =>
      preds.every((p) => p(row)),
  ne: (col: string, val: unknown) => (row: Record<string, unknown>) => row[col] !== val,
  desc: (col: string) => col,
}));

vi.mock('@aione/db', () => {
  const approvals = { runId: 'runId', gate: 'gate', decision: 'decision', decidedAt: 'decidedAt' };
  const runs = { id: 'id' };

  const db = {
    // Only run-loop.ts's `db.update(runs)...` calls reach here; approvals
    // is append-only and never updated.
    update(_table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            async where(_cond: unknown) {
              Object.assign(hoisted.runRow, patch);
            },
          };
        },
      };
    },
    // Only gate/approver.ts's auto-approve path inserts.
    insert(_table: unknown) {
      return {
        values(row: Record<string, unknown>) {
          return {
            async returning() {
              const record = {
                id: `approval-${hoisted.nextId.current++}`,
                decidedAt: new Date(),
                reason: null,
                ...row,
              };
              hoisted.approvalRows.push(record);
              return [record];
            },
          };
        },
      };
    },
    // Only gate/approver.ts's confirm-path read reaches here.
    select() {
      return {
        from(_table: unknown) {
          return {
            where(cond: (row: Record<string, unknown>) => boolean) {
              return {
                orderBy(_o: unknown) {
                  return {
                    limit(n: number) {
                      const matched = hoisted.approvalRows
                        .filter(cond)
                        .sort(
                          (a, b) =>
                            (b.decidedAt as Date).getTime() - (a.decidedAt as Date).getTime(),
                        );
                      return Promise.resolve(matched.slice(0, n));
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, approvals, runs };
});

vi.mock('@aione/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aione/utils')>();
  return {
    ...actual,
    createLogger: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} }),
  };
});

// diffFromPlan (see ./orchestrator/diff.ts) makes a real model-provider
// call by default as of #4. This suite exercises the gate-blocking state
// machine, not diff generation itself (see ./orchestrator/diff.test.ts for
// that) — stub it out so these tests never require live credentials or
// network access, while still returning a shape consistent with the
// approved plan so the diff-review gate has something real to act on.
vi.mock('./orchestrator/diff.js', () => ({
  diffFromPlan: vi.fn(async (plan: { steps: Array<{ role: string }> }) => ({
    files: plan.steps.map((step, i) => ({
      path: `stub/${step.role}-${i}.ts`,
      added: 10,
      removed: 0,
    })),
    summary: 'Stub diff for gate tests.',
  })),
}));

const { processRun } = await import('./run-loop.js');

// Simulates the next worker poll tick: rebuild the WorkerRun the way
// poll.ts's fetchPendingRuns() would, from the current persisted run row.
function currentRun(trustTier: WorkerRun['trustTier']): WorkerRun {
  return {
    id: hoisted.runRow.id as RunId,
    sessionId: 'session-1' as SessionId,
    status: hoisted.runRow.status as WorkerRun['status'],
    plan: hoisted.runRow.plan as WorkerRun['plan'],
    diff: hoisted.runRow.diff as WorkerRun['diff'],
    trustTier,
    // Cost quota / idle timeout enforcement is not what this test suite
    // exercises (see run-enforcement.test.ts and
    // run-loop-cost-idle.test.ts) — unlimited/no-timeout defaults here keep
    // that logic out of the way of the gate-blocking behavior under test.
    costQuotaTokens: (hoisted.runRow.costQuotaTokens as bigint | null) ?? null,
    tokensUsed: (hoisted.runRow.tokensUsed as bigint) ?? BigInt(0),
    idleTimeoutMinutes: (hoisted.runRow.idleTimeoutMinutes as number | null) ?? null,
    gateEnteredAt: (hoisted.runRow.gateEnteredAt as Date | null) ?? null,
  };
}

beforeEach(() => {
  hoisted.runRow = {
    id: 'run-1',
    status: 'planning',
    plan: undefined,
    diff: undefined,
    costQuotaTokens: null,
    tokensUsed: BigInt(0),
    idleTimeoutMinutes: null,
    gateEnteredAt: null,
  };
  hoisted.approvalRows.length = 0;
  hoisted.nextId.current = 1;
});

describe('processRun — approval gate', () => {
  // cautious tier makes file_write => 'confirm' under gate-policy.ts, so
  // these tests actually exercise the human-approval path rather than
  // auto-approving instantly.
  const TIER = 'cautious';

  it('pauses at plan-review until an approval row exists, then proceeds to done', async () => {
    // Tick 1: generate the plan.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('awaiting_approval');
    expect(hoisted.runRow.plan).toBeDefined();

    // Tick 2: plan-review gate — no human decision yet. Must NOT proceed.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('awaiting_approval');
    expect(hoisted.runRow.diff).toBeUndefined();

    // A human approves the plan via the API (apps/api/src/handlers/gate.ts).
    hoisted.approvalRows.push({
      id: 'human-plan',
      runId: 'run-1',
      gate: 'plan-review',
      decision: 'approved',
      reason: null,
      decidedAt: new Date(),
    });

    // Tick 3: plan-review gate now passes.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('executing');

    // Tick 4: diff is generated.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('awaiting_approval');
    expect(hoisted.runRow.diff).toBeDefined();

    // Tick 5: diff-review gate — no human decision yet. Must NOT proceed.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('awaiting_approval');

    // A human approves the diff.
    hoisted.approvalRows.push({
      id: 'human-diff',
      runId: 'run-1',
      gate: 'diff-review',
      decision: 'approved',
      reason: null,
      decidedAt: new Date(),
    });

    // Tick 6: diff-review gate passes, run completes.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('done');
  });

  it('does not proceed once a rejection row is written, and preserves the plan', async () => {
    // Tick 1: generate the plan.
    await processRun(currentRun(TIER));
    const generatedPlan = hoisted.runRow.plan;
    expect(hoisted.runRow.status).toBe('awaiting_approval');

    // A human rejects the plan via the API.
    hoisted.approvalRows.push({
      id: 'human-plan',
      runId: 'run-1',
      gate: 'plan-review',
      decision: 'rejected',
      reason: 'wrong approach',
      decidedAt: new Date(),
    });

    // Tick 2: the rejection must stop the run — no diff is generated, and
    // it must not silently proceed the way the old setTimeout stub did.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('rejected');
    expect(hoisted.runRow.diff).toBeUndefined();
    // Prior context (the plan) is preserved, not lost.
    expect(hoisted.runRow.plan).toEqual(generatedPlan);

    // Tick 3: a rejected run does not advance on its own on later ticks
    // either — regression guard against reintroducing an auto-approve path.
    await processRun(currentRun(TIER));
    expect(hoisted.runRow.status).toBe('rejected');
    expect(hoisted.runRow.diff).toBeUndefined();
  });

  it('auto-approves both gates under the balanced tier and still records an audit trail', async () => {
    // Tick 1: generate the plan.
    await processRun(currentRun('balanced'));
    expect(hoisted.runRow.status).toBe('awaiting_approval');

    // Tick 2: plan-review gate — balanced + file_write => auto.
    await processRun(currentRun('balanced'));
    expect(hoisted.runRow.status).toBe('executing');

    // Tick 3: generate the diff.
    await processRun(currentRun('balanced'));
    expect(hoisted.runRow.status).toBe('awaiting_approval');
    expect(hoisted.runRow.diff).toBeDefined();

    // Tick 4: diff-review gate — auto again.
    await processRun(currentRun('balanced'));
    expect(hoisted.runRow.status).toBe('done');

    expect(hoisted.approvalRows).toHaveLength(2);
    expect(hoisted.approvalRows.map((r) => r.gate).sort()).toEqual(['diff-review', 'plan-review']);
  });
});
