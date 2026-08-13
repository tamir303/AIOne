# Execution & sandbox layer

Expands spec §6 and the sandbox risks in §14.

## Three lanes, on purpose

| | WebContainers | E2B (microVM) | Remote builder |
|---|---|---|---|
| Where it runs | Browser tab (WASM) | Ephemeral Firecracker microVM | Depot, or a GitHub Actions runner |
| Good for | Node/Vite/npm, instant preview, the vibe loop | Python/Go/Rust backends, long-running or native processes | Docker image builds, and only those |
| Startup | ~1s | ~2–5s | ~10s+ (queue dependent) |
| Cost model | Free (user's CPU) | Per-second, ours | Per-build-minute, ours |
| Network | Proxied through us | Default-deny egress | Build-time network only |
| Can run a Docker daemon | No | Poorly — nested Docker and systemd-style init don't fit | Yes, that's the point |

They are not redundant. Each covers a case the others physically cannot, which is why the answer to "can we drop one" is no for all three.

## The router

One decision per task, in this order — first match wins:

1. **Task produces a Docker image** → remote builder. No exceptions; this is what spec §8 step 2 means.
2. **Task needs a non-Node runtime** (Python, Go, Rust, native deps, a real Postgres process) → E2B.
3. **Task is long-running or exceeds browser memory** (large installs, heavy test suites, multi-minute jobs) → E2B.
4. **Everything else** → WebContainers.

Rule 4 is the common case and it's the cheap one: it runs on the user's machine, starts instantly, and gives live preview for free. Bias toward it. A router that sends everything to E2B is a router that burns the budget in §14's first bullet.

The router is a pure function of the task descriptor. It must not consult agent output to decide, because that makes lane assignment prompt-injectable.

## Filesystem coherence

Three lanes means three filesystems, and spec §14 flags this as a decide-before-Phase-3 item. The decision:

**Git is the source of truth. Lanes reconcile through it. There is no direct lane-to-lane filesystem sync.**

- Each lane checks out from the session's working branch.
- A lane that changes files commits (locally, no gate needed — spec §10 auto-approves local commits) before handing off.
- The next lane checks out that commit. Handoff cost is a fetch, not a diff-and-merge.
- The IDE's editor buffer is a fourth view and is reconciled the same way.

The alternative — a shared virtual FS with lanes mounting it — is faster in the happy path and turns into a distributed-consistency problem the first time two lanes write concurrently. Git already solved this, and its conflict semantics are ones the user can read.

## Vendor abstraction (non-negotiable)

Spec §14: this space moves fast enough that a serious competitor went closed-source mid-2026. Therefore:

```ts
// The only interface agent code knows about.
interface SandboxLane {
  start(spec: LaneSpec): Promise<Handle>;
  writeFiles(h: Handle, files: FileMap): Promise<void>;
  exec(h: Handle, cmd: Command): Promise<ExecResult>;  // gate-checked upstream
  previewUrl(h: Handle): Promise<URL | null>;
  dispose(h: Handle): Promise<void>;
}
```

`@webcontainer/api` and `e2b` are imported in exactly one directory each — their adapter. An agent module that imports a sandbox SDK directly fails review. Swapping a provider should be one adapter file, not a migration.

## Cost and egress controls

Both from spec §14, both required from day one rather than retrofitted:

**Quotas.** Per-user sandbox-minute budget, enforced at lane start, with an idle timeout (suggested: 5 min no-activity → suspend, 30 min → dispose). Agentic loops are a retry-until-green pattern by nature; without a ceiling, one runaway loop is a billing incident.

**Default-deny egress.** Generated code is untrusted code. E2B lanes start with outbound network denied. A task that genuinely needs the network (installing packages, calling an API the app depends on) requests a named allowlist entry, and that request is visible to the user. Package registries are the one pre-allowed category, pinned to the specific registry hosts.

The threat this closes: a prompt-injected agent generating code that exfiltrates the workspace on first run. Sandboxing alone does not stop that — the sandbox is doing its job while the data leaves.

**Status.** The policy and enforcement seam described above are implemented ahead of any real lane: `packages/core/src/egress-policy.ts` defines the default-deny policy and its allowlist mechanism, and `apps/worker/src/orchestrator/egress.ts` is the seam a future lane adapter calls before letting sandboxed code reach the network. No `SandboxLane` adapter exists yet — that's Phase 1 (WebContainers) and Phase 3 (E2B, remote builder) work — so nothing calls this seam in a live path today. Quotas and idle timeouts (the other half of this section) are not yet implemented.

## Preview URLs

WebContainers previews are same-origin to the tab and free. E2B previews need a proxy with a per-session token; they must never be guessable URLs, because a preview of an in-progress app frequently has auth disabled.

## Related

- [architecture.md](architecture.md) · [docker-pipeline.md](docker-pipeline.md) · [security.md](security.md)
- ADR: [0004-git-as-sandbox-source-of-truth.md](adr/0004-git-as-sandbox-source-of-truth.md)
