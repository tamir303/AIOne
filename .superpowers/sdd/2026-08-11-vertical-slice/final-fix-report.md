# Final fix round report — vertical slice

**Status: DONE**

## Commit

```
af9e97c fix: wire web UI to API, correct docker_build policy, add lint scripts, fix ESM extensions
```

24 files changed (2 new: `apps/api/src/handlers/events.ts`, `apps/api/src/handlers/runs.ts`).

All 4 findings were fixed in a single commit (they were small and interdependent enough — e.g. finding 4's `.js` extensions touch the same files finding 2 restructured — that splitting further added no clarity).

## Finding 1 — docker_build gate policy

`packages/core/src/gate-policy.ts`: `docker_build` changed from
`{ cautious: 'confirm', balanced: 'confirm', autonomous: 'auto' }` to
`{ cautious: 'auto', balanced: 'auto', autonomous: 'auto' }`, copied verbatim
from `docs/trust-model.md`'s "Docker build (sandbox-local) | auto | auto | auto" row.

## Finding 2 — web UI never called the API

- **2a.** Extracted the SSE handler out of `apps/api/src/handlers/gate.ts` into a new
  `apps/api/src/handlers/events.ts` router (route `GET /:runId`). `apps/api/src/index.ts`
  now mounts it at the top level: `app.route('/events', eventsRouter)`, alongside the
  unchanged `app.route('/gate', gateRouter)` (which still only has `/plan-review` and
  `/diff-review`). Real path is now `/events/:runId`, matching `apps/web/src/api.ts`'s
  `streamRun()`.
- **2b.** Added `apps/api/src/handlers/runs.ts` with `POST /` (mounted as
  `app.route('/runs', runsRouter)` → `POST /runs`). It has an `ensureStubSession()`
  helper that does a `select` on `sessions` and, if empty, inserts a
  workspace → project → session chain once (memoized in a module-level variable),
  then reuses that `sessionId` for every run insert — avoiding the FK violation
  `runs.sessionId → sessions.id` would otherwise cause. Returns the created run row
  as JSON, logs via `createLogger('api:runs')`, wrapped in try/catch matching the
  existing `gate.ts` pattern (500 + logged error on failure).
- **2c.** Rewrote `apps/web/src/App.tsx`: it now imports `submitPrompt` from `./api.js`
  and `useRun` from `./hooks/useRun.js`. "Start Demo Run" calls
  `await submitPrompt('demo prompt')`, stores the returned `id` in
  `useState<string | null>`, and `const run = useRun(runId)` drives the rest of the
  render (loading / PlanReview / DiffReview / done) instead of local fake state.

Traced the plumbing end to end: `submitPrompt()` → `POST /api/runs` → Vite proxy
rewrite → `POST /runs` → `runsRouter` (real handler, no 404) → DB insert → JSON
response with real `id` → `useRun(runId)` → `GET /api/events/:id` → proxy rewrite →
`GET /events/:id` → `eventsRouter` (real handler, no 404) → SSE stream. As documented
in the brief, `run.plan`/`run.diff` stay empty because the worker's `processRun`
polling loop is not wired up — that remains the known, explicitly out-of-scope Phase 2
gap. No worker polling was added.

## Finding 3 — lint scripts

Added `"lint": "eslint src --ext .ts"` to `packages/core`, `packages/utils`,
`packages/db`, `apps/worker`, `apps/api`, and `"lint": "eslint src --ext .ts,.tsx"` to
`apps/web`. No per-package `eslint` dependency was needed — pnpm's hoisting made the
root devDependency resolvable everywhere. `pnpm -r lint` now completes with 0 errors
(11 pre-existing `@typescript-eslint/no-explicit-any` warnings across
`packages/core`, `packages/utils`, `apps/web`, `apps/worker` — all warnings, none
introduced by this fix round, none blocking).

## Finding 4 — ESM `.js` extensions / nodenext

- Root `tsconfig.json`: `module` → `nodenext`, `moduleResolution` → `nodenext`.
- Also had to drop the `"module": "ESNext"` override in `apps/api/tsconfig.json` and
  `apps/worker/tsconfig.json` (not mentioned explicitly in the brief, but those two
  package-level configs were overriding the root's new `module: nodenext` back to
  `ESNext`, which is an invalid pairing with `moduleResolution: nodenext` — TS
  requires them to match). Left `target: ES2022` in place on both.
- Added explicit `.js` extensions to every relative import/export across all 6
  packages, including `apps/web` (Vite/esbuild resolves `.js`-suffixed specifiers to
  `.tsx`/`.ts` source files correctly, so this didn't break the Vite build — verified,
  `apps/web build` still produced `dist/assets/index-*.js` cleanly).
- Files touched: `packages/core/src/index.ts`, `packages/core/src/gate-policy.ts`,
  `packages/utils/src/index.ts`, `packages/db/src/index.ts`,
  `apps/worker/src/gate/approver.ts`, `apps/worker/src/run-loop.ts` (including fixing
  a directory import, `./orchestrator` → `./orchestrator/index.js`),
  `apps/api/src/index.ts`, and `apps/web/src/{App.tsx,main.tsx,hooks/useRun.ts,pages/PlanReview.tsx,pages/DiffReview.tsx}`.
- No unrelated type errors surfaced from the `nodenext` switch — nothing needed
  suppression.

## Verification output

**`pnpm -r build`** — all 6 packages, zero errors:
```
packages/core build: Done
packages/utils build: Done
apps/web build: ✓ built in 765ms — Done
packages/db build: Done
apps/api build: Done
apps/worker build: Done
```

**`pnpm -r type-check`** — all 6 packages, zero errors:
```
packages/core type-check: Done
packages/utils type-check: Done
apps/web type-check: Done
packages/db type-check: Done
apps/api type-check: Done
apps/worker type-check: Done
```

**`pnpm -r lint`** — all 6 packages run, zero errors (warnings only, all pre-existing
`no-explicit-any`):
```
packages/core lint: 1 warning — Done
packages/utils lint: 8 warnings — Done
apps/web lint: 1 warning — Done
packages/db lint: 0 problems — Done
apps/api lint: 0 problems — Done
apps/worker lint: 1 warning — Done
```

**`node apps/api/dist/index.js`** — booted clean, no `ERR_MODULE_NOT_FOUND`:
```
[INFO] [api] api starting on port 3001
```
(process killed after confirming; port 3001 was listening)

**`node apps/worker/dist/index.js`** — booted clean, no `ERR_MODULE_NOT_FOUND`:
```
[INFO] [worker] worker starting
[INFO] [worker] worker ready
```

## Concerns / deviations

- Removing `"module": "ESNext"` from `apps/api/tsconfig.json` and
  `apps/worker/tsconfig.json` was necessary but not explicitly called out in the
  brief — flagging it here since it's a deviation from "only touch the root
  tsconfig.json" language in finding 4. Without it, `tsc` throws a hard
  moduleResolution/module mismatch error, so there was no working alternative.
- No other residual issues. All 4 findings verified fixed; build, type-check, and
  lint are clean across the whole monorepo; both compiled entry points boot under
  plain `node`.
