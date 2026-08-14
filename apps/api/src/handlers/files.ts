import { Hono } from 'hono';
import { getAuth } from '@clerk/hono';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, projects, workspaces, sessions, projectFiles, type Project } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:files');
const router = new Hono();

// Postgres error code for a unique-constraint violation — used to turn a
// racing "create" or "move" into a 409 instead of a generic 500. See
// packages/db/src/schema.round-trip.test.ts for the same pattern applied
// to foreign-key violations (23503).
const UNIQUE_VIOLATION = '23505';

function isPostgresErrorWithCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}

// Ownership check shared by every route below: project -> workspace ->
// Clerk userId, mirroring apps/api/src/handlers/runs.ts and the
// cross-tenant isolation tests added for #18
// (apps/api/src/handlers/workspaces.test.ts). Returns the Project row on
// success, or null if it doesn't exist or isn't owned by this user — both
// cases are reported to the caller as a plain 404, so a cross-tenant probe
// can't distinguish "not found" from "not yours".
async function requireOwnedProject(projectId: string, userId: string): Promise<Project | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return null;
  }

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, project.workspaceId));
  if (!workspace || workspace.userId !== userId) {
    return null;
  }

  return project;
}

// Per docs/data-model.md, a Session is "one continuous working context: a
// vibe request, or a manual editing stretch" — this project has no agent
// yet (ADR 0010 is explicitly Phase 1, pre-agent), so every mutating file
// route below calls this before writing, to make sure the manual-editing
// stretch has a Session to hang off of. Reuses the most recent existing
// Session for the project rather than minting one per call, so a stretch of
// several edits shares a single Session the way docs/data-model.md
// describes, and only actually creates one on the *first* edit.
async function ensureSession(projectId: string): Promise<string> {
  const [existing] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.projectId, projectId))
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await db.insert(sessions).values({ projectId }).returning();
  return created.id;
}

// Normalizes and validates a project-relative file path. Not a filesystem
// operation (this table is rows, not disk — see ADR 0010), but path shape
// still matters: a path with a `..` segment or a leading/trailing slash
// would let two different-looking strings address logically ambiguous
// "files", and would carry filesystem-traversal assumptions into a schema
// that isn't a filesystem. Returns null for anything invalid.
function normalizePath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string') {
    return null;
  }

  const segments = rawPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }

  return segments.join('/');
}

// GET /projects/:projectId/files — list tree. Content is deliberately
// omitted (a tree view doesn't need every file's full body, and this keeps
// the payload small); soft-deleted rows (see projectFiles.deletedAt) are
// excluded, same as every other route in this file.
router.get('/:projectId/files', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  const rows = await db
    .select({
      id: projectFiles.id,
      path: projectFiles.path,
      createdAt: projectFiles.createdAt,
      updatedAt: projectFiles.updatedAt,
    })
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.deletedAt)));

  return c.json(rows);
});

// GET /projects/:projectId/files/content?path=... — read one file's content.
router.get('/:projectId/files/content', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  const path = normalizePath(c.req.query('path'));
  if (!path) {
    return c.json({ error: 'A valid path query parameter is required' }, 400);
  }

  const [file] = await db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path), isNull(projectFiles.deletedAt)));

  if (!file) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json(file);
});

