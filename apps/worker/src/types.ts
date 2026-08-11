import type { Run as CoreRun, TrustTier } from '@aione/core';

/**
 * The worker operates on Runs enriched with the trust tier of their owning
 * Project. `@aione/core`'s `Run` type does not carry `trustTier` directly —
 * it lives on `Project` — so the gate layer (which decides auto/confirm/deny
 * per tier) needs the caller to resolve and attach it. Once Task 6/7 wire up
 * real Session -> Project lookups, this becomes the shape returned by that
 * join. For the vertical slice, callers construct it directly.
 */
export type WorkerRun = CoreRun & { trustTier: TrustTier };
