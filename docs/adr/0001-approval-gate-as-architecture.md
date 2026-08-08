# 0001 — The approval gate is an architectural layer, not UI

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §2, §10
- **Affects:** docs/trust-model.md, docs/architecture.md, every state-changing subsystem

## Context

Every agentic coding tool has confirmation prompts. Most implement them as UI: the action is a function call, and somewhere before it a modal renders. That works until it doesn't — a code path added later forgets the modal, a "batch mode" flag skips it for convenience, or an action executes while its dialog is still open.

We are handing agents real credentials: GitHub write access, registry push, cloud deploy, database DDL. The cost of one missed confirmation isn't a bad diff, it's a deleted production table. A guarantee that depends on every future contributor remembering to call the modal is not a guarantee.

## Decision

Every state-changing action passes through a blocking gate layer: **classify → policy (class × tier) → block and await decision → execute → record.**

- The gate is a layer in the call path, not a component in the render tree. An agent cannot reach an effect without traversing it.
- It **blocks**. The Run is suspended, not racing a dialog.
- Interfaces to gated effects require an `ApprovalToken` argument. `DeployAdapter.apply(plan, approval)` cannot be called without one — so "forgot to check" is a type error rather than an incident.
- The classifier **fails closed**: an action it can't classify is treated as destructive.
- Every decision, approve and reject alike, appends to `Run.Approvals[]` and emits a trace span.
- The floor rows of the trust matrix are absent from the config schema entirely, so there is no key to flip.

## Alternatives rejected

**Confirmation dialogs at call sites.** Simplest, and it's what most tools do. It fails by omission — the tenth gated action added by a contributor who hasn't read this document is the one that ships without a prompt. Nothing structurally prevents it.

**Policy engine advising the agent.** Give the agent a policy description and expect it to ask. This treats a security boundary as a prompt instruction, and prompt instructions are precisely what fails under prompt injection — the threat we most need to survive when importing arbitrary repos.

**Post-hoc audit with undo.** Let actions run and offer reversal. Works for sandbox file writes (which is exactly why Balanced tier auto-approves them with instant undo) and does not work for anything irreversible. You cannot undo a dropped table or an image the world already pulled.

## Consequences

**Accepted costs.** Every new external effect requires gate integration, which is real friction — and that friction is the feature. Blocking means Runs suspend, so the execution model needs durable suspension and resumption; that's meaningful complexity in Phase 2. Failing closed means occasional unnecessary prompts on novel-but-safe actions.

**What this enables.** The approval trail is a byproduct rather than a feature to build. Trust tiers become one policy table instead of scattered conditionals. Prompt injection can make an agent propose anything and still cannot make the gate approve it. And it's what makes giving the product real credentials defensible.

**What would reverse this.** Nothing. If gate friction becomes the product's main complaint, the answer is a better classifier and better-worded confirmations — not a bypass. The floor rows in particular are non-negotiable per spec §10.
