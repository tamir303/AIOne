import { Hono } from 'hono';
import { db, runs, sessions, projects, workspaces } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:runs');
const router = new Hono();

// Vertical-slice stub: there is no real auth/session-creation flow yet, so
// we find-or-create a single stub workspace -> project -> session chain and
// reuse its sessionId for every demo run. runs.sessionId has a NOT NULL FK
// to sessions.id, so a bare random UUID would violate the constraint.
let stubSessionId: string | null = null;

async function ensureStubSession(): Promise<string> {
  if (stubSessionId) {
    return stubSessionId;
  }

  const [existingSession] = await db.select().from(sessions).limit(1);
  if (existingSession) {
    stubSessionId = existingSession.id;
    return stubSessionId;
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({ userId: 'stub-user', name: 'Stub Workspace' })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({ workspaceId: workspace.id, name: 'Stub Project' })
    .returning();

  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id })
    .returning();

  stubSessionId = session.id;
  return stubSessionId;
}

// POST /runs
router.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { prompt } = body;

    logger.info('submit prompt', { prompt });

    const sessionId = await ensureStubSession();

    const [run] = await db
      .insert(runs)
      .values({
        sessionId,
        agent: 'orchestrator',
        status: 'planning',
      })
      .returning();

    return c.json(run);
  } catch (error) {
    logger.error('error in create run', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
