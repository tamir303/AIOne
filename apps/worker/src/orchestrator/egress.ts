import {
  createDefaultEgressPolicy,
  isHostAllowed,
  withAllowlistEntry,
  type EgressAllowEntry,
  type EgressPolicy,
} from '@aione/core';
import { createLogger, EgressDeniedError } from '@aione/utils';

const logger = createLogger('orchestrator:egress');

/**
 * Seam for future sandbox lane adapters (WebContainers, E2B, remote builder
 * — see `.claude/skills/sandbox-routing` and `docs/sandbox-execution.md`).
 *
 * No sandbox lane is wired into this repo yet: Phase 1's WebContainers work
 * and Phase 3's E2B/remote-builder work land the real `SandboxLane`
 * adapters. This module exists so the egress *policy* is decided and
 * enforceable from day one, per `docs/roadmap.md`'s requirement that egress
 * plumbing ships with Phase 2 (when sandboxes first run agent-generated
 * code) rather than being bolted on later.
 *
 * Contract for every future lane adapter: resolve a policy with
 * `resolveEgressPolicy`, then call `enforceEgress(policy, host)` before
 * letting the sandboxed process reach that host. Do not add a global bypass
 * — CLAUDE.md rule #5 requires default-deny; exceptions must always be
 * named, visible allowlist entries.
 */

export function resolveEgressPolicy(extraAllowlist: EgressAllowEntry[] = []): EgressPolicy {
  return extraAllowlist.reduce(
    (policy, entry) => withAllowlistEntry(policy, entry),
    createDefaultEgressPolicy(),
  );
}

/**
 * Throws `EgressDeniedError` unless `host` is on the resolved policy's
 * allowlist. Fails closed: an unresolvable/empty host is denied, not
 * allowed by default.
 */
export function enforceEgress(policy: EgressPolicy, host: string): void {
  if (isHostAllowed(policy, host)) {
    logger.debug('egress allowed', { host });
    return;
  }

  logger.warn('egress denied', { host });
  throw new EgressDeniedError(host);
}
