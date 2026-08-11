# 0009 — Thin vertical slice through the entire loop before building phases

- **Status:** Accepted
- **Date:** 2026-08-11
- **Spec reference:** §5 (MVP shortcut), §13 (Roadmap)
- **Affects:** docs/roadmap.md, build sequencing

## Context

Spec §13 defines six phases in order: Phase 0 (schema), Phase 1 (IDE shell), Phase 2 (single-agent vibe loop), etc. Following them literally means building schema and auth first (Phase 0), then a complete Monaco editor with file tree and preview (Phase 1), before any agent or gate.

That's waterfall-adjacent: if the IDE shell turns out to be less usable than expected, all of Phase 0's work is wasted. If the gate layer has a design flaw, it's expensive to discover after building both orchestrator and agents.

The tight constraint is that Runs block on approval gates for minutes. That's not a feature you can retrofit; it's an architectural dependency. The gate and the Run/Approval schema are the bet the whole design is making. Testing them early is essential.

## Decision

**Build a thin vertical slice through the entire loop first — before backfilling phases.**

Slice scope: prompt → plan → plan-review gate → stubbed diff → diff-review gate → approval recorded.

- **Stubbed agent:** no real Claude, no real reasoning. Just returns a fake plan and a fake diff.
- **Stubbed sandbox:** no WebContainers, no E2B. Just stubs.
- **Real gate layer:** the approval flow, the token model, the policy table, the blocking semantics.
- **Real Run/Approval schema:** append-only at the database level, real approvals written.
- **Real SSE streaming:** plan and diff flow from worker to web via SSE.
- **Minimal UI:** two screens (plan review, diff review) with real interaction.

Exit criterion: a user can submit a natural-language prompt, see a plan, reject or accept it, see a diff, reject or accept it, and the approvals are recorded in the database with the exact timestamp and tier.

After this slice is working:
- **Phase 0** gets backfilled: proper auth (Clerk), database setup (Neon), workspace/project UI.
- **Phase 1** gets backfilled: full IDE shell (Monaco, file tree, xterm, WebContainers, live preview).
- **Phase 2** builds from here: real agent, real sandbox, keeps using the validated gate layer.

## Alternatives rejected

**Phases in order (Phase 0 → Phase 1 → Phase 2).** The spec's sequence. Follow it strictly. Rejected because Phase 1 (a complete working IDE) is expensive to build before proving the gate works. If the gate design needs revision after Phase 2, Phase 1's work might need redoing. Testing the constraint early is cheaper.

**Skip the gate entirely in Phase 2, retrofit it later.** Build the agent and sandbox first, add approval gates in Phase 3. Rejected because the gate is architectural — approvals and the blocking semantics are baked into the Run lifecycle. Retrofitting means redesigning Runs, rewriting the worker, and re-testing everything. Worse, a Phase 2 that "works" without gates will train people to think gates are optional.

**Full application before any agent.** Build Phases 0 and 1 completely (auth, database, IDE shell), then build Phase 2 knowing everything works except agents. Rejected because it's the longest path. We spend weeks on the IDE shell and still don't know if the gate design survives contact with a real orchestrator.

## Consequences

**Accepted costs.** The slice is "fake" — stubs for agent and sandbox. That code gets replaced. But the gate, the schema, the streaming, and the interaction model are real and stay. Some Phase 0 work (schema design, database setup) happens twice: once in the slice (minimal), once in Phase 0 (full). But the slice's schema is a good prototype — it often survives to Phase 0 with only additions.

**What this enables.** Gate design flaws surface in days, not weeks. By the time the agent ships (Phase 2), the approval flow has been proven. The slice is also a concrete design doc — "here's what an IDE state machine looks like" — that agents building Phase 1 can read and reason about.

**What would reverse this.** If the gate design proves fundamentally flawed and needs major rework anyway, the slice's benefit evaporates. But that's unlikely — the gate is well-specified in spec §10, and the design (blocking layer, token requirement, append-only records) is solid. The slice exists to catch smaller issues: UX friction, latency, state management bugs.
