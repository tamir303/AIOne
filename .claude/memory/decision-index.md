---
name: decision-index
description: What AIOne has already decided and what is still open, so settled questions aren't re-litigated
metadata:
  pinned: false
---

# Decision index

Read this before proposing an architectural direction. Most of the obvious questions have already been argued; the reasoning is in the ADRs, and re-opening one without new evidence costs everyone time.

## Settled

| Decision | Record | One-line reason |
|---|---|---|
| The approval gate is a blocking architectural layer, not UI | [ADR 0001](../../docs/adr/0001-approval-gate-as-architecture.md) | A guarantee that depends on remembering to call a modal is not a guarantee |
| The model layer is multi-vendor | [ADR 0002](../../docs/adr/0002-multi-vendor-model-layer.md) | Three call profiles with different optimal answers; the abstraction is cheap now, expensive to retrofit |
| MCP is the only path to external services | [ADR 0003](../../docs/adr/0003-mcp-as-sole-integration-substrate.md) | It's what makes per-agent tool scopes enforceable rather than advisory |
| Git is the source of truth across sandbox lanes | [ADR 0004](../../docs/adr/0004-git-as-sandbox-source-of-truth.md) | The alternative is building a distributed filesystem as a side quest |
| One full-stack agent ships before the FE/BE/DevOps split | [ADR 0005](../../docs/adr/0005-single-agent-before-multi-agent-split.md) | The core loop must be validated before its complexity is tripled |
| Fly.io is the only v1 deploy target | [ADR 0006](../../docs/adr/0006-fly-io-as-v1-deploy-target.md) | It consumes the container image we already build, and one adapter finished beats three half-built |
| Sandbox egress defaults to deny | spec §14, [docs/security.md](../../docs/security.md) | Isolation doesn't stop generated code from sending data out |
| Quotas and idle timeouts ship in Phase 2 | spec §14, [docs/roadmap.md](../../docs/roadmap.md) | Retry-until-green is the natural shape of an agent loop |
| GitHub App, not bare OAuth | spec §7 | Per-repo, revocable, short-lived tokens, and webhooks |
| Claude native vision; no separate vision model | spec §11 | One vendor, one context — v0.1's "GPT-4o or Claude Vision" is obsolete |

## Open — with deadlines

| # | Question | Decide by | Current lean |
|---|---|---|---|
| R7 | Supabase lock-in vs. plain-Postgres portability | Phase 3 | Provision through Supabase; generate against standard SQL and our own auth abstraction where that's cheap; accept coupling for storage and realtime |
| R8 | Multi-tenancy timeline | Phase 0 | Commit to the seams now (`Workspace` exists, secrets partitioned by it); don't build the isolation work yet |
| R9 | Anthropic Agent SDK vs. LangGraph | Phase 2 | Agent SDK, accepting that it pins the *orchestrator* to Claude — but decide it in its own ADR rather than absorbing it because the SDK was convenient |

Details and reasoning: [docs/risks.md](../../docs/risks.md).

## Reopening a settled decision

Legitimate, but it costs an ADR. Bring the evidence the original record named under "what would reverse this" — each ADR states it explicitly. "I'd have done it differently" is not evidence; a measurement is.

## Standing risks that never close

Prompt injection via imported repositories, agentic loop cost, and documentation drift. These are mitigated structurally, not fixed. Treat a proposal to "solve" one of them as a proposal to strengthen a mitigation.
