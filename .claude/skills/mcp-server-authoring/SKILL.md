---
name: mcp-server-authoring
description: How to write or adopt an MCP server for AIOne so tool scoping stays enforceable — narrow verb tools, split read/write, honest destructive names, no secret returns. Use when integrating any external service, adding a tool, or reviewing an existing server.
---

# Writing an MCP server

Background: [docs/mcp-integrations.md](../../../docs/mcp-integrations.md), [ADR 0003](../../../docs/adr/0003-mcp-as-sole-integration-substrate.md).

## First: check whether you need to

Reference and community servers already exist for GitHub, Docker, and Supabase. Adopting one beats writing one. But **audit an adopted server against the rules below before enabling it** — a community server with a generic passthrough tool will quietly collapse our entire permission model.

## Why the shape matters

Per-agent tool scopes are a security boundary, not a prompt instruction. That only works if permissions are expressible as "which servers, which tools" and checkable at the layer. Every rule below exists to keep that true.

## Rules

### Tools are narrow verbs

```
✅ create_pull_request(repo, base, head, title, body)
❌ github_api(method, path, body)
```

A generic passthrough tool is a shell in disguise. It makes every scope meaningless, because "can call `github_api`" is "can do anything GitHub allows." This is the single most important rule here.

### Split read from write, in the name

The gate classifies on **tool identity**. `get_deployment` and `apply_deployment` must be two tools, never one tool with a `dryRun` flag — a flag is invisible to the classifier.

### Name destructive tools destructively

`drop_table`, `delete_app`, `force_push`, `destroy_volume`. The classifier fails closed on unknown tools; an honest name helps it fail closed *correctly* and helps the confirmation text write itself.

### Never return a secret value

Not even one the caller just set. Return the name and a confirmation. Values must never enter agent context, prompt caches, or logs.

### Return structured errors

```ts
{ ok: false, code: "RATE_LIMITED", retryAfterMs: 4200, message: "..." }
```

Not a stringified exception. The agent has to act on the result, and a string forces it to guess.

### Rate-limit and back off inside the server

So no agent has to remember to. Cache read-heavy calls. Make every write **idempotent** — a retried `create_pull_request` must find the existing PR, not open a second one.

### Scope credentials to the server

The server holds the token; the agent holds a tool name. Credentials come from environment variables and are never committed. `.mcp.json` contains `${ENV_VAR}` references only.

## Registering it

1. Add the server to [.mcp.json](../../../.mcp.json) with `${ENV_VAR}` credential references.
2. Add it to the table in [docs/mcp-integrations.md](../../../docs/mcp-integrations.md) with its purpose and the agents allowed to use it.
3. Make sure that table agrees with the scope table in [docs/agents.md](../../../docs/agents.md). If they drift, the MCP config wins because it's what actually runs — then fix the doc.
4. Add it to `enabledMcpjsonServers` in [.claude/settings.json](../../settings.json) only when it's ready to be used.
5. Any destructive tool it exposes needs a gate integration — see the [approval-gates](../approval-gates/SKILL.md) skill.

## Reviewing an existing server

- [ ] No generic passthrough tool
- [ ] Read and write are separate, differently-named tools
- [ ] Destructive tools are honestly named
- [ ] No tool returns a secret value
- [ ] Errors are structured
- [ ] Writes are idempotent
- [ ] Credentials come from env, nothing committed
- [ ] Its tool list matches what the docs claim the server can do
