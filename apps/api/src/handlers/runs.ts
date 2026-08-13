import { Hono } from 'hono';
import { getAuth } from '@clerk/hono';
import { createTextStreamResponse } from 'ai';
import { eq } from 'drizzle-orm';
import { db, runs, sessions, projects, workspaces } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:runs');
const router = new Hono();

// How often /plan-stream re-checks the Run row for new draft text, and how
// long a single connection is allowed to stay open before the client (see
// apps/web's useCompletion-based PlanStream component) has to retry. Plan
// generation is a single bounded model call, not an indefinite gate wait —
// unlike /events/:runId, this has a hard ceiling well under a typical
// request timeout.
const PLAN_STREAM_POLL_INTERVAL_MS = 300;
const PLAN_STREAM_MAX_MS = 120_000;

// POST /runs — body: { prompt: string, projectId: string }. Creates a new
// Session under the caller's project, then a Run under that Session.
router.post('/', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const { prompt, projectId } = body;

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId));
    if (!workspace || workspace.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    logger.info('submit prompt', { userId, projectId, prompt });

    const [session] = await db.insert(sessions).values({ projectId }).returning();

    const [run] = await db
      .insert(runs)
      .values({
        sessionId: session.id,
        agent: 'orchestrator',
        status: 'planning',
        prompt: typeof prompt === 'string' ? prompt : '',
      })
      .returning();

    return c.json(run);
  } catch (error) {
    logger.error('error in create run', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /runs/:runId/plan-stream — Vercel AI SDK-native incremental plan
// text, per CLAUDE.md's "Vercel AI SDK for streaming" convention and issue
// #3. Consumed by apps/web's PlanStream component via `useCompletion` from
// `@ai-sdk/react` with `streamProtocol: 'text'`, which itself POSTs a JSON
// `{ prompt }` body — the body is ignored here, since the real prompt was
// already persisted at Run-creation time and the run is looked up by :runId.
//
// This endpoint does not call the model itself. apps/worker/src/
// orchestrator/index.ts (invoked from run-loop.ts's Step 1) remains the
// sole place a plan is generated — a live request/response cycle is a poor
// fit for a step nobody may be listening to (the same reason the worker is
// its own process rather than living in this API — see the pinned "Runs
// block on approval gates for minutes" stack decision). Instead, this polls
// `runs.plan_draft_text`, which Step 1 writes incrementally as the model
// streams, and relays each new increment as a real text-stream chunk via
// `createTextStreamResponse` — a genuine Vercel AI SDK response, not a
// bespoke event shape the frontend has to special-case.
router.post('/:runId/plan-stream', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const runId = c.req.param('runId');

  const [owned] = await db
    .select({ runId: runs.id, ownerId: workspaces.userId })
    .from(runs)
    .innerJoin(sessions, eq(runs.sessionId, sessions.id))
    .innerJoin(projects, eq(sessions.projectId, projects.id))
    .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(eq(runs.id, runId));

  if (!owned || owned.ownerId !== userId) {
    return c.json({ error: 'Not found' }, 404);
  }

  logger.info('plan-stream connected', { runId });

  const stream = new ReadableStream<string>({
    async start(controller) {
      let lastLength = 0;
      const startedAt = Date.now();

      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const [run] = await db
            .select({ planDraftText: runs.planDraftText, plan: runs.plan, status: runs.status })
            .from(runs)
            .where(eq(runs.id, runId));

          if (!run) {
            break;
          }

          const text = run.planDraftText ?? '';
          if (text.length > lastLength) {
            controller.enqueue(text.slice(lastLength));
            lastLength = text.length;
          }

          // Once `plan` lands (or the Run leaves 'planning' without one,
          // e.g. it failed) nothing further will ever be written to
          // plan_draft_text for this run — stop polling rather than hold
          // the connection open for no reason.
          if (run.plan || run.status !== 'planning') {
            break;
          }

          if (Date.now() - startedAt >= PLAN_STREAM_MAX_MS) {
            logger.warn('plan-stream exceeded max duration, closing', { runId });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, PLAN_STREAM_POLL_INTERVAL_MS));
        }
      } catch (error) {
        logger.error('plan-stream error', error instanceof Error ? error : { error: String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return createTextStreamResponse({ stream });
});

export default router;
