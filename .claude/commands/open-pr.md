---
description: Prepare a branch and open a PR with a reviewer-usable description
argument-hint: [PR title]
allowed-tools: Read, Grep, Glob, Bash, Task
---

Open a pull request$ARGUMENTS.

Follow [docs/github-workflow.md](../../docs/github-workflow.md) and [.claude/workflows/feature-to-pr.md](../workflows/feature-to-pr.md).

## Before anything

1. `git status` and `git diff` — know exactly what's going out.
2. Confirm you are **not** on the default branch. If you are, create `aione/<short-id>/<slug>` and move the work onto it. Never commit to the default branch.
3. Scan the diff for secrets. Any value that looks like a credential stops this command — report the file and line, not the value.
4. Run the build, the linter, and the tests. A PR that doesn't build wastes a reviewer's time and CI minutes.

## Commit

Local commits are auto-approved — they're cheap and revertible. Commit in logical units, not one dump. Message says what changed and why, not which files.

## Push and open — both gated

`git push` and `gh pr create` are `confirm` in **every** tier, Autonomous included. Show the user what's about to be pushed, then stop and ask.

## PR body

Written for a reviewer who is not in the IDE and did not watch this happen:

- **What changed and why** — the user's intent, not your restatement of your own steps
- **Per-file diff summary** for anything non-obvious
- **The plan** this executed, if there was one
- **Assumptions and guesses**, called out explicitly. A guess labeled as a guess is useful; a guess buried in a diff is a landmine
- **What was noticed but not done**
- **Test evidence** — what you ran and what it said. If something failed, say so with the output

End with the generated-with attribution line.

## After

Report the PR URL. Do not merge — merging to the default branch is `confirm` in every tier and is the user's call, separately.
