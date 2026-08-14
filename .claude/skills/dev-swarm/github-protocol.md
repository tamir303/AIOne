# GitHub protocol reference

This is the shared contract the orchestrator, BL agents, and validation agents all follow so a label or state means the same thing to everyone without having to ask. Read this before assigning the first ticket, and make sure assignment messages and the agent definitions (`swarm-bl-agent.md`, `swarm-validator.md`) don't contradict it.

## Label taxonomy

Created by `setup_labels.sh` (safe to re-run — it only creates labels that don't already exist):

| Label | Meaning |
|---|---|
| `swarm:ready` | Backlog item, unassigned, ready for the orchestrator to hand to a BL agent |
| `swarm:in-progress` | A BL agent has been assigned and is actively implementing |
| `swarm:ready-for-validation` | BL agent finished and pushed; waiting for the orchestrator to assign a validation agent |
| `swarm:in-validation` | A validation agent is checking the branch |
| `swarm:rejected-need-context` | Validation agent couldn't judge the work; a specific question is on its way back to the BL agent via the orchestrator |
| `swarm:rejected-need-fix` | Validation agent found a real defect; specific fix requirements are on their way back to the BL agent via the orchestrator |
| `swarm:done` | Validation passed; the BL agent is opening (or has opened) the PR for the orchestrator to approve and merge |

There's no separate "merged" label — a merged PR with `Closes #N` closes the issue automatically, and a closed issue *is* "done, for real." Don't add a redundant label that can drift out of sync with the real state.

## Issue lifecycle

```
swarm:ready
  → swarm:in-progress              (orchestrator assigns a BL agent)
  → swarm:ready-for-validation     (BL agent finishes and pushes)
  → swarm:in-validation            (orchestrator assigns a validation agent)
      → swarm:done                       (validation passes; BL agent opens PR; orchestrator approves + merges → issue auto-closes)
      → swarm:rejected-need-context      (orchestrator relays the question to the BL agent, then the answer back to the same validation agent → swarm:in-validation)
      → swarm:rejected-need-fix          (orchestrator relays the fix requirements to the BL agent; once pushed → swarm:in-validation directly, not through swarm:ready-for-validation)
```

If a teammate can't proceed for any reason, it comments on the issue with the specific question and messages the orchestrator — it does not sit idle without saying why, and it does not guess.

## Assignment rule

**Only the orchestrator assigns work.** BL agents and validation agents never self-claim a ticket from the label list, even if it looks unclaimed. This is the fix for a real bug the earlier peer-to-peer version of this workflow hit: every teammate authenticates through the same `gh` identity, so assignee-based "is this claimed" checks can't tell one teammate's claim from another's, and the deterministic worktree-path convention means two teammates entering the same issue's path land in the literal same directory. Centralizing assignment in the orchestrator removes the race entirely — there's exactly one process deciding who owns what, at every stage.

## PR conventions

- **Title**: `[#<issue-number>] <short description>`
- **Body** should include, at minimum:
  - What changed and why
  - How it was verified (which tests were run, what the validation agent's Gemini call reported)
  - `Closes #<issue-number>` so merging auto-closes the ticket
- **Opened only at `swarm:done`**, by the BL agent, after validation has already passed — not at the point the BL agent finishes writing code. There is no PR to review during validation; the validation agent works directly against the branch (`git diff main...swarm/issue-<N>`).
- **Merge current `main` into the branch before opening the PR.** A ticket can sit in implementation and validation for a while, during which other tickets merge into `main` — this is the point where the BL agent catches up, not before. `git fetch origin main && git merge origin/main`:
  - **Clean merge, no conflicts**: open the PR as normal.
  - **Conflicts in non-production files** (comments, test mocks, generated snapshots): resolve by keeping both sides' intent (don't pick one ticket's change over the other's), re-run the real test suite yourself, note the resolution in the PR body, and open the PR — no re-validation needed.
  - **Conflicts touching production logic**: resolve them, re-run the test suite, but message the orchestrator before opening the PR rather than opening it straight away — the merge introduced code the Gemini validation call never saw, and the orchestrator decides whether that warrants a re-validation pass.
  - This step exists because a squash merge takes the PR branch's file contents wholesale for anything the branch touched relative to its own fork point; a branch that never caught up with `main` can silently revert an unrelated fix that landed on `main` after the branch was created. That's a real regression this swarm hit in practice, not a hypothetical.
- One ticket, one PR. If a BL agent discovers mid-implementation that the ticket is really two tickets, it should say so on the issue rather than bundling unrelated changes into one PR.

## Approval rule

**Only the orchestrator approves and merges a PR.** This is a deliberate change from the old peer-to-peer model's "any other teammate can approve" rule: since validation already happened (via the Gemini-backed validation agent) before the PR even existed, the PR-stage approval is the orchestrator's own final check, not a second independent peer review.

## Validation

A validation agent checks a branch directly, not a PR — see the `swarm-validator` agent definition for the full mechanics (worktree isolation, running the real test suite itself, calling `scripts/validate-with-gemini.ts` for the actual pass/fail judgment). The validation agent relays that tool's verdict; it does not substitute its own opinion for it.

## Merge

Once the orchestrator approves a `swarm:done` PR, it merges immediately:

```bash
gh pr merge <N> --squash --auto
```

`--auto` enables GitHub's native auto-merge, which waits for required status checks to pass before actually merging — but only if a status check is actually marked *required* on `main`. This repo defines a `ci` job in `.github/workflows/ci.yml`, but a workflow existing doesn't by itself make it a required check; that's branch-protection state, not something this repo's files confirm. Verify with `gh api repos/:owner/:repo/branches/main/protection --jq .required_status_checks.contexts` before relying on `--auto` as a real gate — don't assume it's enforced just because the workflow exists. If a repository doesn't have auto-merge enabled (`gh api repos/:owner/:repo --jq .allow_auto_merge`), drop `--auto` and merge directly; just be aware that in that case nothing is gating the merge on CI at all.

**Sync local `main` right after merging.** The orchestrator's own local checkout does not update itself just because `gh pr merge` ran — that only advances `origin/main`. Run `git fetch origin main` immediately after every merge, and reconcile the local `main` branch before reading any file from it or reasoning about repo state. This matters concretely: a stale local `main` will show pre-merge file contents (a component that's actually there will look missing, a fix that already landed will look reverted), which is a real trap for anything the orchestrator does after a merge — reviewing the next PR, assessing project state, briefing a new teammate. If local `main` has its own divergent commit history (e.g. from squash-merges elsewhere rewriting SHAs for content that's also sitting on local `main` directly), diff local `main` against `origin/main` first to confirm they're content-equivalent modulo the new merge, stash any uncommitted work, then fast-forward or reset local `main` to `origin/main` — never assume a plain `git merge` will be clean once history has diverged like that.

## Rejection loops

**`rejected-need-context`** (validation agent is missing information, not reporting a defect):
1. Validation agent comments the specific question on the issue and messages the orchestrator.
2. Orchestrator relays the question to the BL agent by name.
3. BL agent answers factually as an issue comment (no code change) and messages the orchestrator.
4. Orchestrator relays the answer to the *same* validation agent and moves the issue to `swarm:in-validation`.
5. Validation agent re-runs its full check with the added context — it does not skip straight to a verdict just because the question is answered.

**`rejected-need-fix`** (validation agent found a real defect):
1. Validation agent comments what's wrong (and ideally what would fix it) and messages the orchestrator.
2. Orchestrator relays the fix requirements to the BL agent by name.
3. BL agent pushes a fix to the *same branch* — it does not open a new PR or new branch — and messages the orchestrator.
4. Orchestrator moves the issue straight to `swarm:in-validation` (skipping `swarm:ready-for-validation`, since this is a recheck of an already-validated branch, not a fresh validation request) and reassigns the same validation agent where possible, for continuity.

If the same ticket bounces between a BL agent and a validation agent more than twice, that's a signal the ticket itself is ambiguous or too large, not that the BL agent needs another attempt. Surface this to the user rather than continuing the loop indefinitely.

## Gemini validation tool

`scripts/validate-with-gemini.ts` reads a JSON object from stdin (`issueNumber`, `issueBody`, `diff`, `testOutput`) and prints a JSON verdict to stdout (`verdict`: `"pass" | "fail-missing-context" | "fail-needs-fix"`, `explanation`: string). It reads `GEMINI_API_KEY` from the environment — never from a repo file, per CLAUDE.md rule #2. This is a documented deviation from CLAUDE.md's "route integration work through MCP" preference: a bespoke script was chosen over an MCP server for this single call type, given it's on Gemini's free tier — worth revisiting as an MCP server if usage grows.

## Hardening: enforce completion with a hook (optional)

Teammates self-report when they mark a task complete, and Agent Teams' own docs note that task status can lag or be reported inaccurately. A `TaskCompleted` hook can check that the claimed work actually exists before allowing the task to close. Example, checking that a BL agent's task has actually pushed its branch before it's allowed to report `swarm:ready-for-validation`:

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ISSUE=$(jq -r .task.issue_number 2>/dev/null); if [ -n \"$ISSUE\" ] && ! git ls-remote --exit-code origin \"swarm/issue-$ISSUE\" >/dev/null 2>&1; then echo \"Branch swarm/issue-$ISSUE not pushed yet\" >&2; exit 2; fi'"
          }
        ]
      }
    ]
  }
}
```

Treat this as a starting point, not a drop-in — the exact JSON shape of the `TaskCompleted` hook payload should be checked against [the current hooks reference](https://code.claude.com/docs/en/hooks#taskcompleted) before relying on it, since task metadata fields aren't guaranteed to stay the same across versions.
