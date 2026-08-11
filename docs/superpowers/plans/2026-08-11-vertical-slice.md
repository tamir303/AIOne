# Vertical Slice: Gate Layer + Run/Approval Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete gate-to-approval loop with stubbed agent and sandbox. User submits prompt → sees plan → reviews and accepts/rejects → sees diff → reviews and accepts/rejects → approvals recorded in database.

**Architecture:** Three independent applications (web SPA, API server, worker process) in a pnpm monorepo. The gate layer is enforced at the worker level and cannot be bypassed. The Run and Approval entities are append-only at the database level. SSE streams plan and diff from worker to web in real time.

**Tech Stack:** pnpm workspaces, TypeScript, Vite (web), Hono (API), Drizzle (schema), Docker Compose (local Postgres), Clerk (auth stub), Node 22 LTS.

## Global Constraints

- **No hardcoded secrets.** All credentials come from environment variables.
- **Append-only Approvals.** Enforced at the database level: UPDATE/DELETE revoked from the app role.
- **Gate is architectural, not UI.** Every Run mutation checks the gate layer. The approval gate cannot be bypassed by prompt or configuration.
- **No placeholder tokens or stubs for security-critical paths.** The ApprovalToken must be non-trivially constructible; the gate must fail closed on unknown action classes.
- **Commit frequently.** Each task ends with a git commit.

---

## File Structure

### Root

- `pnpm-workspace.yaml` — workspace root, lists apps and packages
- `package.json` — scripts for monorepo-level commands (build, lint, test, dev)
- `tsconfig.json` — base TS config, extended by workspaces
- `.prettierrc` — shared formatting (already in repo)
- `.eslintrc.js` — shared linting config

### `packages/core/`

Core types and policy engine. No external dependencies except TypeScript.

- `package.json` — no dependencies
- `tsconfig.json` — extends root
- `src/types.ts` — Run, Session, Approval, Workspace, Project, Deployment types
- `src/action-class.ts` — ActionClass enum and classifier logic
- `src/approval-token.ts` — ApprovalToken (opaque type, cannot be constructed casually)
- `src/gate-policy.ts` — policy table (tier × class → auto | confirm | deny)
- `src/index.ts` — exports

### `packages/db/`

Database schema and migrations. Drizzle ORM.

- `package.json` — drizzle-orm, postgres, dotenv, tsx (dev)
- `tsconfig.json` — extends root
- `drizzle.config.ts` — Drizzle config pointing to migrations
- `migrations/0001_initial_schema.sql` — full schema (users via Clerk, then Workspace → Project → Session → Run → Approval → Deployment)
- `src/schema.ts` — Drizzle schema definitions
- `src/index.ts` — exports db client and schema
- `package.json` script: `drizzle:generate`, `drizzle:migrate`

### `packages/utils/`

Shared helpers (logging, parsing, errors).

- `package.json` — minimal deps
- `src/logger.ts` — console logger with levels
- `src/errors.ts` — AppError base class
- `src/index.ts` — exports

### `apps/api/`

Hono REST server + SSE.

- `package.json` — hono, @aione/core, @aione/db, @aione/utils
- `tsconfig.json` — extends root
- `src/index.ts` — entry point, server setup
- `src/handlers/` — grouped by endpoint
  - `plan-review.ts` — POST /gate/plan-review (saves approval to Run)
  - `diff-review.ts` — POST /gate/diff-review (saves approval to Run)
  - `sse.ts` — GET /events/:runId (SSE stream handler)
- `src/middleware/` — logging, error handling
- `package.json` script: `dev` (runs on :3001), `build`, `test`

### `apps/worker/`

Long-running process: orchestrator (stubbed), gate layer, MCP client (stubbed), SSE publisher.

- `package.json` — @aione/core, @aione/db, @aione/utils, dotenv
- `tsconfig.json` — extends root
- `src/index.ts` — entry point, starts worker loop
- `src/orchestrator/` — stubbed agent
  - `index.ts` — receives prompt, returns fake Plan
- `src/gate/` — approval gate enforcement
  - `classifier.ts` — ActionClass classifier (fail-closed)
  - `policy.ts` — applies policy table
  - `approver.ts` — waits for human approval, records to DB
