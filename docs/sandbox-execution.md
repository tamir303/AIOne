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
  spawnInteractive(h: Handle, cmd: Command): Promise<InteractiveProcess>;  // xterm.js terminal, issue #42
  previewUrl(h: Handle): Promise<URL | null>;
  dispose(h: Handle): Promise<void>;
}
```

`spawnInteractive` (issue #42) is the PTY-backed counterpart to `exec()`: instead of collecting output into a single `ExecResult` once the process exits, it hands back an `InteractiveProcess` — a live output stream, a `write()` for input, `resize()` for the attached pseudoterminal's cols/rows, and an `exit` promise — and leaves the process running until the caller kills it or it exits on its own (e.g. `exit` typed into a shell). It never times out on its own the way `exec()` does; there's no defined "done" point for an interactive shell. `apps/web/src/components/Terminal.tsx` is the one consumer today, piping xterm.js's input/output through it.

`@webcontainer/api` and `e2b` are imported in exactly one directory each — their adapter. An agent module that imports a sandbox SDK directly fails review. Swapping a provider should be one adapter file, not a migration.

## Cost and egress controls

Both from spec §14, both required from day one rather than retrofitted:

**Quotas.** Per-user sandbox-minute budget, enforced at lane start, with an idle timeout (suggested: 5 min no-activity → suspend, 30 min → dispose). Agentic loops are a retry-until-green pattern by nature; without a ceiling, one runaway loop is a billing incident.

**Default-deny egress.** Generated code is untrusted code. E2B lanes start with outbound network denied. A task that genuinely needs the network (installing packages, calling an API the app depends on) requests a named allowlist entry, and that request is visible to the user. Package registries are the one pre-allowed category, pinned to the specific registry hosts.

The threat this closes: a prompt-injected agent generating code that exfiltrates the workspace on first run. Sandboxing alone does not stop that — the sandbox is doing its job while the data leaves.

**Status.** The policy and enforcement seam described above are implemented ahead of any real lane: `packages/core/src/egress-policy.ts` defines the default-deny policy and its allowlist mechanism, and `apps/worker/src/orchestrator/egress.ts` is the seam a future lane adapter calls before letting sandboxed code reach the network. No `SandboxLane` adapter exists yet — that's Phase 1 (WebContainers) and Phase 3 (E2B, remote builder) work — so nothing calls this seam in a live path today. Quotas and idle timeouts (the other half of this section) are not yet implemented.

## Preview URLs

WebContainers previews are same-origin to the tab and free. E2B previews need a proxy with a per-session token; they must never be guessable URLs, because a preview of an in-progress app frequently has auth disabled.

## Cross-origin isolation (COOP/COEP), and Clerk

WebContainers (rule 4 above, the common case) needs `SharedArrayBuffer`, which the browser only exposes when the page is **cross-origin isolated**. That requires the serving origin to send, on the top-level document response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`apps/web/vite.config.ts` sets both headers on the Vite `server` (dev) and `preview` config, so `pnpm --filter @aione/web dev` and `vite preview` are already cross-origin isolated. `apps/web/src/main.tsx` checks `window.crossOriginIsolated` at startup via `apps/web/src/lib/crossOriginIsolation.ts` and logs a dev-time `console.warn` (not a crash) if it's ever false — a silently-false isolation flag is what turns into a confusing "SharedArrayBuffer is not defined" failure much later, once WebContainers is actually wired in.

**Clerk was verified compatible with `require-corp` — no fallback to `credentialless` was needed.** Phase 0 shipped `@clerk/react`, which loads its script bundle, UI chunks, and modal/avatar assets from the signing app's own `*.clerk.accounts.dev` (or `clerk.<app-domain>` in production) origin, plus a Cloudflare Turnstile bot-check iframe. COEP `require-corp` blocks any cross-origin subresource that doesn't opt in via `Cross-Origin-Resource-Policy` or a CORS response — so this had to be checked empirically, not assumed from docs, per the investigation below.

**What was actually run:** the Vite dev server was started with the headers above, and a headless Chromium session (Playwright) was pointed at `http://localhost:5173`, using a real, disposable Clerk "keyless"/accountless dev instance (Clerk's own no-signup bootstrap endpoint, `POST https://api.clerk.com/v1/accountless_applications` — the same mechanism `@clerk/nextjs` uses for zero-config local dev) so the test exercised real Clerk infrastructure rather than a stub.

Findings:

- `window.crossOriginIsolated` was `true` on load.
- The `SignInButton`/`SignUpButton` modal (`mode="modal"`) opened and rendered completely: email field, password field, "Continue with Google" social button, and the Clerk-branded footer all displayed and were interactive.
- Every Clerk-origin network response observed (`*.clerk.accounts.dev/npm/@clerk/clerk-js@…`, `@clerk/ui@…` chunks, `img.clerk.com/static/*.svg`, and the Clerk API calls to `/v1/client`, `/v1/environment`, `/v1/dev_browser`) came back `200`/`307` with either `Cross-Origin-Resource-Policy: cross-origin` or a permissive CORS `Access-Control-Allow-Origin: *` — exactly what `require-corp` requires from a cross-origin subresource, and none were blocked (`net::ERR_BLOCKED_BY_RESPONSE`, the signature of a COEP block, never appeared).
- The sign-up flow's Cloudflare Turnstile bot-check also rendered as a working cross-origin iframe under `require-corp` (iframes aren't subject to the same-origin-or-CORP restriction that COEP applies to fetch/script/img subresources).
- The one failed request seen (`net::ERR_NAME_NOT_RESOLVED` for a Turnstile challenge-escalation sub-host) was a DNS failure, not a COEP block, and didn't stop the visible modal from working.
- Headless-browser bot detection (expected and unrelated to COEP) blocked completing a full OTP-verified sign-in in the automated test, so `UserButton`'s post-auth render wasn't captured by screenshot; but `UserButton` ships in the same `@clerk/ui` bundle and reads assets from the same `img.clerk.com` origin already proven to load cleanly under `require-corp`, so there's no COEP-specific reason to expect it to differ from the sign-in modal.

Given `require-corp` worked cleanly, `credentialless` was not tried — the ticket that prompted this section only called for it as a fallback if `require-corp` broke Clerk.

### Production hosting headers

The two headers above are set by Vite for `dev`/`preview` only — they do **not** carry over to however `apps/web`'s built `dist/` output ends up served in production (Fly.io, a static host, a CDN, or a reverse proxy in front of one). Whatever serves the SPA's `index.html` in production must set the same two headers on that response (and it's simplest to set them on every response from that host):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Concretely, depending on what ends up fronting the built assets:

- **Static host / CDN with a headers file** (e.g. a `_headers` file convention): add a rule matching `/*` with the two headers above.
- **Nginx or another reverse proxy:** `add_header Cross-Origin-Opener-Policy same-origin;` and `add_header Cross-Origin-Embedder-Policy require-corp;` in the relevant `server`/`location` block.
- **Served through a Hono app** (as `apps/api` already is): a small middleware setting both response headers before the static handler, mirroring `apps/web/vite.config.ts`'s `crossOriginIsolationHeaders`.

Whoever picks the production host for `apps/web` should carry this header pair over as part of that decision, not rediscover it — this is the note the WebContainers/Monaco/xterm tickets depend on.

## Related

- [architecture.md](architecture.md) · [docker-pipeline.md](docker-pipeline.md) · [security.md](security.md)
- ADR: [0004-git-as-sandbox-source-of-truth.md](adr/0004-git-as-sandbox-source-of-truth.md)
