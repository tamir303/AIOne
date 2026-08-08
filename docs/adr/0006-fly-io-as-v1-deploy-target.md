# 0006 — Fly.io is the single v1 deploy target

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §9, §14 ("Primary cloud target"), §15, decided in v0.3
- **Affects:** docs/cloud-deploy.md, docs/roadmap.md (Phase 6)

## Context

Spec §9 specifies an adapter pattern with several candidate targets: Vercel/Netlify for frontend and serverless, Fly.io/Render/Railway for containers, and the hyperscalers via Terraform or Pulumi. Spec §14 then asks the real question — pick one to actually finish, rather than three to leave half-done — and §15 restates it as a non-goal: one adapter done well beats three half-built ones.

v0.3 decided: Fly.io.

## Decision

**Fly.io is the only deploy adapter built for v1.** No second adapter starts until Fly.io works end to end, *including rollback*.

The reasons it wins:

- **It takes a container image**, which our pipeline already produces ([docker-pipeline.md](../docker-pipeline.md)). No second artifact format, no second build path.
- **Fastest path to a working URL**, which is the demo that has to land.
- **Scriptable CLI and API** that wrap cleanly as an MCP server ([ADR 0003](0003-mcp-as-sole-integration-substrate.md)).
- **A real secret manager**, so the "never write a secret to a repo file" rule has somewhere to put secrets instead.
- **Genuine plan/apply semantics** for config changes, matching the plan → diff → approve → apply sequence spec §9 mandates.
- **Rollback is first-class**, and an adapter without working rollback isn't finished.

Everything target-specific stays behind the `DeployAdapter` interface. Nothing outside `adapters/fly` knows the word "Fly."

## Alternatives rejected

**Vercel.** The best DX of the candidates and the obvious fit for a frontend-heavy tool. Rejected as the *first* adapter because its model is functions and static assets, not containers — so choosing it means our Docker pipeline doesn't feed our deploy path, and we'd be building two artifact stories at once. It's a strong second adapter.

**Render or Railway.** Very close on the merits; both take containers and both are easy. Fly.io edges ahead on secret-manager quality and on plan/apply semantics that fit the approval sequence. This one is close enough that it should be re-examined honestly if Fly.io disappoints in Phase 6.

**AWS via Terraform.** The most general and most credible for eventual enterprise use, with a real `terraform plan` that fits the diff-review gate perfectly. Rejected for v1 because the surface is enormous — IAM, networking, ECR, ECS or App Runner — and each piece is a place the v1 adapter could stall. This is the fourth adapter, not the first.

**Build the adapter interface and two implementations at once.** Ostensibly proves the abstraction. Rejected because an abstraction validated by two half-finished implementations is validated by nothing; the first *complete* implementation is what reveals the interface's real requirements.

## Consequences

**Accepted costs.** Users who need Vercel or AWS can't use the deploy feature in v1. The interface risks being shaped by Fly.io's specifics — mitigated by writing the interface first and reviewing it against a sketched Vercel adapter before Phase 6 closes, without building that adapter. And Fly.io becomes a dependency whose outage is our outage.

**What this enables.** Phase 6 can actually finish, including rollback and the observability tie-in. The docker pipeline feeds directly into deploy with no second artifact path. And the second adapter is dramatically cheaper once the first has survived production contact.

**What would reverse this.** Fly.io proving unreliable or its API proving unsuitable for gated plan/apply during Phase 6. Render is the fallback, and switching should cost one adapter directory — if it costs more, the interface leaked and that's the bug to fix first.
