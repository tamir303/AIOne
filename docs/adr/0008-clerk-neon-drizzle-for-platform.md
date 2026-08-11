# 0008 — Platform auth and database: Clerk + Neon Postgres + Drizzle

- **Status:** Accepted
- **Date:** 2026-08-11
- **Spec reference:** §11 (Tech stack), §14 (Supabase lock-in / R7)
- **Affects:** docs/tech-stack.md, packages/db/

## Context

The platform (AIOne itself) needs its own database, separate from the generated-app databases (which use Supabase). This separation is critical while R7 (Supabase lock-in) is open — if the answer turns out to be "generated apps must stay portable to any Postgres," the platform database must not block that decision.

Three layers need wiring:

1. **Auth** — users signing into AIOne
2. **Platform database** — Workspace, Project, Session, Run, Approval, Deployment
3. **Migrations** — schema versioning

The choice stacks all three together.

## Decision

**Clerk + Neon + Drizzle:**

- **Clerk** for platform auth. OAuth provider (GitHub, Google, email) + session management. Keeps users' credentials out of our database.
- **Neon Postgres** for the platform database. Serverless Postgres with a connection pooler. No ops overhead locally (runs in Docker Compose) or in production.
- **Drizzle** for schema and migrations. Type-safe queries, checked-in migrations (not push-based), good DX.

This keeps the platform's database completely separate from Supabase, which is reserved for provisioning generated apps. The two are never confused.

## Alternatives rejected

**Supabase for both.** One vendor, one dashboard, one SDK story. Clerk signs in, Supabase holds everything. Rejected because it deepens the lock-in risk documented in R7 — if generated apps must stay portable later, the platform database choice (Supabase-specific auth, RLS policies, client libraries) blocks that decision.

**Auth.js + AWS RDS + Prisma.** Finer control over auth, production-grade database. Rejected for v1 because:
- Auth.js requires more wiring (session storage, provider setup) than Clerk's turnkey solution.
- AWS RDS + production Postgres is overkill for v1 single-user load.
- Prisma has excellent DX but its migrations are less portable than Drizzle's SQL files.

**Supabase auth + plain Postgres + Drizzle.** Compromise: Supabase's auth, plain Postgres for the schema. Rejected because it splits the auth layer from the data layer — when Supabase issues come up, the separation makes debugging harder. Clerk bundles auth + session, which is cleaner.

## Consequences

**Accepted costs.** Clerk pricing (free tier covers development and small scale; pay-as-you-go after). Neon pricing (same — free for dev, pay for production). Two more third-party dependencies. If Clerk or Neon becomes unmaintainable, migration is non-trivial (Postgres data export is easy; Clerk→Auth.js/another provider is wiring).

**What this enables.** The platform database is now truly independent of the generated-app database. If R7's answer turns out to be "portable to any Postgres," we're not blocked. Checked-in Drizzle migrations let every agent review schema changes. Clerk's turnkey auth means no session bugs.

**What would reverse this.** Clerk pricing becoming prohibitive (v1 is single-user; price increases matter more then), or Neon having persistent reliability issues. Either would push toward Auth.js + self-hosted Postgres. But for initial development, this stack is right.
