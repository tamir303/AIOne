# Fly.io MCP Server

MCP server exposing Fly.io deployment operations as narrow, scoped tools.

## Architecture

The server implements [docs/mcp-integrations.md](../../docs/mcp-integrations.md) principles:

- **Narrow verbs, not escape hatches.** Tools are named for specific operations (`create_deployment_plan`, `apply_deployment_plan`, `rollback_deployment`) rather than `call_fly_api()`.
- **Read and write are separate tools.** `create_deployment_plan` (read-only) and `apply_deployment_plan` (mutating) are distinct, so permissions can be scoped.
- **Destructive tools require approval tokens.** `apply_deployment_plan` and `rollback_deployment` require an `approval_token` parameter that's verified by the gate layer upstream.
- **No secret values returned.** `set_secret` accepts a value but never returns it, logs it, or caches it.

## Tools

| Tool | Purpose | Approval required |
|---|---|---|
| `get_app_status` | Read current app status | No |
| `get_app_scale` | Read machine scale and regions | No |
| `create_deployment_plan` | Compute deployment diff (read-only) | No |
| `apply_deployment_plan` | Apply a plan to Fly.io | Yes |
| `get_deployment_status` | Poll deployment progress | No |
| `rollback_deployment` | Revert to a previous release | Yes |
| `set_secret` | Set an environment secret | Yes (upstream) |

## Implementation status

**Phase 1 (vertical slice):** Tools return stubs. No actual Fly.io API calls. The server structure is complete and correct.

**Phase 6 (deploy):** Tools call the real Fly.io GraphQL API and handle actual deployments, rollbacks, and secret management. The query templates and client are sketched but need real implementation.

## Building

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development
npm run dev
```

## Environment

Required environment variables (set by `.mcp.json` from your shell environment):
- `FLY_API_TOKEN` — Fly.io API token
- `FLY_ORG` — Organization slug

## Secrets handling

Per [docs/security.md](../../docs/security.md):

- Secrets are passed as `value` parameters and **never returned** in any response.
- No secret is logged or cached.
- The caller receives only confirmation of the set operation.

This is enforced in the source, not by convention.
