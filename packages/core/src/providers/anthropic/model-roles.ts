import type { ModelRole } from '../types.js';

/**
 * Per-role Anthropic model defaults, per docs/tech-stack.md's model layer
 * table and CLAUDE.md's stack conventions: Opus for orchestration/planning,
 * Sonnet for working role agents, Haiku for routing/autocomplete.
 *
 * Model IDs move — these are resolved here, in the one directory that's
 * allowed to know a vendor model ID, rather than hardcoded at call sites.
 * Verified against the `claude-api` skill's current model catalog.
 */
export const ANTHROPIC_MODELS: Record<ModelRole, string> = {
  orchestrator: 'claude-opus-5',
  agent: 'claude-sonnet-5',
  routing: 'claude-haiku-4-5',
};
