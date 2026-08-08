# 0003 — MCP is the only path to external services

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §2, §11
- **Affects:** docs/mcp-integrations.md, docs/agents.md, .mcp.json

## Context

Agents need GitHub, a container registry, Fly.io, Supabase, and eventually more. The default path is a client library per service — Octokit here, the Fly API there, the Supabase SDK somewhere else — each with its own auth handling, its own error shapes, and its own place where a credential lives.

That default breaks the thing spec §5 says makes the multi-agent split worth its complexity: per-agent tool scoping. If the Frontend agent's process can `import { Octokit }`, then "the Frontend agent may not open PRs" is a prompt instruction. Prompt instructions do not survive prompt injection, and we import arbitrary repositories.

## Decision

Every external call goes through an MCP server. Agent code contains no HTTP client, no vendor SDK import, and no shell path to `curl` or `gh`.

- Servers are declared in `.mcp.json`; credentials come from environment variables, never committed.
- Per-agent permissions are expressed as **which servers and which tools within them**, checked at the tool layer.
- Tools are **narrow verbs**: `create_pull_request`, not `github_api(method, path, body)`. A generic passthrough tool is a shell in disguise and defeats the entire model.
- Read and write are separate tools with separate names, because the gate classifies on tool identity.
- Destructive tools are named destructively (`drop_table`, `delete_app`) so the classifier's fail-closed default lands correctly.
- Servers never return secret values, even ones the caller just set.

## Alternatives rejected

**Direct SDK per service.** Fewer layers, better types, full API surface. Rejected because it makes tool scoping unenforceable — the security property is the entire reason for the agent split — and because it scatters credentials across the codebase.

**One internal tool-calling framework of our own.** We'd control the shape completely. Rejected because it's MCP with worse ecosystem support: reference and community servers already exist for GitHub and Docker, and building our own means writing all of them ourselves and keeping them current.

**MCP for external services, direct SDKs for "trusted internal" ones.** Pragmatic-sounding. Rejected because "trusted internal" is exactly the category that grows until the rule is meaningless, and the first exception is the one that never gets audited.

## Consequences

**Accepted costs.** A layer of indirection with weaker typing than a native SDK. Some APIs need a server written before they can be used at all. Not every capability of a rich SDK gets exposed, so occasionally a feature requires a server change rather than a line of code. Latency adds a hop.

**What this enables.** Tool scopes become enforceable data rather than prompt text. One audit point for every external effect, which is where the gate and the trace hook in. Credentials live in servers, out of agent reach. Swapping a provider is swapping a server. And community servers are usable directly.

**What would reverse this.** MCP failing as a standard — abandonment or a fragmenting successor. Even then the interface shape (narrow named verbs, permissioned at the layer) would be retained; only the transport would change.
