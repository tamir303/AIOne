import { Plan } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('orchestrator');

/**
 * Stub orchestrator for the vertical slice. Replaced in Phase 2 by the real
 * agent that turns a prompt into a reviewable Plan via the model provider
 * abstraction (never a direct `@anthropic-ai/sdk` import — see CLAUDE.md).
 *
 * No sandbox execution is dispatched from here yet (Phase 1/3 land the real
 * lane adapters). When a lane is wired in, it MUST resolve and enforce an
 * egress policy before letting sandboxed code reach the network — see
 * `./egress.ts` for that seam and why it exists ahead of the lanes
 * themselves.
 */
export async function planFromPrompt(prompt: string): Promise<Plan> {
  logger.info('planning', { promptLength: prompt.length });

  // Stub: return a fake plan
  return {
    steps: [
      {
        role: 'backend',
        description: 'Create an API endpoint for the new feature',
      },
      {
        role: 'frontend',
        description: 'Add UI components to call the endpoint',
      },
    ],
    rationale: 'This is a stub plan from the vertical slice.',
  };
}
