# Final review fix round — vertical slice

The final whole-branch reviewer found 4 issues after independently re-running builds and tracing the actual runtime paths (not just trusting task reports). Fix all four. This is a single fix round — be thorough.

---

## Finding 1 (Important): docker_build gate policy contradicts the documented trust matrix

**File:** `packages/core/src/gate-policy.ts`

Current:
```typescript
docker_build: { cautious: 'confirm', balanced: 'confirm', autonomous: 'auto' },
```

`docs/trust-model.md` states: "Docker build (sandbox-local) | auto | auto | auto" — auto in every tier, because a docker build that stays inside the sandbox never leaves it and needs no gate.

**Fix:** Change the `docker_build` row to `{ cautious: 'auto', balanced: 'auto', autonomous: 'auto' }` so `packages/core/src/gate-policy.ts` matches `docs/trust-model.md`. Read `docs/trust-model.md` first to confirm the exact row before editing — copy its values verbatim, don't guess.

---

## Finding 2 (Important — the big one): the web UI never actually calls the API

The vertical slice's whole exit criterion is "user submits prompt → sees plan → accepts/rejects → sees diff → accepts/rejects → approvals recorded in DB." Right now the UI's "Start Demo Run" button only sets local React state — it never calls the backend, `useRun` (the SSE hook) is defined but never imported anywhere, and even if it were wired up, the SSE URL path is wrong. Fix all three problems together so a user can genuinely click through the full loop in a browser.

### 2a. `apps/api/src/index.ts` — SSE route is mounted under `/gate`, but the web client expects a top-level `/events/:runId`

Currently: `app.route('/gate', gateRouter)` mounts plan-review, diff-review, AND the SSE handler all under `/gate/*`, so the real SSE path is `/gate/events/:runId`. The web client (`apps/web/src/api.ts`) calls `new EventSource('/api/events/${runId}')`, which — after Vite's `/api` → `http://localhost:3001` proxy rewrite — becomes `GET /events/:runId`, a 404.

**Fix:** Split `apps/api/src/handlers/gate.ts`'s single router into two: keep `/plan-review` and `/diff-review` under `/gate`, but mount the SSE `/events/:runId` route separately at the top level so the final path is `/events/:runId`, matching what `apps/web/src/api.ts` already calls. The simplest correct fix: in `apps/api/src/index.ts`, add a second `app.route('/events', eventsRouter)` (or `app.get('/events/:runId', ...)` directly) alongside the existing `app.route('/gate', gateRouter)`, and move the SSE handler out of `gate.ts` into its own small router/export so it's mounted at the root rather than under `/gate`. Keep `/gate/plan-review` and `/gate/diff-review` exactly where they are — only the SSE route moves.

### 2b. `apps/api/src/handlers/runs.ts` (new file) + wiring in `apps/api/src/index.ts` — no handler exists for `POST /api/runs`

The web client's `submitPrompt()` in `apps/web/src/api.ts` posts to `/api/runs` (→ `/runs` after the proxy rewrite), but no route in `apps/api` handles this at all.

**Fix:** Add a minimal `POST /runs` handler. For the vertical slice, it should:
1. Accept `{ prompt: string }` in the body.
2. Insert a new row into the `runs` table via `@aione/db` with `status: 'planning'`, `agent: 'orchestrator'`, and a `sessionId`. Since there's no real session-creation flow yet, insert (or reuse) a stub `workspaces` → `projects` → `sessions` row chain first if none exists, OR — simpler and acceptable for this stub — just generate a random UUID for `sessionId` without a real FK-satisfying row, IF the `sessions` FK constraint would reject that. Check `packages/db/src/schema.ts` first: `runs.sessionId` has `.references(() => sessions.id)`, so a bare random UUID will fail the FK. The pragmatic fix: on server startup or lazily on first request, ensure one stub workspace → project → session chain exists (find-or-create), and reuse its `sessionId` for all demo runs. Keep this minimal — a small `ensureStubSession()` helper in the new `runs.ts` handler that does a `select` and, if empty, one `insert` chain is enough. Do not over-engineer real auth or multi-tenant session handling here.
3. Return the created run as JSON (matching the `Run` shape the frontend's `api.ts` expects it to parse into, at minimum `{ id, status, ... }`).
4. Log the action via `createLogger('api:runs')`.
5. Wrap in try/catch like the existing gate handlers, returning 500 with logged error on failure.

Register this new router in `apps/api/src/index.ts` as `app.route('/runs', runsRouter)` (so the full path is `POST /runs`, matching what the frontend expects after proxy rewrite).

### 2c. `apps/web/src/App.tsx` — the "Start Demo Run" button must call the real API, and the run state must come from `useRun`

Currently the button does `setRun({ id: 'stub-run-1' as any, ... })` — a hardcoded local object, never touching the backend. And `run.plan`/`run.diff` never populate because nothing ever writes to them from a live source.

**Fix:**
1. Import `submitPrompt` from `./api` and `useRun` from `./hooks/useRun`.
2. On "Start Demo Run" click, call `await submitPrompt('demo prompt')`, get back the created `Run` (with a real `id` and `sessionId` from the database), and store just the `runId` in local state (e.g. `const [runId, setRunId] = useState<string | null>(null)`).
3. Use `const run = useRun(runId)` to subscribe to the SSE stream and get live run updates (this hook is already correctly implemented in `apps/web/src/hooks/useRun.ts` — it just needs to actually be called).
4. Keep the rest of `App.tsx`'s render logic (loading / PlanReview / DiffReview / done) working off the `run` returned by `useRun` instead of local component state.
5. The existing SSE handler in the API (`apps/api/src/handlers/gate.ts`, being moved per 2a) currently only streams the run's *current* DB state once plus pings — it does not yet regenerate the plan/diff live. That's fine for this fix round: the point is that the wiring is correct and the request/response path is real, even if the worker's `processRun` still has no caller yet (that remains a known, already-documented Phase 2 gap — do NOT try to wire up worker polling in this fix round, that's out of scope).

