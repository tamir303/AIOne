import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Same convention as migrate.ts / set-app-role-password.ts: load the
// repo-root .env regardless of cwd, so `.env` stays the single source of
// truth documented in the root .env.example.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { approvals, deployments, projects, runs, sessions, workspaces } from './schema.js';

// Owner/migration connection, per packages/db/src/set-app-role-password.ts's
// documented convention: these tests prove the schema itself round-trips
// (FKs, defaults, ON DELETE behavior), not what the restricted aione_app
// role can or can't do — that access-control guarantee belongs to #17's
// tests, which should use DATABASE_URL instead.
const connectionString = process.env.DATABASE_MIGRATION_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_MIGRATION_URL is not set. These tests need a real Postgres ' +
      'instance with migrations applied (`pnpm --filter @aione/db migrate`) ' +
      '— see docker-compose.yml for local setup, or .github/workflows/ci.yml ' +
      'for how CI provisions one.',
  );
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client, { schema });

/**
 * Postgres error shape thrown by the `postgres` client on a constraint
 * violation. Asserting on `.code` (rather than just "it threw") makes sure
 * a foreign-key test is actually failing for the foreign-key reason
 * (`23503`) and not for some unrelated bug in the test's own setup.
 */
function isPostgresErrorWithCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}

const FOREIGN_KEY_VIOLATION = '23503';

describe('schema round-trip: Workspace -> Project -> Session -> Run -> Approval -> Deployment', () => {
  // Populated by the top-level beforeAll and consumed by every describe
  // block below, so there is exactly one real chain of rows in flight at a
  // time (see vitest.config.ts's fileParallelism: false for why that
  // matters against a shared database).
  let workspaceId: string;
  let projectId: string;
  let sessionId: string;
  let runId: string;
  let approvalId: string;
  let deploymentId: string;

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ userId: `test-user-${randomUUID()}`, name: 'Round-trip test workspace' })
      .returning();
    workspaceId = workspace.id;

    // Deliberately omit trustTier to prove the schema's declared default
    // ('balanced') is what actually lands in the database, not just what
    // the TypeScript type says.
    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'Round-trip test project' })
      .returning();
    projectId = project.id;

    const [session] = await db.insert(sessions).values({ projectId }).returning();
    sessionId = session.id;

    // Deliberately omit status, tokensUsed, and prompt to prove their
    // declared defaults ('planning', 0, '').
    const [run] = await db.insert(runs).values({ sessionId, agent: 'planner' }).returning();
    runId = run.id;

    // Deliberately omit reason and decidedAt to prove decidedAt's default
    // (now()).
    const [approval] = await db
      .insert(approvals)
      .values({
        runId,
        gate: 'plan-review',
        actionClass: 'file_write',
        actionSummary: 'Round-trip test approval',
        decision: 'approve',
        tier: 'balanced',
      })
      .returning();
    approvalId = approval.id;

    const [deployment] = await db
      .insert(deployments)
      .values({ runId, environment: 'preview', status: 'pending' })
      .returning();
    deploymentId = deployment.id;
  });

  afterAll(async () => {
    // Children before parents, matching the FK direction (deployments and
    // approvals reference runs; runs reference sessions; sessions
    // reference projects; projects reference workspaces) — the "ON DELETE
    // no action" behavior under test means the database itself would
    // reject this in the wrong order.
    if (deploymentId) await db.delete(deployments).where(eq(deployments.id, deploymentId));
    if (approvalId) await db.delete(approvals).where(eq(approvals.id, approvalId));
    if (runId) await db.delete(runs).where(eq(runs.id, runId));
    if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

    await client.end();
  });

  it('persists and reads back a Workspace with its declared id/createdAt defaults', async () => {
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row).toBeDefined();
    expect(row.userId).toMatch(/^test-user-/);
    expect(row.name).toBe('Round-trip test workspace');
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('persists and reads back a Project, applying the trustTier default and linking to its Workspace', async () => {
    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row).toBeDefined();
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.trustTier).toBe('balanced');
  });

  it('persists and reads back a Session, linking to its Project', async () => {
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row).toBeDefined();
    expect(row.projectId).toBe(projectId);
  });

  it('persists and reads back a Run, applying status/tokensUsed/prompt defaults and linking to its Session', async () => {
    const [row] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(row).toBeDefined();
    expect(row.sessionId).toBe(sessionId);
    expect(row.status).toBe('planning');
    // tokensUsed is a bigint-mode column; its declared default is the SQL
    // expression `0`, not a JS literal (see schema.ts's comment on why),
    // so this also proves that expression form actually round-trips.
    expect(row.tokensUsed).toBe(0n);
    expect(row.prompt).toBe('');
  });

  it('persists and reads back an Approval, applying the decidedAt default and linking to its Run', async () => {
    const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(row).toBeDefined();
    expect(row.runId).toBe(runId);
    expect(row.gate).toBe('plan-review');
    expect(row.decision).toBe('approve');
    expect(row.decidedAt).toBeInstanceOf(Date);
  });

  it('persists and reads back a Deployment, linking to its Run', async () => {
    const [row] = await db.select().from(deployments).where(eq(deployments.id, deploymentId));
    expect(row).toBeDefined();
    expect(row.runId).toBe(runId);
    expect(row.environment).toBe('preview');
    expect(row.status).toBe('pending');
  });

  describe('foreign key constraints reject orphaned inserts', () => {
    it('rejects a Project referencing a nonexistent Workspace', async () => {
      const err = await db
        .insert(projects)
        .values({ workspaceId: randomUUID(), name: 'orphan project' })
        .catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects a Session referencing a nonexistent Project', async () => {
      const err = await db
        .insert(sessions)
        .values({ projectId: randomUUID() })
        .catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects a Run referencing a nonexistent Session', async () => {
      const err = await db
        .insert(runs)
        .values({ sessionId: randomUUID(), agent: 'planner' })
        .catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects an Approval referencing a nonexistent Run', async () => {
      const err = await db
        .insert(approvals)
        .values({
          runId: randomUUID(),
          gate: 'plan-review',
          actionClass: 'file_write',
          actionSummary: 'orphan approval',
          decision: 'approve',
          tier: 'balanced',
        })
        .catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects a Deployment referencing a nonexistent Run', async () => {
      const err = await db
        .insert(deployments)
        .values({ runId: randomUUID(), environment: 'preview', status: 'pending' })
        .catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });
  });

  describe('ON DELETE behavior is "no action", not cascade', () => {
    // 0000_whole_susan_delgado.sql declares every FK as
    // `ON DELETE no action ON UPDATE no action`. If this were ever
    // silently upgraded to CASCADE, these deletes would succeed instead of
    // being rejected, and the referencing child rows built in the
    // top-level beforeAll would vanish out from under this test file's own
    // other assertions.
    it('rejects deleting a Workspace that a Project still references', async () => {
      const err = await db.delete(workspaces).where(eq(workspaces.id, workspaceId)).catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);

      const [stillThere] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      expect(stillThere).toBeDefined();
    });

    it('rejects deleting a Project that a Session still references', async () => {
      const err = await db.delete(projects).where(eq(projects.id, projectId)).catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects deleting a Session that a Run still references', async () => {
      const err = await db.delete(sessions).where(eq(sessions.id, sessionId)).catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
    });

    it('rejects deleting a Run that an Approval or Deployment still references', async () => {
      const err = await db.delete(runs).where(eq(runs.id, runId)).catch((e) => e);
      expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);

      const [stillThere] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(stillThere).toBeDefined();
    });
  });
});
