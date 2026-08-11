# 0007 — pnpm monorepo: Vite SPA + Hono API + separate agent worker

- **Status:** Accepted
- **Date:** 2026-08-11
- **Spec reference:** §6 (Execution), §12 (Data model)
- **Affects:** repo layout, build system, deployment model

## Context

AIOne needs three independent pieces working together:

1. **IDE Shell** — React SPA, all state client-side, no SSR. Fast to iterate, responsive UX.
2. **API** — REST endpoints for persistence, plus SSE streaming for agent output.
3. **Agent Worker** — Long-running process for Runs. Blocks on approval gates for minutes. Does not fit serverless function timeouts or a web framework's request lifecycle.

A single Next.js app would force either (a) a queue+worker architecture layered on top, or (b) async Run handling that complicates the approval-gate blocking semantics. A fully decoupled three-piece architecture is clearer.

## Decision

**pnpm monorepo** with three applications and a shared package layer:

```
aione/
├── apps/
│   ├── web/          Vite + React SPA
│   ├── api/          Hono server (REST + SSE)
│   └── worker/       Agent Runs, gate layer, MCP client
├── packages/
│   ├── core/         ActionClass, ApprovalToken, policy table, Run/Approval types
│   ├── sandbox/      SandboxLane interface + adapters (WebContainers, E2B, remote)
│   ├── deploy/       DeployAdapter interface + Fly.io + future adapters
│   ├── providers/    Model provider abstraction (Claude, Bedrock, Vertex)
│   ├── db/           Drizzle schema, migrations
│   └── utils/        Shared helpers (logging, parsing, etc.)
├── mcp/
│   ├── fly-server/
│   └── registry-server/
└── pnpm-workspace.yaml
```

- **Workspace:** pnpm workspaces with TypeScript project references. Enables per-package build, test, and lint without duplicating config.
- **No monorepo complexity yet.** Each app and package is as simple as possible. Shared code lives in packages only when actually reused.
- **Deployment:** web and api are stateless and deploy independently (Vercel/Netlify frontend, Hono to Fly.io). Worker is one long-running process on the deployment platform.

## Alternatives rejected

**Single Next.js app with API routes.** Simpler repo layout, familiar framework. Route handlers become the "workers," and Runs use a message queue (Bull, BullMQ) or a webhook loop to simulate blocking. This adds a queue dependency and makes the gate layer asynchronous — which is not worth the complexity savings. Also, mixing edge-computed pages with long-running background work is awkward in Next.js's model.

**Separate repos.** Three GitHub repos, shared deps via npm. Cleaner module boundaries, independent CI/CD. Rejected because:
- Monorepo discipline is easier to enforce — one build, one lint, one test suite.
- Shared types (Run, Approval, ActionClass) live in `packages/core` and are versioned with the code that uses them, avoiding version mismatch.
- Onboarding and CI setup is simpler with one repository.

**Serverless throughout.** Lambda + SQS + DynamoDB for all three. Rejects the spec's core constraint: the gate is blocking, and blocking doesn't fit Lambda's 15-minute max execution time.

## Consequences

**Accepted costs.** Monorepo tooling overhead (pnpm, TypeScript references, workspace setup). Separate deployment per app (more moving parts in Phase 6). Cross-workspace testing and CI require careful setup.

**What this enables.** Clean separation of concerns: web has no backend logic, API has no long-running processes, worker has no UI. Each can scale or deploy independently. Shared types prevent drift.

**What would reverse this.** Evidence that the monorepo overhead dominates or that the three pieces need to be decoupled further — e.g., different teams, different release cycles, very different deployment constraints. v1 is one team and one shared schedule, so this isn't urgent. If it happens, extracting a piece into its own repo is straightforward.
