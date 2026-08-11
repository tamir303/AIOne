# Task 7: Web - Vite SPA with plan and diff review

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
- Produces: Vite React SPA with plan review and diff review screens, SSE listener

---

## Steps

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
