import { describe, expect, it } from 'vitest';
import type {
  GenerateTextRequest,
  GenerateTextResult,
  ModelProvider,
  Plan,
  StreamTextChunk,
} from '@aione/core';
import { diffFromPlan } from './diff.js';

/**
 * A stub `ModelProvider` — no live credentials, no network access.
 * `diffFromPlan` uses `generateText` (not streaming), unlike
 * `planFromPrompt` — see index.ts.
 */
function stubProvider(responseText: string, opts?: { requests?: GenerateTextRequest[] }): ModelProvider {
  return {
    name: 'stub',
    async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
      opts?.requests?.push(request);
      return {
        text: responseText,
        model: 'stub-model',
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 10 },
      };
    },
    streamText(): AsyncIterable<StreamTextChunk> {
      throw new Error('streamText should not be called by diffFromPlan — it uses generateText');
    },
  };
}

describe('diffFromPlan', () => {
  it('produces a diff that reflects the input plan, not a hardcoded stub', async () => {
    const plan: Plan = {
      steps: [
        { role: 'backend', description: 'Add a /reports/export endpoint that streams a CSV of report rows' },
        { role: 'frontend', description: 'Add an "Export CSV" button to the reports dashboard that calls it' },
      ],
      rationale: 'Adds CSV export to the reports dashboard as requested, split across the API and UI layers.',
    };

    const modelResponse = JSON.stringify({
      files: [
        { path: 'api/routes/reports/export.ts', added: 42, removed: 0 },
        { path: 'components/ExportCsvButton.tsx', added: 28, removed: 0 },
      ],
      summary: 'Adds a CSV export endpoint and a dashboard button that calls it.',
    });

    const requests: GenerateTextRequest[] = [];
    const provider = stubProvider(modelResponse, { requests });

    const diff = await diffFromPlan(plan, provider);

    // The request sent to the model actually carries the approved plan and
    // the working-agent role (Sonnet, per CLAUDE.md), not a hardcoded literal.
    expect(requests).toHaveLength(1);
    expect(requests[0].role).toBe('agent');
    expect(requests[0].messages).toEqual([{ role: 'user', content: JSON.stringify(plan) }]);

    // The returned diff reflects the (mocked) model's response, not the old
    // fixed two-file stub — this is the actual regression guard for #4.
    expect(diff.files).toHaveLength(2);
    expect(diff.files[0]).toEqual({ path: 'api/routes/reports/export.ts', added: 42, removed: 0 });
    expect(diff.files[1]).toEqual({ path: 'components/ExportCsvButton.tsx', added: 28, removed: 0 });
    expect(diff.summary).toContain('CSV export');
  });

  it('produces a different diff for a different plan using the same provider', async () => {
    const provider: ModelProvider = {
      name: 'stub',
      async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
        const parsedPlan = JSON.parse(request.messages[0].content) as Plan;
        return {
          text: JSON.stringify({
            files: parsedPlan.steps.map((step, i) => ({
              path: `generated/${step.role}-${i}.ts`,
              added: (i + 1) * 5,
              removed: 0,
            })),
            summary: `Diff for: ${parsedPlan.rationale}`,
          }),
          model: 'stub-model',
          stopReason: 'end_turn',
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      },
      streamText(): AsyncIterable<StreamTextChunk> {
        throw new Error('streamText should not be called by diffFromPlan');
      },
    };

    const planA: Plan = {
      steps: [{ role: 'backend', description: 'Do backend thing A' }],
      rationale: 'Rationale A',
    };
    const planB: Plan = {
      steps: [
        { role: 'backend', description: 'Do backend thing B' },
        { role: 'frontend', description: 'Do frontend thing B' },
      ],
      rationale: 'Rationale B',
    };

    const diffA = await diffFromPlan(planA, provider);
    const diffB = await diffFromPlan(planB, provider);

    expect(diffA.files).toHaveLength(1);
    expect(diffA.summary).toBe('Diff for: Rationale A');

    expect(diffB.files).toHaveLength(2);
    expect(diffB.summary).toBe('Diff for: Rationale B');
  });

  it('strips a ```json code fence if the model wraps its response in one', async () => {
    const plan: Plan = {
      steps: [{ role: 'devops', description: 'Add a Dockerfile' }],
      rationale: 'Containerize the app.',
    };

    const fenced = [
      '```json',
      JSON.stringify({
        files: [{ path: 'Dockerfile', added: 15, removed: 0 }],
        summary: 'Adds a Dockerfile.',
      }),
      '```',
    ].join('\n');

    const diff = await diffFromPlan(plan, stubProvider(fenced));

    expect(diff.files).toEqual([{ path: 'Dockerfile', added: 15, removed: 0 }]);
    expect(diff.summary).toBe('Adds a Dockerfile.');
  });

  it('throws a descriptive error when the model response is not valid JSON', async () => {
    const plan: Plan = { steps: [{ role: 'backend', description: 'x' }], rationale: 'x' };

    await expect(diffFromPlan(plan, stubProvider('not json at all'))).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('throws a descriptive error when the model response does not match the Diff shape', async () => {
    const plan: Plan = { steps: [{ role: 'backend', description: 'x' }], rationale: 'x' };

    await expect(
      diffFromPlan(plan, stubProvider(JSON.stringify({ files: [], summary: 'empty' }))),
    ).rejects.toThrow(/expected Diff shape/);

    await expect(
      diffFromPlan(plan, stubProvider(JSON.stringify({ summary: 'missing files entirely' }))),
    ).rejects.toThrow(/expected Diff shape/);
  });
});
