import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Same auth-boundary mock as workspaces.test.ts (#18) — only getAuth() is a
// vi.fn() the tests drive directly; clerkMiddleware() itself is a no-op
// pass-through so it doesn't need a real CLERK_SECRET_KEY or network access.
const { getAuth } = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/hono', () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  getAuth,
}));

// Static imports — vitest.setup.ts has already pointed process.env.DATABASE_URL
// at the owner/migration role before this module's top-level imports run.
import app from '../app.js';
import { db, workspaces, projects, sessions, projectFiles } from '@aione/db';
import { eq } from 'drizzle-orm';

function authAs(userId: string | null) {
  getAuth.mockReturnValue({ userId });
}

// Cleared before each test (not after), same reasoning as workspaces.test.ts:
// a failed test's leftover rows stay inspectable if a run is stopped
// mid-suite. Children before parents: project_files and sessions both
// reference projects.
async function cleanDb() {
  await db.delete(projectFiles);
  await db.delete(sessions);
  await db.delete(projects);
  await db.delete(workspaces);
}

beforeEach(async () => {
  await cleanDb();
  authAs(null);
});

afterAll(async () => {
  await cleanDb();
});

async function createWorkspaceAndProject(userId: string) {
  authAs(userId);
  const wsRes = await app.request('/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'WS' }),
  });
  const workspace = await wsRes.json();

  const projectRes = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: workspace.id, name: 'Project' }),
  });
  return projectRes.json();
}

