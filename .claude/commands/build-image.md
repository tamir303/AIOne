---
description: Generate or review a Dockerfile, build on the remote builder, scan, and stop before the gated push
argument-hint: [service name]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task
---

Build a container image$ARGUMENTS.

Follow [docs/docker-pipeline.md](../../docs/docker-pipeline.md) and [.claude/workflows/image-to-registry.md](../workflows/image-to-registry.md). Use the `devops-agent`.

## 1. Dockerfile

Generate or review against the standing checklist. Every line of it is checkable, so check it:

- [ ] Multi-stage — build deps never reach the runtime image
- [ ] Base image pinned **by digest**, not a floating tag
- [ ] Non-root user created and `USER` set
- [ ] No secrets in any layer — not `ENV`, not a baked `ARG`, not a copied `.env`. Build-time secrets use BuildKit secret mounts
- [ ] `.dockerignore` covers `.git`, `node_modules`, `.env*`
- [ ] Layer order caches: manifest → install → source
- [ ] `HEALTHCHECK` present and meaningful to the deploy target

Show the Dockerfile diff and stop for review before building.

## 2. Build

On the **remote builder** (Depot, or a GitHub Actions job off the PR branch) — never in the agent sandbox. Neither WebContainers nor E2B microVMs handle a Docker daemon well, and fighting that is wasted effort.

Tag with the commit SHA. The SHA is the image's identity; semantic tags are aliases applied later. Stream the build log — a silent two-minute build reads as a hang.

## 3. Scan

Trivy against the built image, **before** it can leave the build step.

- Fail on CRITICAL, and on HIGH with a fix available
- Report HIGH-without-fix and below; don't block on unfixable findings
- Also scan layers for leaked secrets

A failing scan **stops the pipeline.** It does not warn and continue. If an ignore is genuinely warranted, it goes in `.trivyignore` with a reason and an expiry date — an entry with neither is treated as absent.

## 4. Stop

Registry push is `confirm` in every tier. Do not push.

Report: image name and SHA tag, size, base image and digest, scan summary, intended destination. The user approving a push should not have to go look any of that up.
