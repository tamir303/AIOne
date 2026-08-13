import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunId } from '@aione/core';
import type { WorkerRun } from '../types.js';

// --- Fake persistence layer -------------------------------------------
//
// requestApproval() must never auto-complete a 'confirm' decision itself —
// it only ever reads what a human wrote via apps/api/src/handlers/gate.ts.
// These mocks replace drizzle-orm and @aione/db with an in-memory table so
// the test can assert on that read-only behavior without a live Postgres.
const hoisted = vi.hoisted(() => {
  return {
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

  const db = {
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

  return { db, approvals };
});

vi.mock('@aione/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aione/utils')>();
  return {
    ...actual,
    createLogger: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} }),
  };
});

const { requestApproval } = await import('./approver.js');

function makeRun(overrides: Partial<WorkerRun> = {}): WorkerRun {
  return {
    id: 'run-1' as RunId,
    sessionId: 'session-1' as any,
    status: 'awaiting_approval',
    prompt: 'test prompt',
    trustTier: 'cautious',
    // Not exercised by these tests (see run-enforcement.test.ts and
    // run-loop-cost-idle.test.ts) — unlimited/no-timeout defaults.
    costQuotaTokens: null,
    tokensUsed: BigInt(0),
    idleTimeoutMinutes: null,
    gateEnteredAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.approvalRows.length = 0;
  hoisted.nextId.current = 1;
});

describe('requestApproval', () => {
  it('auto-approves immediately and records an audit row when the policy says auto', async () => {
    // balanced tier + file_write => auto per gate-policy.ts
    const run = makeRun({ trustTier: 'balanced' });

    const outcome = await requestApproval(run, 'plan-review', 'file_write', 'Plan generated');

    expect(outcome.status).toBe('approved');
    expect(hoisted.approvalRows).toHaveLength(1);
    expect(hoisted.approvalRows[0]).toMatchObject({
      decision: 'approved',
      gate: 'plan-review',
    });
  });

  it('returns pending and writes nothing when no human decision exists yet', async () => {
    // cautious tier + file_write => confirm per gate-policy.ts
    const run = makeRun({ trustTier: 'cautious' });

    const outcome = await requestApproval(run, 'plan-review', 'file_write', 'Plan generated');

    expect(outcome.status).toBe('pending');
    expect(hoisted.approvalRows).toHaveLength(0);
  });

  it('returns approved once the API has written an approved row for this run+gate', async () => {
    const run = makeRun({ trustTier: 'cautious' });

    hoisted.approvalRows.push({
      id: 'human-1',
      runId: run.id,
      gate: 'plan-review',
      decision: 'approved',
      reason: null,
      decidedAt: new Date(),
    });

    const outcome = await requestApproval(run, 'plan-review', 'file_write', 'Plan generated');

    expect(outcome.status).toBe('approved');
    if (outcome.status === 'approved') {
      expect(outcome.token.runId).toBe(run.id);
    }
  });

  it('returns rejected with the reason once the API has written a rejected row', async () => {
    const run = makeRun({ trustTier: 'cautious' });

    hoisted.approvalRows.push({
      id: 'human-1',
      runId: run.id,
      gate: 'plan-review',
      decision: 'rejected',
      reason: 'not what I asked for',
      decidedAt: new Date(),
    });

    const outcome = await requestApproval(run, 'plan-review', 'file_write', 'Plan generated');

    expect(outcome).toEqual({ status: 'rejected', reason: 'not what I asked for' });
  });

  it('only matches decisions recorded for the same gate on the same run', async () => {
    const run = makeRun({ trustTier: 'cautious' });

    // A decision for a *different* gate on the same run must not satisfy
    // the plan-review check — this is exactly the bug a shared actionClass
    // ('file_write' for both plan and diff review) could otherwise cause.
    hoisted.approvalRows.push({
      id: 'human-1',
      runId: run.id,
      gate: 'diff-review',
      decision: 'approved',
      reason: null,
      decidedAt: new Date(),
    });

    const outcome = await requestApproval(run, 'plan-review', 'file_write', 'Plan generated');

    expect(outcome.status).toBe('pending');
  });
});
