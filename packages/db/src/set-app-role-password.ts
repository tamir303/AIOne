import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Loaded from the repo root regardless of cwd, so `.env` stays the single
// source of truth documented in the root .env.example.
config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import postgres from 'postgres';

// Migration 0001_sharp_scalphunter.sql creates the `aione_app` role but
// deliberately sets no password on it — a password is a secret, and
// secrets never belong in a migration file (CLAUDE.md rule #2). This
// script is the out-of-band step the migration's own comment points to:
// it sets that password from an environment variable, never a literal.
//
// Run this once per fresh database, after migrations, before anything
// tries to connect as `aione_app`:
//
//   pnpm --filter @aione/db migrate              # owner role, creates aione_app
//   pnpm --filter @aione/db set-app-password      # sets aione_app's password
//
// Where AIONE_APP_DB_PASSWORD comes from:
//   - CI (.github/workflows/ci.yml): the `AIONE_APP_DB_PASSWORD` GitHub
//     Actions secret.
//   - Local dev: `.env` at the repo root (gitignored — see root
//     .env.example for the key, never a value).
//
// Connection-string convention downstream tests (see issues #16, #17)
// should rely on:
//   - DATABASE_MIGRATION_URL — the owner/migration role. Full rights,
//     including on `approvals`. Used for schema setup/teardown in tests,
//     never for exercising app-level access control.
//   - DATABASE_URL — the runtime `aione_app` role. SELECT/INSERT/UPDATE/
//     DELETE on most tables; SELECT/INSERT only on `approvals` (UPDATE and
//     DELETE are REVOKEd at the database level). This is the connection
//     string that should be used to prove the append-only guarantee,
//     since the guarantee is meaningless if tested through a role that
//     was never restricted in the first place.
const migrationConnectionString =
  process.env.DATABASE_MIGRATION_URL ||
  'postgres://aione:password@localhost:5432/aione';

const password = process.env.AIONE_APP_DB_PASSWORD;

if (!password) {
  console.error(
    'AIONE_APP_DB_PASSWORD is not set. This script sets the aione_app ' +
      "role's password and needs the value supplied out-of-band (a GitHub " +
      "Actions secret in CI, `.env` locally) — refusing to run rather " +
      'than proceed with no password or a hardcoded one.'
  );
  process.exit(1);
}

const client = postgres(migrationConnectionString, { max: 1 });

// ALTER ROLE ... WITH PASSWORD expects a string literal in the grammar,
// not a bind parameter, so the password is inlined here after escaping
// embedded single quotes the standard SQL way (doubling them). The value
// itself never appears in a repo file — it only ever lives in the
// environment this script reads it from at run time.
const escapedPassword = password.replace(/'/g, "''");
await client.unsafe(`ALTER ROLE aione_app WITH PASSWORD '${escapedPassword}'`);

await client.end();

console.log('aione_app role password set.');
