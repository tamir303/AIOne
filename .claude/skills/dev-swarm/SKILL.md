---
name: dev-swarm
description: Orchestrate a team of parallel Claude Code sessions (via Agent Teams) that split a project's backlog into GitHub issues, implement and validate them in isolated git worktrees, review each other's pull requests, and merge automatically once approved. Use this whenever the user wants multiple agents working a real codebase at once — phrases like "spin up a swarm," "run agents in parallel on this project," "have agents build and review each other's PRs," "parallelize the backlog," or "orchestrate a team to build and validate this," even if they don't say "GitHub" or "Agent Teams" by name. Also use when the user wants agents to open tickets, claim work, request review, or merge autonomously.
---

# Dev Swarm

## What this builds

You (the current session) become the **lead** of a small team of teammate sessions, using Claude Code's [Agent Teams](https://code.claude.com/docs/en/agent-teams). Some teammates implement tickets, some validate other teammates' work, and they coordinate and merge their own pull requests through GitHub — without you relaying every message by hand.

This is a real engineering workflow with a real merge button at the end of it. Treat the setup steps below as load-bearing, not optional boilerplate.

## Before you start

Check every one of these before spawning anyone — a swarm that starts half-configured wastes far more time than the setup costs:

1. **Agent Teams must be enabled.** It's experimental and off by default. Check for `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the environment or `settings.json`. If it isn't set, tell the user directly — don't try to work around it, and don't silently fall back to subagents, which can't message each other or open their own PRs the way this workflow needs.
2. **`gh` is installed and authenticated** with permission to open issues, review PRs, and merge: `gh auth status`.
3. **The checkout is clean** and on the default branch.
4. **Decide whether GitHub's auto-merge is available**: `gh repo view --json autoMergeAllowed`. If it's on, validators can use `gh pr merge --auto`, which waits for required status checks before merging — a real safety net for autonomous merging. If it's off, autonomous merge means immediate merge on approval with no automated check gating it, which is worth flagging to the user before you start.
5. **Set up the label taxonomy** if it isn't already there: run `scripts/setup_labels.sh` (idempotent — safe to re-run).
6. **Set up teammate role definitions** if they don't exist yet: check for `.claude/agents/swarm-implementer.md` and `.claude/agents/swarm-validator.md` in this repo. If missing, create them from the templates in `references/teammate-roles.md`. This is a one-time cost per repo — after that, every future swarm run in this project reuses them.

## Why GitHub is the source of truth, not the team's task list

Agent Teams gives you a shared task list and direct teammate messaging, but both are local to this one Claude Code session — they vanish if the session ends and aren't visible to the user. GitHub issues and PRs are durable, visible, and are literally what "opening tickets" and "approving each other" mean here. So use two layers together, not one instead of the other:

- The **team task list** is for live coordination *within this run* — who's doing what right now, dependencies between in-flight work.
- **GitHub issues** are the actual backlog and the durable record. Every task you create should map to exactly one open issue. If the session crashes or you resume later, the issue state tells you (or a fresh swarm) exactly where things stood.

## Roles

