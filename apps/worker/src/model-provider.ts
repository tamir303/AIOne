import { createAnthropicProvider } from '@aione/core';
import type { ModelProvider } from '@aione/core';

let cached: ModelProvider | undefined;

/**
 * Lazily constructs (and caches) the worker's real `ModelProvider`.
 *
 * Lazy on purpose: importing this module (or `./orchestrator/index.js`,
 * which calls it) must never require `ANTHROPIC_API_KEY` to be set just to
 * load — only an actual call that omits an explicit provider needs
 * credentials. Callers that want to avoid live model calls entirely (tests,
 * mainly) pass their own `ModelProvider` to `planFromPrompt` instead of
 * relying on this default.
 */
export function getModelProvider(): ModelProvider {
  if (!cached) {
    cached = createAnthropicProvider();
  }
  return cached;
}
