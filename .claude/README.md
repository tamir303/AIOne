# `.claude/` — Claude Code configuration

Everything here configures how Claude Code works in the AIOne repo.

## What the harness loads automatically

| Path | Loaded when |
|---|---|
| [settings.json](settings.json) | Session start. Permissions, env, hooks, MCP enablement |
| `settings.local.json` | Session start, if present. Machine-specific overrides — gitignored, never committed |
| [agents/](agents/) | On delegation. One subagent per file; `description` is what routing matches on |
| [commands/](commands/) | On `/name`. One slash command per file |
| [skills/](skills/) | On demand, when a task matches the skill's `description` |
| [hooks/](hooks/) | Per the `hooks` block in settings.json |
| [../.mcp.json](../.mcp.json) | Session start, for servers listed in `enabledMcpjsonServers` |
| [../CLAUDE.md](../CLAUDE.md) | Every session |

## What is documentation, not a harness feature

| Path | What it is |
|---|---|
| [workflows/](workflows/) | Human- and agent-readable runbooks. Referenced *by* commands; nothing auto-loads them |
| [memory/](memory/) | Project-scoped conventions, checked into git. Distinct from Claude Code's per-user auto-memory, which lives outside the repo |

Both are here because they're agent-facing context rather than product documentation — but they're read because something points at them, not because the harness picks them up.

## Contents

**Agents** — [orchestrator](agents/orchestrator.md) (plans, never writes) · [frontend-agent](agents/frontend-agent.md) · [backend-agent](agents/backend-agent.md) · [devops-agent](agents/devops-agent.md) (the only one with credentials) · [spec-auditor](agents/spec-auditor.md) · [security-reviewer](agents/security-reviewer.md)

**Commands** — `/vibe` · `/plan-feature` · `/adr` · `/gate-check` · `/open-pr` · `/build-image` · `/deploy` · `/phase-status` · `/spec-sync`

**Skills** — [approval-gates](skills/approval-gates/SKILL.md) · [sandbox-routing](skills/sandbox-routing/SKILL.md) · [deploy-adapter](skills/deploy-adapter/SKILL.md) · [mcp-server-authoring](skills/mcp-server-authoring/SKILL.md) · [secret-handling](skills/secret-handling/SKILL.md) · [agent-prompt-design](skills/agent-prompt-design/SKILL.md)

**Workflows** — [feature-to-pr](workflows/feature-to-pr.md) · [image-to-registry](workflows/image-to-registry.md) · [plan-to-deploy](workflows/plan-to-deploy.md) · [repo-import](workflows/repo-import.md)

**Memory** — [non-negotiables](memory/non-negotiables.md) (read first) · [project-conventions](memory/project-conventions.md) · [decision-index](memory/decision-index.md) · [working-agreements](memory/working-agreements.md)

## The permissions in settings.json mirror the product's own trust model

`deny` covers force-push, hard reset, `sudo`, direct `curl`/`wget` (everything external goes through MCP — [ADR 0003](../docs/adr/0003-mcp-as-sole-integration-substrate.md)), infrastructure destruction, and reading `.env` or key material.

`ask` covers the outward-facing actions that are `confirm` in every trust tier: push, PR, merge, registry push, deploy, secret changes.

The [guard-destructive](hooks/guard-destructive.mjs) `PreToolUse` hook is a second layer over `deny`: it parses Bash commands for destructive patterns and `.env` writes that a glob rule would miss, and blocks with an explanation. It needs Node on `PATH` and fails **open** by design — a broken guard must not wedge a session, and `permissions.deny` still covers the worst cases underneath it.

## MCP servers

`filesystem` and `github` are enabled by default. `fly`, `registry`, and `supabase` are declared in [../.mcp.json](../.mcp.json) but not enabled — `fly` and `registry` point at servers under `mcp/` that this repo has not built yet.

All credentials come from environment variables. Nothing here contains a token, and nothing here ever should. Setup: [../docs/mcp-integrations.md](../docs/mcp-integrations.md).