**Acceptance for finding 2:** After this fix, `pnpm -r build` still passes, and manually tracing the code path by inspection (or running `pnpm dev` if you want to verify live) shows: clicking "Start Demo Run" → `POST /runs` creates a DB row → response has a real run id → `useRun(runId)` opens `GET /events/:runId` → the SSE endpoint finds the row and streams it back → `App.tsx` receives it via the hook. It's fine if `run.plan`/`run.diff` stay empty because nothing populates them yet (worker isn't polling) — the acceptance bar is that the *plumbing* is correct and doesn't 404 or throw, not that the demo produces a populated plan.

---

## Finding 3 (Important): `pnpm -r lint` fails — no package defines a `lint` script

Root `package.json` declares `"lint": "pnpm -r lint"`, and `.eslintrc.js` exists at the repo root, but none of the 6 workspace packages (`packages/core`, `packages/utils`, `packages/db`, `apps/worker`, `apps/api`, `apps/web`) define their own `lint` script, so `pnpm -r lint` exits with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`.

**Fix:** Add a `"lint": "eslint src --ext .ts,.tsx"` script to each of the 6 packages' `package.json` (adjust `.tsx` inclusion only for `apps/web`, which has JSX; the other 5 packages can use `--ext .ts`). Verify each package already has (or gains) `eslint` resolvable — since `eslint` is a root devDependency and pnpm workspaces hoist by default, this should work without adding `eslint` as a per-package dependency. After adding the scripts, run `pnpm -r lint` from the repo root and confirm it completes (warnings are fine; the bar is "the script exists and runs," not "zero lint warnings").

---

## Finding 4 (Important): compiled `dist/` output can't run under plain `node` — ESM imports are missing `.js` extensions

Running `node apps/api/dist/index.js` or `node apps/worker/dist/index.js` directly crashes with `ERR_MODULE_NOT_FOUND`, because `packages/utils/dist/index.js` (and likely `core`/`db` too) contains bare-specifier re-exports like `export * from './logger'` with no `.js` extension. Node's native ESM resolver (used because every package.json has `"type": "module"`) requires explicit extensions on relative imports — TypeScript's `tsc` does not add them automatically under the current config, and `tsx` (used by `pnpm dev`) is lenient enough to paper over it, which is why this slipped through every prior task's build check.

**Fix:** In the root `tsconfig.json`, change `"moduleResolution": "bundler"` to `"moduleResolution": "nodenext"` and `"module": "ESNext"` to `"module": "nodenext"`. Then, in each package's source files, add explicit `.js` extensions to all relative imports (e.g. `export * from './logger.js'` instead of `export * from './logger'`) — this is what `nodenext` module resolution requires from TypeScript source even though the file on disk is `.ts`. Apply this across all 6 packages' `src/*.ts` files wherever a relative import/export exists. After the change, run `pnpm -r build` to confirm it's still clean, and additionally run `node apps/api/dist/index.js &` briefly (then kill it) and `node apps/worker/dist/index.js &` (then kill it) to confirm both now boot without `ERR_MODULE_NOT_FOUND`. If `nodenext` moduleResolution causes new type errors unrelated to import extensions, stop and report them rather than working around them with `any` or suppressions.

---

## General instructions

- Work through all 4 findings in one pass; they're independent of each other (fix in any order).
- After all fixes, run `pnpm -r build`, `pnpm -r type-check`, and `pnpm -r lint` from the repo root and confirm all three succeed.
- Commit with a message like: `fix: wire web UI to API, correct docker_build policy, add lint scripts, fix ESM extensions`
- You may split into multiple commits if that's cleaner (e.g. one per finding) — either is fine, just keep messages descriptive.
- Do NOT attempt to wire up the worker's `processRun` polling loop — that's explicitly out of scope (documented Phase 2 follow-up).
- Do NOT add authentication, real session management, or any feature beyond what's needed to make the described paths actually connect.

Report status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED) with commit hashes and build/lint/type-check output.
