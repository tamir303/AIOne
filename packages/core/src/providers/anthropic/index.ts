import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from './client.js';
import type { AnthropicTransport } from './transport.js';

export { AnthropicProvider } from './client.js';
export { ANTHROPIC_MODELS } from './model-roles.js';
export type {
  AnthropicCreateParams,
  AnthropicMessageResponse,
  AnthropicMessageStream,
  AnthropicStreamEvent,
  AnthropicTransport,
} from './transport.js';

export interface CreateAnthropicProviderOptions {
  /**
   * Overrides the API key read from `ANTHROPIC_API_KEY`. Only ever pass a
   * value sourced from the platform secret manager at runtime — never a
   * literal. See CLAUDE.md rule #2 and the secret-handling skill.
   */
  apiKey?: string;
}

/**
 * The only function in the codebase allowed to construct a live
 * `@anthropic-ai/sdk` client. Reads the API key from the environment /
 * secret manager only — never accepts or writes a hardcoded key.
 */
export function createAnthropicProvider(
  options: CreateAnthropicProviderOptions = {},
): AnthropicProvider {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Provide it via the environment or platform secret manager — never hardcode it in a repo file.',
    );
  }

  // The real SDK client satisfies AnthropicTransport structurally.
  const client = new Anthropic({ apiKey }) as unknown as AnthropicTransport;
  return new AnthropicProvider(client);
}
