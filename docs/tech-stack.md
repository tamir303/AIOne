# Tech stack

Expands spec §11. Every row records what we chose, and — more usefully — what we rejected and why.

## Model layer

| Role | Default | Rejected alternative |
|---|---|---|
| Orchestrator / planner | Claude Opus 4.8 | Sonnet for everything — planning errors are the expensive kind, and the orchestrator runs once per request |
| Role agents | Claude Sonnet 5 | Opus for agents — cost doesn't survive a long session |
| Routing, autocomplete | Claude Haiku 4.5 | Sonnet — latency-bound work where judgment isn't the bottleneck |
| Vision (screenshots, wireframes) | Claude, native | A separate vision model — a second vendor and a second context for no gain; v0.1's "GPT-4o or Claude Vision" is obsolete |

**Model IDs move.** Never hardcode one from memory — resolve through the provider abstraction, and check the `claude-api` skill when pricing or capability matters.

**The layer is multi-vendor by design** (v0.3). These are per-role defaults, not bindings. Every call goes through our provider interface; `@anthropic-ai/sdk` is imported in exactly one directory. See [ADR 0002](adr/0002-multi-vendor-model-layer.md), including the genuine tension with the Agent SDK choice below.

## Orchestration

| Layer | Choice | Note |
|---|---|---|
| Orchestration runtime | Anthropic Agent SDK (leaning), or LangGraph | Agent SDK gives native subagents with isolated context and built-in MCP — close to the FE/BE/DevOps split out of the box, but locks the orchestrator to Claude models (via Anthropic API, Bedrock, or Vertex). LangGraph is model-agnostic if that matters more. Unresolved — see [ADR 0002](adr/0002-multi-vendor-model-layer.md) |
| Tool-calling substrate | MCP | The one integration substrate. Reference/community servers exist for GitHub and Docker; cloud integrations standardize on the same shape |
| Streaming / UI sync | Vercel AI SDK | Streaming, partial-message UI, tool-call rendering — all things we'd otherwise rebuild |

## Execution

| Layer | Choice | Note |
|---|---|---|
| In-browser execution | StackBlitz WebContainers | Instant preview, runs on the user's CPU. Node-only, no Docker daemon |
| Heavy / native execution | E2B | Python/Go/Rust, long jobs. **Not** Docker builds |
| Docker image builds | Depot, or GitHub Actions + BuildKit | Dedicated lane; avoids docker-in-docker limits |

All three sit behind our own `SandboxLane` interface. Vendor churn is a live risk (spec §14) — see [sandbox-execution.md](sandbox-execution.md).

## Editor & UI

| Layer | Choice | Note |
|---|---|---|
| Code editor | Monaco | VS Code's editor; users already know the keybindings |
| Visual editing | Onlook | Click-to-edit in the preview, mapped back to source |
| Styling | Tailwind + shadcn/ui | Copy-in components, no runtime dependency, models generate it well |
| Terminal | xterm.js | Standard |

Do not introduce a second component library. Consistency in generated output matters more here than in a normal app, because the user reads a *lot* of generated markup.

## Platform services

| Layer | Choice | Note |
|---|---|---|
| Generated-app database | Supabase Management API | Fast to provision; Postgres underneath. Lock-in is an open question — [risks.md](risks.md) |
| Cache | Upstash Redis | Semantic cache for repeated vibe patterns. Keys must include trust tier |
| Version control | GitHub App + Octokit | Not bare OAuth — [github-workflow.md](github-workflow.md) |
| Vulnerability scanning | Trivy (default) or Grype | Between build and registry push |
| IaC / deploy | Adapter per target; Terraform or Pulumi where the target needs it | Fly.io first — [cloud-deploy.md](cloud-deploy.md) |
| Observability | OpenTelemetry | One trace across agent calls *and* the deployed app |
| Platform auth | Clerk, Auth.js, or Supabase Auth | Auth of the IDE itself — distinct from the generated app's auth. Don't conflate them |

## Language and runtime

TypeScript across the platform. v1 supports generating Node/TS and Python apps only (spec §15) — not because other runtimes are hard, but because each one multiplies the surface of the sandbox router, the Dockerfile generator, and the deploy adapters.

## Related

- [architecture.md](architecture.md) · [risks.md](risks.md) · [adr/](adr/)
