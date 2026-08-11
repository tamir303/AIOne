# Container Registry MCP Server

MCP server exposing container registry operations as narrow, scoped tools.

## Architecture

Implements [docs/mcp-integrations.md](../../docs/mcp-integrations.md) principles:

- **Narrow verbs.** Tools are `push_image`, `delete_image`, `tag_image` rather than a generic `call_registry_api()`.
- **Read vs. write.** `get_image_metadata` and `get_scan_results` are read-only. `push_image`, `delete_image`, `tag_image` are mutating and require approval tokens.
- **Approval-gated mutations.** `push_image`, `delete_image`, and `tag_image` require an `approval_token` verified upstream by the gate layer.
- **No credentials in responses.** The server authenticates to the registry; callers never see the token.

## Tools

| Tool | Purpose | Approval required |
|---|---|---|
| `get_image_metadata` | Read image size, digest, creation date | No |
| `get_scan_results` | Read Trivy/Grype vulnerability scan | No |
| `push_image` | Push image to registry | Yes |
| `delete_image` | Delete image from registry | Yes |
| `tag_image` | Create image alias (promote to latest) | Yes |

## Implementation status

**Phase 1 (vertical slice):** Tools return stubs. The server is complete and correct structurally.

**Phase 5 (docker & artifact pipeline):** Tools call the real registry API. The default registry is GHCR; adapters for ECR, GCR, and Docker Hub can be added later.

## Building

```bash
npm install
npm run build
npm run dev  # development
```

## Environment

- `REGISTRY_HOST` — Registry hostname (default: ghcr.io)
- `GHCR_TOKEN` — GitHub Container Registry authentication token

In production, support ECR_ROLE, GCR_SA_KEY, DOCKER_HUB_TOKEN as alternatives.

## Secrets handling

Per [docs/security.md](../../docs/security.md):

- No credential is returned or logged.
- The token is held by the server, not passed to callers.
- This is enforced in the source code, not by convention.
