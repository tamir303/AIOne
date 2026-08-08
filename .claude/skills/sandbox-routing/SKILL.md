---
name: sandbox-routing
description: How to pick an execution lane (WebContainers, E2B microVM, remote builder), add a lane adapter, and keep the three filesystems coherent through git. Use when writing routing logic, integrating a sandbox provider, debugging a lane handoff, or setting egress and quota policy.
---

# Sandbox routing and lane adapters

Background: [docs/sandbox-execution.md](../../../docs/sandbox-execution.md), [ADR 0004](../../../docs/adr/0004-git-as-sandbox-source-of-truth.md).

## The routing decision

First match wins. That ordering is the whole algorithm:

1. **Produces a Docker image** → remote builder. No exceptions.
2. **Needs a non-Node runtime** (Python, Go, Rust, native deps, a real Postgres process) → E2B.
3. **Long-running or exceeds browser memory** (large installs, heavy suites, multi-minute jobs) → E2B.
4. **Everything else** → WebContainers.

Rule 4 is the common case and it's the cheap one — it runs on the user's CPU, starts in about a second, and gives live preview for free. **Bias toward it.** A router that sends everything to E2B is a router that burns the budget.

### The router must be a pure function of the task descriptor

```ts
// Wrong: lane assignment becomes prompt-injectable.
const lane = pickLane(agentOutput.suggestedEnvironment);

// Right: derived from the structured task, not from model output.
const lane = pickLane({ producesImage, runtime, expectedDurationMs, memoryHintMb });
```

Never consult agent output. This is the same principle as everywhere else in AIOne: agent output is data, never policy.

## Writing a lane adapter

Agent code knows exactly one interface. `@webcontainer/api` and `e2b` are each imported in exactly one directory — their adapter.

```ts
interface SandboxLane {
  start(spec: LaneSpec): Promise<Handle>;
  writeFiles(h: Handle, files: FileMap): Promise<void>;
  exec(h: Handle, cmd: Command): Promise<ExecResult>;  // gate-checked upstream
  previewUrl(h: Handle): Promise<URL | null>;
  dispose(h: Handle): Promise<void>;
}
```

An agent module that imports a sandbox SDK directly fails review. Spec §14 flags sandbox vendor churn as a live risk — a serious competitor went closed-source mid-2026 — so swapping a provider must be one adapter file, not a migration.

Adapter requirements:

- **Never leak provider types** across the interface. If `Handle` carries an E2B-specific field, the abstraction has already failed.
- **Normalize errors** into our own taxonomy: `LaneUnavailable`, `ExecFailed`, `Timeout`, `QuotaExceeded`. Callers must not switch on provider error strings.
- **`dispose` is idempotent** and safe to call on an already-dead handle.
- **Enforce quota at `start`**, not mid-execution.

## Filesystem coherence

Git is the source of truth. There is no direct lane-to-lane filesystem sync.

- Each lane checks out from the Session's working branch.
- A lane that changed files **commits before handing off**. Local commits are auto-approved in every tier, so this costs no user friction.
- The next lane checks out that commit — a handoff is a fetch, not a merge.
- The IDE editor buffer is a fourth view; unsaved buffers are explicitly not part of shared state.
- Conflicts surface as git conflicts, in the diff UI the user already has.

If you're reaching for a shared virtual filesystem, you're about to build a distributed consistency system as a side quest. Git already solved this, with semantics the user can read.

## Egress and quotas — from day one

**Default-deny egress.** Generated code is untrusted code. E2B lanes start with outbound network denied. Package registries are the one pre-allowed category, pinned by host. Anything else is a named allowlist request, visible to the user.

The threat: a prompt-injected agent generates code that exfiltrates the workspace on first run. The sandbox is doing its job while the data leaves — isolation alone doesn't close this.

**Quotas.** Per-user sandbox-minute budget checked at lane start, plus idle timeouts (suggested: 5 min idle → suspend, 30 min → dispose). Agentic loops are retry-until-green by nature; without a ceiling, one runaway loop is a billing incident.

## Preview URLs

WebContainers previews are same-origin and free. E2B previews need a proxy with a per-session token and **must not be guessable** — an in-progress app frequently has auth disabled.

## Self-check

- [ ] Routing derives only from the task descriptor
- [ ] No provider SDK imported outside its adapter
- [ ] No provider type crosses the interface
- [ ] Handoffs go through git; the lane commits first
- [ ] Egress denies by default; allowlist entries are named and visible
- [ ] Quota checked at start; idle timeout set
- [ ] E2B preview URLs are token-scoped
