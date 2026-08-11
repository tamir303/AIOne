-- Runtime role used by apps/api and apps/worker (DATABASE_URL). The
-- migration role (DATABASE_MIGRATION_URL) stays the owner and is never
-- used at request time. No password is set here — that's a secret and
-- never belongs in a migration file; set it out-of-band per environment
-- (ALTER ROLE aione_app WITH PASSWORD '...', run directly against the
-- database, or via Neon's own role-management feature) after this runs.
DO $$ BEGIN
  CREATE ROLE aione_app WITH LOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO aione_app;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  workspaces, projects, sessions, runs, deployments
TO aione_app;
--> statement-breakpoint

-- Approvals is append-only: the app role may read and insert, but the
-- database itself refuses UPDATE and DELETE regardless of what any query
-- built at the application layer attempts.
GRANT SELECT, INSERT ON approvals TO aione_app;
--> statement-breakpoint

REVOKE UPDATE, DELETE ON approvals FROM aione_app;
