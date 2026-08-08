# Workflow — plan to live deploy

From a scanned image to a running URL. Referenced by `/deploy`. Detail: [docs/cloud-deploy.md](../../docs/cloud-deploy.md).

**Never apply on generate.** This is the rule spec §9 states outright, and it's the one that matters most on this path.

```
select env ──► plan (read-only) ──► render diff ──🛑 approve ──► apply ──► verify
                                                                    │
                                                             fail → 🛑 rollback
```

🛑 = blocking, every tier. Destroyed resources are additionally confirmed **per resource**, never batched.

## 1. Select the environment

`preview` → `staging` → `production`. **Explicit, always.** An unqualified "deploy" is never production; if the target is ambiguous, ask.

Preview environments are per-PR and auto-destroyed on merge or close — the one automated deletion in the system, and only because the resource is ephemeral by construction and holds no durable data.

## 2. Plan

`adapter.plan(app, env)`. **Read-only.** It creates nothing, reserves nothing, tags nothing.

The plan records a fingerprint of the live state it was computed against.

## 3. Render the diff — for a human

- **Created** — new resources
- **Changed** — before → after, per field, not a JSON blob
- **Destroyed** — separate section, called out loudly
- Scaling, region, instance-size changes
- Secret **names** being set — never values
- Cost delta, if the target exposes it

Also state: which image digest deploys, whether it passed its scan, and which previous `DeploymentRef` rollback would target.

A diff a user skims and approves is a diff that failed. Undifferentiated length is the enemy, not length.

## 4. Approve

🛑 Every tier. Anything in the destroyed column hits the destructive floor: confirmed per resource, naming the resource and its irreversibility.

> ✅ `Destroy volume pgdata (12 GB, no snapshot) in production. This cannot be undone.`
> ❌ `Apply 7 changes?`

## 5. Apply

`adapter.apply(plan, approvalToken)`. The token is required by the signature — there is no path that skips it.

**Re-verify the state fingerprint first.** If live state moved, refuse and re-plan. Applying a stale plan is how you destroy something that was never shown in a diff.

Stream progress to the IDE.

## 6. Verify

Health check, then the smoke path the app actually cares about. Record the `Deployment`: image digest, config revision, previous `DeploymentRef`, the authorizing approval, status. OpenTelemetry spans attach to the Run.

## 7. On failure

🛑 Rollback is gated, but its confirmation is deliberately **lighter** than a deploy's — the failure mode of a slow rollback is worse than that of a fast one.

Report the log and your read of it. Do not retry blind.

## Secrets on this path

Set through the platform's secret manager, by name. Values never enter agent context, logs, or a repo file — including `.env.example`. If the target needs a file-based secret, generate it inside the deploy environment, never in the working tree.

## Failure modes to avoid

| Symptom | Cause |
|---|---|
| Resource destroyed that nobody saw | Stale plan applied — step 5 fingerprint check skipped |
| Deployed to prod unintentionally | Step 1 defaulted instead of asking |
| Can't roll back | Previous `DeploymentRef` not recorded; the adapter was never finished |
| Secret in the repo | Step 7 shortcut — always the shortcut |
