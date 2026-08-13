import { Plan } from '@aione/core';
import type { ModelProvider } from '@aione/core';
import { createLogger } from '@aione/utils';
import { getModelProvider } from '../model-provider.js';

const logger = createLogger('orchestrator');

/**
 * Instructs the model to return exactly one JSON object matching `Plan`
 * (see packages/core/src/types.ts) and nothing else. The provider
 * abstraction (packages/core/src/providers/types.ts) returns plain text —
 * there is no structured-output primitive — so the contract is enforced by
 * prompting for it here and validating/parsing the result ourselves.
 */
const PLAN_SYSTEM_PROMPT = `You are the planning step of an AI IDE. Given a user's prompt describing something they want built, produce an implementation plan a human will review and approve before any code is written.

Respond with ONLY a single JSON object — no markdown code fence, no commentary before or after it — of exactly this shape:
{"steps": [{"role": "frontend" | "backend" | "devops" | "fullstack", "description": "..."}], "rationale": "..."}

Rules:
- "steps" must contain at least one entry; each entry is one concrete, actionable unit of work grounded in the user's actual prompt.
- "role" must be one of "frontend", "backend", "devops", or "fullstack" — pick whichever fits each step best.
- "description" must be specific enough that a human reviewer can tell exactly what will be built, referencing the user's request rather than a generic placeholder.
- "rationale" is 1-3 sentences explaining why this plan satisfies the request.
- Output nothing but the JSON object itself.`;

/**
 * Turns a user's prompt into a reviewable `Plan` via the model provider
 * abstraction (never a direct `@anthropic-ai/sdk` import — see CLAUDE.md).
 * Runs at the `'agent'` role, which resolves to Claude Sonnet per CLAUDE.md's
 * "Sonnet for the working agents" convention.
 *
 * `provider` defaults to the worker's real, lazily-constructed
 * `ModelProvider` (see ../model-provider.ts) so production call sites don't
 * need to thread one through; tests pass a stub transport/provider instead
 * of relying on the default, so they never require live credentials or
 * network access.
 *
 * No sandbox execution is dispatched from here (Phase 1/3 land the real
 * lane adapters). When a lane is wired in, it MUST resolve and enforce an
 * egress policy before letting sandboxed code reach the network — see
 * `./egress.ts` for that seam and why it exists ahead of the lanes
 * themselves.
 */
export async function planFromPrompt(
  prompt: string,
  provider: ModelProvider = getModelProvider(),
): Promise<Plan> {
  logger.info('planning', { promptLength: prompt.length });

  // Streamed rather than a single generateText() call: per CLAUDE.md's UI
  // stack convention ("Vercel AI SDK for streaming"), plan generation is
  // meant to be visible to the web UI incrementally rather than only after
  // the full response lands. The worker's poll loop still writes the
  // *finished* plan to the Run row in one shot (run-loop.ts does exactly one
  // DB write per tick — see its top-of-file comment), but consuming the
  // model's streamed chunks here, rather than generateText(), is what lets
  // a live per-request caller (a future direct HTTP endpoint, not this
  // poll-based worker) relay `text-delta` chunks onward as they arrive.
  let text = '';
  for await (const chunk of provider.streamText({
    role: 'agent',
    system: PLAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
    }
  }

  const plan = parsePlan(text);

  logger.info('plan generated', { stepCount: plan.steps.length });

  return plan;
}

function parsePlan(text: string): Plan {
  const jsonText = extractJson(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `planFromPrompt: model response was not valid JSON (${(error as Error).message}): ${truncate(text)}`,
    );
  }

  if (!isPlanShape(parsed)) {
    throw new Error(`planFromPrompt: model response did not match the expected Plan shape: ${truncate(text)}`);
  }

  return parsed;
}

// Models sometimes wrap JSON in a ```json fence despite being told not to;
// strip it defensively rather than fail the whole plan on a formatting slip.
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function isPlanShape(value: unknown): value is Plan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.rationale !== 'string') {
    return false;
  }
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    return false;
  }
  return candidate.steps.every((step) => {
    if (typeof step !== 'object' || step === null) {
      return false;
    }
    const s = step as Record<string, unknown>;
    return typeof s.role === 'string' && typeof s.description === 'string';
  });
}

function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
