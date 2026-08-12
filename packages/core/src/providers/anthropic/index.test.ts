import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAnthropicProvider } from './index.js';

describe('createAnthropicProvider', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it('throws instead of silently constructing a client with no credentials', () => {
    expect(() => createAnthropicProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('constructs a provider once an API key is available via the environment', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-secret';
    const provider = createAnthropicProvider();
    expect(provider.name).toBe('anthropic');
  });

  it('accepts an explicit apiKey override without requiring the env var', () => {
    const provider = createAnthropicProvider({ apiKey: 'explicit-test-key' });
    expect(provider.name).toBe('anthropic');
  });
});
