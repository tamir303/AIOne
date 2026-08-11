# GitHub protocol reference

This is the shared contract every teammate follows so the lead, implementers, and validators agree on what a label or PR state means without having to ask each other. Read this before spawning the team, and make sure the spawn message and the agent definitions in `teammate-roles.md` don't contradict it.

## Label taxonomy

Created by `scripts/setup_labels.sh` (safe to re-run — it only creates labels that don't already exist):

| Label | Meaning |
|---|---|
| `swarm:ready` | Backlog item, unclaimed, ready for an implementer to pick up |
| `swarm:in-progress` | An implementer has claimed it and is actively working |
| `swarm:in-review` | PR is open and waiting on a validator |
| `swarm:changes-requested` | A validator asked for changes; back with the original implementer |
| `swarm:blocked` | Stuck — needs more information or a human decision |

There's deliberately no `swarm:done` label — a merged PR with `Closes #N` closes the issue automatically, and a closed issue *is* "done." Don't add a redundant label that can drift out of sync with the real state.

## Issue lifecycle

```
swarm:ready --(implementer claims)--> swarm:in-progress --(PR opened)--> swarm:in-review
                                                                              |
                                                    approved & merged <-------+-------> changes requested
                                                    (issue auto-closes)              (swarm:changes-requested,
                                                                                       back to swarm:in-progress
                                                                                       once implementer resumes)
```

If a teammate can't proceed for any reason, it relabels `swarm:blocked`, comments on the issue with the specific question, and messages the lead — it does not sit idle without saying why, and it does not guess.

## PR conventions

- **Title**: `[#<issue-number>] <short description>`
- **Body** should include, at minimum:
  - What changed and why
  - How it was verified (which tests were run, what was checked manually)
  - `Closes #<issue-number>` so merging auto-closes the ticket
- One ticket, one PR. If a teammate discovers mid-implementation that the ticket is really two tickets, it should say so on the issue rather than bundling unrelated changes into one PR.

## Approval rule

**A PR needs exactly one approval from a teammate other than its author before it can merge.** This is deliberately role-agnostic rather than strictly "validators approve implementers": an implementer can review a validator's PR (e.g. when a validator opens a PR adding test coverage), as long as the reviewer isn't the author. What matters is that no one merges their own unreviewed work.

A validator reviewing a PR should actually check it against the linked issue's acceptance criteria — re-reading the ticket, not just skimming the diff — and run the test suite itself rather than trusting the PR description's claims about what was verified.

## Merge

On approval, the reviewer merges immediately:

```bash
gh pr merge <N> --squash --auto
```

`--auto` enables GitHub's native auto-merge, which waits for required status checks to pass before actually merging — this is the cheapest safety net available and costs nothing in autonomy, since it still merges as soon as checks are green with no human in the loop. If the repository doesn't have auto-merge enabled (`gh repo view --json autoMergeAllowed`), drop `--auto` and merge directly; just be aware that in that case nothing is gating the merge on CI at all.

## Rework loop

1. Validator leaves `gh pr review <N> --request-changes --body "..."` with specific, actionable feedback — not just "doesn't work," but what's wrong and ideally what would fix it.
2. Issue gets relabeled `swarm:changes-requested`.
3. The lead (or the validator directly, via `SendMessage`) notifies the original implementer by name.
4. The implementer pushes fixes to the **same branch** — it does not open a new PR — and re-requests review.
5. Relabel back to `swarm:in-review`.

If the same PR bounces between an implementer and validator more than twice, that's a signal the ticket itself is ambiguous or too large, not that the implementer needs another attempt. Surface this to the user rather than continuing the loop indefinitely.

## Hardening: enforce completion with a hook (optional)

Teammates self-report when they mark a task complete, and Agent Teams' own docs note that task status can lag or be reported inaccurately. A `TaskCompleted` hook can check that the claimed work actually exists before allowing the task to close. Example, checking that an implementation task has a real, non-draft PR referencing its issue:

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ISSUE=$(jq -r .task.issue_number 2>/dev/null); if [ -n \"$ISSUE\" ] && [ \"$(gh pr list --search \"linked:$ISSUE\" --json number --jq length)\" = \"0\" ]; then echo \"No PR found referencing issue #$ISSUE yet\" >&2; exit 2; fi'"
          }
        ]
      }
    ]
  }
}
```

Treat this as a starting point, not a drop-in — the exact JSON shape of the `TaskCompleted` hook payload should be checked against [the current hooks reference](https://code.claude.com/docs/en/hooks#taskcompleted) before relying on it, since task metadata fields aren't guaranteed to stay the same across versions.
