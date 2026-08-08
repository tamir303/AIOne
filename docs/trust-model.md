# Human-in-the-loop / trust model

Expands spec §10. This is the chapter that answers "where is the user in the middle," and it is the one part of the design treated as fixed.

## The matrix

| Action | Cautious | Balanced (default) | Autonomous |
|---|---|---|---|
| Read files / search codebase | auto | auto | auto |
| Write/edit files (sandbox only) | confirm each | auto, instant undo | auto |
| Terminal — read-only command | auto | auto | auto |
| Terminal — mutating/network command | confirm | confirm | auto |
| Git commit (local) | auto | auto | auto |
| Git push / open PR | confirm | confirm | confirm |
| Merge to default branch | confirm | confirm | confirm |
| Docker build (sandbox-local) | auto | auto | auto |
| Docker push to registry | confirm | confirm | confirm |
| Apply cloud deploy | confirm | confirm | confirm |
| Destructive (drop table/DB, delete cloud resource, force-push) | **always confirm** | **always confirm** | **always confirm** |

Read the last four rows across: they are `confirm` in every column. Trust tiers tune the *inner loop* — how much friction you accept while code is being written inside a sandbox. They never tune the *boundary* — the moment something leaves the sandbox and touches the world.

## The floor

The destructive row is the design constraint spec §10 calls non-negotiable. Concretely, the floor means:

- No tier, feature flag, config key, environment variable, or enterprise plan can set a destructive action to auto.
- **Approval is per-action, not per-session.** Approving one `DROP TABLE` does not approve the next one. There is no "don't ask again" for this class.
- The confirmation must name the specific resource and the specific irreversibility: "drop table `invoices` (14,204 rows) — this cannot be undone," not "run destructive command?"
- If the gate cannot classify an action with confidence, it treats it as destructive. Fail closed.

If a future requirement seems to need an exception here, the requirement is wrong. This is the property that makes the product trustworthy enough to give real credentials to.

## The gate is a layer, not a dialog

```
agent → proposed action
          ↓
      Classifier          (what class is this? fail closed on ambiguity)
          ↓
      Policy              (class × tier → auto | confirm | deny)
          ↓
   ┌──── confirm ────┐
   │  block the Run  │    ← the agent is genuinely suspended here
   │  render to user │
   │  await decision │
   └────────┬────────┘
            ↓
     Execute + append to Run.Approvals[] + emit trace span
```

Two properties that make this architecture rather than UI:

- **It blocks.** The Run is suspended, not racing a modal. An action that executes while its dialog is open is the failure mode this design exists to prevent.
- **Every decision is recorded**, approvals and rejections alike, on the Run and in the OpenTelemetry trace. The audit trail is a product feature, not a debugging aid — it's how a user reconstructs what an agent did to their infrastructure last Tuesday.

## Classifying actions

The classifier is the security-critical component. Guidelines:

- Classify on the **effect**, not the phrasing. `psql -c "DROP TABLE x"`, a migration file containing `DROP TABLE`, and a Supabase MCP call that drops a table are one class.
- Shell commands need real parsing, not substring matching. `rm -rf ./build` and `rm -rf /` differ; `echo "rm -rf /"` is neither.
- **Unknown = destructive.** A command the classifier has never seen gets confirmed. Users tolerate an extra prompt far better than a deleted database.
- Composite commands take the **maximum** class of their parts. `npm test && flyctl deploy` is a deploy.
- Reclassification is only ever downward with evidence, and each downward move is an ADR.

## Rejection is a first-class outcome

A rejected action is not an error. The Run receives the rejection plus any reason the user typed, and continues from there — that's the hybrid loop of spec §3 working as designed. Agents must treat "no" as information, and must not re-propose the identical action hoping for a different answer.

## Undo

The Balanced tier's "auto, instant undo" for sandbox file writes is what makes it usable as a default. Requirements: every accepted diff is individually revertible from the Run timeline; undo is a git operation against the working branch; and undo is available for the whole session, not a few seconds.

## Configuration

Tier is set per project, defaults to Balanced, and is visible in the IDE chrome at all times — a user should never be unsure which tier they're in. Changing tier is itself logged. The floor rows are not represented in configuration at all: they aren't set to `confirm`, they're absent from the schema, so there is no key to flip.

## Related

- [architecture.md](architecture.md) · [security.md](security.md) · [data-model.md](data-model.md)
- [.claude/skills/approval-gates/SKILL.md](../.claude/skills/approval-gates/SKILL.md) — how to implement a new gated action
- ADR: [0001-approval-gate-as-architecture.md](adr/0001-approval-gate-as-architecture.md)
