import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Same convention as schema.round-trip.test.ts: load the repo-root .env
// regardless of cwd.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { projectFiles, projects, workspaces } from './schema.js';

// Owner/migration connection — same reasoning as schema.round-trip.test.ts:
// this proves the schema itself round-trips (FKs, defaults, the partial
// unique index), not what the restricted aione_app role can or can't do.
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

function isPostgresErrorWithCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === code
  );
}

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

describe('project_files round-trip (ADR 0010)', () => {
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    const [workspace] = await db
      .insert(workspaces)
      .values({ userId: `test-user-${randomUUID()}`, name: 'project-files round-trip workspace' })
      .returning();
    workspaceId = workspace.id;

    const [project] = await db
      .insert(projects)
      .values({ workspaceId, name: 'project-files round-trip project' })
      .returning();
    projectId = project.id;
  });

  afterAll(async () => {
    await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await client.end();
  });

  it('persists and reads back a file, applying content/deletedAt defaults and linking to its Project', async () => {
    // Deliberately omit content and deletedAt to prove the schema's
    // declared defaults ('' and null) actually land in the database.
    const [row] = await db.insert(projectFiles).values({ projectId, path: 'src/index.ts' }).returning();

    try {
      expect(row).toBeDefined();
      expect(row.projectId).toBe(projectId);
      expect(row.path).toBe('src/index.ts');
      expect(row.content).toBe('');
      expect(row.deletedAt).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);

      const [reread] = await db.select().from(projectFiles).where(eq(projectFiles.id, row.id));
      expect(reread).toEqual(row);
    } finally {
      await db.delete(projectFiles).where(eq(projectFiles.id, row.id));
    }
  });

  it('rejects a file referencing a nonexistent Project (23503)', async () => {
    const err = await db
      .insert(projectFiles)
      .values({ projectId: randomUUID(), path: 'orphan.ts' })
      .catch((e) => e);
    expect(isPostgresErrorWithCode(err, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  describe('unique (project_id, path) is scoped to live rows', () => {
    it('rejects a second live row at the same (project_id, path)', async () => {
      const [first] = await db
        .insert(projectFiles)
        .values({ projectId, path: 'duplicate.ts', content: 'first' })
        .returning();

      try {
        const err = await db
          .insert(projectFiles)
          .values({ projectId, path: 'duplicate.ts', content: 'second' })
          .catch((e) => e);
        expect(isPostgresErrorWithCode(err, UNIQUE_VIOLATION)).toBe(true);
      } finally {
        await db.delete(projectFiles).where(eq(projectFiles.id, first.id));
      }
    });

    it('allows re-creating a path once the prior row is soft-deleted', async () => {
      const [first] = await db
        .insert(projectFiles)
        .values({ projectId, path: 'recreated.ts', content: 'v1' })
        .returning();

      await db.update(projectFiles).set({ deletedAt: new Date() }).where(eq(projectFiles.id, first.id));

      const [second] = await db
        .insert(projectFiles)
        .values({ projectId, path: 'recreated.ts', content: 'v2' })
        .returning();

      try {
        expect(second.id).not.toBe(first.id);
        expect(second.content).toBe('v2');

        const rows = await db.select().from(projectFiles).where(eq(projectFiles.path, 'recreated.ts'));
        expect(rows).toHaveLength(2);
      } finally {
        await db.delete(projectFiles).where(eq(projectFiles.id, first.id));
        await db.delete(projectFiles).where(eq(projectFiles.id, second.id));
      }
    });
  });
});
