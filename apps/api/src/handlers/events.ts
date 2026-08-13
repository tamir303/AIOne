import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq } from 'drizzle-orm';
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:events');
const router = new Hono();

// How long a single SSE connection stays open before the client (see
// apps/web/src/api.ts's streamRun()) has to reconnect. Bounded rather than
// unbounded so a forgotten tab doesn't hold a DB-polling connection open
// forever.
const MAX_CONNECTION_TICKS = 300;
const POLL_INTERVAL_MS = 1000;

// GET /events/:runId (SSE) — mounted at the top level in index.ts so the
// real path is /events/:runId, matching apps/web/src/api.ts's streamRun().
//
// This is a deliberately minimal "incremental updates" channel, not a
// Vercel AI SDK data stream: the worker (apps/worker) is a separate
// poll-based process (see the pinned stack decision — the worker exists
// specifically because Runs can block on an approval gate for minutes,
// which doesn't fit a request/response HTTP handler), and it writes a
// Run's plan to Postgres in one atomic step per run-loop.ts, not as it's
// generated token-by-token. There is no live, same-process token stream to
// relay to the browser the way Vercel AI SDK's `useCompletion`/`useChat`
// expect from a request-scoped streaming endpoint.
//
// What this *can* honestly do — and what it does below — is poll the Run
// row and push a fresh `run` event to the browser as soon as the worker's
// next DB write lands (e.g. the moment the plan or diff appears), instead
// of only showing the state from when the page first loaded. That's the
// "incremental" guarantee this ticket's scope covers; wiring the literal
// `ai` package end-to-end would require turning plan generation into a
// live per-request streaming endpoint, which is a larger architecture
// change than this ticket (see the PR description).
router.get('/:runId', async (c) => {
  const runId = c.req.param('runId');

  logger.info('sse connected', { runId });

  return streamSSE(
    c,
    async (stream) => {
      let lastSerialized: string | null = null;

      for (let tick = 0; tick < MAX_CONNECTION_TICKS; tick++) {
        // Drizzle requires the eq() helper for .where() — passing a plain
        // object matches nothing and silently returns [].
        const [run] = await db.select().from(runs).where(eq(runs.id, runId));

        if (run) {
          const serialized = JSON.stringify(run);
          if (serialized !== lastSerialized) {
            lastSerialized = serialized;
            await stream.writeSSE({ data: JSON.stringify({ type: 'run', run }) });
          } else {
            await stream.writeSSE({ data: JSON.stringify({ type: 'ping' }) });
          }
        }

        await stream.sleep(POLL_INTERVAL_MS);
      }
    },
    async (error, stream) => {
      logger.error('sse stream error', error);
      await stream.writeSSE({ event: 'error', data: 'Internal server error' });
    },
  );
});

export default router;
