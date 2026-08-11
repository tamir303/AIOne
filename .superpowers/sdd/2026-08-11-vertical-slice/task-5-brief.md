# Task 5: Worker - gate layer and run lifecycle

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

---

## Steps

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
