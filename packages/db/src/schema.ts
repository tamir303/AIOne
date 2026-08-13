import { pgTable, text, timestamp, uuid, varchar, jsonb } from 'drizzle-orm/pg-core';
import { InferSelectModel } from 'drizzle-orm';

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
  plan: jsonb('plan'),
  diff: jsonb('diff'),
  status: varchar('status', { length: 50 }).notNull().default('planning'),
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

export type Workspace = InferSelectModel<typeof workspaces>;
export type Project = InferSelectModel<typeof projects>;
export type Session = InferSelectModel<typeof sessions>;
export type Run = InferSelectModel<typeof runs>;
export type Approval = InferSelectModel<typeof approvals>;
export type Deployment = InferSelectModel<typeof deployments>;