// POST /projects/:projectId/files — create. body: { path, content? }
router.post('/:projectId/files', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const body = await c.req.json();
    const path = normalizePath(body.path);
    if (!path) {
      return c.json({ error: 'A valid path is required' }, 400);
    }
    const content = typeof body.content === 'string' ? body.content : '';

    const sessionId = await ensureSession(projectId);

    logger.info('create file', { userId, projectId, path, sessionId });

    const [file] = await db.insert(projectFiles).values({ projectId, path, content }).returning();
    return c.json(file);
  } catch (error) {
    if (isPostgresErrorWithCode(error, UNIQUE_VIOLATION)) {
      return c.json({ error: 'A file already exists at that path' }, 409);
    }
    logger.error('error creating file', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PUT /projects/:projectId/files/content?path=... — write (update) an
// existing file's content. Deliberately does not create: POST above is the
// only route that inserts a new row, so "write" and "create" stay the two
// distinct operations the ticket asks for instead of collapsing into one
// upsert.
router.put('/:projectId/files/content', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  const path = normalizePath(c.req.query('path'));
  if (!path) {
    return c.json({ error: 'A valid path query parameter is required' }, 400);
  }

  try {
    const body = await c.req.json();
    if (typeof body.content !== 'string') {
      return c.json({ error: 'content (string) is required' }, 400);
    }

    const sessionId = await ensureSession(projectId);
    logger.info('write file', { userId, projectId, path, sessionId });

    const [file] = await db
      .update(projectFiles)
      .set({ content: body.content, updatedAt: new Date() })
      .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path), isNull(projectFiles.deletedAt)))
      .returning();

    if (!file) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(file);
  } catch (error) {
    logger.error('error writing file', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// PATCH /projects/:projectId/files/move — rename/move.
// body: { fromPath, toPath }
router.patch('/:projectId/files/move', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const body = await c.req.json();
    const fromPath = normalizePath(body.fromPath);
    const toPath = normalizePath(body.toPath);
    if (!fromPath || !toPath) {
      return c.json({ error: 'Valid fromPath and toPath are required' }, 400);
    }

    const sessionId = await ensureSession(projectId);
    logger.info('move file', { userId, projectId, fromPath, toPath, sessionId });

    const [file] = await db
      .update(projectFiles)
      .set({ path: toPath, updatedAt: new Date() })
      .where(
        and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, fromPath), isNull(projectFiles.deletedAt))
      )
      .returning();

    if (!file) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(file);
  } catch (error) {
    if (isPostgresErrorWithCode(error, UNIQUE_VIOLATION)) {
      return c.json({ error: 'A file already exists at that path' }, 409);
    }
    logger.error('error moving file', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// DELETE /projects/:projectId/files/content?path=...&confirm=true
//
// Soft-deletes (sets deletedAt, doesn't drop the row) *and* requires an
// explicit `confirm=true` query parameter — belt-and-suspenders for
// CLAUDE.md rule #1 ("never execute a destructive action without explicit
// confirmation in the current turn"). A DELETE call missing `confirm=true`
// is rejected outright rather than treated as a no-op, so a client can't
// accidentally rely on the confirmation being optional. Paired with
// POST /:projectId/files/restore, which is what makes the soft-delete
// meaningfully reversible rather than just a hidden hard-delete.
router.delete('/:projectId/files/content', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  const path = normalizePath(c.req.query('path'));
  if (!path) {
    return c.json({ error: 'A valid path query parameter is required' }, 400);
  }

  if (c.req.query('confirm') !== 'true') {
    return c.json(
      { error: 'Deleting a file requires confirm=true as an explicit query parameter' },
      400
    );
  }

  const sessionId = await ensureSession(projectId);
  logger.info('delete file', { userId, projectId, path, sessionId });

  const [file] = await db
    .update(projectFiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, path), isNull(projectFiles.deletedAt)))
    .returning();

  if (!file) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ ok: true, id: file.id, path: file.path });
});

// POST /projects/:projectId/files/restore — undo a soft-delete.
// body: { path }
router.post('/:projectId/files/restore', async (c) => {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const projectId = c.req.param('projectId');
  const project = await requireOwnedProject(projectId, userId);
  if (!project) {
    return c.json({ error: 'Not found' }, 404);
  }

  try {
    const body = await c.req.json();
    const path = normalizePath(body.path);
    if (!path) {
      return c.json({ error: 'A valid path is required' }, 400);
    }

    const sessionId = await ensureSession(projectId);
    logger.info('restore file', { userId, projectId, path, sessionId });

    // The unique (project_id, path) index is partial — scoped to live rows
    // only (see schema.ts) — so more than one soft-deleted row can share a
    // path if a file was deleted, re-created, and deleted again. Restore
    // the most recently deleted one, not an arbitrary one.
    const [deletedFile] = await db
      .select({ id: projectFiles.id })
      .from(projectFiles)
      .where(
        and(
          eq(projectFiles.projectId, projectId),
          eq(projectFiles.path, path),
          isNotNull(projectFiles.deletedAt)
        )
      )
      .orderBy(desc(projectFiles.deletedAt))
      .limit(1);

    if (!deletedFile) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [file] = await db
      .update(projectFiles)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(projectFiles.id, deletedFile.id))
      .returning();

    return c.json(file);
  } catch (error) {
    if (isPostgresErrorWithCode(error, UNIQUE_VIOLATION)) {
      return c.json({ error: 'A live file already exists at that path' }, 409);
    }
    logger.error('error restoring file', error instanceof Error ? error : { error: String(error) });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default router;
