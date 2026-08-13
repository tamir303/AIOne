import { createAnthropicProvider, type Diff, type ModelProvider, type Plan } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('orchestrator:diff');

/**
 * Instructs the model to return exactly one JSON object matching `Diff`
 * (see packages/core/src/types.ts) and nothing else. Same contract style as
 * orchestrator/index.ts's plan prompt: the provider abstraction
 * (packages/core/src/providers/types.ts) returns plain text — there is no
 * structured-output primitive — so this is enforced by prompting for it and
 * validating/parsing the result ourselves.
 *
 * The `Diff` shape here is file-level (path + added/removed line counts +
 * a summary), matching what's already on `runs.diff` (packages/db/src/
 * schema.ts) and what apps/web/src/pages/DiffReview.tsx renders today. It
 * is not a shape that carries actual hunk content, so "reviewable per-hunk"
 * currently means "reviewable per-file" in practice — see this module's
 * PR description for why that contract wasn't widened here.
 */
const DIFF_SYSTEM_PROMPT = `You are the diff-generation step of an AI IDE. Given an approved implementation plan, produce a summary of the code changes that would implement it. A human will review this diff before it is applied.

Respond with ONLY a single JSON object — no markdown code fence, no commentary before or after it — of exactly this shape:
{"files": [{"path": "...", "added": 0, "removed": 0}], "summary": "..."}

Rules:
- "files" must contain at least one entry, one per file the plan's steps would create or modify. Use realistic, specific file paths consistent with the plan's roles (e.g. an "api/..." or "server/..." path for a backend step, a "components/..." or "src/..." path for a frontend step).
- "added" and "removed" are the estimated number of lines added/removed in that file. "removed" is 0 for a new file.
- "summary" is 1-3 sentences describing the change set as a whole, grounded in the plan's steps and rationale.
- Output nothing but the JSON object itself.`;

let cachedProvider: ModelProvider | undefined;

/**
 * Lazily constructs (and caches) the worker's real `ModelProvider`.
 *
 * Lazy on purpose: importing this module must never require
 * `ANTHROPIC_API_KEY` to be set just to load — only an actual call that
 * omits an explicit provider needs credentials. Callers that want to avoid
 * live model calls entirely (tests, mainly) pass their own `ModelProvider`
 * to `diffFromPlan` instead of relying on this default.
 */
function getDefaultProvider(): ModelProvider {
  if (!cachedProvider) {
    cachedProvider = createAnthropicProvider();
  }
  return cachedProvider;
}

/**
 * Turns an approved `Plan` into a reviewable `Diff` via the model provider
 * abstraction (never a direct `@anthropic-ai/sdk` import — see CLAUDE.md).
 * Runs at the `'agent'` role, which resolves to Claude Sonnet per CLAUDE.md's
 * "Sonnet for the working agents" convention.
 *
 * `provider` defaults to the worker's real, lazily-constructed
 * `ModelProvider` so production call sites (run-loop.ts's Step 3) don't need
 * to thread one through; tests pass a stub provider instead, so they never
 * require live credentials or network access.
 */
export async function diffFromPlan(
  plan: Plan,
  provider: ModelProvider = getDefaultProvider(),
): Promise<Diff> {
  logger.info('generating diff', { stepCount: plan.steps.length });

  const result = await provider.generateText({
    role: 'agent',
    system: DIFF_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(plan) }],
  });

  const diff = parseDiff(result.text);

  logger.info('diff generated', { fileCount: diff.files.length });

  return diff;
}

function parseDiff(text: string): Diff {
  const jsonText = extractJson(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `diffFromPlan: model response was not valid JSON (${(error as Error).message}): ${truncate(text)}`,
    );
  }

  if (!isDiffShape(parsed)) {
    throw new Error(
      `diffFromPlan: model response did not match the expected Diff shape: ${truncate(text)}`,
    );
  }

  return parsed;
}

// Models sometimes wrap JSON in a ```json fence despite being told not to;
// strip it defensively rather than fail the whole diff on a formatting slip.
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function isDiffShape(value: unknown): value is Diff {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.files) || candidate.files.length === 0) {
    return false;
  }
  return candidate.files.every((file) => {
    if (typeof file !== 'object' || file === null) {
      return false;
    }
    const f = file as Record<string, unknown>;
    return (
      typeof f.path === 'string' &&
      typeof f.added === 'number' &&
      typeof f.removed === 'number'
    );
  });
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
