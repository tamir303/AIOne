import { Plan } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('orchestrator');

/**
 * Stub orchestrator for the vertical slice. Replaced in Phase 2 by the real
 * agent that turns a prompt into a reviewable Plan via the model provider
 * abstraction (never a direct `@anthropic-ai/sdk` import — see CLAUDE.md).
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
