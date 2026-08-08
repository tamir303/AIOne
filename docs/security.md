# Security model

Cross-cutting; draws on spec §6, §9, §10, §14. This chapter states the threats we're actually defending against, because a control without a threat is decoration.

## Threat model

| Threat | Why it's real here | Primary control |
|---|---|---|
| Prompt injection via repo content | We import arbitrary repos; a README can contain instructions | Tool scoping + gates; agent output is never trusted as policy |
| Generated code exfiltrates the workspace | The code is LLM-written and untrusted by construction | Default-deny egress in sandboxes |
| Agent leaks a secret into a file or a log | Helpful-seeming shortcut, very easy to do | Secrets never enter agent context; scanning as backstop |
| Sandbox escape | Running untrusted code is the product | MicroVM isolation, no host credentials in the sandbox |
| Overbroad GitHub access | A token with account-wide scope is one bug from disaster | GitHub App, per-repo, short-lived tokens |
| Destructive action without intent | The highest-consequence failure mode | The §10 floor — always confirm, per action |
| Supply-chain compromise in generated deps | Agents add packages | Lockfiles, scanning, no auto-upgrade |

## Trust boundaries

```
┌─ user's browser ────────────────────────────────────┐
│  IDE shell        │ trusted UI, untrusted input     │
└───────────────────┼─────────────────────────────────┘
┌─ our backend ─────▼─────────────────────────────────┐
│  orchestrator · gate · MCP layer · credentials      │  ← the only place secrets live
└───────────────────┬─────────────────────────────────┘
┌─ sandbox ─────────▼─────────────────────────────────┐
│  generated code · agent-run commands                │  ← fully untrusted, no credentials, egress denied
└─────────────────────────────────────────────────────┘
```

The line that matters: **no credential ever crosses into the sandbox.** Generated code that needs to call an API in development uses a per-session proxy token that is scoped, short-lived, and revocable — never the real key.

## Agent output is data, not instructions

Anything an agent produces — a plan, a diff, a command, a tool call — is a *proposal* evaluated by the gate. The gate never reads agent text to decide policy. Specifically:

- The sandbox router picks the lane from the task descriptor, never from model output.
- The action classifier classifies the concrete action, not the agent's description of it. "This is a safe cleanup command" is not evidence.
- An agent cannot request its own tool scope be widened.

This is the structural answer to prompt injection. An injected instruction can make an agent *propose* something terrible; it cannot make the gate approve it.

## Secrets

One rule, restated everywhere it applies because it's the one most likely to be broken by a shortcut: **the agent never writes a secret into a repo file.** Not `.env`, not `.env.example`, not a comment, not a test fixture, not an IaC file.

- Secrets live in the target platform's secret manager ([cloud-deploy.md](cloud-deploy.md)).
- Agents reference secrets by name, may request one be created, and may never read a value.
- Values never enter agent context, prompt caches, or logs. Redaction happens on the path to every sink, not at the call site.
- Backstops: secret scanning on commit, and secret scanning of built image layers. Backstops, not the control.

## Sandbox isolation

- E2B microVMs give hardware-level isolation; WebContainers run in the browser's own sandbox on the user's machine.
- **Egress default-deny.** Package registries are pre-allowed and pinned by host. Anything else is a named, user-visible allowlist request.
- Per-user quotas and idle timeouts from day one (spec §14) — this is a cost control *and* a blast-radius control on a runaway loop.
- Sandboxes are ephemeral. Nothing durable lives there; git is the source of truth.

## Multi-tenancy

Everything above assumes single-user or small-team. Spec §14 flags multi-tenancy as a design-it-now-or-pay-later decision, and the two places it bites are exactly the ones here: sandbox isolation between tenants, and secret storage partitioning. The `Workspace` entity exists in v1 as the seam ([data-model.md](data-model.md)) even though it currently holds one team.

## Audit

Every gate decision is append-only on the Run and in the OpenTelemetry trace. Approvals survive Project deletion. This is the artifact that answers "what did the agent do to my infrastructure, and who said yes" — the question that gets asked exactly once, urgently.

## Out of scope for v1

Per spec §15: enterprise SSO, RBAC, and formal audit-log export. The approval record is *designed* to become that export later; it just isn't productized in v1.

## Related

- [trust-model.md](trust-model.md) · [sandbox-execution.md](sandbox-execution.md) · [mcp-integrations.md](mcp-integrations.md)
- [.claude/skills/secret-handling/SKILL.md](../.claude/skills/secret-handling/SKILL.md)
