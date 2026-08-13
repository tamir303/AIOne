/**
 * The minimal slice of the `@anthropic-ai/sdk` client surface this provider
 * depends on. Depending on this narrow structural interface — rather than
 * the SDK's own `Anthropic` class type — keeps the vendor SDK import
 * confined to `createAnthropicProvider` (see index.ts) and lets tests inject
 * a stub transport instead of hitting the network. A real `Anthropic` client
 * instance satisfies this interface structurally, no adapter needed.
 */

export interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicTextBlock {
  type: string;
  text?: string;
}

export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessageParam[];
}

export interface AnthropicMessageResponse {
  model: string;
  stop_reason: string | null;
  content: AnthropicTextBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface AnthropicMessageStream extends AsyncIterable<AnthropicStreamEvent> {
  finalMessage(): Promise<AnthropicMessageResponse>;
}

export interface AnthropicTransport {
  messages: {
    create(params: AnthropicCreateParams): Promise<AnthropicMessageResponse>;
    stream(params: AnthropicCreateParams): AnthropicMessageStream;
  };
}