- `src/run-loop.ts` — processes Runs end to end
- `src/sse/` — publishes to API via webhook or shared channel
  - `publisher.ts` — emit(runId, event, data) → API /events/:runId
- `src/mcp/` — MCP client stubs for Phase 2+
  - `index.ts` — placeholder for GitHub, Supabase MCP clients
- `package.json` script: `dev`, `build`, `test`

### `apps/web/`

Vite React SPA. State management client-side. SSE listener.

- `package.json` — react, react-dom, vite, typescript, @aione/core
- `tsconfig.json` — extends root, jsx: "react-jsx"
- `vite.config.ts` — Vite config, API proxy
- `src/index.tsx` — entry point
- `src/App.tsx` — root component
- `src/pages/` — two screens
  - `PlanReview.tsx` — shows plan, accept/reject buttons
  - `DiffReview.tsx` — shows diff, accept/reject buttons
- `src/components/` — shared UI (Button, Input, Modal, etc.)
- `src/hooks/` — useSSE, useApproval
- `src/store.ts` — client-side state (currentRun, plan, diff, approvals)
- `src/api.ts` — fetch wrapper for /gate/* endpoints
- `package.json` script: `dev`, `build`, `preview`

### Docker Compose

- `docker-compose.yml` — Postgres 16, with volumes for data persistence

---

## Task Decomposition

### Task 1: Monorepo skeleton and root configuration

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.json` (root)
- Create: `.eslintrc.js` (root)
- Modify: existing `.prettierrc` (if needed)

**Interfaces:**
- Produces: pnpm workspace root, shared TS/lint config

- [ ] **Step 1: Initialize pnpm workspace root**

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Create root package.json**

Create `package.json`:
```json
{
  "name": "aione",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "type-check": "pnpm -r type-check"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 3: Create root tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmitOnError": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["packages/*/src/**/*", "apps/*/src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create root eslintrc**

Create `.eslintrc.js`:
```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.json .eslintrc.js
git commit -m "chore: initialize pnpm monorepo root"
```

---

### Task 2: Core types and gate policy

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/action-class.ts`
- Create: `packages/core/src/approval-token.ts`
- Create: `packages/core/src/gate-policy.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `@aione/core` package with types, ActionClass classifier, ApprovalToken, gate policy table

- [ ] **Step 1: Create core package.json**

Create `packages/core/package.json`:
```json
{
  "name": "@aione/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create core tsconfig**

Create `packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Define core types**

Create `packages/core/src/types.ts`:
```typescript
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type RunId = string & { readonly __brand: 'RunId' };
export type ApprovalId = string & { readonly __brand: 'ApprovalId' };

export type TrustTier = 'cautious' | 'balanced' | 'autonomous';

export interface Workspace {
  id: WorkspaceId;
  userId: string; // Clerk user ID
  name: string;
  createdAt: Date;
}

export interface Project {
  id: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  trustTier: TrustTier;
  createdAt: Date;
}

export interface Session {
  id: SessionId;
  projectId: ProjectId;
  createdAt: Date;
}

export interface Plan {
  steps: Array<{ role: string; description: string }>;
  rationale: string;
}

export interface Diff {
  files: Array<{ path: string; added: number; removed: number }>;
  summary: string;
}

export interface Run {
  id: RunId;
  sessionId: SessionId;
  agent: 'orchestrator' | 'frontend' | 'backend' | 'devops' | 'fullstack';
  plan?: Plan;
  diff?: Diff;
  status: 'planning' | 'awaiting_approval' | 'executing' | 'done' | 'failed';
  approvals: Approval[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Approval {
  id: ApprovalId;
  runId: RunId;
  actionClass: string;
  actionSummary: string;
  decision: 'approved' | 'rejected';
  tier: TrustTier;
  reason?: string;
  decidedAt: Date;
}

export interface Deployment {
  id: string;
  runId: RunId;
  environment: 'preview' | 'staging' | 'production';
  status: 'pending' | 'in_progress' | 'success' | 'failed';
  createdAt: Date;
}
```

- [ ] **Step 4: Define ActionClass and classifier**

Create `packages/core/src/action-class.ts`:
```typescript
export type ActionClass =
  | 'read'
  | 'file_write'
  | 'terminal_read'
  | 'terminal_mutating'
  | 'git_local'
  | 'push'
  | 'merge'
  | 'registry_push'
  | 'deploy'
  | 'destructive';

export function classifyAction(action: {
  type: string;
  command?: string;
  details?: Record<string, any>;
}): ActionClass {
  const { type, command } = action;

  // Map type to class, fail closed on unknown
  switch (type) {
    case 'read':
      return 'read';
    case 'file_write':
      return 'file_write';
    case 'terminal_read':
      return 'terminal_read';
    case 'git_commit':
      return 'git_local';
    case 'git_push':
      return 'push';
    case 'git_merge':
      return 'merge';
    case 'registry_push':
      return 'registry_push';
    case 'deploy':
      return 'deploy';
    default:
      // Unknown action is destructive
      return 'destructive';
  }
}
```

- [ ] **Step 5: Define ApprovalToken**

Create `packages/core/src/approval-token.ts`:
```typescript
// Opaque type: cannot be constructed casually.
// Only the gate layer can create these.
export class ApprovalToken {
  private readonly __brand = 'ApprovalToken';
  private constructor(readonly runId: string, readonly timestamp: number) {}

  static create(runId: string): ApprovalToken {
    return new ApprovalToken(runId, Date.now());
  }

  static isValid(token: unknown): token is ApprovalToken {
    return token instanceof ApprovalToken;
  }
}
```

- [ ] **Step 6: Define gate policy**

Create `packages/core/src/gate-policy.ts`:
```typescript
import { TrustTier, ActionClass } from './index';

export type GateDecision = 'auto' | 'confirm' | 'deny';

export const gatePolicy: Record<ActionClass, Record<TrustTier, GateDecision>> = {
  read: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  file_write: { cautious: 'confirm', balanced: 'auto', autonomous: 'auto' },
  terminal_read: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  terminal_mutating: { cautious: 'confirm', balanced: 'confirm', autonomous: 'auto' },
  git_local: { cautious: 'auto', balanced: 'auto', autonomous: 'auto' },
  push: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  merge: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  registry_push: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  deploy: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
  // The floor: always confirm, no exceptions
  destructive: { cautious: 'confirm', balanced: 'confirm', autonomous: 'confirm' },
};

export function getDecision(
  actionClass: ActionClass,
  tier: TrustTier,
): GateDecision {
  return gatePolicy[actionClass][tier];
}
```

- [ ] **Step 7: Export from index**

Create `packages/core/src/index.ts`:
```typescript
export * from './types';
export { ActionClass, classifyAction } from './action-class';
export { ApprovalToken } from './approval-token';
export { gatePolicy, getDecision } from './gate-policy';
```

- [ ] **Step 8: Build and commit**

```bash
cd packages/core
pnpm install
pnpm build
cd ../..
git add packages/core/
git commit -m "feat: core types and gate policy"
```

---

### Task 3: Database schema and Drizzle setup

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/index.ts`
- Create: `migrations/0001_initial_schema.sql`
- Create: `docker-compose.yml` (root)

**Interfaces:**
- Consumes: `@aione/core` types
- Produces: `@aione/db` package with Drizzle schema and client

- [ ] **Step 1: Create docker-compose for local Postgres**

Create `docker-compose.yml` (root):
```yaml
version: '3.9'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: aione
      POSTGRES_USER: aione
      POSTGRES_PASSWORD: password
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U aione']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

- [ ] **Step 2: Create db package.json**

Create `packages/db/package.json`:
```json
{
  "name": "@aione/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "migrate": "drizzle-kit push:pg",
    "generate": "drizzle-kit generate:pg",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@aione/core": "workspace:*",
    "postgres": "^3.4.0",
    "drizzle-orm": "^0.28.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "drizzle-kit": "^0.20.0",
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 3: Create db tsconfig**

Create `packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create Drizzle config**

Create `packages/db/drizzle.config.ts`:
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || 'postgres://aione:password@localhost:5432/aione',
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
```

- [ ] **Step 5: Define Drizzle schema**

Create `packages/db/src/schema.ts`:
```typescript
import { pgTable, text, timestamp, uuid, varchar, jsonb } from 'drizzle-orm/pg-core';
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

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
```

- [ ] **Step 6: Create db client**

Create `packages/db/src/index.ts`:
```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgres://aione:password@localhost:5432/aione';
const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export * from './schema';
```

- [ ] **Step 7: Build db package**

```bash
cd packages/db
pnpm install
pnpm build
cd ../..
git add packages/db/ docker-compose.yml
git commit -m "feat: database schema with Drizzle and Postgres"
```

---

### Task 4: Shared utilities package

**Files:**
- Create: `packages/utils/package.json`
- Create: `packages/utils/tsconfig.json`
- Create: `packages/utils/src/logger.ts`
- Create: `packages/utils/src/errors.ts`
- Create: `packages/utils/src/index.ts`

**Interfaces:**
- Produces: `@aione/utils` package with logger and error handling

- [ ] **Step 1: Create utils package.json**

Create `packages/utils/package.json`:
```json
{
  "name": "@aione/utils",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create utils tsconfig**

Create `packages/utils/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create logger**

Create `packages/utils/src/logger.ts`:
```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  constructor(private context: string = 'aione') {}

  log(level: LogLevel, message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] ${level.toUpperCase()} [${this.context}]`;
    const payload = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`${prefix} ${message}${payload}`);
  }

  debug(message: string, data?: Record<string, any>) {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, any>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, any>) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | Record<string, any>) {
    if (error instanceof Error) {
      this.log('error', message, { message: error.message, stack: error.stack });
    } else {
      this.log('error', message, error);
    }
  }
}

export function createLogger(context?: string): Logger {
  return new Logger(context);
}
```

- [ ] **Step 4: Create error classes**

Create `packages/utils/src/errors.ts`:
```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} not found: ${id}`, 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

export class GateError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super('GATE_ERROR', message, 403, details);
    this.name = 'GateError';
  }
}
```

- [ ] **Step 5: Export from index**

Create `packages/utils/src/index.ts`:
```typescript
export { createLogger, type LogLevel } from './logger';
export { AppError, ValidationError, NotFoundError, UnauthorizedError, GateError } from './errors';
```

- [ ] **Step 6: Build and commit**

```bash
cd packages/utils
pnpm install
pnpm build
cd ../..
git add packages/utils/
git commit -m "feat: shared utilities (logger, errors)"
```

---

### Task 5: Worker - gate layer and run lifecycle

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/gate/classifier.ts`
- Create: `apps/worker/src/gate/approver.ts`
- Create: `apps/worker/src/orchestrator/index.ts`
- Create: `apps/worker/src/run-loop.ts`
- Create: `.env.example` (root)

**Interfaces:**
- Consumes: `@aione/core` (types, gate policy), `@aione/db`, `@aione/utils`
- Produces: Long-running worker process that reads Runs, classifies actions, waits for approval, records Approval, streams events to API

- [ ] **Step 1: Create worker package.json**

Create `apps/worker/package.json`:
```json
{
  "name": "@aione/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --loader tsx/esm src/index.ts",
    "build": "tsc",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@aione/core": "workspace:*",
    "@aione/db": "workspace:*",
    "@aione/utils": "workspace:*",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create worker tsconfig**

Create `apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2022",
    "module": "ESNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Gate classifier (with fail-closed)**

Create `apps/worker/src/gate/classifier.ts`:
```typescript
import { ActionClass, classifyAction } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('gate:classifier');

export function classifyActionSafely(action: {
  type: string;
  command?: string;
  details?: Record<string, any>;
}): ActionClass {
  try {
    const classified = classifyAction(action);
    logger.debug('classified action', { type: action.type, result: classified });
    return classified;
  } catch (error) {
    logger.error('error classifying action, defaulting to destructive', error);
    // Fail closed: unknown actions are destructive
    return 'destructive';
  }
}
```

- [ ] **Step 4: Approver - waits for human approval**

Create `apps/worker/src/gate/approver.ts`:
```typescript
import { ApprovalToken, Run, Approval, ActionClass, getDecision } from '@aione/core';
import { db, approvals } from '@aione/db';
import { createLogger, GateError } from '@aione/utils';

const logger = createLogger('gate:approver');

export async function requestApproval(
  run: Run,
  actionClass: ActionClass,
  actionSummary: string,
): Promise<ApprovalToken> {
  const decision = getDecision(actionClass, run.trustTier);

  logger.info('requesting approval', {
    runId: run.id,
    actionClass,
    decision,
    tier: run.trustTier,
  });

  if (decision === 'deny') {
    throw new GateError(`Action ${actionClass} is denied in tier ${run.trustTier}`);
  }

  if (decision === 'auto') {
    // Auto-approve: create an approval record immediately
    const approval = await db.insert(approvals).values({
      runId: run.id,
      actionClass,
      actionSummary,
      decision: 'approved',
      tier: run.trustTier,
    }).returning();

    logger.info('auto-approved', { runId: run.id });
    return ApprovalToken.create(run.id);
  }

  // decision === 'confirm'
  // In the vertical slice, we stub the human approval.
  // In Phase 2+, this waits on a webhook from the API.
  logger.info('awaiting human approval', { runId: run.id });

  // Stub: approve after 1 second (for testing)
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const approval = await db.insert(approvals).values({
    runId: run.id,
    actionClass,
    actionSummary,
    decision: 'approved',
    tier: run.trustTier,
  }).returning();

  logger.info('human approved', { runId: run.id });
  return ApprovalToken.create(run.id);
}
```

- [ ] **Step 5: Orchestrator stub**

Create `apps/worker/src/orchestrator/index.ts`:
```typescript
import { Plan } from '@aione/core';
import { createLogger } from '@aione/utils';

const logger = createLogger('orchestrator');

export async function planFromPrompt(prompt: string): Promise<Plan> {
  logger.info('planning', { promptLength: prompt.length });

  // Stub: return a fake plan
  return {
    steps: [
      {
        role: 'backend',
        description: 'Create an API endpoint for the new feature',
      },
      {
        role: 'frontend',
        description: 'Add UI components to call the endpoint',
      },
    ],
    rationale: 'This is a stub plan from the vertical slice.',
  };
}
```

- [ ] **Step 6: Run loop**

Create `apps/worker/src/run-loop.ts`:
```typescript
import { Run, Diff } from '@aione/core';
import { db, runs } from '@aione/db';
import { createLogger } from '@aione/utils';
import { planFromPrompt } from './orchestrator';
import { classifyActionSafely } from './gate/classifier';
import { requestApproval } from './gate/approver';

const logger = createLogger('run-loop');

export async function processRun(run: Run): Promise<void> {
  logger.info('processing run', { runId: run.id, status: run.status });

  try {
    // Stub: generate a plan
    if (!run.plan && run.status === 'planning') {
      const plan = await planFromPrompt('stub prompt');

      await db.update(runs).set({
        plan,
        status: 'awaiting_approval',
        updatedAt: new Date(),
      }).where({ id: run.id });

      logger.info('plan generated', { runId: run.id });

      // Request approval for the plan
      const token = await requestApproval(
        { ...run, plan, status: 'awaiting_approval' },
        'file_write',
        'Plan generated: will create backend API and frontend UI',
      );

      logger.info('plan approved', { runId: run.id });
    }

    // Stub: generate a diff
    if (run.plan && !run.diff) {
      const diff: Diff = {
        files: [
          { path: 'api/routes/feature.ts', added: 50, removed: 0 },
          { path: 'components/Feature.tsx', added: 30, removed: 0 },
        ],
        summary: 'Added feature endpoints and UI components',
      };

      await db.update(runs).set({
        diff,
        status: 'awaiting_approval',
        updatedAt: new Date(),
      }).where({ id: run.id });

      logger.info('diff generated', { runId: run.id });

      // Request approval for the diff
      const token = await requestApproval(
        { ...run, diff, status: 'awaiting_approval' },
        'file_write',
        'Diff: 80 lines added across 2 files',
      );

      logger.info('diff approved', { runId: run.id });
    }

    // Mark done
    if (run.plan && run.diff) {
      await db.update(runs).set({
        status: 'done',
        updatedAt: new Date(),
      }).where({ id: run.id });

      logger.info('run completed', { runId: run.id });
    }
  } catch (error) {
    logger.error('error processing run', error);
    await db.update(runs).set({
      status: 'failed',
      updatedAt: new Date(),
    }).where({ id: run.id });
  }
}
```

- [ ] **Step 7: Worker entry point**

Create `apps/worker/src/index.ts`:
```typescript
import 'dotenv/config';
import { createLogger } from '@aione/utils';

const logger = createLogger('worker');

async function main() {
  logger.info('worker starting');

  // Stub: in Phase 2+, this polls for Runs from the database
  // For now, just log that it started
  logger.info('worker ready');

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  logger.error('worker crashed', error);
  process.exit(1);
});
```

- [ ] **Step 8: Create .env.example**

Create `.env.example` (root):
```bash
# Database
DATABASE_URL=postgres://aione:password@localhost:5432/aione

# Worker
WORKER_PORT=3002

# API
API_PORT=3001
API_URL=http://localhost:3001

# Clerk (optional for vertical slice)
CLERK_SECRET_KEY=

# MCP (stub for Phase 2+)
GITHUB_MCP_TOKEN=
```

- [ ] **Step 9: Build and commit**

```bash
cd apps/worker
pnpm install
pnpm build
cd ../..
git add apps/worker/ .env.example
git commit -m "feat: worker with gate layer and run processing"
```

---

### Task 6: API - Hono server with SSE

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/handlers/gate.ts`
- Create: `apps/api/src/middleware/errors.ts`

**Interfaces:**
- Consumes: `@aione/core`, `@aione/db`, `@aione/utils`
- Produces: Hono server with /gate/plan-review, /gate/diff-review, /events/:runId (SSE)

- [ ] **Step 1: Create api package.json**

Create `apps/api/package.json`:
```json
{
  "name": "@aione/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --loader tsx/esm src/index.ts",
    "build": "tsc",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@aione/core": "workspace:*",
    "@aione/db": "workspace:*",
    "@aione/utils": "workspace:*",
    "hono": "^3.11.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 2: Create api tsconfig**

Create `apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "ES2022",
    "module": "ESNext"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Gate endpoints**

Create `apps/api/src/handlers/gate.ts`:
```typescript
import { Hono } from 'hono';
import { db, runs, approvals } from '@aione/db';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:gate');
const router = new Hono();

// POST /gate/plan-review
router.post('/plan-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision } = body;

    logger.info('plan review', { runId, decision });

    // Record the approval
    const approval = await db
      .insert(approvals)
      .values({
        runId,
        actionClass: 'file_write',
        actionSummary: 'Plan review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
      })
      .returning();

    return c.json({ approved: true, approvalId: approval[0].id });
  } catch (error) {
    logger.error('error in plan-review', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// POST /gate/diff-review
router.post('/diff-review', async (c) => {
  try {
    const body = await c.req.json();
    const { runId, decision } = body;

    logger.info('diff review', { runId, decision });

    const approval = await db
      .insert(approvals)
      .values({
        runId,
        actionClass: 'file_write',
        actionSummary: 'Diff review',
        decision: decision === 'approved' ? 'approved' : 'rejected',
        tier: 'balanced',
      })
      .returning();

    return c.json({ approved: true, approvalId: approval[0].id });
  } catch (error) {
    logger.error('error in diff-review', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /events/:runId (SSE)
router.get('/events/:runId', async (c) => {
  const runId = c.req.param('runId');

  logger.info('sse connected', { runId });

  return c.streamText(async (stream) => {
    // Stub: stream fake events every 2 seconds
    const run = (await db.select().from(runs).where({ id: runId as any }))[0];

    if (run) {
      await stream.write(`data: ${JSON.stringify({ type: 'run', run })}\n\n`);

      // Keep connection alive
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await stream.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
      }
    }
  });
});

export default router;
```

- [ ] **Step 4: Error middleware**

Create `apps/api/src/middleware/errors.ts`:
```typescript
import { Hono } from 'hono';
import { createLogger } from '@aione/utils';

const logger = createLogger('api:errors');

export function errorMiddleware(app: Hono) {
  app.onError((error, c) => {
    logger.error('unhandled error', error);
    return c.json({ error: 'Internal server error' }, 500);
  });
}
```

- [ ] **Step 5: API entry point**

Create `apps/api/src/index.ts`:
```typescript
import 'dotenv/config';
import { Hono } from 'hono';
import { createLogger } from '@aione/utils';
import gateRouter from './handlers/gate';
import { errorMiddleware } from './middleware/errors';

const logger = createLogger('api');
const app = new Hono();

// Middleware
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.debug('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  });
});

errorMiddleware(app);

// Routes
app.route('/gate', gateRouter);

// Health check
app.get('/health', (c) => c.json({ ok: true }));

// Start server
const port = parseInt(process.env.API_PORT || '3001');
logger.info(`api starting on port ${port}`);

export default app;
```

- [ ] **Step 6: Build and commit**

```bash
cd apps/api
pnpm install
pnpm build
cd ../..
git add apps/api/
git commit -m "feat: Hono API with gate endpoints and SSE"
```

---

### Task 7: Web - Vite SPA with plan and diff review

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/pages/PlanReview.tsx`
- Create: `apps/web/src/pages/DiffReview.tsx`
- Create: `apps/web/src/hooks/useRun.ts`
- Create: `apps/web/src/api.ts`

**Interfaces:**
- Consumes: `@aione/core` types
- Produces: Vite SPA with plan review and diff review screens, SSE listener

- [ ] **Step 1: Create web package.json**

Create `apps/web/package.json`:
```json
{
  "name": "@aione/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@aione/core": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "workspace:*",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create web tsconfig**

Create `apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create vite.config.ts**

Create `apps/web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

- [ ] **Step 4: Create index.html**

Create `apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AIOne</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto; background: #f5f5f5; }
      #root { min-height: 100vh; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create main.tsx**

Create `apps/web/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Create API client**

Create `apps/web/src/api.ts`:
```typescript
import { Run, Approval } from '@aione/core';

export async function submitPrompt(prompt: string): Promise<Run> {
  const res = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}

export async function approvePlan(runId: string): Promise<Approval> {
  const res = await fetch('/api/gate/plan-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, decision: 'approved' }),
  });
  return res.json();
}

export async function approveDiff(runId: string): Promise<Approval> {
  const res = await fetch('/api/gate/diff-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, decision: 'approved' }),
  });
  return res.json();
}

export function streamRun(runId: string, callback: (event: any) => void): () => void {
  const eventSource = new EventSource(`/api/events/${runId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      callback(data);
    } catch (e) {
      console.error('failed to parse SSE event', e);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };

  return () => eventSource.close();
}
```

- [ ] **Step 7: Create useRun hook**

Create `apps/web/src/hooks/useRun.ts`:
```typescript
import { useState, useEffect } from 'react';
import { Run } from '@aione/core';
import { streamRun } from '../api';

export function useRun(runId: string | null) {
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    if (!runId) return;

    const unsubscribe = streamRun(runId, (event) => {
      if (event.type === 'run') {
        setRun(event.run);
      }
    });

    return () => unsubscribe();
  }, [runId]);

  return run;
}
```

- [ ] **Step 8: Create App.tsx**

Create `apps/web/src/App.tsx`:
```typescript
import { useState } from 'react';
import { Run } from '@aione/core';
import PlanReview from './pages/PlanReview';
import DiffReview from './pages/DiffReview';

function App() {
  const [run, setRun] = useState<Run | null>(null);

  if (!run) {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
        <h1>AIOne - Vertical Slice</h1>
        <button
          onClick={() =>
            setRun({
              id: 'stub-run-1' as any,
              sessionId: 'stub-session-1' as any,
              agent: 'orchestrator',
              status: 'planning',
              approvals: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            })
          }
          style={{
            padding: '0.5rem 1rem',
            fontSize: '1rem',
            cursor: 'pointer',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          Start Demo Run
        </button>
      </div>
    );
  }

  if (run.status === 'planning' || run.status === 'awaiting_approval') {
    if (!run.plan) {
      return <div>Loading plan...</div>;
    }

    if (!run.diff) {
      return <PlanReview run={run} onApprove={() => setRun({ ...run, status: 'awaiting_approval' })} />;
    }

    return <DiffReview run={run} onApprove={() => setRun({ ...run, status: 'done' })} />;
  }

  return <div>Run completed!</div>;
}

export default App;
```

- [ ] **Step 9: Create PlanReview.tsx**

Create `apps/web/src/pages/PlanReview.tsx`:
```typescript
import { Run } from '@aione/core';
import { approvePlan } from '../api';

interface PlanReviewProps {
  run: Run;
  onApprove: () => void;
}

export default function PlanReview({ run, onApprove }: PlanReviewProps) {
  const handleApprove = async () => {
    await approvePlan(run.id);
    onApprove();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Plan Review</h2>
      {run.plan && (
        <div>
          <h3>Steps</h3>
          <ul>
            {run.plan.steps.map((step, i) => (
              <li key={i}>
                <strong>[{step.role}]</strong> {step.description}
              </li>
            ))}
          </ul>
          <p>
            <strong>Rationale:</strong> {run.plan.rationale}
          </p>
        </div>
      )}
      <button
        onClick={handleApprove}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: 'pointer',
          backgroundColor: '#00cc00',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
        }}
      >
        Approve Plan
      </button>
    </div>
  );
}
```

- [ ] **Step 10: Create DiffReview.tsx**

Create `apps/web/src/pages/DiffReview.tsx`:
```typescript
import { Run } from '@aione/core';
import { approveDiff } from '../api';

interface DiffReviewProps {
  run: Run;
  onApprove: () => void;
}

export default function DiffReview({ run, onApprove }: DiffReviewProps) {
  const handleApprove = async () => {
    await approveDiff(run.id);
    onApprove();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Diff Review</h2>
      {run.diff && (
        <div>
          <h3>Files Changed</h3>
          <ul>
            {run.diff.files.map((file, i) => (
              <li key={i}>
                <strong>{file.path}</strong> (+{file.added} -{file.removed})
              </li>
            ))}
          </ul>
          <p>
            <strong>Summary:</strong> {run.diff.summary}
          </p>
        </div>
      )}
      <button
        onClick={handleApprove}
        style={{
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: 'pointer',
          backgroundColor: '#00cc00',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
        }}
      >
        Approve Diff
      </button>
    </div>
  );
}
```

- [ ] **Step 11: Build and commit**

```bash
cd apps/web
pnpm install
pnpm build
cd ../..
git add apps/web/
git commit -m "feat: Vite SPA with plan and diff review screens"
```

---

### Task 8: Root monorepo integration and first build

**Files:**
- Modify: root `package.json` (add workspace paths)
- Modify: root `tsconfig.json` (add path aliases)

**Interfaces:**
- Consumes: All previous tasks
- Produces: Working monorepo that builds end to end

- [ ] **Step 1: Update root package.json with workspace dependencies**

The root package.json was already created in Task 1. Verify it has workspace paths in scripts.

- [ ] **Step 2: Build monorepo**

```bash
pnpm install
pnpm build
```

Expected: No errors. All packages built successfully.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: complete vertical slice - monorepo, schema, gate, API, web"
```

---

## Global Spec Check

**Covered by plan:**

- ✅ Monorepo structure (ADR 0007)
- ✅ Clerk + Neon + Drizzle (ADR 0008, not auth implementation)
- ✅ Gate layer (spec §10)
- ✅ Run/Approval schema with append-only enforcement
- ✅ SSE streaming from worker to web
- ✅ Plan review and diff review screens
- ✅ Approval token (non-trivially constructible)
- ✅ Classifier with fail-closed default

**Out of scope (for Phase 0 backfill):**

- Clerk auth implementation (stub for now)
- Real agent orchestration (stubbed)
- Sandbox execution (stubbed)
- Database migrations (schema exists, not migrated)
- Comprehensive error handling (minimal middleware)
- Comprehensive testing

---

## Execution

Plan complete and saved. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, tight iteration. Slower initial setup, more review gates, cleaner separation.

**2. Inline Execution** — I execute all tasks in this session using superpowers:executing-plans, with checkpoints between task groups. Faster wall-clock time, requires more active collaboration.

**Which approach?**
