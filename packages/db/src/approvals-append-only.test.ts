import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approvals, projects, runs, sessions, workspaces } from './schema.js';

// -----------------------------------------------------------------------
// Why this test does NOT mock the database
// -----------------------------------------------------------------------
// Migration 0001_sharp_scalphunter.sql grants `aione_app` SELECT/INSERT on
// `approvals` and then REVOKEs UPDATE/DELETE — a guarantee enforced by
// Postgres itself, not by any application-layer check. A mock (or an
// in-memory fake, or a test run against the owner/migration role) cannot
// observe this: it would happily accept an UPDATE or DELETE because the
// mock/owner never had the privilege restriction in the first place, and
// the test would pass while the real production database quietly allows
// tampering with approval records. The only way to prove the REVOKE
// actually blocks writes is to open a real connection authenticated AS
// `aione_app` against a real Postgres instance and attempt the forbidden
// statements — which is exactly what this file does. Simplifying this
// into a mock later would silently delete the one thing this test exists
// to prove.
// -----------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. This test proves a real Postgres-level access ` +
        'control guarantee and cannot run against a mock or a default — ' +
        'set DATABASE_MIGRATION_URL (owner role) and DATABASE_URL ' +
        "(aione_app role) in the environment. See packages/db/src/" +
        'set-app-role-password.ts for the full local-setup steps ' +
        '(migrate, then set-app-password with AIONE_APP_DB_PASSWORD set).'
    );
  }
  return value;
}

// Owner/migration role: full rights, used only to scaffold and tear down
// the workspace -> project -> session -> run chain that `approvals.run_id`
// requires. Never used to exercise the append-only guarantee itself —
// doing so would prove nothing, since the owner role was never restricted.
const migrationConnectionString = requireEnv('DATABASE_MIGRATION_URL');

// Runtime aione_app role: the actual subject of this test. SELECT/INSERT
// on `approvals` should succeed; UPDATE/DELETE should fail at the database
// level with Postgres error code 42501 (insufficient_privilege).
const appConnectionString = requireEnv('DATABASE_URL');

const ownerClient = postgres(migrationConnectionString, { max: 1 });
const ownerDb = drizzle(ownerClient);

const appClient = postgres(appConnectionString, { max: 1 });
const appDb = drizzle(appClient);

describe('approvals table: append-only guarantee enforced for aione_app', () => {
  let runId: string;
  let approvalId: string;

  beforeAll(async () => {
    // Scaffolding only — created via the owner role because aione_app has
    // no INSERT rights on workspaces/projects/sessions/runs in this test's
    // scope (it does, per the migration, but setup shouldn't depend on
    // that; it should depend only on what's actually under test).
    const [workspace] = await ownerDb
      .insert(workspaces)
      .values({ userId: 'test-user-issue-17', name: 'append-only-proof-workspace' })
      .returning();
    const [project] = await ownerDb
      .insert(projects)
      .values({ workspaceId: workspace.id, name: 'append-only-proof-project' })
      .returning();
    const [session] = await ownerDb
      .insert(sessions)
      .values({ projectId: project.id })
      .returning();
    const [run] = await ownerDb
      .insert(runs)
      .values({ sessionId: session.id, agent: 'test-agent', prompt: 'append-only proof' })
      .returning();
    runId = run.id;
  });

  afterAll(async () => {
    // Teardown must go through the owner role: aione_app cannot DELETE
    // from `approvals` (that's the very guarantee under test), and the FK
    // chain has to be unwound child-first regardless of role.
    if (runId) {
      await ownerDb.delete(approvals).where(eq(approvals.runId, runId));
      const [run] = await ownerDb.select({ sessionId: runs.sessionId }).from(runs).where(eq(runs.id, runId));
      await ownerDb.delete(runs).where(eq(runs.id, runId));
      if (run) {
        const [session] = await ownerDb
          .select({ projectId: sessions.projectId })
          .from(sessions)
          .where(eq(sessions.id, run.sessionId));
        await ownerDb.delete(sessions).where(eq(sessions.id, run.sessionId));
        if (session) {
          const [project] = await ownerDb
            .select({ workspaceId: projects.workspaceId })
            .from(projects)
            .where(eq(projects.id, session.projectId));
          await ownerDb.delete(projects).where(eq(projects.id, session.projectId));
          if (project) {
            await ownerDb.delete(workspaces).where(eq(workspaces.id, project.workspaceId));
          }
        }
      }
    }

    await appClient.end();
    await ownerClient.end();
  });

  it('allows aione_app to INSERT into approvals', async () => {
    const [row] = await appDb
      .insert(approvals)
      .values({
        runId,
        gate: 'plan-review',
        actionClass: 'file_write',
        actionSummary: 'append-only proof insert',
        decision: 'approved',
        tier: 'balanced',
      })
      .returning();

    expect(row).toBeDefined();
    expect(row.id).toEqual(expect.any(String));
    approvalId = row.id;
  });

  it('allows aione_app to SELECT from approvals', async () => {
    const rows = await appDb.select().from(approvals).where(eq(approvals.id, approvalId));

    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe('approved');
  });

  it('blocks aione_app UPDATE on approvals with 42501 (insufficient_privilege)', async () => {
    await expect(
      appDb.update(approvals).set({ reason: 'tampered' }).where(eq(approvals.id, approvalId))
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('blocks aione_app DELETE on approvals with 42501 (insufficient_privilege)', async () => {
    await expect(appDb.delete(approvals).where(eq(approvals.id, approvalId))).rejects.toMatchObject({
      code: '42501',
    });
  });
});
