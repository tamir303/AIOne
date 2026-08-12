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

`--auto` enables GitHub's native auto-merge, which waits for required status checks to pass before actually merging — this repo has `ci` configured as a required status check on `main`, so this is a real gate, not just a delay. If a repository doesn't have auto-merge enabled (`gh api repos/:owner/:repo --jq .allow_auto_merge`), drop `--auto` and merge directly; just be aware that in that case nothing is gating the merge on CI at all.

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
