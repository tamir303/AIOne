import { describe, expect, it } from 'vitest';
import type { GenerateTextRequest, GenerateTextResult, ModelProvider, StreamTextChunk } from '@aione/core';
import { planFromPrompt } from './index.js';

/**
 * A stub `ModelProvider` — no live credentials, no network access. Splits a
 * canned response into a few `text-delta` chunks so `planFromPrompt`'s
 * streamText-consuming loop (see index.ts) is actually exercised, not just
 * its JSON-parsing fallback path.
 */
function stubProvider(responseText: string, opts?: { requests?: GenerateTextRequest[] }): ModelProvider {
  return {
    name: 'stub',
    async generateText(): Promise<GenerateTextResult> {
      throw new Error('generateText should not be called by planFromPrompt — it streams');
    },
    async *streamText(request: GenerateTextRequest): AsyncIterable<StreamTextChunk> {
      opts?.requests?.push(request);

      const mid = Math.floor(responseText.length / 2);
      const parts = [responseText.slice(0, mid), responseText.slice(mid)];

      for (const part of parts) {
        yield { type: 'text-delta', text: part };
      }

      yield {
        type: 'done',
        result: {
          text: responseText,
          model: 'stub-model',
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 10 },
        },
      };
    },
  };
}

describe('planFromPrompt', () => {
  it('produces a plan that reflects the input prompt, not a hardcoded stub', async () => {
    const prompt = 'Add a CSV export button to the reports dashboard';
    const modelResponse = JSON.stringify({
      steps: [
        { role: 'backend', description: 'Add a /reports/export endpoint that streams a CSV of report rows' },
        { role: 'frontend', description: 'Add an "Export CSV" button to the reports dashboard that calls it' },
      ],
      rationale: 'Adds CSV export to the reports dashboard as requested, split across the API and UI layers.',
    });

    const requests: GenerateTextRequest[] = [];
    const provider = stubProvider(modelResponse, { requests });

    const plan = await planFromPrompt(prompt, provider);

    // The request sent to the model actually carries the user's prompt and
    // the working-agent role (Sonnet, per CLAUDE.md), not a hardcoded literal.
    expect(requests).toHaveLength(1);
    expect(requests[0].role).toBe('agent');
    expect(requests[0].messages).toEqual([{ role: 'user', content: prompt }]);

    // The returned plan reflects the (mocked) model's response, not a fixed
    // stub plan — this is the actual regression guard for #3.
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toEqual({
      role: 'backend',
      description: 'Add a /reports/export endpoint that streams a CSV of report rows',
    });
    expect(plan.steps[1].role).toBe('frontend');
    expect(plan.rationale).toContain('CSV export');
    expect(plan.rationale).toContain('reports dashboard');
  });

  it('produces a different plan for a different prompt using the same provider', async () => {
    const provider: ModelProvider = {
      name: 'stub',
      async generateText(): Promise<GenerateTextResult> {
        throw new Error('generateText should not be called by planFromPrompt — it streams');
      },
      async *streamText(request: GenerateTextRequest): AsyncIterable<StreamTextChunk> {
        // Echoes the prompt back into the plan so this test can assert the
        // two calls below produced genuinely different plans.
        const userPrompt = request.messages[request.messages.length - 1]?.content ?? '';
        const text = JSON.stringify({
          steps: [{ role: 'fullstack', description: `Implement: ${userPrompt}` }],
          rationale: `Plan for "${userPrompt}"`,
        });
        yield { type: 'text-delta', text };
        yield {
          type: 'done',
          result: { text, model: 'stub-model', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
        };
      },
    };

    const planA = await planFromPrompt('Build a login page', provider);
    const planB = await planFromPrompt('Build a settings page', provider);

    expect(planA.steps[0].description).toContain('Build a login page');
    expect(planB.steps[0].description).toContain('Build a settings page');
    expect(planA).not.toEqual(planB);
  });

  it('strips a markdown code fence around the JSON if the model adds one anyway', async () => {
    const fenced = [
      '```json',
      JSON.stringify({ steps: [{ role: 'backend', description: 'do the thing' }], rationale: 'because' }),
      '```',
    ].join('\n');

    const provider = stubProvider(fenced);
    const plan = await planFromPrompt('do the thing', provider);

    expect(plan.steps).toEqual([{ role: 'backend', description: 'do the thing' }]);
    expect(plan.rationale).toBe('because');
  });

  it('throws a descriptive error when the model response is not valid JSON', async () => {
    const provider = stubProvider('sorry, I cannot help with that');
    await expect(planFromPrompt('anything', provider)).rejects.toThrow(/not valid JSON/);
  });

  it('throws a descriptive error when the JSON does not match the Plan shape', async () => {
    const provider = stubProvider(JSON.stringify({ hello: 'world' }));
    await expect(planFromPrompt('anything', provider)).rejects.toThrow(/expected Plan shape/);
  });

  it('rejects a response whose steps array is empty', async () => {
    const provider = stubProvider(JSON.stringify({ steps: [], rationale: 'nothing to do' }));
    await expect(planFromPrompt('anything', provider)).rejects.toThrow(/expected Plan shape/);
  });

  it('invokes onChunk with the accumulated text as each text-delta chunk arrives', async () => {
    const modelResponse = JSON.stringify({
      steps: [{ role: 'backend', description: 'build the thing' }],
      rationale: 'because the prompt asked for it',
    });
    const provider = stubProvider(modelResponse);

    const seen: string[] = [];
    const plan = await planFromPrompt('anything', provider, (accumulatedText) => {
      seen.push(accumulatedText);
    });

    // stubProvider splits the response into exactly two text-delta chunks
    // (see its own comment above), so onChunk must fire exactly twice: once
    // with the first half, once with the full accumulated text.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(modelResponse.slice(0, Math.floor(modelResponse.length / 2)));
    expect(seen[1]).toBe(modelResponse);
    expect(plan.steps[0].description).toBe('build the thing');
  });

  it('awaits an async onChunk before requesting the next chunk', async () => {
    const modelResponse = JSON.stringify({
      steps: [{ role: 'backend', description: 'x' }],
      rationale: 'y',
    });
    const provider = stubProvider(modelResponse);

    const order: string[] = [];
    await planFromPrompt('anything', provider, async (accumulatedText) => {
      order.push(`onChunk-start:${accumulatedText.length}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      order.push(`onChunk-end:${accumulatedText.length}`);
    });

    // Each onChunk call fully resolves before the next one starts — proves
    // planFromPrompt awaits the callback rather than firing it fire-and-forget.
    expect(order).toEqual([
      'onChunk-start:' + Math.floor(modelResponse.length / 2),
      'onChunk-end:' + Math.floor(modelResponse.length / 2),
      'onChunk-start:' + modelResponse.length,
      'onChunk-end:' + modelResponse.length,
    ]);
  });

  it('does not require ANTHROPIC_API_KEY when an explicit provider is supplied', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const provider = stubProvider(
        JSON.stringify({ steps: [{ role: 'backend', description: 'x' }], rationale: 'y' }),
      );
      await expect(planFromPrompt('no creds needed', provider)).resolves.toBeDefined();
    } finally {
      if (originalKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = originalKey;
      }
    }
  });
});
