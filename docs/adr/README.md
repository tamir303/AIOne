# Architecture Decision Records

An ADR records a decision that is expensive to reverse, at the moment it's made, with the reasoning and the rejected alternatives intact. The value is almost entirely in the "why" and the "what we rejected" — a decision without those is just a fact, and facts get re-litigated by whoever arrives next.

## Rules

- **Write the ADR before the decision is executed**, not after it ships. Use `/adr` to draft one.
- One decision per record. If it has two independent parts, it's two ADRs.
- Never edit an accepted ADR's decision. **Supersede it** with a new one and mark the old one `Superseded by NNNN`. The history is the point.
- Number sequentially, never reuse. Filename: `NNNN-kebab-case-title.md`.
- Record what was rejected and why. Six months later that's the section people actually read.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-approval-gate-as-architecture.md) | The approval gate is an architectural layer, not UI | Accepted |
| [0002](0002-multi-vendor-model-layer.md) | The model layer is multi-vendor by design | Accepted |
| [0003](0003-mcp-as-sole-integration-substrate.md) | MCP is the only path to external services | Accepted |
| [0004](0004-git-as-sandbox-source-of-truth.md) | Git is the source of truth across sandbox lanes | Accepted |
| [0005](0005-single-agent-before-multi-agent-split.md) | Ship one full-stack agent before the FE/BE/DevOps split | Accepted |
| [0006](0006-fly-io-as-v1-deploy-target.md) | Fly.io is the single v1 deploy target | Accepted |
| [0007](0007-monorepo-vite-hono-worker.md) | pnpm monorepo: Vite SPA + Hono API + separate agent worker | Accepted |
| [0008](0008-clerk-neon-drizzle-for-platform.md) | Platform auth and database: Clerk + Neon Postgres + Drizzle | Accepted |
| [0009](0009-thin-slice-before-phases.md) | Thin vertical slice through the entire loop before building phases | Accepted |
| [0010](0010-postgres-table-for-project-files.md) | Project files are stored in a Postgres table, not git, until a sandbox lane exists | Accepted |

Template: [template.md](template.md).
