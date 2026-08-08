---
description: Generate a deploy plan and render its diff for approval — never applies
argument-hint: <environment: preview | staging | production>
allowed-tools: Read, Grep, Glob, Bash, Task
---

Generate a deploy plan for: **$ARGUMENTS**

Follow [docs/cloud-deploy.md](../../docs/cloud-deploy.md) and [.claude/workflows/plan-to-deploy.md](../workflows/plan-to-deploy.md). Use the `devops-agent`.

**This command ends at the diff. It does not apply.** Never apply-on-generate — that's spec §9 and it is the single most important rule on this path.

## 1. Confirm the target

Environment must be explicit. If `$ARGUMENTS` is empty or ambiguous, **ask** — never default to production. An unqualified "deploy" is never production.

## 2. Plan

Call the adapter's `plan()`. It is read-only and mutates nothing. Fly.io is the v1 target ([ADR 0006](../../docs/adr/0006-fly-io-as-v1-deploy-target.md)); everything target-specific stays behind `DeployAdapter`.

## 3. Render the diff

For a human, not for a machine:

- **Created** — new resources
- **Changed** — before → after, per field
- **Destroyed** — call this out separately and loudly. Every entry here hits the destructive floor: always confirm, per resource, no batching
- Scaling and region changes
- Secret **names** being set — never values
- Cost delta, if the target exposes it

## 4. Stop

Deploy apply is `confirm` in every tier. End your turn here with the diff and an explicit question.

Also state:

- Which image digest this deploys, and whether it passed its scan
- Whether rollback is available and to which previous `DeploymentRef`
- That the plan is bound to the live state it was computed against — if state moves, it must be re-planned, because applying a stale plan is how you destroy something that was never in a diff

## If asked to apply afterward

Re-verify live state hasn't moved. Pass the `ApprovalToken`. Stream progress. On failure, report the log and the rollback option — do not retry blind.
