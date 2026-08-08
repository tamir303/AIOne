# Cloud deployment

Expands spec §9. The v1 target decision is [ADR 0006](adr/0006-fly-io-as-v1-deploy-target.md).

## Fly.io is the v1 target (decided in v0.3)

One adapter, finished, beats three half-built ones — spec §15 says this outright. Fly.io wins v1 because it takes a container image (which our pipeline already produces), gets to a working URL fastest, has a scriptable CLI and API suitable for MCP wrapping, and includes a real secret manager we can use instead of writing secrets to files.

Vercel/Netlify, Render/Railway, and AWS/GCP/Azure via Terraform or Pulumi are all planned adapters. None of them get built until Fly.io works end to end, including rollback.

## The adapter interface

Everything target-specific lives behind this. Nothing else in the codebase knows the word "Fly."

```ts
interface DeployAdapter {
  readonly target: TargetId;
  plan(app: AppSpec, env: Environment): Promise<DeployPlan>;   // never mutates
  diff(plan: DeployPlan): Promise<HumanReadableDiff>;
  apply(plan: DeployPlan, approval: ApprovalToken): Promise<Deployment>;
  status(d: DeploymentRef): Promise<DeployStatus>;
  rollback(d: DeploymentRef, approval: ApprovalToken): Promise<Deployment>;
  secrets: SecretManager;   // the target's own, not ours
}
```

Two signatures carry the invariants. `plan()` returns a value and touches nothing. `apply()` **requires an `ApprovalToken`** — it is not possible to call it without one, so "forgot to check approval" is a compile error rather than an incident.

## plan → diff → approve → apply

Never apply-on-generate. The sequence, always:

1. **Plan.** Adapter computes desired state and diffs it against live state. Read-only.
2. **Diff.** Rendered for a human: what's created, changed, destroyed; scaling and region changes; secret *names* being set (never values); estimated cost delta when the target exposes it.
3. **Approve.** `confirm` in every tier. Anything in the destroy column additionally hits the destructive floor — always confirm, per-resource, no batching.
4. **Apply.** With the token. Progress streams to the IDE.

A plan is bound to the state it was computed against. If live state changed underneath, `apply` refuses and re-plans. Applying a stale plan is how you delete something you never saw in a diff.

## Secrets

Secrets live in the target platform's secret manager — Fly secrets for v1. Rules:

- **The agent never writes a secret to a repo file.** Not `.env`, not `.env.example`, not a comment, not a test fixture. Restated here because it's the rule most likely to be violated by a helpful-seeming shortcut.
- The agent may create and reference secrets *by name*, and may say "this needs `DATABASE_URL` set." It may not read values back.
- Secret values never enter agent context or a log line. If a value has to transit our backend, it goes through a path that redacts on the way to any sink.
- Rotation is a first-class action, gated like any other mutation.

## Environments

`preview` → `staging` → `production`, per Project. Preview environments are per-PR, auto-created, and auto-destroyed on merge or close — that auto-destroy is the one automated deletion in the system, and it's acceptable because the resource is ephemeral by construction and never holds durable data. Production always requires an explicit target selection; it is never the default of an unqualified "deploy."

## Rollback

Every deploy records enough to reverse it: the image digest, the config revision, and the previous `DeploymentRef`. Rollback is gated like a deploy, but the confirmation is deliberately lighter — the failure mode of a slow rollback is worse than the failure mode of a fast one.

An adapter without a working rollback path is not finished, regardless of whether deploys succeed.

## Observability

OpenTelemetry spans cover the deploy itself and get attached to the Run. Deployed apps are instrumented too, so "the agent's change made it slow" is answerable from one trace view rather than two systems.

## Related

- [docker-pipeline.md](docker-pipeline.md) — where the image comes from
- [trust-model.md](trust-model.md) · [security.md](security.md)
- [.claude/skills/deploy-adapter/SKILL.md](../.claude/skills/deploy-adapter/SKILL.md) — writing the next adapter
- [.claude/workflows/plan-to-deploy.md](../.claude/workflows/plan-to-deploy.md)
