import type { RunId, SessionId, Plan, Diff, TrustTier } from '@aione/core';

/**
 * The worker operates on Runs enriched with the trust tier of their owning
 * Project. `@aione/core`'s `Run` type does not carry `trustTier` directly —
 * it lives on `Project` — so the gate layer (which decides auto/confirm/deny
 * per tier) needs the caller to resolve and attach it via the
 * Run -> Session -> Project join in poll.ts.
 *
 * This is intentionally narrower than `@aione/core`'s `Run`: it carries only
 * the fields run-loop.ts and gate/approver.ts actually read. `agent`,
 * `approvals`, `createdAt`, and `updatedAt` are dropped rather than stubbed
 * with placeholder values, since nothing here consumes them.
 */
export interface WorkerRun {
  id: RunId;
  sessionId: SessionId;
  status: 'planning' | 'awaiting_approval' | 'executing' | 'done' | 'failed' | 'rejected';
  plan?: Plan;
  diff?: Diff;
  trustTier: TrustTier;
}
