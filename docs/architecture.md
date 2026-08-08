# Architecture

Expands spec §1, §2, §5, §6, §12.

## The shape of the system

```
                     ┌──────────────────────────────────────────┐
  Browser tab        │  IDE Shell                               │
                     │  Monaco · file tree · xterm · preview    │
                     │  Onlook visual layer · diff review UI    │
                     └──────────┬───────────────────────────────┘
                                │  streamed events (Vercel AI SDK)
                     ┌──────────▼───────────────────────────────┐
                     │  Orchestrator / Planner  (Opus)          │
                     │  decomposes intent → Plan → Runs         │
                     └──────────┬───────────────────────────────┘
                                │
      ┌─────────────────────────┼─────────────────────────┐
      │                         │                         │
┌─────▼──────┐          ┌───────▼──────┐          ┌───────▼──────┐
│ Frontend   │          │ Backend      │          │ DevOps       │
│ Agent      │          │ Agent        │          │ Agent        │
│ (Sonnet)   │          │ (Sonnet)     │          │ (Sonnet)     │
└─────┬──────┘          └───────┬──────┘          └───────┬──────┘
      │                         │                         │
      └────────────┬────────────┴────────────┬────────────┘
                   │                         │
          ┌────────▼────────┐       ┌────────▼─────────┐
          │ Approval Gate   │       │ MCP Tool Layer   │
          │ (blocking)      │       │ github · docker  │
          └────────┬────────┘       │ fly · supabase   │
                   │                └────────┬─────────┘
          ┌────────▼──────────────────────────▼─────────┐
          │ Execution Router                            │
          │  WebContainers │ E2B microVM │ Remote build  │
          └─────────────────────────────────────────────┘
```

Two things in that diagram carry most of the design weight, and both are boxes rather than arrows:

**The Approval Gate is inline and blocking.** It is not a UI component that happens to render before an action; it is a layer every state-changing call passes through, and it can refuse. An agent that finds a way to write a file without traversing it has found a bug. See [trust-model.md](trust-model.md).

**The MCP Tool Layer is the only exit.** Agents have no HTTP client, no shell access to `curl`, and no vendor SDK imports. Everything external — GitHub, registries, Fly.io, Supabase — is an MCP server. This is what makes per-agent permission scoping enforceable rather than advisory, because permissions are expressed as "which MCP servers and which tools within them," and that list is checked at the layer, not trusted to the prompt. See [mcp-integrations.md](mcp-integrations.md).

## Layers

| Layer | Responsibility | Must not |
|---|---|---|
| IDE Shell | Editing, preview, diff review, approval prompts | Contain business logic about what's approvable |
| Orchestrator | Decompose intent into a Plan; assign Runs to agents; hold the cross-agent picture | Write files or call external services itself |
| Role agents | Do the work inside their slice | Reach outside their tool scope, even when it would be faster |
| Approval Gate | Classify each proposed action, apply trust tier, block or pass | Be bypassable by any tier or flag |
| MCP Tool Layer | All external I/O, per-server auth, audit log | Hold long-lived credentials in agent-reachable memory |
| Execution Router | Pick the lane; keep the source tree consistent across lanes | Let lanes drift into three different filesystems |
| Persistence | Workspace/Project/Session/Run/Deployment + approvals audit trail | Lose the approval record — it's the compliance artifact |

## Control flow of one vibe request

1. User submits a prompt (plus optional images, spec docs, sample data — spec §4).
2. Orchestrator produces a **Plan**: an ordered list of intended changes with rationale, files touched, and the gates it expects to hit.
3. **Gate: plan review.** The user sees the plan before any agent runs. This is the first approval gate shipped (Phase 2) and the cheapest place to catch a wrong direction.
4. Orchestrator opens one or more **Runs**, each assigned to a role agent with a scoped tool set.
5. Agents work inside a sandbox lane chosen by the router. File writes inside the sandbox are cheap and reversible — under the Balanced tier they're automatic with instant undo.
6. Agents produce diffs. **Gate: diff review**, per file or per hunk. The user can edit before accepting; this is the hybrid mode that spec §3 calls the 80% case.
7. Accepted changes commit to a feature branch. **Gate: push/PR.**
8. Optional continuation into build → scan → registry push → deploy, each with its own gate.
9. Every gate decision is written to the Run's `Approvals[]` and to the OpenTelemetry trace.

The loop can be re-entered at any step. A rejected diff returns to step 5 with the rejection reason as context, not to step 1.

## Why multi-agent at all

One generalist agent with one prompt is simpler and, for code quality alone, roughly as good. The split earns its complexity for exactly two reasons, and neither is "better code":

1. **Permission boundaries.** The Frontend agent cannot be tricked into pushing to a registry because it does not have the tool. That is a security property, not a prompt instruction, and prompt instructions are the thing that fails under adversarial input.
2. **Parallelism.** Independent frontend and backend Runs against the same plan cut wall-clock time on larger features.

Until you need one of those two, the single full-stack agent is the correct implementation. Spec §5's MVP shortcut is a real instruction, not a hedge — see [roadmap.md](roadmap.md) Phase 2 vs. Phase 3.

## Cross-cutting concerns

- **Observability.** OpenTelemetry traces span agent calls *and* the deployed app, so "the generated app is slow" and "the agent took 40 seconds" are answerable from the same place.
- **Caching.** Upstash Redis holds a semantic cache of repeated vibe patterns. Cache keys must include the trust tier and tool scope — a cached plan generated under Autonomous must never be replayed for a Cautious user.
- **Source of truth.** Git, always. The three execution lanes reconcile through it rather than through direct filesystem sync. See [sandbox-execution.md](sandbox-execution.md).

## Related

- [agents.md](agents.md) · [sandbox-execution.md](sandbox-execution.md) · [trust-model.md](trust-model.md) · [data-model.md](data-model.md)
- ADRs: [0001](adr/0001-approval-gate-as-architecture.md), [0003](adr/0003-mcp-as-sole-integration-substrate.md), [0005](adr/0005-single-agent-before-multi-agent-split.md)