async function createFile(userId: string, projectId: string, path: string, content = '') {
  authAs(userId);
  const res = await app.request(`/projects/${projectId}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  return res;
}

describe('project files handlers', () => {
  describe('auth', () => {
    it('returns 401 for GET /projects/:id/files with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files');
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /projects/:id/files/content with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files/content?path=a.ts');
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /projects/:id/files with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'a.ts', content: '' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for PUT /projects/:id/files/content with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files/content?path=a.ts', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for PATCH /projects/:id/files/move with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files/move', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: 'a.ts', toPath: 'b.ts' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for DELETE /projects/:id/files/content with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files/content?path=a.ts&confirm=true', {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /projects/:id/files/restore with no authenticated user', async () => {
      const res = await app.request('/projects/does-not-matter/files/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'a.ts' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('create + read + list', () => {
    it('creates a file, reads it back by path, and lists it in the tree', async () => {
      const project = await createWorkspaceAndProject('user_1');

      authAs('user_1');
      const createRes = await createFile('user_1', project.id, 'src/index.ts', 'console.log(1)');
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.path).toBe('src/index.ts');
      expect(created.content).toBe('console.log(1)');
      expect(created.projectId).toBe(project.id);

      const readRes = await app.request(`/projects/${project.id}/files/content?path=src/index.ts`);
      expect(readRes.status).toBe(200);
      const read = await readRes.json();
      expect(read.id).toBe(created.id);
      expect(read.content).toBe('console.log(1)');

      const listRes = await app.request(`/projects/${project.id}/files`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list).toHaveLength(1);
      expect(list[0].path).toBe('src/index.ts');
      // Tree listing omits content by design.
      expect(list[0].content).toBeUndefined();
    });

    it('returns 409 creating a second file at the same path', async () => {
      const project = await createWorkspaceAndProject('user_1');
      const first = await createFile('user_1', project.id, 'dup.ts', 'a');
      expect(first.status).toBe(200);

      const second = await createFile('user_1', project.id, 'dup.ts', 'b');
      expect(second.status).toBe(409);
    });

    it('returns 400 for an invalid path (e.g. a ".." segment)', async () => {
      const project = await createWorkspaceAndProject('user_1');
      const res = await createFile('user_1', project.id, '../escape.ts', 'x');
      expect(res.status).toBe(400);
    });

    it('returns 404 reading a nonexistent path', async () => {
      const project = await createWorkspaceAndProject('user_1');
      authAs('user_1');
      const res = await app.request(`/projects/${project.id}/files/content?path=missing.ts`);
      expect(res.status).toBe(404);
    });
  });

  describe('write', () => {
    it('updates an existing file\'s content', async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'v1');

      authAs('user_1');
      const writeRes = await app.request(`/projects/${project.id}/files/content?path=a.ts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'v2' }),
      });
      expect(writeRes.status).toBe(200);
      const written = await writeRes.json();
      expect(written.content).toBe('v2');

      const readRes = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      const read = await readRes.json();
      expect(read.content).toBe('v2');
    });

    it('returns 404 writing to a path that does not exist (write never creates)', async () => {
      const project = await createWorkspaceAndProject('user_1');
      authAs('user_1');
      const res = await app.request(`/projects/${project.id}/files/content?path=nope.ts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('move', () => {
    it('renames a file', async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'old.ts', 'body');

      authAs('user_1');
      const moveRes = await app.request(`/projects/${project.id}/files/move`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: 'old.ts', toPath: 'new.ts' }),
      });
      expect(moveRes.status).toBe(200);
      const moved = await moveRes.json();
      expect(moved.path).toBe('new.ts');
      expect(moved.content).toBe('body');

      const oldRes = await app.request(`/projects/${project.id}/files/content?path=old.ts`);
      expect(oldRes.status).toBe(404);
    });

    it('returns 409 moving onto an existing live path', async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'a');
      await createFile('user_1', project.id, 'b.ts', 'b');

      authAs('user_1');
      const res = await app.request(`/projects/${project.id}/files/move`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: 'a.ts', toPath: 'b.ts' }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe('delete + restore', () => {
    it('returns 400 deleting without confirm=true, and the file is unaffected', async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'x');

      authAs('user_1');
      const res = await app.request(`/projects/${project.id}/files/content?path=a.ts`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(400);

      const readRes = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      expect(readRes.status).toBe(200);
    });

    it('soft-deletes with confirm=true, hides it from list/read, and restore brings it back', async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'keep-me');

      authAs('user_1');
      const delRes = await app.request(`/projects/${project.id}/files/content?path=a.ts&confirm=true`, {
        method: 'DELETE',
      });
      expect(delRes.status).toBe(200);

      const readAfterDelete = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      expect(readAfterDelete.status).toBe(404);

      const listAfterDelete = await app.request(`/projects/${project.id}/files`);
      expect(await listAfterDelete.json()).toHaveLength(0);

      // The row itself still exists (soft delete, not a hard DROP).
      const [row] = await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.id));
      expect(row).toBeDefined();
      expect(row.deletedAt).not.toBeNull();

      const restoreRes = await app.request(`/projects/${project.id}/files/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'a.ts' }),
      });
      expect(restoreRes.status).toBe(200);
      const restored = await restoreRes.json();
      expect(restored.content).toBe('keep-me');
      expect(restored.deletedAt).toBeNull();

      const readAfterRestore = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      expect(readAfterRestore.status).toBe(200);
    });
  });

  describe('Session creation on first manual edit', () => {
    it('creates exactly one Session on the first write and reuses it for later edits', async () => {
      const project = await createWorkspaceAndProject('user_1');

      const before = await db.select().from(sessions).where(eq(sessions.projectId, project.id));
      expect(before).toHaveLength(0);

      await createFile('user_1', project.id, 'a.ts', 'v1');

      const afterFirst = await db.select().from(sessions).where(eq(sessions.projectId, project.id));
      expect(afterFirst).toHaveLength(1);

      authAs('user_1');
      await app.request(`/projects/${project.id}/files/content?path=a.ts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'v2' }),
      });

      const afterSecond = await db.select().from(sessions).where(eq(sessions.projectId, project.id));
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0].id).toBe(afterFirst[0].id);
    });
  });

  describe('cross-tenant isolation', () => {
    it("returns 404 (not 200 with empty data) listing another user's project's files", async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'secret.ts', 'top secret');

      authAs('user_2');
      const res = await app.request(`/projects/${project.id}/files`);
      expect(res.status).toBe(404);
    });

    it("returns 404 reading another user's file, never leaking its content", async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'secret.ts', 'top secret');

      authAs('user_2');
      const res = await app.request(`/projects/${project.id}/files/content?path=secret.ts`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain('top secret');
    });

    it("returns 404 creating a file under another user's project, and nothing is created", async () => {
      const project = await createWorkspaceAndProject('user_1');

      const res = await createFile('user_2', project.id, 'intruder.ts', 'x');
      expect(res.status).toBe(404);

      const rows = await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.id));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 writing to another user's file, and its content is unchanged", async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'original');

      authAs('user_2');
      const res = await app.request(`/projects/${project.id}/files/content?path=a.ts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'tampered' }),
      });
      expect(res.status).toBe(404);

      authAs('user_1');
      const readRes = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      const read = await readRes.json();
      expect(read.content).toBe('original');
    });

    it("returns 404 deleting another user's file, even with confirm=true", async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'original');

      authAs('user_2');
      const res = await app.request(`/projects/${project.id}/files/content?path=a.ts&confirm=true`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(404);

      authAs('user_1');
      const readRes = await app.request(`/projects/${project.id}/files/content?path=a.ts`);
      expect(readRes.status).toBe(200);
    });

    it("returns 404 moving another user's file", async () => {
      const project = await createWorkspaceAndProject('user_1');
      await createFile('user_1', project.id, 'a.ts', 'original');

      authAs('user_2');
      const res = await app.request(`/projects/${project.id}/files/move`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromPath: 'a.ts', toPath: 'b.ts' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for a nonexistent project id, same as another user\'s project', async () => {
      authAs('user_1');
      const res = await app.request('/projects/00000000-0000-0000-0000-000000000000/files');
      expect(res.status).toBe(404);
    });
  });
});
