import { Hono } from 'hono';
import { getAuth } from '@clerk/hono';
import { eq } from 'drizzle-orm';
import { db, runs, sessions, projects, workspaces } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:runs');
const router = new Hono();

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
      })
      .returning();

    return c.json(run);
  } catch (error) {
    logger.error('error in create run', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
