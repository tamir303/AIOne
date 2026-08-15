import { pgTable, text, timestamp, uuid, varchar, jsonb, integer, bigint, uniqueIndex } from 'drizzle-orm/pg-core';
import { InferSelectModel, sql } from 'drizzle-orm';

// Clerk handles user auth; we only store the user ID
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(), // Clerk user ID
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: varchar('name', { length: 255 }).notNull(),
  trustTier: varchar('trust_tier', { length: 50 }).notNull().default('balanced'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id),
  agent: varchar('agent', { length: 50 }).notNull(),
  // The user's original prompt for this Run. planFromPrompt() (see
  // apps/worker/src/orchestrator/index.ts) needs this to generate a plan
  // that actually reflects what was asked, rather than a hardcoded stub —
  // apps/api/src/handlers/runs.ts writes it at Run-creation time.
  // Default '' (rather than a NOT NULL-only column) so this migration
  // doesn't fail against any pre-existing rows from before this column
  // existed.
  prompt: text('prompt').notNull().default(''),
  // Incremental, in-progress plan text written by run-loop.ts's Step 1 as
  // the model streams its response (see apps/worker/src/orchestrator/
  // index.ts's onChunk callback) — a display-only progress feed, not part
  // of the Run's state machine. apps/api/src/handlers/runs.ts's
  // /:runId/plan-stream endpoint polls this column and relays it to the
  // web UI via Vercel AI SDK's createTextStreamResponse/useCompletion (see
  // issue #3). Cleared back to null once the authoritative `plan` column
  // is written; never read by any gate or state-transition logic.
  planDraftText: text('plan_draft_text'),
  plan: jsonb('plan'),
  diff: jsonb('diff'),
  status: varchar('status', { length: 50 }).notNull().default('planning'),
  // Cost quota: max tokens allowed for this run (null = unlimited)
  costQuotaTokens: bigint('cost_quota_tokens', { mode: 'bigint' }),
  // Tokens used so far in this run (accumulated across model calls)
  // `sql\`0\`` rather than `BigInt(0)`: drizzle-kit's snapshot diffing
  // JSON.stringify()s column defaults, which throws on a raw bigint value.
  // An SQL default expression avoids that while still typing correctly.
  tokensUsed: bigint('tokens_used', { mode: 'bigint' }).notNull().default(sql`0`),
  // Idle timeout: how many minutes a run can wait at a gate (null = no timeout)
  idleTimeoutMinutes: integer('idle_timeout_minutes'),
  // When the run entered a gate-blocked state (awaiting_approval), null if not at gate
  gateEnteredAt: timestamp('gate_entered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// APPEND-ONLY: UPDATE and DELETE are revoked from the app role
export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id),
  // Which review checkpoint this decision belongs to (e.g. 'plan-review',
  // 'diff-review'). actionClass alone can't disambiguate: two different
  // gates in the same Run can share an actionClass (both the plan and the
  // diff gate classify as 'file_write'), and the worker needs to match a
  // human decision written by apps/api/src/handlers/gate.ts back to the
  // specific gate it was waiting on.
  gate: varchar('gate', { length: 50 }).notNull(),
  actionClass: varchar('action_class', { length: 50 }).notNull(),
  actionSummary: text('action_summary').notNull(),
  decision: varchar('decision', { length: 50 }).notNull(),
  tier: varchar('tier', { length: 50 }).notNull(),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id),
  environment: varchar('environment', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per ADR 0010: a Project's files are rows in this table, one per path, not
// a server-side git repository — that's a deliberately deferred Phase 3
// decision (see the ADR). Unlike `approvals`, `aione_app` keeps UPDATE/
// DELETE here: this data is meant to be mutated by its owner (the signed-in
// user editing their project), not an append-only audit record.
//
// `deletedAt` implements a soft-delete rather than a hard DROP on a single
// DELETE-route call, per CLAUDE.md rule #1 (destructive actions need
// explicit confirmation) — see apps/api/src/handlers/files.ts's DELETE
// route for the two-step confirm this backs.
//
// The unique (project_id, path) constraint ADR 0010 calls for is scoped to
// live (non-deleted) rows via a partial index: a soft-deleted row must not
// permanently block re-creating a file at the same path, or soft-delete
// would behave like a hard delete the moment anyone tries to undo it by
// writing the file again.
export const projectFiles = pgTable('project_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  path: text('path').notNull(),
  content: text('content').notNull().default(''),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // NOTE: drizzle-kit 0.20 (this repo's pinned version) does not emit the
  // `WHERE` clause from `.where()` into generated migration SQL or into
  // `drizzle/meta/*_snapshot.json`'s "indexes" entry — that's a version gap,
  // not this being unsupported by Postgres. drizzle/0006_brown_shriek.sql
  // has the partial condition added by hand to match this declaration. If
  // this schema ever changes and `drizzle-kit generate` is re-run, check
  // the emitted SQL for this index and re-add `WHERE deleted_at is null` by
  // hand if it's missing.
  projectPathUnique: uniqueIndex('project_files_project_id_path_unique')
    .on(table.projectId, table.path)
    .where(sql`deleted_at is null`),
}));

export type Workspace = InferSelectModel<typeof workspaces>;
export type Project = InferSelectModel<typeof projects>;
export type Session = InferSelectModel<typeof sessions>;
export type Run = InferSelectModel<typeof runs>;
export type Approval = InferSelectModel<typeof approvals>;
export type Deployment = InferSelectModel<typeof deployments>;
export type ProjectFile = InferSelectModel<typeof projectFiles>;
