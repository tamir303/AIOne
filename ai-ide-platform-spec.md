# Unified Full-Stack AI IDE — Spec v0.3

> v0.1 was the brainstorm doc (Base44 + Lovable + Bolt.new + v0, unified). v0.2 folded in the additional requirements: senior-level output across the stack, vibe **and** manual modes, text/file input, GitHub + Docker + cloud deploy, and a human in the loop at every stage that matters. **v0.3** locks in three decisions that change what "v1" means: this is a real product to ship, not a demo; Fly.io is the concrete v1 deploy target; and the model layer is multi-vendor by design. Changes are marked inline as *(new in v0.3)* or *(decided in v0.3)*.

## 1. Vision

A single web-based IDE that lets a developer move anywhere along a spectrum from "describe the app in English" to "hand-edit every file," without ever losing the ability to see, question, or reject what an AI agent is about to do — from the first line of code through the Docker image to the production deploy.

## 2. Design principles

- **Spectrum, not a switch.** Vibe and manual aren't two products — they're two ends of one control, and most real usage lives in the middle (agent proposes, you edit before accepting).
- **Human-in-the-loop is architecture, not UI polish.** Every state-changing action — file write, terminal command, git push, Docker push, cloud deploy — passes through an approval gate that's part of the system design, not a confirmation dialog added on top.
- **"Senior" means judgment, not just code.** Secure defaults, sensible schema decisions, real error handling, and knowing when *not* to do something — implemented as role-scoped agents rather than one generalist that treats every task the same way.
- **One integration substrate.** Use MCP (Model Context Protocol) as the standard way agents call out to GitHub, Docker registries, and cloud APIs, instead of a bespoke client per service.
- **The whole SDLC, one workspace.** Idea → code → repo → container → deployed URL, without leaving the tab.

## 3. Modes

| Mode | What it is | When it's used |
|---|---|---|
| Vibe | Natural-language prompt → orchestrator plans → agents execute across FE/BE/infra | New feature, new project, "just get me something working" |
| Manual | Full IDE: Monaco + file tree + terminal, AI available as an inline copilot only | Precise, deliberate changes; debugging; anything you don't trust an agent with yet |
| Hybrid (default) | Agent proposes a diff, you review/edit/accept per file or hunk | The 80% case once the project exists |
| Visual | Click an element in the live preview, edit it, the change maps back to source | Styling, layout, copy tweaks |

## 4. Inputs

- Free-text prompt
- Existing repo (GitHub URL import, or zip upload)
- Images — screenshots, wireframes, whiteboard photos (fed directly to the model; no separate vision model needed, see §11)
- Spec documents (PDF/Markdown)
- Sample data (CSV/JSON) to seed a schema or seed data

## 5. Agent architecture

```
Orchestrator / Planner
        ├── Frontend Agent   (components, client state, styling)
        ├── Backend Agent    (API, business logic, schema/migrations, auth)
        └── DevOps Agent     (Dockerfile, CI, IaC, secrets, deploy)
```

Each agent gets its own system prompt, its own slice of context, and — the part that actually matters — its own scoped tool permissions. The Frontend agent should not be able to touch deploy credentials or push to a registry. The Backend agent shouldn't be the one writing Terraform. This is the same reasoning a real team's access control follows, and it's what makes the multi-agent split worth the extra complexity over one generalist agent.

**MVP shortcut:** ship a single full-stack agent first (Phase 2 in the roadmap) that plays all three roles with the same judgment bar, and only split into specialists once you need the permission boundaries or the parallelism (Phase 3). Don't build the three-agent version before you've validated the core loop.

## 6. Execution & sandbox layer

