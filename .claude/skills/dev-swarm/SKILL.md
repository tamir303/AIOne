---
name: dev-swarm
description: Orchestrate a team of parallel Claude Code sessions (via Agent Teams) where the lead session assigns backlog tickets to business-logic agents and Gemini-backed validation agents, mediates rejections, and is the sole PR approver — split a project's backlog into GitHub issues, implement and validate them in isolated git worktrees, and merge automatically once the orchestrator approves. Use this whenever the user wants multiple agents working a real codebase at once — phrases like "spin up a swarm," "run agents in parallel on this project," "have an orchestrator assign and validate work," "parallelize the backlog," or "orchestrate a team to build and validate this," even if they don't say "GitHub" or "Agent Teams" by name. Also use when the user wants agents to open tickets, get ticket assignments, validate each other's work, or merge autonomously.
---

# Dev Swarm

## What this builds

You (the current session) become the **orchestrator** of a small team of teammate sessions, using Claude Code's [Agent Teams](https://code.claude.com/docs/en/agent-teams). You assign every ticket explicitly — teammates never self-claim — some teammates implement assigned tickets (BL agents), one type validates them by delegating the actual judgment to a Gemini API call (validation agents), and you are the sole approver and merger of the PRs that result.

This is a real engineering workflow with a real merge button at the end of it. Treat the setup steps below as load-bearing, not optional boilerplate.

## Before you start

Check every one of these before spawning anyone — a swarm that starts half-configured wastes far more time than the setup costs:

1. **Agent Teams must be enabled.** It's experimental and off by default. Check for `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the environment or `settings.json`. If it isn't set, tell the user directly — don't try to work around it, and don't silently fall back to subagents, which can't message each other or open their own PRs the way this workflow needs.
2. **`gh` is installed and authenticated** with permission to open issues, review PRs, and merge: `gh auth status`.
3. **The checkout is clean** and on the default branch.
4. **Decide whether GitHub's auto-merge is available**: `gh repo view --json autoMergeAllowed`. If it's on, you (the orchestrator) can use `gh pr merge --auto`, which waits for required status checks before merging — a real safety net for autonomous merging. If it's off, autonomous merge means immediate merge on approval with no automated check gating it, which is worth flagging to the user before you start.
5. **Set up the label taxonomy** if it isn't already there: run `.claude/skills/dev-swarm/setup_labels.sh` (idempotent — safe to re-run).
6. **Set up teammate role definitions** if they don't exist yet: check for `.claude/agents/swarm-bl-agent.md` and `.claude/agents/swarm-validator.md` in this repo. If missing, create them from the templates in `teammate-roles.md`. This is a one-time cost per repo — after that, every future swarm run in this project reuses them.
7. **Set `GEMINI_API_KEY` in the environment** (never in a repo file) if it isn't already — validation agents need it to call `scripts/validate-with-gemini.ts`. If it's missing, tell the user directly rather than letting validation agents discover the failure on their own later.

## Why GitHub is the source of truth, not the team's task list

Agent Teams gives you a shared task list and direct teammate messaging, but both are local to this one Claude Code session — they vanish if the session ends and aren't visible to the user. GitHub issues and PRs are durable, visible, and are literally what "opening tickets" and "approving each other" mean here. So use two layers together, not one instead of the other:

- The **team task list** is for live coordination *within this run* — who's doing what right now, dependencies between in-flight work.
- **GitHub issues** are the actual backlog and the durable record. Every task you create should map to exactly one open issue. If the session crashes or you resume later, the issue state tells you (or a fresh swarm) exactly where things stood.

## Roles

