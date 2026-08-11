# Task 6 Report: API - Hono server with SSE

## Status: DONE_WITH_CONCERNS

## Commits made

```
bc6a298 feat: Hono API with gate endpoints and SSE
```

Range: `caaf9bf..HEAD` (one commit, on top of Task 5's worker commit). 6 files changed, 174 insertions: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/api/src/handlers/gate.ts`, `apps/api/src/middleware/errors.ts`, plus `pnpm-lock.yaml` updated for the new dependencies.

## What was built

`@aione/api` — Hono v3 REST server:

- `POST /gate/plan-review` — inserts a row into `approvals` (`db.insert(approvals).values(...).returning()`), returns `{ approved, approvalId }`.
- `POST /gate/diff-review` — same shape, for diffs.
- `GET /events/:runId` — SSE via `c.streamText()`; writes the current run row once, then pings once/sec for 30s.
- `GET /health` — liveness check.
- Request-logging middleware (method, path, status, duration) and `onError`-based error middleware, both wired in `src/index.ts`.
- `dotenv/config` imported first for env loading; `API_PORT` read from env, default 3001.

## Build output

`pnpm build` in `apps/api`: clean, `tsc` exits 0, no output (no errors).

`pnpm -r build` from repo root: all 5 workspace packages build clean —
```
packages/utils build: Done
packages/core build: Done
packages/db build: Done
apps/worker build: Done
apps/api build: Done
```

`dist/` verified populated: `apps/api/dist/index.{js,d.ts}`, `dist/handlers/gate.{js,d.ts}`, `dist/middleware/errors.{js,d.ts}`, with source maps.

## Fixes applied over the brief (and why)

1. **`.where({ id: runId as any })` → `.where(eq(runs.id, runId))`.** Same bug class flagged by the Task 5 reviewer for the worker: drizzle-orm's `.where()` takes a `SQL` condition, not a plain object — the brief's version would silently match zero rows rather than error, which is worse than a compile failure. Added `drizzle-orm` as a direct dependency of `apps/api` (mirroring what Task 5 already had to do for the worker) and imported `eq`.

2. **The brief's `index.ts` never calls `serve()`.** Hono v3 has no built-in Node HTTP listener — `app` is a fetch-shaped router, not a server. The brief only logs `"api starting on port ${port}"` and exports `app`; nothing would actually be listening. Added `@hono/node-server` (`^1.8.0`) and `serve({ fetch: app.fetch, port })`. Verified live: `GET /health` returns `200 {"ok":true}` when run via `pnpm dev`.

3. **`"dev": "node --loader tsx/esm src/index.ts"` fails on Node 24.** `--loader` was removed in favor of `--import` (this repo's `node --version` is v24.19.0). Changed api's script to `node --import tsx/esm src/index.ts`; confirmed the dev server now boots and serves. **`apps/worker`'s package.json (Task 5, already committed) has the identical broken script** — out of this task's file scope to fix, flagging for a follow-up task or the Task 5 owner.

## Runtime verification performed (beyond the brief's required steps)

Since I added the actual `serve()` call, I checked it works, not just compiles:

- `pnpm dev` (via `--import tsx/esm`) boots and `GET /health` → `200 {"ok":true}`, with the request-logging middleware logging correctly.
- `POST /gate/plan-review` against a DB with nothing listening on 5432 returns a clean `500 {"error":"Internal server error"}` — the error middleware and try/catch in the handler both do their job; the process does not crash. (Confirms fail-safe behavior under a cold/absent Postgres, which is the state a fresh checkout will be in without `docker-compose up`.)

## Concern for the reviewer (not fixed — outside this task's file scope)

Running the **compiled** output directly (`node apps/api/dist/index.js`, i.e. a "production" run rather than `pnpm dev`) fails:

```
Cannot find module '...\packages\utils\dist\logger' imported from '...\packages\utils\dist\index.js'
```

`tsc` with `module: ESNext` does not append `.js` to relative specifiers, but Node's own ESM resolver requires the extension. `tsx` (used by `pnpm dev`) is lenient enough to resolve these anyway, which is why dev-mode works, but a plain `node dist/index.js` does not. This is **pre-existing in `packages/utils`, `packages/core`, and `packages/db` (Tasks 2–4, already committed)** — not introduced here, and it's repo-wide, so it also affects `apps/worker`'s eventual production run, not just `apps/api`. It doesn't fail `tsc`/`pnpm build`, which is why it slipped through those tasks' acceptance checks. Recommend a follow-up task: either set `moduleResolution: nodenext` + explicit `.js` extensions across `packages/*/src`, or introduce a bundler (esbuild/tsup) for the actual runtime artifact, before relying on `node dist/index.js` anywhere in this stack.

## Self-review notes

- No secrets in code; `DATABASE_URL` and `API_PORT` come from env only, with local-dev fallbacks matching the pattern already established in `packages/db/src/index.ts`.
- Approvals are only ever inserted, never updated/deleted, from these handlers — consistent with the append-only intent noted by the Task 5 reviewer (enforcement is still DB-role level TODO, not this task's job).
- Did not touch `packages/core`, `packages/db`, `packages/utils`, or `apps/worker` — stayed within the Task 6 file list (`apps/api/**`) plus the lockfile, which `pnpm install` updates automatically for any new package's dependencies.
