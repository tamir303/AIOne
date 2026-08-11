import { ActionClass, classifyAction } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('gate:classifier');

export function classifyActionSafely(action: {
  type: string;
  command?: string;
  details?: Record<string, any>;
}): ActionClass {
  try {
    const classified = classifyAction(action);
    logger.debug('classified action', { type: action.type, result: classified });
    return classified;
  } catch (error) {
    // Fail closed: unknown or malformed actions are treated as destructive,
    // which forces confirmation under every trust tier.
    logger.error(
      'error classifying action, defaulting to destructive',
      error instanceof Error ? error : { error: String(error) },
    );
    return 'destructive';
  }
}
