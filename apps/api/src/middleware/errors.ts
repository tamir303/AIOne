import { Hono } from 'hono';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:errors');

export function errorMiddleware(app: Hono) {
  app.onError((error, c) => {
    logger.error('unhandled error', error);
    return c.json({ error: 'Internal server error' }, 500);
  });
}
