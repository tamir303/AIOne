# Docker & artifact pipeline

Expands spec §8.

## The pipeline

```
DevOps agent                remote builder            scanner            registry
     │                            │                      │                  │
  generate  ──── gate: diff ───►  build  ────────────►  scan  ─ gate: push ─► GHCR
  Dockerfile      review          (Depot /              (Trivy)   confirm
  + compose                      Actions+BuildKit)         │      always
                                                     fail → stop
```

Four properties of that diagram are the whole design:

1. **The build does not happen in the agent sandbox.** Neither WebContainers (no Docker daemon in WASM) nor E2B microVMs (nested Docker and systemd-style init don't fit) handle this well. Fighting that is wasted effort when a purpose-built lane exists.
2. **The scan is between the build and the registry, not after it.** A vulnerable image that reached the registry is already a distribution problem.
3. **The push is gated in every tier.** A pushed image is public-ish, cached by consumers, and hard to fully unpublish.
4. **A failed scan stops the pipeline.** It does not warn and continue.

## Dockerfile generation

The DevOps agent owns `Dockerfile`, `.dockerignore`, and `docker-compose.yml`. Standing requirements — these are the "senior means judgment" bar from spec §2, expressed as concrete checks:

- **Multi-stage.** Build deps never reach the runtime image.
- **Pinned base image by digest**, not a floating tag. `node:22-slim` today is not `node:22-slim` next month.
- **Non-root user.** Create one and `USER` it. Root in a container is a default, not a requirement.
- **No secrets in layers.** Not in `ENV`, not in `ARG` that lands in history, not in a `COPY`'d `.env`. Build-time secrets use BuildKit secret mounts. This one is checked mechanically, not trusted.
- **A real `.dockerignore`.** `.git`, `node_modules`, `.env*` — this is both an image-size and a secret-leak control.
- **Layer ordering for cache.** Manifest first, install, then source.
- **A `HEALTHCHECK`** the deploy target can actually use.

`docker-compose.yml` is for local multi-service development only. It is never the production deploy mechanism — that's [cloud-deploy.md](cloud-deploy.md).

## Build lane

Depot, or a GitHub Actions job triggered off the PR branch. Either way:

- Builds run on the **PR branch**, so the image corresponds to a reviewable commit.
- The image is tagged with the commit SHA. Semantic tags are aliases applied later, never the primary identity.
- Build logs stream to the IDE — a silent two-minute build reads as a hang.
- Builds are cached across runs; a cold build on every keystroke-triggered rebuild is a cost problem.

## Scanning

Trivy (default) or Grype, run against the built image before it can leave the build step.

- **Fail on:** CRITICAL, and HIGH with a fix available. Those are actionable.
- **Report but pass:** HIGH with no fix available, MEDIUM and below. Blocking on unfixable findings just trains people to add ignores.
- **Ignores are files, not flags.** `.trivyignore` entries carry a reason and an expiry date. An ignore with neither is treated as absent.
- Scan results attach to the Run so the PR can show them.

Also scan for leaked secrets in the image layers. This is the last line of defense behind the "no secrets in files" rule, and last lines of defense are worth having.

## Registry push

GHCR by default. ECR, GCR, and Docker Hub are adapters behind the same interface — same reasoning as the deploy adapters, same shape.

- **Always confirm.** Every tier, no exception, per spec §10.
- The confirmation shows: image name and tag, size, base image, scan summary, and destination registry. A user approving a push should not have to go look any of that up.
- Registry credentials live with the DevOps agent's MCP server scope and nowhere else. No other agent, and no generated code, can reach them.
- Never push `latest` from an automated run. Promoting a SHA tag to `latest` is a separate, separately-approved action.

## Local builds

A sandbox-local build for iteration is auto-approved in all tiers (spec §10) because nothing leaves the sandbox. In practice these are limited by the lane's daemon support — expect most real builds to go to the remote builder even during iteration.

## Related

- [sandbox-execution.md](sandbox-execution.md) — why the build lane is separate
- [cloud-deploy.md](cloud-deploy.md) — what happens to the image next
- [security.md](security.md) · [.claude/workflows/image-to-registry.md](../.claude/workflows/image-to-registry.md)
