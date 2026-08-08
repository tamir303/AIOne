# MCP integrations

Expands spec §2 ("one integration substrate") and §11. Server config lives in [.mcp.json](../.mcp.json).

## Why MCP is the only exit

Every external call an agent makes goes through an MCP server. No agent module contains an HTTP client, a vendor SDK import, or a shell path to `curl` or `gh`.

This is not stylistic. It's what makes the per-agent tool scopes in [agents.md](agents.md) *enforceable*:

- **Permissions become a checkable list.** "The Frontend agent may use `github:read_file` but not `github:create_pull_request`" is data the tool layer checks, not an instruction the prompt asks for. Prompt instructions fail under adversarial input; a missing tool cannot be talked into existing.
- **One audit point.** Every external effect flows through one layer, so the approval gate and the trace have exactly one place to hook.
- **Credentials stay out of agent reach.** The server holds the token. The agent holds a tool name.
- **Swapping a provider is swapping a server**, not editing agent code.

If you're about to write a bespoke client for an external service, that's a design violation. Write or adopt an MCP server instead.

## Servers

| Server | Purpose | Agents with access | Auth |
|---|---|---|---|
| `filesystem` | Read/write the session working tree | all (path-scoped per role) | none — local |
| `github` | Repo, branch, commit, PR, checks | orchestrator (read), devops (write) | GitHub App installation token |
| `fly` | Deploy plan/apply, secrets, status, rollback | devops only | `FLY_API_TOKEN` |
| `registry` | Image tag, scan result, push | devops only | `GHCR_TOKEN` |
| `supabase` | Provision DB, run migrations | backend only | `SUPABASE_ACCESS_TOKEN` |
| `otel` | Query traces for debugging | all (read-only) | internal |

Read the "agents with access" column as the enforcement point for [agents.md](agents.md)'s scope table. The two must agree; if they drift, the MCP config wins because it's what actually runs — and then fix the doc.

## Configuration

Servers are declared in [.mcp.json](../.mcp.json) and read credentials from environment variables. A server whose variables are unset does not start, and its absence is reported at session start rather than failing mid-Run.

Never commit a token. `.mcp.json` contains `${ENV_VAR}` references only; the values live in your shell, your secret manager, or `.env.local` — which is gitignored.

## Writing a new server

Before writing one, check whether a reference or community server already covers it. GitHub and Docker both have existing servers worth starting from.

When you do write one:

- **Tools are verbs with narrow scope.** `create_pull_request`, not `github_api(method, path, body)`. A generic escape-hatch tool defeats the entire permission model — it's a shell in disguise.
- **Split read from write in the tool name.** The gate classifies on tool identity; `get_deployment` and `apply_deployment` must not be one tool with a flag.
- **Destructive tools are named destructively.** `drop_table`, `delete_app`, `force_push`. The classifier fails closed on unknown tools, and an honest name helps it fail closed correctly.
- **Return structured errors**, not stringified exceptions. The agent has to act on them.
- **Never return a secret value**, even one the caller just set. Return the name and a confirmation.
- **Rate-limit and back off inside the server**, so no agent has to remember to.

## Local development

`claude mcp list` shows configured servers and their status. Missing credentials show as a disabled server, not a crash. See the setup notes in the [README](../README.md).

## Related

- [agents.md](agents.md) — the scope table these servers enforce
- [trust-model.md](trust-model.md) — the gate sits between the agent and the server
- [.claude/skills/mcp-server-authoring/SKILL.md](../.claude/skills/mcp-server-authoring/SKILL.md)
