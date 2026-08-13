import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './client.js';
import type {
  AnthropicCreateParams,
  AnthropicMessageResponse,
  AnthropicMessageStream,
  AnthropicStreamEvent,
  AnthropicTransport,
} from './transport.js';

function fakeResponse(overrides: Partial<AnthropicMessageResponse> = {}): AnthropicMessageResponse {
  return {
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hello from the stub' }],
    usage: { input_tokens: 12, output_tokens: 3 },
    ...overrides,
  };
}

function fakeStream(events: AnthropicStreamEvent[], finalMessage: AnthropicMessageResponse): AnthropicMessageStream {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: async () => finalMessage,
  };
}

describe('AnthropicProvider', () => {
  it('resolves the model ID from the request role and never requires live credentials', async () => {
    const create = vi.fn(async (_params: AnthropicCreateParams) => fakeResponse());
    const transport: AnthropicTransport = {
      messages: {
        create,
        stream: vi.fn(),
      },
    };
    const provider = new AnthropicProvider(transport);

    const result = await provider.generateText({
      role: 'agent',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5');
    expect(result.text).toBe('hello from the stub');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.stopReason).toBe('end_turn');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('resolves the orchestrator role to the Opus default and the routing role to the Haiku default', async () => {
    const create = vi.fn(async (_params: AnthropicCreateParams) => fakeResponse());
    const transport: AnthropicTransport = { messages: { create, stream: vi.fn() } };
    const provider = new AnthropicProvider(transport);

    await provider.generateText({ role: 'orchestrator', messages: [] });
    await provider.generateText({ role: 'routing', messages: [] });

    expect(create.mock.calls[0][0].model).toBe('claude-opus-5');
    expect(create.mock.calls[1][0].model).toBe('claude-haiku-4-5');
  });

  it('joins multiple text blocks and ignores non-text blocks in the response', async () => {
    const response = fakeResponse({
      content: [
        { type: 'text', text: 'first ' },
        { type: 'tool_use' },
        { type: 'text', text: 'second' },
      ],
    });
    const transport: AnthropicTransport = {
      messages: { create: vi.fn(async () => response), stream: vi.fn() },
    };
    const provider = new AnthropicProvider(transport);

    const result = await provider.generateText({ role: 'agent', messages: [] });

    expect(result.text).toBe('first second');
  });

  it('streams text-delta chunks followed by a final done chunk with the aggregated result', async () => {
    const events: AnthropicStreamEvent[] = [
      { type: 'content_block_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk-1 ' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk-2' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
    ];
    const finalMessage = fakeResponse({ content: [{ type: 'text', text: 'chunk-1 chunk-2' }] });
    const transport: AnthropicTransport = {
      messages: {
        create: vi.fn(),
        stream: vi.fn(() => fakeStream(events, finalMessage)),
      },
    };
    const provider = new AnthropicProvider(transport);

    const chunks: Array<{ type: string; text?: string }> = [];
    for await (const chunk of provider.streamText({ role: 'agent', messages: [] })) {
      chunks.push(chunk.type === 'text-delta' ? { type: chunk.type, text: chunk.text } : { type: chunk.type });
    }

    expect(chunks).toEqual([
      { type: 'text-delta', text: 'chunk-1 ' },
      { type: 'text-delta', text: 'chunk-2' },
      { type: 'done' },
    ]);
  });

  it('defaults maxTokens to 4096 when not supplied and forwards an explicit value otherwise', async () => {
    const create = vi.fn(async (_params: AnthropicCreateParams) => fakeResponse());
    const transport: AnthropicTransport = { messages: { create, stream: vi.fn() } };
    const provider = new AnthropicProvider(transport);

    await provider.generateText({ role: 'agent', messages: [] });
    await provider.generateText({ role: 'agent', messages: [], maxTokens: 512 });

    expect(create.mock.calls[0][0].max_tokens).toBe(4096);
    expect(create.mock.calls[1][0].max_tokens).toBe(512);
  });
});
