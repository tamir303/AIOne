import type {
  GenerateTextRequest,
  GenerateTextResult,
  ModelProvider,
  ModelRole,
  StreamTextChunk,
} from '../types.js';
import { ANTHROPIC_MODELS } from './model-roles.js';
import type { AnthropicTransport } from './transport.js';

/**
 * `ModelProvider` implementation backed by the Anthropic Messages API.
 *
 * This is the one place in the codebase allowed to know Anthropic-specific
 * shapes — everything else depends on `ModelProvider` (see providers/types.ts).
 * It never imports `@anthropic-ai/sdk` itself; a real SDK client instance is
 * handed in by `createAnthropicProvider` (index.ts) and used here only
 * through the narrow `AnthropicTransport` interface, which also lets tests
 * inject a stub transport instead of hitting the network.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';

  constructor(private readonly transport: AnthropicTransport) {}

  private resolveModel(role: ModelRole): string {
    return ANTHROPIC_MODELS[role];
  }

  private buildParams(request: GenerateTextRequest) {
    return {
      model: this.resolveModel(request.role),
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: request.messages,
    };
  }

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const response = await this.transport.messages.create(this.buildParams(request));
    return toResult(response);
  }

  async *streamText(request: GenerateTextRequest): AsyncIterable<StreamTextChunk> {
    const stream = this.transport.messages.stream(this.buildParams(request));

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = event.delta.text;
        if (typeof text === 'string') {
          yield { type: 'text-delta', text };
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    yield { type: 'done', result: toResult(finalMessage) };
  }
}

function toResult(response: {
  model: string;
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}): GenerateTextResult {
  const text = response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  return {
    text,
    model: response.model,
    stopReason: response.stop_reason,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
