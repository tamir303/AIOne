# 0010 — Project files are stored in a Postgres table, not git, until a sandbox lane exists

- **Status:** Accepted
- **Date:** 2026-08-14
- **Spec reference:** §13 (Phase 1), §14 ("Filesystem sync")
- **Affects:** docs/data-model.md, docs/sandbox-execution.md, packages/db/src/schema.ts, apps/api

## Context

Phase 1 needs a file tree and a Monaco editor to have something to read and write, and nothing in the schema represents a project's files today — `packages/db/src/schema.ts`'s `sessions` table is just an id, a `projectId`, and a timestamp. `docs/data-model.md` already describes a Session as owning "the working branch," which reads as if this were decided, but no column, migration, or code backs that claim; it's aspirational text written ahead of the schema that implements it.

[ADR 0004](0004-git-as-sandbox-source-of-truth.md) decided that git is the source of truth **across sandbox lanes** — WebContainers, E2B, the remote builder, and the editor buffer, reconciling through commits and checkouts. That decision is correct and stays. But it answers a Phase 3 question (how do multiple concurrent execution environments agree on a tree) for a Phase 1 situation that doesn't have it yet: one lane doesn't exist (`packages/sandbox` isn't built), there's no agent writing files, and there's nothing to reconcile. Building a server-side git repository per Project now, to satisfy a decision aimed at a problem Phase 1 doesn't have, is solving next phase's problem on this phase's timeline — and it's the more expensive of the two paths to build first.

The forcing function: Phase 1's file-tree and editor tickets (this backlog wave's #3, #5, #6) cannot be scoped without knowing whether "write a file" means an `UPDATE` or a `git commit`. Get this wrong and the fix is a data migration, not a refactor, because real project files will exist in whatever shape gets picked.

## Decision

**A Project's files are rows in a Postgres table — one row per path, holding content and metadata — read and written directly through the API. There is no git repository backing Phase 1 storage.**

- `packages/db/src/schema.ts` gets a `project_files` table (or equivalent name) keyed to `projects.id`, with a unique `(project_id, path)` constraint. Content is stored as a column (text/bytea as the implementing ticket determines), not as a blob reference — Phase 1's file sizes don't justify object storage, unlike the diff artifacts `docs/data-model.md` already flags as "large and cold."
- Reads and writes go through `apps/api` handlers directly against this table. There is no commit, no branch, no working tree.
- `aione_app` keeps UPDATE/DELETE rights on this table, unlike `approvals` — this data is meant to be mutated by its owner.
- This table is explicitly a Phase 1 structure, not a permanent one. When Phase 3's `SandboxLane` adapters need a real working tree to check code out into, the migration path is: initialize a git repo from the table's current rows, and from that point forward the lane and the editor reconcile through git per ADR 0004, with this table either retired or repurposed as a cache. That migration is out of scope for this ADR and for Phase 1 — it's named here so the next reader knows it was anticipated, not missed.
- ADR 0004 is not superseded. It continues to govern multi-lane reconciliation once lanes exist. This ADR only decides what backs a Project's files before that's true.

## Alternatives rejected

**Server-side git repository per Project (via isomorphic-git or a shelled-out git process), starting now.** Front-loads ADR 0004's model immediately, so Phase 3/4 (multi-lane sync, GitHub PR flow) inherit a working tree instead of needing a migration later — genuinely cheaper in the phase that actually needs git semantics. Rejected for Phase 1 because it's real infrastructure (repo lifecycle, commit authorship for pure manual edits, garbage collection, size limits) built for consumers — a sandbox lane, a diff reviewer — that don't exist yet in this phase. Phase 1 has no agent and one lane-less editor; a git repo with a single human committer through one UI is git in name only, paying its complexity cost with none of its benefit.

**Object storage (e.g. S3-compatible) with a Postgres index of paths/metadata.** Matches how `docs/data-model.md` treats large, cold data like diffs, and scales better for large files or binary assets a text column handles poorly. Rejected for Phase 1 on the same "cold" reasoning that argues for it elsewhere: project source files are small, hot, and read/written on every keystroke-adjacent save — the access pattern is a live editor, not an archive. Adding an object-storage round trip to every file open is the wrong latency trade for the thing the phase's exit criterion is most sensitive to (does this feel like a real editor). Revisit if Phase 1 usage shows large generated assets (images, datasets) landing in project trees.

**Do nothing yet — block ticket 3 until Phase 3 forces the git decision.** Cheapest in the moment. Rejected because it doesn't remove the need for a decision, it just moves the forcing function from "write this ADR" to "watch a BL agent guess," which is exactly the failure mode ADRs exist to prevent (spec/CLAUDE.md: write the ADR before an irreversible choice, not after).

## Consequences

**Accepted costs.** A second file-storage shape will exist temporarily once Phase 3 needs git — this table, then a repo, not a clean single model from day one. Manual edits made in Phase 1 have no revision history beyond whatever `updated_at` bookkeeping the implementing ticket adds; there is no `git log` for a Phase-1-only project. The migration into git (whenever Phase 3 does it) is real work that has to be planned for, not assumed away.

**What this enables.** Ticket 3 (project file persistence) can be scoped and built this week instead of waiting on git-repo infrastructure design. The file tree, Monaco, and later WebContainers mounting (ticket 7) all code against a simple table-backed API rather than a git working-tree abstraction that has no second consumer yet. Cheaper to get wrong and change, because the blast radius is one table, not a repository format users have started depending on.

**What would reverse this.** Evidence that Phase 1 needs revision history, branching, or multi-writer conflict resolution before Phase 3 — e.g. if manual-editing sessions turn out to need undo-across-saves or collaborative editing sooner than planned. Absent that, the planned trigger to move off this table is simply reaching Phase 3's `SandboxLane` work, at which point the migration described in the Decision section happens by design, not as a reversal.
