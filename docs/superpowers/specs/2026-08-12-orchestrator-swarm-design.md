# Orchestrator-centric dev-swarm design

## Why

The current `dev-swarm` skill (peer-to-peer: implementers and validators self-claim tickets from GitHub labels, message each other directly, validators merge autonomously) hit a real structural failure during its first run: issue #6 was independently claimed by three different teammates (two validators and an implementer) because (a) every teammate authenticates through the same `gh` identity, so assignee-based "is this already claimed" checks are meaningless — every claim looks like it came from the same user — and (b) the worktree path convention (`.claude/worktrees/issue-<N>`) is deterministic per issue, so any teammate entering that path lands in the literal same directory as whoever got there first, silently interleaving their edits. This produced a duplicate class definition and nearly caused a corrupted commit before it was caught mid-write.

This design replaces self-claiming with centralized assignment: exactly one orchestrator decides who works what, at every stage, which removes the race condition structurally rather than patching around it.

## Roles and models

| Role | Model | Count | Responsibility |
|---|---|---|---|
| Orchestrator | Sonnet 5 | 1 | Creates issues + branches, classifies each ticket complex/simple, assigns BL and validation agents, mediates every rejection, approves + merges PRs. |
| BL agent (complex) | Sonnet 5 | 2 | Implements one assigned ticket at a time, on its own branch. |
| BL agent (simple) | Haiku | 1 | Same, for tickets the orchestrator classifies as simple. |
| Validation agent | Haiku (judgment delegated to Gemini) | 2 | Checks out the assigned branch, runs tests, gathers diff + issue context, calls a Gemini-backed validation script for the actual pass/fail judgment, translates the verdict into a GitHub state transition. |

This is a deliberate departure from CLAUDE.md's stated "Opus for orchestration and planning, Sonnet for the working agents, Haiku for routing" convention — confirmed explicitly with the user. CLAUDE.md's model-convention note should be updated to note this swarm-specific mapping as an intentional exception, not a drift.

Validation is not a Claude-model judgment call. It's a thin Claude-run wrapper (mechanical git/test/diff-gathering work) around a call to the Gemini API, which makes the actual accept/reject decision. This keeps the "free Gemini agents" requirement technically honest — Claude Code's Agent Teams has no way to spawn a teammate that literally runs on a non-Claude model — while still getting a second model family's judgment into the loop, consistent with CLAUDE.md's "multi-vendor by design" model-layer decision.

## State machine

Replaces the current 5-label taxonomy. New labels (already created in the repo): `swarm:ready-for-validation`, `swarm:in-validation`, `swarm:rejected-need-context`, `swarm:rejected-need-fix`, `swarm:done`. Existing `swarm:ready` and `swarm:in-progress` are reused; `swarm:in-review`, `swarm:changes-requested`, `swarm:blocked` from the old taxonomy are deprecated but left in place rather than deleted.

```
swarm:ready
  → swarm:in-progress              (orchestrator assigns a BL agent)
  → swarm:ready-for-validation     (BL agent finishes)
  → swarm:in-validation            (orchestrator assigns a validation agent)
      → swarm:done                 (validation passes)
      → swarm:rejected-need-context
      → swarm:rejected-need-fix
```

- **`rejected-need-context`**: the validation agent couldn't judge the work because something about the implementation isn't explained (e.g. an unusual pattern with no rationale visible in the diff or issue). It comments the specific question on the issue and hands back to the orchestrator. The orchestrator relays the question to the original BL agent, gets an answer, posts it back on the issue, and reassigns the *same* validation agent — issue goes straight back to `swarm:in-validation`. No new implementation work happens in this branch of the loop.
- **`rejected-need-fix`**: the validation agent found an actual defect. It comments what's wrong (and ideally what would fix it) and hands back to the orchestrator, who relays the requirements to the original BL agent. Once the BL agent pushes a fix to the *same branch*, the issue goes straight back to `swarm:in-validation` (not through `swarm:ready-for-validation` — it's a recheck, not a fresh validation request), ideally reassigned to the same validation agent for continuity.
- **`done`**: validation passed. The BL agent (not the orchestrator) opens the PR — `[#<N>] <desc>`, body includes `Closes #<N>`. The orchestrator reviews it and, if satisfied, runs `gh pr review --approve` followed by `gh pr merge --squash --auto`, fully autonomously (same standing policy as the current run), gated on the repo's existing required `ci` status check.

## Assignment and isolation

The orchestrator is the only actor that decides ticket ownership — no teammate self-claims. This directly closes the collision hole: since only one process ever writes the "who owns issue #N" decision, there's no window where two teammates can both believe they're unclaimed-and-free to take it. Worktree isolation (one worktree per active ticket, entered before any file edit) stays as-is from the current skill; it was never the source of the bug, self-claiming was.

## Gemini validation tool

A script in the repo at `scripts/validate-with-gemini.ts` (top-level, not inside any single workspace package, since any validation agent invokes it regardless of which package the ticket touches) that a validation agent invokes via Bash. Input: the PR diff, the linked issue's body/acceptance criteria, and relevant CLAUDE.md/docs conventions. Output: a structured verdict — pass / fail-missing-context / fail-needs-fix — plus an explanation string the validation agent relays into the corresponding GitHub comment.

Reads `GEMINI_API_KEY` from the environment only (already set as a user-level environment variable, outside the repo — never written to a repo file, including `.env`, per CLAUDE.md rule #2, which is explicit that not even a gitignored `.env` inside the repo is acceptable for secrets).

**Documented deviation**: CLAUDE.md's "route integration work through MCP" rule would normally point at an MCP server rather than a bespoke script-plus-API-key. This was raised explicitly and the user chose the simpler script for now, given it's a single call type on a free tier — worth revisiting as an MCP server if Gemini validation usage grows.

## Rollout (already executed)

The prior run's peer-to-peer teammates (implementer-1, implementer-2, implementer-3, validator-1, validator-2) were stopped or had already gone idle. The backlog was re-filed under the new taxonomy:

- Issues #1 and #2 reset to `swarm:ready` — prior partial work is preserved in local worktrees (`.claude/worktrees/issue-1`, `.claude/worktrees/issue-2`) as reference only, not carried forward automatically.
- Issue #6 marked `swarm:ready-for-validation` directly — implementer-3 reported a complete, self-tested implementation already pushed to `origin/swarm/issue-6` (commit `6dbb157`), so it skips re-implementation and goes straight to a validation agent under the new flow. Its self-reported test results should be independently re-verified, not trusted.
- Issues #3, #4, #5 remain `swarm:ready`, untouched.
- A separate, unrelated CI ordering bug (type-check ran before build, failing on every fresh checkout) was found by the old swarm, fixed, and already merged to `main` via PR #7 before the old teammates were stopped — this fix is independent of the model swap and stays.

## Out of scope for this design

- Rewriting `.claude/agents/swarm-implementer.md` / `swarm-validator.md` and the `dev-swarm` skill's `github-protocol.md` / `teammate-roles.md` reference docs into the new orchestrator/BL-agent/validation-agent shape — that's implementation, covered by the next plan.
- Building `scripts/validate-with-gemini.ts` itself.
- Deciding whether to delete the deprecated old labels or the stale worktrees from the previous run.
