# Task 6: API - Hono server with SSE

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/handlers/gate.ts`
- Create: `apps/api/src/middleware/errors.ts`

**Interfaces:**
- Consumes: `@aione/core`, `@aione/db`, `@aione/utils`
- Produces: Hono server with /gate/plan-review, /gate/diff-review, /events/:runId (SSE)

---

## Steps

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
