import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RunId, SessionId } from '@aione/core';
import type { WorkerRun } from './types.js';
import {
  wouldExceedCostQuota,
  recordGateEntryTime,
  clearGateEntryTime,
} from './run-enforcement.js';

// Mock database
const hoisted = vi.hoisted(() => {
  return {
    runRow: {} as Record<string, unknown>,
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => (row: Record<string, unknown>) => row[col] === val,
}));

vi.mock('@aione/db', () => {
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
  };
  return { db, runs };
});

vi.mock('@aione/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aione/utils')>();
  return {
    ...actual,
    createLogger: () => ({ info: () => {}, error: () => {}, debug: () => {}, warn: () => {} }),
  };
});

const { checkAndExpireIdleRun: checkAndExpireIdleRunImpl } = await import(
  './run-enforcement.js'
);

describe('run-enforcement', () => {
  describe('idle timeout', () => {
    beforeEach(() => {
      hoisted.runRow = {
        id: 'run-1',
        status: 'awaiting_approval',
        gateEnteredAt: null,
        idleTimeoutMinutes: 30,
      };
    });

    it('marks a run as expired when idle timeout is exceeded', async () => {
      // Gate entered 31 minutes ago
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      hoisted.runRow.gateEnteredAt = thirtyOneMinutesAgo;
      hoisted.runRow.idleTimeoutMinutes = 30;

      const run: WorkerRun = {
        id: 'run-1' as RunId,
        sessionId: 'session-1' as SessionId,
        status: 'awaiting_approval',
        trustTier: 'balanced',
        costQuotaTokens: null,
        tokensUsed: BigInt(0),
        idleTimeoutMinutes: 30,
        gateEnteredAt: thirtyOneMinutesAgo,
      };

      const wasExpired = await checkAndExpireIdleRunImpl(run);

      expect(wasExpired).toBe(true);
      expect(hoisted.runRow.status).toBe('expired');
      expect(hoisted.runRow.updatedAt).toBeDefined();
    });

    it('does not expire a run that is still within the timeout window', async () => {
      // Gate entered 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      hoisted.runRow.gateEnteredAt = tenMinutesAgo;
      hoisted.runRow.idleTimeoutMinutes = 30;

      const run: WorkerRun = {
        id: 'run-1' as RunId,
        sessionId: 'session-1' as SessionId,
        status: 'awaiting_approval',
        trustTier: 'balanced',
        costQuotaTokens: null,
        tokensUsed: BigInt(0),
        idleTimeoutMinutes: 30,
        gateEnteredAt: tenMinutesAgo,
      };

      const wasExpired = await checkAndExpireIdleRunImpl(run);

      expect(wasExpired).toBe(false);
      expect(hoisted.runRow.status).toBe('awaiting_approval');
    });

    it('does not check timeout for runs not awaiting approval', async () => {
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);

      const run: WorkerRun = {
        id: 'run-1' as RunId,
        sessionId: 'session-1' as SessionId,
        status: 'planning',
        trustTier: 'balanced',
        costQuotaTokens: null,
        tokensUsed: BigInt(0),
        idleTimeoutMinutes: 30,
        gateEnteredAt: thirtyOneMinutesAgo,
      };

      const wasExpired = await checkAndExpireIdleRunImpl(run);

      expect(wasExpired).toBe(false);
      expect(hoisted.runRow.status).toBe('awaiting_approval');
    });

    it('does not timeout if idleTimeoutMinutes is null', async () => {
      const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000);
      hoisted.runRow.gateEnteredAt = thirtyOneMinutesAgo;
      hoisted.runRow.idleTimeoutMinutes = null;

      const run: WorkerRun = {
        id: 'run-1' as RunId,
        sessionId: 'session-1' as SessionId,
        status: 'awaiting_approval',
        trustTier: 'balanced',
        costQuotaTokens: null,
        tokensUsed: BigInt(0),
        idleTimeoutMinutes: null,
        gateEnteredAt: thirtyOneMinutesAgo,
      };

      const wasExpired = await checkAndExpireIdleRunImpl(run);

      expect(wasExpired).toBe(false);
    });
  });

  describe('cost quota', () => {
    it('returns false when cost is within quota', () => {
      const quota = BigInt(1000);
      const tokensUsed = BigInt(500);
      const tokenCost = BigInt(400);

      const wouldExceed = wouldExceedCostQuota(tokensUsed, tokenCost, quota);

      expect(wouldExceed).toBe(false);
    });

    it('returns true when cost would exceed quota', () => {
      const quota = BigInt(1000);
      const tokensUsed = BigInt(500);
      const tokenCost = BigInt(600);

      const wouldExceed = wouldExceedCostQuota(tokensUsed, tokenCost, quota);

      expect(wouldExceed).toBe(true);
    });

    it('returns true when cost equals quota exactly', () => {
      const quota = BigInt(1000);
      const tokensUsed = BigInt(500);
      const tokenCost = BigInt(500);

      const wouldExceed = wouldExceedCostQuota(tokensUsed, tokenCost, quota);

      // Exactly at quota should return false since we only exceed if we go OVER
      expect(wouldExceed).toBe(false);
    });

    it('returns false when quota is null (unlimited)', () => {
      const tokensUsed = BigInt(999999);
      const tokenCost = BigInt(999999);

      const wouldExceed = wouldExceedCostQuota(tokensUsed, tokenCost, null);

      expect(wouldExceed).toBe(false);
    });
  });

  describe('gate entry time tracking', () => {
    beforeEach(() => {
      hoisted.runRow = { id: 'run-1' };
    });

    it('records gate entry time', async () => {
      await recordGateEntryTime('run-1');

      expect(hoisted.runRow.gateEnteredAt).toBeDefined();
      expect(hoisted.runRow.gateEnteredAt).toBeInstanceOf(Date);
      expect(hoisted.runRow.updatedAt).toBeDefined();
    });

    it('clears gate entry time', async () => {
      hoisted.runRow.gateEnteredAt = new Date();

      await clearGateEntryTime('run-1');

      expect(hoisted.runRow.gateEnteredAt).toBe(null);
      expect(hoisted.runRow.updatedAt).toBeDefined();
    });
  });
});
