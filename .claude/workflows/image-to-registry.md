# Workflow — source to registry image

From a reviewed branch to a scanned image in a registry. Referenced by `/build-image`. Detail: [docs/docker-pipeline.md](../../docs/docker-pipeline.md).

```
Dockerfile ──⚠️ diff review ──► remote build ──► Trivy scan ──► 🛑 push ──► GHCR
   gen                             (SHA tag)         │
                                                  fail → STOP
```

🛑 = blocking, every tier. ⚠️ = blocking in Cautious and Balanced.

## 1. Generate or review the Dockerfile

DevOps agent. Against the standing checklist — every item is mechanically checkable, so check it:

- [ ] Multi-stage; build deps never reach the runtime image
- [ ] Base image pinned **by digest**, not a floating tag
- [ ] Non-root user created, `USER` set
- [ ] No secrets in any layer — `ENV`, baked `ARG`, or copied `.env`. Build-time secrets use BuildKit secret mounts
- [ ] `.dockerignore` covers `.git`, `node_modules`, `.env*`
- [ ] Layer order caches: manifest → install → source
- [ ] `HEALTHCHECK` present and usable by the deploy target

⚠️ Diff review before building.

## 2. Build on the remote builder

Depot, or a GitHub Actions job off the PR branch. **Never the agent sandbox** — WebContainers has no Docker daemon, and E2B microVMs handle nested Docker poorly. This isn't a limitation to work around; it's why the third lane exists.

- Build from the **PR branch**, so the image corresponds to a reviewable commit
- Tag with the **commit SHA** — that's the image's identity. Semantic tags are aliases applied later
- Stream the log; a silent two-minute build reads as a hang
- Cache across builds

## 3. Scan — before the image can leave

Trivy (or Grype).

| Finding | Action |
|---|---|
| CRITICAL | **Fail.** Stop the pipeline |
| HIGH with a fix available | **Fail.** Stop |
| HIGH, no fix available | Report, continue |
| MEDIUM and below | Report, continue |
| Secret found in a layer | **Fail.** Rotate the credential |

Blocking on unfixable findings just trains people to add ignores. Ignores live in `.trivyignore` with a **reason and an expiry** — an entry with neither is treated as absent.

Scan results attach to the Run so the PR can show them.

## 4. Push — gated, always

🛑 Every tier, including Autonomous.

The confirmation shows image name and SHA tag, size, base image and digest, scan summary, and destination registry. A user approving a push should not have to look any of that up elsewhere.

- Registry credentials belong to the DevOps agent's MCP scope and nowhere else
- **Never push `latest` from an automated run.** Promoting a SHA tag to `latest` is a separate, separately-approved action

## 5. Record

Digest, tags, scan summary, and the approval attach to the Run. The digest is what [plan-to-deploy](plan-to-deploy.md) consumes.

## Failure modes to avoid

| Symptom | Cause |
|---|---|
| Image works locally, not in prod | Floating base tag — pin by digest |
| Secret in a published image | Step 1 checklist skipped; deleting the file in a later layer does not remove it |
| Scan warnings routinely ignored | Blocking on unfixable findings; tighten the fail criteria instead |
| Two images, same tag | Semantic tag used as identity instead of the SHA |
