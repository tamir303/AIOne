---
name: approval-gates
description: How to add a new state-changing action to AIOne so it passes through the approval gate correctly. Use whenever you introduce an effect that writes files, runs commands, pushes code or images, deploys, or touches a database — or when classifying an action, wording a confirmation, or extending the trust matrix.
---

# Adding a gated action

The gate is the property that makes it defensible to give AIOne real credentials. It fails quietly — by omission, when someone adds an effect to a path that was already approved for something else. This skill is the checklist that prevents that.

Background: [docs/trust-model.md](../../../docs/trust-model.md), [ADR 0001](../../../docs/adr/0001-approval-gate-as-architecture.md).

## The five steps

### 1. Classify the action

Pick an existing `ActionClass` or add one. Classify on **effect**, not phrasing:

| Class | Examples |
|---|---|
| `read` | file read, search, status queries |
| `file_write` | writes inside a sandbox |
| `terminal_read` | `ls`, `cat`, `git status` |
| `terminal_mutating` | installs, anything with network, anything that writes |
| `git_local` | local commit |
| `push` | git push, open PR |
| `merge` | merge to default branch |
| `registry_push` | image push |
| `deploy` | apply a deploy plan |
| `destructive` | drop table/DB, delete cloud resource, force-push, delete branch |

Rules that decide the hard cases:

- **Composite takes the maximum.** `npm test && flyctl deploy` is `deploy`.
- **Unknown is `destructive`.** Fail closed. Users tolerate an extra prompt far better than a deleted database.
- Shell commands need **parsing**, not substring matching. `rm -rf ./build` and `rm -rf /` differ; `echo "rm -rf /"` is neither.
- Reclassification only ever moves *downward* with evidence, and each downward move is an ADR.

### 2. Put the effect behind the gate layer

The effect must be unreachable except through the gate. Not a modal before the call — a layer in the call path.

```ts
// Wrong: the check is a sibling of the effect and one refactor from being skipped.
if (await confirmDialog(...)) await flyClient.deploy(plan);

// Right: the effect cannot be invoked without proof of approval.
const token = await gate.request({ class: "deploy", summary, resourceRef });
await adapter.apply(plan, token);   // signature requires the token
```

Make the token **required and non-trivially-constructible** — not optional, not nullable, not `{}`. This turns "forgot to check approval" from an incident into a compile error.

### 3. Write the confirmation text

This is what the user actually decides on, so it carries real weight. Name the resource and the irreversibility:

> ✅ `Drop table invoices (14,204 rows) in production. This cannot be undone.`
> ❌ `Run destructive command?`

> ✅ `Push ghcr.io/acme/api:3f2a91c (142 MB) to GHCR. Trivy: 0 critical, 2 high (no fix available).`
> ❌ `Push image?`

Include everything the user would otherwise have to go look up. A confirmation that forces the user to open another tab is a confirmation that gets approved blindly.

### 4. Record the decision

Append to `Run.Approvals[]` — **approvals and rejections alike** — and emit a trace span. Store the `action_summary` **verbatim as rendered**, not a template ID, so the historical record still shows what was on screen after the template changes. Denormalize `tier_at_time`; reconstructing it later from a changelog is exactly the query that fails when you need it.

### 5. Handle rejection as a normal outcome

Rejection is information, not an error. Return it to the Run with any reason the user typed, and let the Run continue from there. Never re-propose the identical action hoping for a different answer.

## Extending the trust matrix

A new row needs a value per tier. Before writing `auto` in any column, ask whether the action can be undone without leaving the sandbox. If not, it's `confirm` everywhere.

**The floor rows are absent from the config schema entirely.** They are not set to `confirm` — there is no key. If your change introduces a key that could set a destructive action to auto, that's the bug, even if nothing sets it today.

## Self-check

- [ ] The effect is unreachable without a token
- [ ] The classifier fails closed on this action's unknown variants
- [ ] Composite commands take the max class
- [ ] The confirmation names the resource and the irreversibility
- [ ] Approvals *and* rejections are recorded, append-only
- [ ] Rejection returns cleanly to the Run
- [ ] No new config key can weaken the floor