### You, the orchestrator
- Turn the backlog into GitHub issues if they don't exist yet, or read the existing backlog with `gh issue list`. Classify each ticket complex or simple as you file it — this decides which BL agent it goes to.
- Spawn BL agents (`swarm-bl-agent`, model `sonnet` for complex tickets, `haiku` for simple ones) and validation agents (`swarm-validator`) — see [Spawn the team](#spawn-the-team).
- **Assign every ticket explicitly, by message, naming the issue and branch.** No teammate self-claims. This is the fix for a real collision bug the self-claim version of this workflow hit — see `github-protocol.md`'s Assignment rule for why.
- Mediate every rejection: relay `rejected-need-context` questions and `rejected-need-fix` requirements between the validation agent and the BL agent (see `github-protocol.md`'s Rejection loops), rather than letting them message each other directly about ticket outcomes.
- Approve and merge every PR yourself once a BL agent opens one at `swarm:done` — see [Merge policy](#merge-policy). You are the only approver; there's no second peer review at this stage, since validation already happened before the PR existed.
- Watch for teammates that stop early, idle without a result, or message you stuck — see [Handling problems](#handling-problems).
- **Don't do implementation work yourself once the team is running.** If you catch yourself editing files directly, that's a signal the team is undersized or a ticket is underspecified — fix that instead of quietly picking up the slack.

### BL (business-logic) agents
Wait for an explicit assignment, implement it in an isolated worktree, push the branch, and hand off to validation — without opening a PR yet. Only after you tell them validation passed do they open the PR. Full instructions live in the `swarm-bl-agent` agent definition.

### Validation agents
Wait for an explicit assignment naming a branch (there's no PR to review yet). Check it out, run the real test suite, and call `scripts/validate-with-gemini.ts` for the actual pass/fail judgment — they relay that verdict, they don't substitute their own opinion. Full instructions live in the `swarm-validator` agent definition.

## Isolation: every teammate gets its own worktree

Agent Teams does not automatically isolate teammates' file edits from each other — Anthropic's own guidance is to avoid file conflicts by giving each teammate a distinct set of files. For a swarm touching a shared codebase, the reliable way to do that is a [git worktree](https://code.claude.com/docs/en/worktrees) per active ticket, and that instruction is baked into the `swarm-bl-agent` and `swarm-validator` definitions: **the first thing every teammate does, before touching any file, is enter its own worktree.** Don't rely on a subagent's `isolation: worktree` frontmatter field to handle this automatically for teammates — it isn't documented to carry over from subagent definitions into Agent Teams, so the role instructions handle it explicitly instead.

## Spawn the team

Once setup is done, spawn teammates by naming the agent type and overriding the model per instance, e.g.:

> Spawn three teammates using the swarm-bl-agent agent type: two on model sonnet named bl-agent-1 and bl-agent-2 for complex tickets, one on model haiku named bl-agent-3 for simple tickets. Spawn two teammates using the swarm-validator agent type on model haiku, named validator-1 and validator-2. None of them self-claim work — wait for an explicit assignment message from you naming the issue number and branch.

Unlike the old self-claim model, a spawn message here doesn't need to point teammates at the backlog or at each other — they only ever hear from you, and only about the one ticket you've assigned them. Keep assignment messages one-ticket-at-a-time rather than handing out a batch up front, since rejections mean a BL agent may need to come back to a ticket you thought was finished.

## GitHub protocol

The full label taxonomy, PR conventions, and approval/merge rules are in `github-protocol.md` — read it before assigning the first ticket so your assignment messages and the agent definitions agree with each other. Summary:

- Issues move through `swarm:ready` → `swarm:in-progress` → `swarm:ready-for-validation` → `swarm:in-validation` → `swarm:done` (or one of two rejection labels, looping back).
- A validation agent's Gemini call decides pass/fail; the PR only exists once validation has already passed.
- You, the orchestrator, are the sole PR approver, and you merge immediately on approval — see below.

## Merge policy

Per the user's choice, approved work merges **autonomously — no human checkpoint**. You, the orchestrator, approve and merge every PR yourself (`gh pr merge --squash --auto` if auto-merge is enabled on the repo, otherwise a direct `gh pr merge --squash` right after approving). This is a real design tradeoff worth restating to the user if you're setting this up fresh: nothing but your own review and the Gemini validation call that already happened is checking the work before it lands. The one guardrail that costs nothing in autonomy is requiring CI to pass before merge — if the repo has no CI configured, say so explicitly, since `--auto` without required checks merges just as fast as a direct merge would.

## Handling problems

- **Teammate idle with nothing assigned**: that's expected between assignments now — only assign the next ticket once you're ready, rather than batching. If a teammate is idle and the backlog isn't exhausted, it's waiting on you, not on the backlog.
- **Teammate stuck or erroring repeatedly**: message it for more context, or spawn a replacement and let the original wind down — don't let a stuck teammate silently block a ticket others are waiting on.
- **A validation agent keeps rejecting the same BL agent's work**: that's a signal worth surfacing to the user, not just cycling the fix loop indefinitely — a repeated rejection usually means the ticket itself is ambiguous or too large.
- **A teammate is missing information to proceed**: it should comment on the GitHub issue with the specific question and message you, rather than guessing or stalling silently.
- **The Gemini validation call fails** (missing `GEMINI_API_KEY`, network error, malformed response): the validation agent reports this to you as a blocker, not a verdict — don't let a tool failure get silently treated as a pass or a fail. Fix the underlying issue (e.g. confirm the env var is actually set) and reassign.

## Hardening further (optional)

`github-protocol.md` includes an example `TaskCompleted` hook that blocks a teammate from marking a ticket done unless a PR referencing it actually exists — worth adding once the basic loop is working, to stop a teammate from self-reporting completion it didn't actually reach.
