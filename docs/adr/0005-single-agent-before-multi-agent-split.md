# 0005 — Ship one full-stack agent before the FE/BE/DevOps split

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §5 ("MVP shortcut"), §13
- **Affects:** docs/agents.md, docs/roadmap.md (Phase 2 vs. Phase 3)

## Context

Spec §5 describes an Orchestrator over Frontend, Backend, and DevOps agents, each with its own prompt, context slice, and — the part that matters — its own tool scope. That's the target architecture and it's the right one.

It is also tempting to build first, because it's the interesting part. Spec §5 pre-empts that with an explicit MVP shortcut, and this ADR records why that shortcut is an instruction rather than a hedge.

## Decision

Phase 2 ships **one full-stack agent** playing all three roles at the same judgment bar. The split into specialists happens in Phase 3, and only after Phase 2's exit criterion is met.

- The single agent runs behind the full approval gate. Nothing about the gate is deferred.
- Its tool scope is the **union** of the three role scopes. That's broad, which is why Phase 2 is confined to a single user's own sandbox and why registry/deploy gates stay confirm-only regardless.
- The `Run` schema carries an `agent` field from day one, so the split is a change in who fills the field, not a migration.
- Phase 3 begins when we need the permission boundaries or the parallelism — not when the single agent produces imperfect code. Better code is not what the split buys.

## Alternatives rejected

**Build the three-agent split immediately.** It's the target architecture, so building it once seems cheaper than building twice. Rejected because it multiplies every bug in the core loop by three and adds a handoff protocol on top — while the questions Phase 2 exists to answer are all about the loop itself: does plan review catch wrong directions early enough to be worth a gate; is per-hunk diff review usable at realistic diff sizes; does rejection-with-reason actually produce a better second attempt. Every one of those is answerable with one agent and gets harder to answer with three.

**Two agents (app + infra).** A middle path with a genuine boundary — infra credentials separated from application code. Rejected as the worst of both: it adds handoff complexity without the full permission model, and the boundary it draws isn't the one the target architecture needs.

**Skip the split permanently; one agent with dynamic tool scoping.** Genuinely attractive — scope tools per task rather than per agent, and you get the security property without the handoff protocol. Rejected for v1 because it makes scope a runtime decision derived from task classification, and task classification is model output. Deriving a security boundary from model output is the pattern this system exists to avoid. Worth revisiting if handoffs prove more expensive than expected.

## Consequences

**Accepted costs.** Phase 2's agent has a broad tool scope, so the permission property arrives late — mitigated by keeping Phase 2 single-user and keeping the boundary-crossing gates at confirm. Some Phase 2 prompt work is thrown away when roles split. Parallelism doesn't exist until Phase 3, so large features are slower.

**What this enables.** The core loop gets validated against real usage before three-way complexity is layered on. Phase 3's design is informed by what Phase 2 learned about where handoffs are actually needed, rather than by guessing. And Phase 2 is small enough to ship, which is the point of a phase.

**What would reverse this.** A concrete need for the permission boundary earlier than Phase 3 — multi-user workspaces, or handing the agent production credentials sooner than planned. Either would pull the split forward, and the exit criterion should move with it rather than be waived.
