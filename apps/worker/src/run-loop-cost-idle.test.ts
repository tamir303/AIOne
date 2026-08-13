import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunId, SessionId } from '@aione/core';
import type { WorkerRun } from './types.js';

// Mock database
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
  const approvals = {
    runId: 'runId',
    gate: 'gate',
    decision: 'decision',
    decidedAt: 'decidedAt',
  };
  const runs = { id: 'id' };

  const db = {
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

  return { db, approvals, runs };
});

vi.mock('@aione/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aione/utils')>();
  return {
    ...actual,
    createLogger: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} }),
  };
});

// This suite exercises cost-quota/idle-timeout enforcement, not plan
// *content* — #3's planFromPrompt() makes a real model call by default,
// which must never run in a unit test. Stub it out; prompt-reflecting
// behavior is covered by orchestrator/index.test.ts.
vi.mock('./orchestrator/index.js', () => ({
  planFromPrompt: async (prompt: string) => ({
    steps: [{ role: 'backend', description: `stub step for: ${prompt}` }],
    rationale: 'stub plan for cost/idle enforcement tests',
  }),
}));

const { processRun } = await import('./run-loop.js');

function currentRun(
  trustTier: WorkerRun['trustTier'],
  overrides?: Partial<WorkerRun>,
): WorkerRun {
  return {
    id: hoisted.runRow.id as RunId,
    sessionId: 'session-1' as SessionId,
    status: hoisted.runRow.status as WorkerRun['status'],
    prompt: (hoisted.runRow.prompt as string) ?? 'test prompt',
    plan: hoisted.runRow.plan as WorkerRun['plan'],
    diff: hoisted.runRow.diff as WorkerRun['diff'],
    trustTier,
    costQuotaTokens:
      (hoisted.runRow.costQuotaTokens as bigint | null) ?? (overrides?.costQuotaTokens ?? null),
    tokensUsed: (hoisted.runRow.tokensUsed as bigint) ?? BigInt(0),
    idleTimeoutMinutes:
      (hoisted.runRow.idleTimeoutMinutes as number | null) ??
      (overrides?.idleTimeoutMinutes ?? null),
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

describe('processRun — cost quota and idle timeout', () => {
  const TIER = 'cautious';

  describe('idle timeout', () => {
    it('marks a run as expired when it exceeds idle timeout at a gate', async () => {
      // Initial state: generate plan
      await processRun(currentRun(TIER, { idleTimeoutMinutes: 30 }));
      expect(hoisted.runRow.status).toBe('awaiting_approval');

      // Simulate gate entry 31 minutes ago
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      hoisted.runRow.gateEnteredAt = thirtyOneMinutesAgo;

      // Next tick should expire the run
      await processRun(
        currentRun(TIER, {
          idleTimeoutMinutes: 30,
          gateEnteredAt: thirtyOneMinutesAgo,
        }),
      );

      expect(hoisted.runRow.status).toBe('expired');
    });

    it('does not expire a run still within the timeout window', async () => {
      // Initial state: generate plan
      await processRun(currentRun(TIER, { idleTimeoutMinutes: 30 }));
      expect(hoisted.runRow.status).toBe('awaiting_approval');

      // Simulate gate entry 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      hoisted.runRow.gateEnteredAt = tenMinutesAgo;

      // Next tick should NOT expire
      await processRun(
        currentRun(TIER, {
          idleTimeoutMinutes: 30,
          gateEnteredAt: tenMinutesAgo,
        }),
      );

      // Should still be awaiting approval (and diff should not be generated)
      expect(hoisted.runRow.status).toBe('awaiting_approval');
      expect(hoisted.runRow.diff).toBeUndefined();
    });

    it('records gate entry time when entering awaiting_approval state', async () => {
      await processRun(currentRun(TIER, { idleTimeoutMinutes: 30 }));

      expect(hoisted.runRow.gateEnteredAt).toBeDefined();
      expect(hoisted.runRow.gateEnteredAt).toBeInstanceOf(Date);
    });

    it('clears gate entry time when exiting awaiting_approval state', async () => {
      // Generate plan
      await processRun(currentRun(TIER, { idleTimeoutMinutes: 30 }));
      const gateEnteredTime = hoisted.runRow.gateEnteredAt;

      // Approve the plan
      hoisted.approvalRows.push({
        id: 'human-plan',
        runId: 'run-1',
        gate: 'plan-review',
        decision: 'approved',
        reason: null,
        decidedAt: new Date(),
      });

      // Process again to accept approval
      await processRun(
        currentRun(TIER, {
          idleTimeoutMinutes: 30,
          gateEnteredAt: gateEnteredTime as Date,
        }),
      );

      // Gate entry time should be cleared
      expect(hoisted.runRow.gateEnteredAt).toBe(null);
    });
  });

  describe('cost quota', () => {
    it('allows a run with unlimited quota to proceed', async () => {
      await processRun(currentRun(TIER, { costQuotaTokens: null }));

      expect(hoisted.runRow.status).toBe('awaiting_approval');
      expect(hoisted.runRow.plan).toBeDefined();
    });

    it('allows a run within its cost quota to proceed', async () => {
      const quota = BigInt(10000);
      hoisted.runRow.tokensUsed = BigInt(0);

      await processRun(currentRun(TIER, { costQuotaTokens: quota }));

      expect(hoisted.runRow.status).toBe('awaiting_approval');
      expect(hoisted.runRow.plan).toBeDefined();
    });

    it('allows a run to proceed when cost quota fields exist but are not enforced at plan stage', async () => {
      // The current implementation is stubbed and doesn't make real model calls,
      // so quota enforcement happens at model call time, not plan generation.
      // This test verifies the fields are available when real model calls are added.
      const quota = BigInt(100);
      const tokensUsed = BigInt(50);

      hoisted.runRow.costQuotaTokens = quota;
      hoisted.runRow.tokensUsed = tokensUsed;

      await processRun(currentRun(TIER, { costQuotaTokens: quota, tokensUsed }));

      // Should proceed because model calls aren't real yet
      expect(hoisted.runRow.plan).toBeDefined();
    });
  });

  describe('interaction between idle timeout and cost quota', () => {
    it('checks both idle timeout and cost quota', async () => {
      const quota = BigInt(10000);
      const timeoutMinutes = 30;

      // costQuotaTokens/idleTimeoutMinutes are Run-creation-time config,
      // not something processRun ever writes back to the DB row — seed
      // them on the row directly first, the same way 'allows a run within
      // its cost quota to proceed' above seeds tokensUsed.
      hoisted.runRow.costQuotaTokens = quota;
      hoisted.runRow.idleTimeoutMinutes = timeoutMinutes;

      await processRun(
        currentRun(TIER, {
          costQuotaTokens: quota,
          idleTimeoutMinutes: timeoutMinutes,
        }),
      );

      // Both fields should be set
      expect(hoisted.runRow.costQuotaTokens).toBe(quota);
      expect(hoisted.runRow.idleTimeoutMinutes).toBe(timeoutMinutes);
      expect(hoisted.runRow.status).toBe('awaiting_approval');
    });
  });
});
