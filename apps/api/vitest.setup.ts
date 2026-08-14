// Runs once per test file, before that file's own top-level (static)
// imports are evaluated — see https://vitest.dev/config/#setupfiles.
//
// workspaces.test.ts needs process.env.DATABASE_URL pointed at the
// full-CRUD owner/migration role *before* it statically imports
// ../app.js, which transitively imports @aione/db's module-level
// `postgres(connectionString)` client. Setting the env var inside the
// test file itself would be too late: static imports are hoisted above
// any code in the same module, so the db client would already have been
// constructed against whatever DATABASE_URL happened to be (in CI, the
// restricted aione_app role — see packages/db/src/set-app-role-password.ts)
// before the assignment ever ran.
//
// Issue #18 is testing workspace/project CRUD and cross-tenant isolation,
// not the aione_app role's own restrictions (that's #16/#17's job), so
// using the owner role here is deliberate, not a workaround. The fallback
// matches the same local-dev default used by packages/db/src/migrate.ts,
// drizzle.config.ts, and set-app-role-password.ts.
process.env.DATABASE_URL =
  process.env.DATABASE_MIGRATION_URL || 'postgres://aione:password@localhost:5432/aione';
