# Data model

Expands spec §12.

## The hierarchy

```
Workspace → Project → Session (one vibe request or manual edit session)
                          └── Run (has: Plan, Diff, Status, Approvals[])
                                └── Deployment (linked to a Run + environment)
```

## Entities

**Workspace** — the billing and membership boundary. Owns quotas (sandbox minutes, build minutes, model spend). Spec §14 flags multi-tenancy as an open question; Workspace is the seam where that answer lands, which is why it exists in v1 even with a single user in it. Retrofitting a tenant boundary later is the expensive version of this.

**Project** — one codebase. Holds the linked GitHub repo, the detected stack, the trust tier, the deploy target and its environments, and the MCP servers enabled for it.

**Session** — one continuous working context: a vibe request, or a manual editing stretch. Owns the working branch and the conversation history. Sessions are resumable; a closed browser tab must not lose work.

**Run** — one unit of agent work with a single responsible agent. The most important entity in the system, because it's what the audit trail hangs off:

| Field | Notes |
|---|---|
| `agent` | orchestrator \| frontend \| backend \| devops \| fullstack |
| `plan` | The intended changes, shown at the plan-review gate |
| `diff` | Proposed changes, per file and per hunk |
| `status` | `planning` `awaiting_approval` `executing` `blocked` `rejected` `done` `failed` |
| `approvals[]` | Append-only. Every gate decision, approve *and* reject |
| `lane` | Which sandbox executed it |
| `trace_id` | OpenTelemetry root span |
| `parent_run_id` | Set when the Orchestrator spawned it from a handoff |

**Deployment** — one apply of one plan to one environment. Records image digest, config revision, previous `DeploymentRef` (for rollback), the approval that authorized it, and status.

## The Approval record

```ts
type Approval = {
  id: string;
  run_id: string;
  action_class: ActionClass;      // 'file_write' | 'push' | 'registry_push' | 'deploy' | 'destructive' | ...
  action_summary: string;         // exactly what the user was shown
  tier_at_time: TrustTier;        // tiers change; this must not be recomputed
  decision: 'approved' | 'rejected';
  decided_by: UserId;
  decided_at: timestamp;
  reason?: string;                // user's note, especially on reject
  resource_ref?: string;          // 'table:invoices', 'app:acme-prod'
};
```

Three properties are load-bearing:

- **Append-only.** Approvals are never updated or deleted. An amendable audit log is not an audit log.
- **`action_summary` is the rendered text the user actually saw**, stored verbatim — not a template ID resolved at read time. If the template changes, the historical record must still show what was on screen.
- **`tier_at_time` is denormalized on purpose.** Reconstructing "what tier were they in six weeks ago" from a changelog is exactly the query that fails when you need it.

Retention: approvals outlive the Run, the Session, and Project deletion. They are the compliance artifact.

## Relationships and lifecycle

- Workspace 1—N Project 1—N Session 1—N Run 1—N Deployment
- Runs may reference a `parent_run_id` (handoff), forming a shallow tree under one Session.
- **Cascade deletes stop at Run.** Deleting a Project archives its Runs and preserves Approvals. Deleting a Workspace is a destructive action under the §10 floor and requires per-resource confirmation.

## Storage notes

- Postgres for the entities. Approvals get their own table with an append-only constraint enforced at the database level (revoke UPDATE/DELETE from the app role), not by application discipline.
- Diffs are large and cold — store in object storage, keep a hash and summary in Postgres.
- Session conversation history is append-only too, so a Session can be replayed for debugging.
- Upstash Redis holds the semantic vibe cache. **Cache keys must include trust tier and tool scope** — a plan generated under Autonomous replayed for a Cautious user would silently bypass a gate.

## Related

- [trust-model.md](trust-model.md) — what generates Approvals
- [architecture.md](architecture.md) — how Runs flow through the system
