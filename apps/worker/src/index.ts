import 'dotenv/config';
import { createLogger } from '@aione/utils';

const logger = createLogger('worker');

async function main() {
  logger.info('worker starting');

  // Stub: in Phase 2+, this polls for Runs from the database and calls
  // processRun() from ./run-loop for each one that needs work.
  // For now, just log that it started.
  logger.info('worker ready');

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  logger.error('worker crashed', error);
  process.exit(1);
});
