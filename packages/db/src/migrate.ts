import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Loaded from the repo root regardless of cwd, so `.env` stays the single
// source of truth documented in the root .env.example.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_MIGRATION_URL ||
  'postgres://aione:password@localhost:5432/aione';

const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

await migrate(db, { migrationsFolder: './drizzle', migrationsTable: '__drizzle_migrations' });
await migrationClient.end();
