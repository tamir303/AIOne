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
 * @param runIdleTimeoutMinutes - The timeout from the Run record, if set
 * @returns The timeout in minutes, or null if no timeout
 */
export function getIdleTimeout(
  runIdleTimeoutMinutes: number | null | undefined,
): number | null {
  return runIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES;
}

/**
 * Get the cost quota configuration for a Run.
 * @param runCostQuotaTokens - The quota from the Run record, if set
 * @returns The quota in tokens, or null if unlimited
 */
export function getCostQuota(
  runCostQuotaTokens: bigint | null | undefined,
): bigint | null {
  if (runCostQuotaTokens !== null && runCostQuotaTokens !== undefined) {
    return runCostQuotaTokens;
  }
  return DEFAULT_COST_QUOTA_TOKENS ? BigInt(DEFAULT_COST_QUOTA_TOKENS) : null;
}
