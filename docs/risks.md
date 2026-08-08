# Risks & open questions

Expands spec §14. Every item has a status and a decide-by phase, because an open question with no deadline is a question that gets answered by accident.

| # | Question | Status | Decide by |
|---|---|---|---|
| R1 | Sandbox cost control | **Decided** — quotas + idle timeouts | Phase 2 |
| R2 | Sandbox egress policy | **Decided** — default-deny | Phase 2 |
| R3 | Filesystem source of truth | **Decided** — git ([ADR 0004](adr/0004-git-as-sandbox-source-of-truth.md)) | Phase 3 |
| R4 | Sandbox vendor churn | **Decided** — own interface, adapters | Phase 1 |
| R5 | Model vendor: Claude-only vs. multi-model | **Decided** — multi-vendor ([ADR 0002](adr/0002-multi-vendor-model-layer.md)) | v0.3 |
| R6 | Primary cloud target for v1 | **Decided** — Fly.io ([ADR 0006](adr/0006-fly-io-as-v1-deploy-target.md)) | v0.3 |
| R7 | Supabase lock-in | **Open** | Phase 3 |
| R8 | Multi-tenancy timeline | **Open** | Phase 0 |
| R9 | Orchestration runtime: Agent SDK vs. LangGraph | **Open** | Phase 2 |

## R7 — Supabase lock-in

**The question.** Supabase's Management API is the fastest path to provisioning a database for a generated app. But apps we generate against it inherit Supabase-specific auth, RLS policies, storage, and client libraries. Do generated apps stay portable to any Postgres?

**Why it's urgent despite being deferrable.** Retrofitting portability is far more expensive than preserving it. Every generated app written against the Supabase client is one more app to migrate if the answer later turns out to be "portable."

**The likely shape of the answer:** provision through Supabase (keep the speed) but have the Backend agent generate against plain Postgres + a thin adapter wherever it's cheap to do so — standard SQL migrations rather than Supabase-specific DDL, our own auth abstraction rather than direct `supabase.auth` calls in components. Accept lock-in for storage and realtime, where the alternative is genuinely more work.

**Decide by Phase 3**, when Supabase provisioning is actually built.

## R8 — Multi-tenancy timeline

**The question.** Everything in the spec assumes single-user or small-team. If this must serve many orgs, sandbox isolation and secret storage need tenant boundaries designed in, not bolted on.

**Current position:** the `Workspace` entity exists in v1 as the seam even with one team in it ([data-model.md](data-model.md)), and secrets are partitioned by Workspace from the start. That's cheap insurance. The expensive part — proving sandbox isolation between tenants, per-tenant egress policy, per-tenant quota enforcement — is not built.

**Decide by Phase 0**, because it's a schema question and schema is what's hard to change. The decision needed now is not "build multi-tenancy," it's "commit to the seams" — and the seams are already committed.

## R9 — Orchestration runtime

**The question.** Anthropic Agent SDK or LangGraph?

**The tension.** The Agent SDK gives native subagents with isolated context and built-in MCP support — very close to the FE/BE/DevOps split, for free. But it locks the *orchestrator* to Claude models (routable via the Anthropic API, Bedrock, or Vertex). That sits awkwardly against R5's multi-vendor decision.

**Reading of the tension:** R5's multi-vendor decision is primarily about the *role agents* — the high-volume calls where cost, latency, and per-task fit vary. The orchestrator runs once per request, and planning quality dominates its cost. Locking that one seat to Claude while keeping the agent tier vendor-flexible is a coherent position, not a contradiction. But it should be a written decision rather than a thing that happens because the SDK was convenient.

**Decide by Phase 2**, when the first real orchestrator ships. Until then, keep the orchestrator's interface narrow enough that the runtime is replaceable.

## Standing risks (mitigated, never closed)

**Prompt injection via imported repos.** We import arbitrary repositories, and a README can contain instructions. Structurally mitigated: agent output is a proposal, never policy ([security.md](security.md)). Not something that gets "fixed."

**Agentic loop cost.** Retry-until-green is the natural shape of an agent loop, and each retry costs sandbox minutes and tokens. Quotas cap the damage; they don't remove the incentive to keep loops tight.

**Documentation drift.** These chapters state invariants the code is supposed to hold. A chapter that no longer describes reality is a bug — use `/spec-sync` to check.

## Related

- [roadmap.md](roadmap.md) · [adr/](adr/) · [security.md](security.md)
