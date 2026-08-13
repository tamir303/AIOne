import type { ModelRole } from '../types.js';

/**
 * Per-role Anthropic model defaults, per docs/tech-stack.md's model layer
 * table: Claude Opus 4.8 for orchestration/planning, Claude Sonnet 5 for
 * working role agents, Claude Haiku 4.5 for routing/autocomplete.
 *
 * Model IDs move — these are resolved here, in the one directory that's
 * allowed to know a vendor model ID, rather than hardcoded at call sites.
 *
 * Provenance note: CLAUDE.md and docs/tech-stack.md both say to check the
 * `claude-api` skill before trusting a model ID from memory. As of this
 * change, no `claude-api` skill exists in this repo's `.claude/skills/`
 * (checked; also not present under the user's global `~/.claude/`). In its
 * absence these IDs were cross-checked against the two verifiable sources
 * available: docs/tech-stack.md's model layer table (source of the role →
 * name mapping) and the installed `@anthropic-ai/sdk@0.116.0`'s own
 * `Model` union type (resources/messages/messages.d.ts), which lists
 * 'claude-opus-4-8', 'claude-sonnet-5', and 'claude-haiku-4-5' as accepted
 * values. That is corroborating evidence, not a substitute for the skill —
 * re-verify here once `claude-api` is added.
 */
export const ANTHROPIC_MODELS: Record<ModelRole, string> = {
  orchestrator: 'claude-opus-4-8',
  agent: 'claude-sonnet-5',
  routing: 'claude-haiku-4-5',
};
