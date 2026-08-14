CREATE TABLE IF NOT EXISTS "project_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Partial unique index: scoped to live (non-deleted) rows so a soft-deleted
-- row (see project_files.deleted_at) doesn't permanently block re-creating
-- a file at the same path. drizzle-kit 0.20's generator does not emit the
-- WHERE clause from the schema's `.where(sql\`deleted_at is null\`)` builder
-- call, so it's added here by hand to match packages/db/src/schema.ts.
CREATE UNIQUE INDEX IF NOT EXISTS "project_files_project_id_path_unique" ON "project_files" ("project_id","path") WHERE deleted_at is null;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