### You, the lead
- Turn the backlog into GitHub issues if they don't exist yet, or read the existing backlog with `gh issue list`.
- Decide team size and spawn teammates using the `swarm-implementer` and `swarm-validator` agent types (see [Spawn the team](#spawn-the-team)). Start with 3-5 teammates total — see [Anthropic's sizing guidance](https://code.claude.com/docs/en/agent-teams#choose-an-appropriate-team-size). A rough starting ratio is two implementers per validator, but adjust to the actual mix of ticket sizes.
- Let teammates self-claim work where possible; step in to assign or rebalance when the backlog is uneven or someone's idle with nothing to claim.
- Watch for teammates that stop early, idle without producing a PR, or message you stuck — see [Handling problems](#handling-problems).
- **Don't do implementation work yourself once the team is running.** If you catch yourself editing files directly, that's a signal the team is undersized or a ticket is underspecified — fix that instead of quietly picking up the slack.

### Implementer teammates
Claim a ticket, work it in an isolated worktree, open a PR that closes the issue, request review from a validator, then move on to the next ticket rather than waiting idle. Full instructions live in the `swarm-implementer` agent definition (`references/teammate-roles.md`).

### Validator teammates
Watch for PRs labeled `swarm:in-review`, check them out, verify against the ticket's actual acceptance criteria (not just "tests pass"), and leave a real `gh pr review`. On approval, they merge it themselves — see [Merge policy](#merge-policy). Validators can also own tickets of their own (e.g. adding missing test coverage); in that case a different teammate reviews *their* PR the same way. Full instructions live in the `swarm-validator` agent definition.

## Isolation: every teammate gets its own worktree

Agent Teams does not automatically isolate teammates' file edits from each other — Anthropic's own guidance is to avoid file conflicts by giving each teammate a distinct set of files. For a swarm touching a shared codebase, the reliable way to do that is a [git worktree](https://code.claude.com/docs/en/worktrees) per active ticket, and that instruction is baked into the `swarm-implementer` and `swarm-validator` definitions: **the first thing every teammate does, before touching any file, is enter its own worktree.** Don't rely on a subagent's `isolation: worktree` frontmatter field to handle this automatically for teammates — it isn't documented to carry over from subagent definitions into Agent Teams, so the role instructions handle it explicitly instead.

## Spawn the team

Once setup is done, spawn teammates by naming the agent type, e.g.:

> Spawn two teammates using the swarm-implementer agent type and one using swarm-validator. Name them implementer-1, implementer-2, and validator-1. Here's the current backlog: [paste `gh issue list` output or a summary]. Let them self-claim tickets.

Give each teammate enough in the spawn message to get moving without waiting on you — at minimum, how to find the backlog and who their reviewer/reviewee counterparts are by name, since teammates message each other directly by name.

## GitHub protocol

The full label taxonomy, PR conventions, and approval/merge rules are in `references/github-protocol.md` — read it before spawning the first teammate so your spawn instructions and the agent definitions agree with each other. Summary:

- Issues move through `swarm:ready` → `swarm:in-progress` → `swarm:in-review` → (`swarm:changes-requested` and back) → merged/closed.
- A PR needs exactly one approval from a teammate who isn't its author before it can merge.
- On approval, the validator merges immediately — see below.

## Merge policy

Per the user's choice, approved work merges **autonomously — no human checkpoint**. The validator that approves a PR also merges it (`gh pr merge --squash --auto` if auto-merge is enabled on the repo, otherwise a direct `gh pr merge --squash` right after approving). This is a real design tradeoff worth restating to the user if you're setting this up fresh: nothing is checking the validator's judgment before code lands. The one guardrail that costs nothing in autonomy is requiring CI to pass before merge — if the repo has no CI configured, say so explicitly, since `--auto` without required checks merges just as fast as a direct merge would.

## Handling problems

- **Teammate idle with nothing claimed**: either the backlog is exhausted (good — check if there's more scope) or everything left is blocked. Ask it directly.
- **Teammate stuck or erroring repeatedly**: message it for more context, or spawn a replacement and let the original wind down — don't let a stuck teammate silently block a ticket others are waiting on.
- **Validator keeps rejecting the same implementer's work**: that's a signal worth surfacing to the user, not just cycling rework indefinitely — a repeated rejection loop usually means the ticket itself is ambiguous.
- **A teammate is missing information to proceed**: it should comment on the GitHub issue with the specific question and message you, rather than guessing or stalling silently.

## Hardening further (optional)

`references/github-protocol.md` includes an example `TaskCompleted` hook that blocks a teammate from marking a ticket done unless a PR referencing it actually exists — worth adding once the basic loop is working, to stop a teammate from self-reporting completion it didn't actually reach.
