import { Hono } from 'hono';
import { getAuth } from '@clerk/hono';
import { eq } from 'drizzle-orm';
import { db, workspaces, projects } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:workspaces');
const router = new Hono();

// GET /workspaces — list the signed-in user's workspaces
router.get('/', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const rows = await db.select().from(workspaces).where(eq(workspaces.userId, userId));
  return c.json(rows);
});

// POST /workspaces — create a workspace owned by the signed-in user
router.post('/', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const { name } = body;

    logger.info('create workspace', { userId, name });

    const [workspace] = await db.insert(workspaces).values({ userId, name }).returning();
    return c.json(workspace);
  } catch (error) {
    logger.error('error creating workspace', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /workspaces/:id/projects — list projects under a workspace the
// signed-in user owns
router.get('/:id/projects', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const workspaceId = c.req.param('id');

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!workspace || workspace.userId !== userId) {
    return c.json({ error: 'Not found' }, 404);
  }

  const rows = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
  return c.json(rows);
});

// POST /projects — create a project under a workspace the signed-in user owns
const projectsRouter = new Hono();
projectsRouter.post('/', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const { workspaceId, name } = body;

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!workspace || workspace.userId !== userId) {
      return c.json({ error: 'Not found' }, 404);
    }

    logger.info('create project', { userId, workspaceId, name });

    const [project] = await db.insert(projects).values({ workspaceId, name }).returning();
    return c.json(project);
  } catch (error) {
    logger.error('error creating project', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
export { projectsRouter };
