/**
 * Configuration for Run cost quotas and idle timeouts.
 * These values are defaults; individual Runs can override via their DB record.
 */

/** Default idle timeout for Runs waiting at a gate, in minutes. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

/** Default cost quota for Runs, in tokens. null = unlimited. */
export const DEFAULT_COST_QUOTA_TOKENS = null as null | number;

/**
 * Get the idle timeout configuration for a Run.
 *
 * Only an *absent* field (`undefined`) falls back to the default. An
 * explicit `null` on the Run record means "no timeout" per the schema
 * (see packages/db/src/schema.ts's `idleTimeoutMinutes` column comment)
 * and must be respected as-is, not coerced to the default.
 *
 * @param runIdleTimeoutMinutes - The timeout from the Run record, if set
 * @returns The timeout in minutes, or null if no timeout
 */
export function getIdleTimeout(
  runIdleTimeoutMinutes: number | null | undefined,
): number | null {
  if (runIdleTimeoutMinutes === undefined) {
    return DEFAULT_IDLE_TIMEOUT_MINUTES;
  }
  return runIdleTimeoutMinutes;
}

/**
 * Get the cost quota configuration for a Run.
 *
 * Same undefined-vs-null contract as {@link getIdleTimeout}: only an
 * absent field falls back to the default, an explicit `null` (unlimited)
 * passes through unchanged.
 *
 * @param runCostQuotaTokens - The quota from the Run record, if set
 * @returns The quota in tokens, or null if unlimited
 */
export function getCostQuota(
  runCostQuotaTokens: bigint | null | undefined,
): bigint | null {
  if (runCostQuotaTokens === undefined) {
    return DEFAULT_COST_QUOTA_TOKENS === null ? null : BigInt(DEFAULT_COST_QUOTA_TOKENS);
  }
  return runCostQuotaTokens;
}
