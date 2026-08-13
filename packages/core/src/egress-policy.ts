/**
 * Egress policy for sandboxed execution (spec §14, CLAUDE.md rule #5,
 * docs/sandbox-execution.md, .claude/skills/sandbox-routing).
 *
 * The posture is default-deny with no global "allow" escape hatch by
 * design: a host is permitted only if it appears on the policy's allowlist,
 * so every exception is a named, visible entry rather than a mode switch
 * someone can flip and forget. Any future sandbox lane adapter
 * (WebContainers, E2B, remote builder) must resolve a policy and check
 * `isHostAllowed` (or the worker-side `enforceEgress` wrapper in
 * `apps/worker/src/orchestrator/egress.ts`) before letting sandboxed code
 * reach a host — see that module for the enforcement seam.
 *
 * This module stays pure and dependency-free (no throwing, no logging) to
 * match `gate-policy.ts`'s convention: policy decisions live in `@aione/core`,
 * enforcement/error-throwing lives in the worker layer that consumes it.
 */

export interface EgressAllowEntry {
  /** Hostname only (no scheme/port/path), matched case-insensitively. */
  host: string;
  /** Why this host is allowlisted, shown to the user per the sandbox-routing skill. */
  reason: string;
}

export interface EgressPolicy {
  readonly allowlist: readonly EgressAllowEntry[];
}

/**
 * Package registries are the one pre-allowed category (sandbox-routing
 * skill), pinned to specific hosts rather than a wildcard.
 */
export const DEFAULT_REGISTRY_ALLOWLIST: readonly EgressAllowEntry[] = [
  { host: 'registry.npmjs.org', reason: 'npm package registry' },
  { host: 'registry.yarnpkg.com', reason: 'Yarn package registry' },
  { host: 'pypi.org', reason: 'PyPI package index' },
  { host: 'files.pythonhosted.org', reason: 'PyPI package file downloads' },
];

/** The default posture: deny everything except the pre-allowed registries. */
export function createDefaultEgressPolicy(): EgressPolicy {
  return { allowlist: [...DEFAULT_REGISTRY_ALLOWLIST] };
}

/** Returns a new policy with one more named allowlist entry. Never mutates. */
export function withAllowlistEntry(
  policy: EgressPolicy,
  entry: EgressAllowEntry,
): EgressPolicy {
  return { allowlist: [...policy.allowlist, entry] };
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

/** True only if `host` is explicitly on the policy's allowlist. Fails closed. */
export function isHostAllowed(policy: EgressPolicy, host: string): boolean {
  const normalized = normalizeHost(host);
  return policy.allowlist.some((entry) => normalizeHost(entry.host) === normalized);
}