| | WebContainers | E2B (microVM) | Remote builder |
|---|---|---|---|
| Where it runs | In the browser tab (WASM) | Remote ephemeral Firecracker microVM | Dedicated build service (e.g. Depot) or a CI runner |
| Good for | Node/Vite/npm, instant preview, the vibe loop | Non-Node backends (Python/Go/Rust), long-running or native processes | Docker image builds specifically |
| Why it's separate | Browser sandbox can't run a Docker daemon | MicroVMs aren't full VMs — nested Docker and systemd-style init don't fit well here either | Purpose-built for exactly this, so it doesn't fight either sandbox's limits |

A router decides per task which lane handles it. All three need to see the *same* source tree — plan a sync/handoff layer (git as the shared source of truth works well) rather than three independently-drifting filesystems.

## 7. GitHub workflow

- Install as a **GitHub App**, not bare OAuth — repo-scoped, revocable permissions and webhooks, not a token with the user's full account access.
- Branch-per-task. Agent commits to a feature branch, opens a PR with a generated description and diff summary.
- CI status flows back into the IDE (webhook → UI badge).
- Nothing reaches the default branch without an explicit approval, regardless of trust tier (§10).

## 8. Docker & artifact pipeline

1. DevOps agent generates `Dockerfile` (+ `docker-compose.yml` for local multi-service dev).
2. Image build runs on a **remote builder** (e.g. Depot) or a GitHub Actions job triggered off the PR branch — not the general agent sandbox. Neither WebContainers nor E2B-style microVMs handle a Docker daemon well.
3. Image is scanned (Trivy or Grype) before it can leave the build step.
4. Push to registry (GHCR by default; ECR/GCR/Docker Hub as adapters) — approval-gated, always.

## 9. Cloud deployment

- Adapter pattern, not a single hardcoded target: Vercel/Netlify (frontend/serverless), Fly.io/Render/Railway (containers — good v1 target, fastest to a working deploy), AWS/GCP/Azure via Terraform or Pulumi modules (add once you need it).
- A deploy is always: **generate plan (IaC diff) → show the diff → approve → apply.** Never apply-on-generate.
- Secrets live in the target platform's own secret manager. The agent should never write a secret into a repo file, even a `.env.example`-adjacent one, by default.

## 10. Human-in-the-loop / trust model

This is the part that answers "user in the middle" directly. Three configurable tiers, but a fixed floor that no tier can drop below.

| Action | Cautious | Balanced (default) | Autonomous |
|---|---|---|---|
| Read files / search codebase | auto | auto | auto |
| Write/edit files (sandbox only) | confirm each | auto, instant undo | auto |
| Terminal — read-only command | auto | auto | auto |
| Terminal — mutating/network command | confirm | confirm | auto |
| Git commit (local) | auto | auto | auto |
| Git push / open PR | confirm | confirm | confirm |
| Merge to default branch | confirm | confirm | confirm |
| Docker build (sandbox-local) | auto | auto | auto |
| Docker push to registry | confirm | confirm | confirm |
| Apply cloud deploy | confirm | confirm | confirm |
| Destructive (drop table/DB, delete cloud resource, force-push) | **always confirm, no exceptions** | **always confirm** | **always confirm** |

The floor row is the one design constraint worth treating as non-negotiable regardless of anything else in this doc.

## 11. Tech stack (refreshed from v0.1)

