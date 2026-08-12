/**
 * Provider-agnostic model layer (spec v0.3, "the model layer is multi-vendor
 * by design"). Every model call in the codebase must go through the
 * `ModelProvider` interface defined here — no agent code should import a
 * vendor SDK (e.g. `@anthropic-ai/sdk`) directly. See CLAUDE.md.
 */

/**
 * The three per-role defaults from docs/tech-stack.md's model layer table:
 * orchestrator/planner, working role agents, and routing/autocomplete.
 * A provider implementation resolves each role to one of its own model IDs —
 * callers never hardcode a vendor model ID.
 */
export type ModelRole = 'orchestrator' | 'agent' | 'routing';

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateTextRequest {
  /** Which per-role default to resolve to a concrete model. */
  role: ModelRole;
  /** Optional system prompt. */
  system?: string;
  messages: ModelMessage[];
  /** Defaults to a provider-chosen value when omitted. */
  maxTokens?: number;
}

export interface GenerateTextUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateTextResult {
  text: string;
  /** The concrete vendor model ID that served the request. */
  model: string;
  stopReason: string | null;
  usage: GenerateTextUsage;
}

export type StreamTextChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; result: GenerateTextResult };

/**
 * The provider-agnostic surface every model call goes through. Implement
 * this once per vendor (Anthropic first; others follow per the multi-vendor
 * decision in ADR 0002) — application code depends only on this interface.
 */
export interface ModelProvider {
  readonly name: string;
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
  streamText(request: GenerateTextRequest): AsyncIterable<StreamTextChunk>;
}
