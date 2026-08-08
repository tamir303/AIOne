# AIOne

A unified full-stack AI IDE. One tab takes an idea from an English sentence to a deployed URL — code, repo, container, cloud — and a human can see, question, or reject every state-changing step along the way.

Status: **specification and scaffolding.** No application code yet. This repository currently holds the product definition, the architecture documentation, and the Claude Code harness configuration used to build it.

## The idea in one paragraph

Existing tools force a choice: either you describe an app in English and accept whatever you get (Lovable, Bolt.new, v0), or you write every line yourself. AIOne treats those as two ends of one control rather than two products. An agent proposes, you edit before accepting, and the approval gate is part of the architecture — not a confirmation dialog bolted on. The same gate covers file writes, terminal commands, git pushes, registry pushes, and cloud deploys.

## Start here

| If you want to… | Read |
|---|---|
| Understand the product | [ai-ide-platform-spec.md](ai-ide-platform-spec.md) — spec v0.3, the source of truth |
| Understand the system | [docs/architecture.md](docs/architecture.md) |
| Know what ships when | [docs/roadmap.md](docs/roadmap.md) |
| Know what we already decided and why | [docs/adr/](docs/adr/) |
| Work on this repo with Claude Code | [CLAUDE.md](CLAUDE.md) |

## Documentation map

Each chapter expands one section of the spec into implementation-level detail and states its own invariants.

- [docs/architecture.md](docs/architecture.md) — how the pieces fit; the system diagram
- [docs/agents.md](docs/agents.md) — orchestrator + Frontend/Backend/DevOps split, and why permissions are the reason for it
- [docs/sandbox-execution.md](docs/sandbox-execution.md) — WebContainers vs. E2B vs. remote builder, and the router that picks
- [docs/github-workflow.md](docs/github-workflow.md) — GitHub App, branch-per-task, PR flow, CI status
- [docs/docker-pipeline.md](docs/docker-pipeline.md) — Dockerfile generation, remote builds, Trivy scan, gated push
- [docs/cloud-deploy.md](docs/cloud-deploy.md) — adapter pattern, Fly.io as the v1 target, plan→diff→approve→apply
- [docs/trust-model.md](docs/trust-model.md) — the three tiers and the floor no tier drops below
- [docs/data-model.md](docs/data-model.md) — Workspace → Project → Session → Run → Deployment
- [docs/tech-stack.md](docs/tech-stack.md) — every layer, the choice, and the alternative we rejected
- [docs/mcp-integrations.md](docs/mcp-integrations.md) — the one sanctioned path to external services
- [docs/security.md](docs/security.md) — sandbox isolation, egress policy, secret handling
- [docs/roadmap.md](docs/roadmap.md) — phases 0–6 with exit criteria
- [docs/risks.md](docs/risks.md) — open questions with owners and decide-by phases
- [docs/glossary.md](docs/glossary.md) — terms used precisely throughout

## The one design constraint

From spec §10: destructive actions — dropping a table or database, deleting a cloud resource, force-pushing — **always require confirmation, in every trust tier, with no exceptions.** Everything else in this repository is negotiable. That row is not.

## Claude Code setup

This repo is configured for [Claude Code](https://claude.com/claude-code). Opening it gives you:

- **Agents** ([.claude/agents/](.claude/agents/)) — `orchestrator`, `frontend-agent`, `backend-agent`, `devops-agent`, `spec-auditor`, `security-reviewer`
- **Commands** ([.claude/commands/](.claude/commands/)) — `/vibe`, `/plan-feature`, `/adr`, `/gate-check`, `/open-pr`, `/build-image`, `/deploy`, `/phase-status`, `/spec-sync`
- **Skills** ([.claude/skills/](.claude/skills/)) — approval gates, sandbox routing, deploy adapters, MCP server authoring, agent prompt design, secret handling
- **MCP servers** ([.mcp.json](.mcp.json)) — GitHub, filesystem, Fly.io, Docker/registry, Supabase

MCP servers read their credentials from environment variables and start disabled until those are set. See [docs/mcp-integrations.md](docs/mcp-integrations.md) for the setup and the reasoning.

## Conventions

- Irreversible decisions get an ADR in [docs/adr/](docs/adr/) *before* they're made.
- The spec is versioned; changes to product direction bump it and get summarized in the header note.
- Documentation that no longer matches reality is a bug, tracked the same way as a code bug.
