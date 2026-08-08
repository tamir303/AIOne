# Workflow — feature request to pull request

The end-to-end path from an English sentence to a PR someone can review. Referenced by `/vibe`, `/plan-feature`, and `/open-pr`.

Gate symbols: 🛑 = blocking, every trust tier, no exception. ⚠️ = blocking in Cautious and Balanced.

```
prompt ──► plan ──🛑 plan review ──► branch ──► build ──► diff ──⚠️ diff review
                                                                       │
                                            ┌──────────────────────────┘
                                            ▼
                                    commit (auto) ──🛑 push ──🛑 open PR ──► CI ──🛑 merge
```

## 1. Intake

Input can be a prompt, images, a spec doc, sample data, or an imported repo. On import: shallow clone, detect the stack, record it on the Project — and **do not reformat, upgrade, or clean up anything.** An import that produces a 4,000-line diff before the user asked for anything destroys trust in the first thirty seconds.

Read the repo's own conventions — `CONTRIBUTING.md`, `CLAUDE.md`, lint config — and follow them over our defaults.

## 2. Plan

The orchestrator produces intent, ordered steps with roles, expected gates, out-of-scope, and open questions.

🛑 **Plan review.** The cheapest gate. Rejecting here costs one planning call instead of a full Run.

## 3. Branch

`aione/<session-short-id>/<slug>`, created at Run start so work is recoverable if the session dies. Never the default branch, in any tier.

## 4. Build

Agents work in their scopes, in the lane the router picked. Cross-boundary needs become handoffs, not workarounds. Keep units small enough to review per hunk — a 900-line diff is a diff nobody reads carefully, which defeats the next gate.

## 5. Diff review

⚠️ Per file or per hunk. The user can **edit before accepting** — this is hybrid mode, the 80% case.

Rejection is information, not an error. It returns to step 4 with the reason as context. Never re-propose the same change hoping for a different answer.

## 6. Commit

Auto-approved in every tier — local, cheap, revertible. Logical units, not one dump. Message says what and why, not which files.

## 7. Before pushing

- Build, lint, and tests run. A PR that doesn't build wastes a reviewer's time and CI minutes.
- Diff scanned for secrets. A hit **stops the workflow** — report file and line, never the value, and say the credential needs rotating, not just removing.

## 8. Push and PR

🛑 Both, every tier. Show what's going out, then stop and ask.

PR body, written for someone not in the IDE: what changed and why (the user's intent, not a restatement of your steps), per-file summary for anything non-obvious, the plan executed, **assumptions flagged as assumptions**, what was noticed but not done, and test evidence including failures. Ends with the generated-with attribution line.

## 9. CI

Webhook → badge in the IDE. Never poll on a timer.

A failing check becomes context: agent reads the log, proposes a fix diff, back to step 5. **This loop is not autonomous end-to-end** — a self-pushing fix loop is how you end up with 40 commits nobody read.

## 10. Merge

🛑 Every tier. The user's call, separately from opening the PR.

## Failure modes to avoid

| Symptom | Cause |
|---|---|
| Reviewer can't tell what changed | Diff too large; split step 4 |
| User rejects the same thing twice | Step 5 ignored the rejection reason |
| Secret in history | Step 7 skipped — now requires rotation, not deletion |
| Commits on the default branch | Step 3 skipped |
| CI red, agent keeps pushing | Step 9 ran unattended |
