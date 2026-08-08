# Agent architecture

Expands spec §5. The harness-level implementations live in [.claude/agents/](../.claude/agents/).

## Roles

```
Orchestrator / Planner
        ├── Frontend Agent   (components, client state, styling)
        ├── Backend Agent    (API, business logic, schema/migrations, auth)
        └── DevOps Agent     (Dockerfile, CI, IaC, secrets, deploy)
```

Each agent has three things of its own: a system prompt, a context slice, and a tool scope. The third is the one that matters. The first two affect output quality; the third is a security boundary.

## Tool scopes

This table is the contract. It is enforced at the MCP layer, not requested in the prompt.

| Capability | Orchestrator | Frontend | Backend | DevOps |
|---|:---:|:---:|:---:|:---:|
| Read repo / search | ✅ | ✅ | ✅ | ✅ |
| Write `app/`, `components/`, styles | — | ✅ | — | — |
| Write `api/`, `server/`, `db/migrations` | — | — | ✅ | — |
| Write `Dockerfile`, `.github/`, IaC | — | — | — | ✅ |
| Run sandbox commands | — | ✅ | ✅ | ✅ |
| Provision database (Supabase MCP) | — | — | ✅ | — |
| Registry credentials / image push | — | — | — | ✅ |
| Cloud deploy credentials (Fly MCP) | — | — | — | ✅ |
| Open PR | — | — | — | ✅ |
| Spawn agents / assign Runs | ✅ | — | — | — |

Reading the table by column: the Frontend agent literally cannot reach a deploy credential. The Backend agent cannot write Terraform. The Orchestrator plans and never writes — which keeps its context clean and makes its output reviewable as a plan rather than as a diff.

Two consequences worth internalizing:

- **Cross-boundary work requires a handoff, not a workaround.** If the Frontend agent needs an API route, it does not write one — it reports the requirement upward and the Orchestrator opens a Backend Run. An agent that starts writing outside its scope is a bug in the scope config, and the fix is to correct the config, not to widen it.
- **Widening a scope is an ADR-level decision.** "The DevOps agent needs to edit `api/` just this once" is how the boundary dies.

## The MVP shortcut is not optional advice

Ship **one full-stack agent** first (Phase 2). It plays all three roles at the same judgment bar. Split into specialists only when you need the permission boundaries or the parallelism (Phase 3).

The reason to obey this: the three-agent version multiplies the surface area of every bug in the core loop by three, and the core loop — plan, propose, review, accept — is the thing that has to be right. Debugging a handoff protocol before you know whether the diff-review UX works is wasted effort.

The single agent still runs behind the full approval gate, and its tool scope is the **union** of the three columns above. That union is broad, which is precisely why Phase 2 is scoped to a single user's own sandbox and why registry/deploy gates stay confirm-only in every tier.

## What "senior-level" means, concretely

Spec §2 says judgment, not just code. That's implemented as explicit standing expectations in each agent's prompt, and it is checkable in review:

- **Secure defaults.** Parameterized queries, auth on new endpoints by default, no permissive CORS, no secrets in files.
- **Real error handling.** Errors that a caller can act on, not `catch {}` and not a stack trace rendered to the user.
- **Schema decisions with reasons.** A migration comes with a note on why the column is nullable, why that index exists, and what it costs.
- **Knowing when not to.** Refusing a request that would introduce a security hole, and saying which one, beats silently building it. An agent that says "this needs a decision from you" is doing its job.
- **Matching the codebase.** New code reads like the code around it — same naming, same idiom, same comment density.

## Handoff protocol

Runs communicate through structured artifacts, never through shared mutable state:

```
Run(frontend) → Requirement { kind: "api-route", method: "POST",
                              path: "/api/invoices", shape: {...},
                              reason: "invoice form submit" }
             → Orchestrator → Run(backend)
```

The Orchestrator is the only component that sees all Runs. This keeps each agent's context small, which is both a cost and a quality property — a Frontend agent that has never seen the Terraform is a Frontend agent that cannot accidentally reason about it.

## Model assignment

| Agent | Model | Why |
|---|---|---|
| Orchestrator | Opus | Planning quality dominates; runs once per request, so cost is amortized |
| Role agents | Sonnet | The working tier — good code at a per-Run cost that survives a long session |
| Routing, autocomplete | Haiku | Latency-bound, high-frequency, low-judgment |

Model IDs move. Resolve them through the provider abstraction and the `claude-api` skill rather than hardcoding a string you remember. The v0.3 multi-vendor decision means these are *defaults per role*, not fixed bindings — see [adr/0002-multi-vendor-model-layer.md](adr/0002-multi-vendor-model-layer.md).

## Related

- [.claude/agents/](../.claude/agents/) — the harness definitions of these roles
- [trust-model.md](trust-model.md) — what each agent still has to ask permission for
- [mcp-integrations.md](mcp-integrations.md) — where tool scopes are actually enforced
