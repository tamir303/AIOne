import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock only the getAuth boundary, per issue #18 — not the whole auth
// middleware. clerkMiddleware() itself is faked as a no-op pass-through
// (it would otherwise throw "Missing Secret Key" without a real
// CLERK_SECRET_KEY, and would otherwise try a real handshake against
// Clerk's API, which sandboxed test runs shouldn't need network access
// for). getAuth() is a vi.fn() each test drives directly, exercising
// exactly the boundary workspaces.ts itself checks:
// `const { userId } = getAuth(c)`.
const { getAuth } = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('@clerk/hono', () => ({
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  getAuth,
}));

// Static imports, not dynamic — vitest.setup.ts has already set
// process.env.DATABASE_URL to the owner/migration role by the time this
// module's imports run (setupFiles execute before a test file's own code,
// including its top-level imports), so app.js's transitive @aione/db
// import connects with full CRUD rights. See vitest.setup.ts for why the
// ordering matters.
import app from '../app.js';
import { db, workspaces, projects } from '@aione/db';
import { eq } from 'drizzle-orm';

function authAs(userId: string | null) {
  getAuth.mockReturnValue({ userId });
}

// Real DB via #14's harness (owner/migration role) — not mocked. Cleared
// before each test rather than after, so a failed test's leftover rows
// don't get silently wiped and are still inspectable if a run is stopped
// mid-suite.
async function cleanDb() {
  // projects.workspaceId references workspaces.id — delete children first.
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

async function createWorkspace(userId: string, name: string) {
  authAs(userId);
  const res = await app.request('/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

describe('workspaces & projects handlers', () => {
  describe('auth', () => {
    it('returns 401 for GET /workspaces with no authenticated user', async () => {
      const res = await app.request('/workspaces');
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /workspaces with no authenticated user', async () => {
      const res = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'nope' }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /workspaces/:id/projects with no authenticated user', async () => {
      const res = await app.request('/workspaces/does-not-matter/projects');
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /projects with no authenticated user', async () => {
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'does-not-matter', name: 'nope' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('workspace create + list', () => {
    it('creates a workspace and lists it back for the owning user', async () => {
      authAs('user_1');

      const createRes = await app.request('/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'My Workspace' }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.name).toBe('My Workspace');
      expect(created.userId).toBe('user_1');
      expect(created.id).toBeDefined();

      const listRes = await app.request('/workspaces');
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].name).toBe('My Workspace');
    });
  });

  describe('project create + list', () => {
    it('creates a project under a workspace and lists it back', async () => {
      const workspace = await createWorkspace('user_1', 'WS');

      authAs('user_1');
      const createRes = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, name: 'My Project' }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.name).toBe('My Project');
      expect(created.workspaceId).toBe(workspace.id);

      const listRes = await app.request(`/workspaces/${workspace.id}/projects`);
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].name).toBe('My Project');
    });
  });

  describe('cross-tenant isolation', () => {
    it("a second user's workspace list never contains the first user's workspace", async () => {
      await createWorkspace('user_1', 'Owner WS');

      authAs('user_2');
      const res = await app.request('/workspaces');
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(0);
    });

    it("returns 404 (not the owner's data) when a second user requests the first user's workspace's projects", async () => {
      const workspace = await createWorkspace('user_1', 'Owner WS');

      authAs('user_2');
      const res = await app.request(`/workspaces/${workspace.id}/projects`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: 'Not found' });
    });

    it("returns 404 when a second user tries to create a project under the first user's workspace", async () => {
      const workspace = await createWorkspace('user_1', 'Owner WS');

      authAs('user_2');
      const res = await app.request('/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, name: 'Intruder Project' }),
      });
      expect(res.status).toBe(404);

      // Confirm the intruder's request didn't actually create anything.
      const rows = await db.select().from(projects).where(eq(projects.workspaceId, workspace.id));
      expect(rows).toHaveLength(0);
    });

    it("returns 404 for a nonexistent workspace id, same as another user's workspace", async () => {
      authAs('user_1');
      const res = await app.request(
        '/workspaces/00000000-0000-0000-0000-000000000000/projects'
      );
      expect(res.status).toBe(404);
    });
  });
});