| Layer | Choice | Note |
|---|---|---|
| Reasoning | Claude Sonnet 5 (agents), Claude Opus 4.8 (orchestrator/planner), Claude Haiku 4.5 (autocomplete, routing) | Replaces the doc's "Claude 3.5 Sonnet" — outdated naming |
| Vision | Claude (native) | Replaces "GPT-4o or Claude Vision" — one vendor, one context |
| Orchestration runtime | Anthropic Agent SDK, or LangGraph | Agent SDK gives native subagents (isolated context per agent) + built-in MCP support — close to the FE/BE/DevOps split, but locks the orchestrator to Claude models (it can still route through the Anthropic API, Bedrock, or Vertex). LangGraph is model-agnostic if that flexibility matters more |
| Tool-calling substrate | MCP (Model Context Protocol) | Reference and community servers already exist for GitHub and Docker; standardizes cloud integrations too |
| Streaming/UI sync | Vercel AI SDK | Unchanged from v0.1 |
| In-browser execution | StackBlitz WebContainers | Unchanged |
| Heavy/native execution | E2B | Non-Node runtimes, long jobs — **not** Docker builds (see §6) |
| Docker image builds | Depot, or GitHub Actions + BuildKit | Dedicated path; avoids the docker-in-docker limits of agent sandboxes |
| Visual editing | Onlook | Unchanged |
| Code editor | Monaco | Unchanged |
| Styling vocabulary | Tailwind + shadcn/ui | Unchanged |
| Generated-app database | Supabase Management API | Unchanged — flagged as a vendor-lock question in §14 |
| Cache | Upstash Redis | Semantic cache for repeated vibe patterns |
| Version control | GitHub App + Octokit | New — see §7 |
| Vulnerability scanning | Trivy or Grype | New — see §8 |
| IaC/deploy | Terraform or Pulumi, adapter per target | New — see §9 |
| Observability | OpenTelemetry | Traces across agent calls *and* the deployed app |
| Platform auth (of the IDE itself) | Clerk, Auth.js, or Supabase Auth | Distinct from the generated app's auth |

## 12. Data model sketch

```
Workspace → Project → Session (one vibe request or manual edit session)
                          └── Run (has: Plan, Diff, Status, Approvals[])
                                └── Deployment (linked to a Run + environment)
```

## 13. Roadmap

0. **Foundations** — platform auth, workspace/project data model, bare shell.
1. **Manual IDE core** — Monaco + file tree + xterm.js + WebContainers + live preview. Has to feel like a real IDE before any AI touches it.
2. **Single-agent vibe loop** — one full-stack agent, streamed via Vercel AI SDK, first approval gate (plan review) shipped here.
3. **Multi-agent split + visual editor** — Frontend/Backend/DevOps agents, Supabase provisioning, Onlook click-to-edit.
4. **GitHub integration** — App install, branch/PR flow, CI status in-IDE.
5. **Docker & artifact pipeline** — Dockerfile gen, remote-builder builds, Trivy scan, gated registry push.
6. **Cloud deploy & observability** — one deploy adapter working end-to-end, IaC diff review, OpenTelemetry, trust tiers finalized.

## 14. Risks & open questions

- **Sandbox cost.** Agentic loops burn sandbox minutes fast — per-user quotas and idle timeouts from day one, not retrofitted later.
- **Sandbox egress.** Running arbitrary LLM-generated code, even sandboxed, needs default-deny outbound network unless a task explicitly needs it.
- **Filesystem sync.** WebContainers, E2B, and the remote builder are three different filesystems — decide the source-of-truth/sync strategy before Phase 3, not during it.
- **Sandbox vendor churn.** This space is moving fast enough that a serious competitor went from open- to closed-source mid-2026 — wrap whichever sandbox SDK you pick behind your own interface rather than calling it directly from agent code.
- **Supabase lock-in.** Fine for v1 speed; worth deciding now whether generated apps should stay portable to any Postgres, since that's a much bigger lift to retrofit later.
- **Multi-tenancy timeline.** Everything above assumes single-user/small-team. If this needs to serve many orgs, security boundaries (especially sandbox isolation and secret storage) need to be designed for that from the start, not bolted on.
- **Model vendor:** Claude-only (simpler, one context/caching story) vs. multi-model (more flexibility, more integration surface).
- **Primary cloud target for v1:** pick one to actually finish, not three to leave half-done.

## 15. Non-goals for v1

- Arbitrary language/runtime support beyond Node/TS + Python
- Enterprise SSO, RBAC, audit logging
- Multi-region deploy, autoscaling policy
- Every cloud provider on day one — one adapter, done well, beats three half-built ones
