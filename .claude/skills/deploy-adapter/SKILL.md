---
name: deploy-adapter
description: How to write a DeployAdapter for a cloud target so it satisfies the plan-diff-approve-apply contract, handles secrets correctly, and supports rollback. Use when adding or modifying a deploy target (Fly.io, Vercel, Render, AWS) or rendering a deploy diff.
---

# Writing a deploy adapter

Background: [docs/cloud-deploy.md](../../../docs/cloud-deploy.md), [ADR 0006](../../../docs/adr/0006-fly-io-as-v1-deploy-target.md).

**Before writing a second adapter, confirm the first one is finished — including rollback.** Spec §15 is explicit: one adapter done well beats three half-built ones, and the first *complete* implementation is what reveals what the interface actually needs.

## The interface

```ts
interface DeployAdapter {
  readonly target: TargetId;
  plan(app: AppSpec, env: Environment): Promise<DeployPlan>;   // read-only, always
  diff(plan: DeployPlan): Promise<HumanReadableDiff>;
  apply(plan: DeployPlan, approval: ApprovalToken): Promise<Deployment>;
  status(d: DeploymentRef): Promise<DeployStatus>;
  rollback(d: DeploymentRef, approval: ApprovalToken): Promise<Deployment>;
  secrets: SecretManager;   // the target's own, never ours
}
```

Two signatures carry the invariants:

- **`plan()` mutates nothing.** Not a tag, not a placeholder resource, not a "reserved" name. If the target's API can't compute a plan without side effects, that's a finding to raise, not a detail to paper over.
- **`apply()` requires an `ApprovalToken`.** Non-optional, non-nullable, not trivially constructible. This makes "forgot to check approval" a compile error.

## Rendering the diff

The diff is what a human decides on, so write it for a human:

- **Created** — new resources
- **Changed** — before → after, per field. Not a JSON blob
- **Destroyed** — a separate, loud section. Every entry hits the destructive floor: always confirm, **per resource**, no batching
- Scaling, region, and instance-size changes
- Secret **names** being set — never values
- Cost delta, if the target exposes one

A diff a user skims and approves is a diff that failed. Length is not the enemy; undifferentiated length is.

## Plan staleness

A plan is bound to the live state it was computed against. Record a state fingerprint in the plan, and have `apply()` **refuse** if live state has moved — re-plan instead. Applying a stale plan is how you destroy something that was never shown in a diff.

## Secrets

- Use the **target's own** secret manager. Do not build a secret store.
- The adapter may create secrets and reference them by name. It must never read a value back into our process.
- Values never enter agent context, prompt caches, or logs. Redact on the path to every sink, not at the call site.
- **Never write a secret into a repo file** — not `.env`, not `.env.example`, not an IaC file. If the target requires a file-based secret, generate it inside the deploy environment, never in the working tree.
- Rotation is a first-class gated action.

## Environments

`preview` → `staging` → `production`. Preview environments are per-PR and auto-destroyed on merge or close — that is the **one** automated deletion in the system, acceptable only because the resource is ephemeral by construction and holds no durable data. If your preview environments can hold user data, this exemption doesn't apply.

Production is never the default of an unqualified "deploy." Require explicit selection.

## Rollback

Record enough with every deploy to reverse it: image digest, config revision, previous `DeploymentRef`. Rollback is gated, but its confirmation is deliberately **lighter** than a deploy's — the failure mode of a slow rollback is worse than that of a fast one.

**An adapter without a working rollback path is not finished**, no matter how well deploys succeed.

## Keeping the abstraction honest

Nothing outside `adapters/<target>` knows the target's name. Before closing the first adapter, sketch a second one against the interface — without building it — and see what leaks. If switching targets would cost more than one directory, the abstraction leaked and that's the bug to fix first.

## Self-check

- [ ] `plan()` provably mutates nothing
- [ ] `apply()` and `rollback()` require a token
- [ ] Destroyed resources rendered separately, confirmed per resource
- [ ] Plan carries a state fingerprint; stale plans refuse
- [ ] No secret value enters our process, logs, or the repo
- [ ] Rollback implemented and tested, not just designed
- [ ] Target name appears nowhere outside the adapter directory
