# 0004 — Git is the source of truth across sandbox lanes

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §6, §14 ("Filesystem sync")
- **Affects:** docs/sandbox-execution.md, docs/architecture.md

## Context

Three execution lanes — WebContainers in the browser, E2B microVMs, and a remote Docker builder — plus the IDE's own editor buffers. That's four views of one source tree, and spec §14 explicitly says the sync strategy must be decided *before* Phase 3, not during it.

The failure mode if we don't: a frontend change made in WebContainers, a migration written in E2B, and a build running against a tree that matches neither. Debugging that is debugging a distributed consistency bug while also debugging an agent.

## Decision

**Git is the source of truth. Lanes reconcile only through it. There is no direct lane-to-lane filesystem sync.**

- Each lane checks out from the Session's working branch.
- A lane that changes files commits before handing off. Local commits are auto-approved in every tier (spec §10), so this costs no user friction.
- The next lane checks out that commit. A handoff is a fetch, not a merge.
- The IDE editor buffer is a fourth view, reconciled the same way; unsaved buffers are explicitly not part of the shared state.
- Conflicts are surfaced as git conflicts, in the UI the user already has for reviewing diffs.

## Alternatives rejected

**Shared virtual filesystem, mounted by each lane.** Faster in the happy path — no commit/checkout round-trip — and conceptually simpler to describe. Rejected because it's a distributed consistency problem the moment two lanes write concurrently, which is exactly what Phase 3's parallel Runs create. We'd be building a distributed filesystem as a side quest.

**One canonical lane, others as caches.** Designate E2B canonical and treat WebContainers as a read-through cache. Rejected because it forces every task through the expensive lane's latency, and the cheap browser lane is where the vibe loop's responsiveness comes from.

**Event-sourced file operations replayed into each lane.** Elegant, and it makes undo trivial. Rejected as a large custom system whose main benefit — a reversible operation log — git already provides, with semantics users understand and tooling that exists.

**No sync; whoever runs owns the tree.** Rejected: silently drops work when a Run hands off.

## Consequences

**Accepted costs.** Commit/checkout latency on every handoff — small, but not zero, and it's on the critical path of a multi-lane task. Working branches accumulate machine-generated commits, so the PR flow needs a squash or a clear commit convention to stay readable. Very large binary assets are a poor fit for git and need separate handling.

**What this enables.** Conflict semantics that already exist and that users can read. Undo is `git revert` rather than a custom system, which is what makes the Balanced tier's instant undo cheap. Every lane state is recoverable after a crash. The PR that ends the workflow is a natural consequence of the sync mechanism rather than an extra export step.

**What would reverse this.** Handoff latency dominating task time in real usage — measurable, not suspected. The fix would likely be narrower than a redesign (shallow checkouts, warm lanes holding the branch) before abandoning git.
