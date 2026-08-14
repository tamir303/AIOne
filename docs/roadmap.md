# Roadmap

Expands spec §13. Each phase has an exit criterion — a thing that must be *demonstrably true*, not a checklist that's been ticked. Phases are sequential because each one's exit criterion is the next one's assumption.

## Phase 0 — Foundations

Platform auth, the Workspace/Project/Session/Run/Deployment schema, bare app shell.

**Exit (met):** a user can sign in, create a Workspace and Project, and the schema round-trips. The Approvals table exists and is append-only at the database level.

Proof:
- Schema round-trip integrity: [`packages/db/src/schema.round-trip.test.ts`](../packages/db/src/schema.round-trip.test.ts) — tests foreign keys, defaults, and ON DELETE behavior.
- Approvals table append-only guarantee at DB level: [`packages/db/src/approvals-append-only.test.ts`](../packages/db/src/approvals-append-only.test.ts) — verifies `aione_app` role cannot UPDATE or DELETE approval records despite being able to INSERT and SELECT.
- Sign-in / create-Workspace / create-Project flow: [`apps/api/src/handlers/workspaces.test.ts`](../apps/api/src/handlers/workspaces.test.ts) — integration tests of the auth boundary and the core user-journey handlers.

All three test suites run in CI per [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (`pnpm -r test` step).

## Phase 1 — Manual IDE core

Monaco, file tree, xterm.js, WebContainers, live preview. No AI anywhere.

**Exit:** you can build a small app in it, by hand, and prefer it to opening a local editor.

This bar is deliberately high. Spec §13 says it has to feel like a real IDE before any AI touches it — because if the editor is mediocre, every agent-produced diff lands in an environment the user doesn't want to review in, and the whole hybrid mode fails for reasons that have nothing to do with the models.

## Phase 2 — Single-agent vibe loop

One full-stack agent, streamed via Vercel AI SDK. First approval gate: plan review.

**Exit:** prompt → plan → review → diff → accept → working app in preview, and the loop survives a rejection at either gate without losing state.

Do not split into three agents here. Spec §5's MVP shortcut is an instruction. The thing being validated is the *loop* — whether plan review catches wrong directions early, whether per-hunk diff review is usable at real diff sizes, whether rejection-with-reason produces a better second attempt. All three questions are answerable with one agent and get harder to answer with three.

## Phase 3 — Multi-agent split + visual editor

Frontend/Backend/DevOps agents with real tool scopes, Supabase provisioning, Onlook click-to-edit.

**Exit:** a Frontend Run demonstrably *cannot* call a deploy tool — verified by a test that asserts the denial, not by reading the config. Handoffs work; a frontend Run needing an API route produces a backend Run.

**Blocked on:** the filesystem source-of-truth decision, which spec §14 says must be settled *before* this phase. It is — [ADR 0004](adr/0004-git-as-sandbox-source-of-truth.md).

## Phase 4 — GitHub integration

GitHub App install, branch-per-task, PR flow, CI status in-IDE.

**Exit:** an agent opens a PR a human reviewer can evaluate without opening the IDE, and a failing check flows back as context for a fix proposal.

## Phase 5 — Docker & artifact pipeline

Dockerfile generation, remote-builder builds, Trivy scan, gated registry push.

**Exit:** a generated Dockerfile passes the [docker-pipeline.md](docker-pipeline.md) checklist unprompted — multi-stage, digest-pinned, non-root, no secrets in layers — and a CRITICAL scan finding stops the pipeline.

## Phase 6 — Cloud deploy & observability

One deploy adapter end-to-end (Fly.io), IaC diff review, OpenTelemetry, trust tiers finalized.

**Exit:** plan → diff → approve → apply → live URL, **and rollback works.** An adapter without rollback is not done. Traces span agent calls and the deployed app in one view.

## What is deliberately not on this roadmap

From spec §15: runtimes beyond Node/TS + Python, enterprise SSO/RBAC/audit export, multi-region and autoscaling policy, and any second deploy adapter. One adapter done well beats three half-built ones — and the second adapter is much cheaper to write after the first one has survived contact with production.

## Sequencing rules

- **Don't start a phase whose predecessor's exit criterion is unmet.** The criteria are load-bearing, not ceremonial.
- Cost controls (quotas, idle timeouts) and default-deny egress ship with Phase 2, when sandboxes first run agent-generated code — not in Phase 6 with the rest of the ops work.
- The approval gate ships in Phase 2 and is extended in every later phase. It is never added retroactively to a shipped action.

## Related

- [risks.md](risks.md) — open questions mapped to decide-by phases
- [adr/](adr/)
