# Glossary

Terms used precisely throughout this repository. Where a word has a loose industry meaning and a specific meaning here, the specific one is what's meant.

**Action class** — the category the gate's classifier assigns to a proposed action (`file_write`, `terminal_mutating`, `push`, `registry_push`, `deploy`, `destructive`, …). Policy is a function of class × trust tier. Unknown classes resolve to `destructive`.

**Approval** — an append-only record of one gate decision: what was proposed, what the user saw, which tier was active, and whether it was approved or rejected. Rejections are recorded too. See [data-model.md](data-model.md).

**Approval gate** — the blocking layer every state-changing action passes through. A layer, not a dialog: it suspends the Run rather than racing a modal.

**Deploy adapter** — the interface behind which all cloud-target specifics live. Fly.io is the v1 implementation. `apply()` requires an `ApprovalToken`, so calling it without approval is a compile error.

**Destructive** — drops a table or database, deletes a cloud resource, force-pushes, deletes a branch, or otherwise destroys data or infrastructure irreversibly. Always confirmed, in every tier, per action. The one non-negotiable.

**Diff review** — the gate where the user accepts, edits, or rejects proposed changes, per file or per hunk. The mechanism behind hybrid mode.

**Egress policy** — outbound network rules for a sandbox lane. Default-deny, with package registries pre-allowed by host.

**Floor** — the rows of the trust matrix that read `confirm` in every tier. Not configurable; absent from the config schema entirely, so there's no key to flip.

**Gate** — short for approval gate.

**Handoff** — a structured `Requirement` passed from one Run to the Orchestrator, which may open another Run. The only cross-agent communication; there is no shared mutable state.

**Hybrid mode** — the default. Agent proposes a diff, the user reviews/edits/accepts. Spec §3 calls it the 80% case once a project exists.

**Lane** — one of the three execution environments: WebContainers, E2B microVM, or remote builder. Chosen by the router.

**Manual mode** — full IDE with AI available only as an inline copilot.

**MCP (Model Context Protocol)** — the tool-calling substrate. Every external call goes through an MCP server; this is what makes per-agent tool scopes enforceable rather than advisory.

**Orchestrator** — the planning agent. Decomposes intent into a Plan, opens Runs, holds the cross-agent picture. Never writes files itself.

**Plan** — the Orchestrator's ordered list of intended changes with rationale and expected gates. Shown at the plan-review gate before any agent runs.

**Plan review** — the first and cheapest gate. Catching a wrong direction here costs one planning call instead of a full Run.

**Role agent** — Frontend, Backend, or DevOps. Distinguished by tool scope, not just prompt.

**Router** — the pure function mapping a task descriptor to a lane. Must not consult agent output, or lane assignment becomes prompt-injectable.

**Run** — one unit of agent work with a single responsible agent. Carries Plan, Diff, Status, and `Approvals[]`. The entity the audit trail hangs off.

**Sandbox** — an isolated execution environment for untrusted, agent-generated code. Holds no credentials. Ephemeral.

**Session** — one continuous working context (a vibe request or a manual editing stretch). Owns the working branch and conversation history. Resumable.

**Tool scope** — the set of MCP servers and tools an agent may call. Enforced at the MCP layer. The reason the multi-agent split is worth its complexity.

**Trust tier** — Cautious, Balanced (default), or Autonomous. Tunes the inner loop only; never the floor.

**Vibe mode** — natural-language prompt → plan → agents execute. One end of the spectrum, not a separate product.

**Visual mode** — click an element in the live preview, edit it, and the change maps back to source. Onlook.

**Workspace** — the billing, membership, and quota boundary; the seam where a future multi-tenancy answer lands.
