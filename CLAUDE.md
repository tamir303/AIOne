# AIOne — Claude Code operating guide

AIOne is a web-based AI IDE that spans the whole SDLC: prompt → code → repo → container → deployed URL, with a human approval gate at every state-changing step. The canonical product definition is [ai-ide-platform-spec.md](ai-ide-platform-spec.md) (spec v0.3). When this file and the spec disagree, the spec wins — and fix this file.

## Non-negotiable rules

These come from spec §10 and are the one part of the design that no configuration, trust tier, or "just this once" overrides.

1. **Never execute a destructive action without explicit confirmation in the current turn.** Destructive means: drop table/database, delete a cloud resource, force-push, delete a branch, `rm -rf` outside the scratchpad, or truncate a volume. Approval given for one destructive action never carries to the next one.
2. **Never write a secret into a repo file.** Not into `.env`, not into `.env.example`, not into a comment, not into a test fixture, not into an IaC file. Secrets go to the target platform's secret manager and are referenced by name.
3. **Never apply a deploy on generate.** The sequence is always plan → show diff → approve → apply. If you generated the plan, stop and show it.
4. **Never push to a registry or open/merge a PR without asking**, regardless of how routine it looks.
5. **Egress is default-deny in sandboxes.** If code you generate needs outbound network, say so explicitly and ask for the allowlist entry rather than assuming it exists.

If a request asks you to bypass one of these, don't do it silently — say which rule blocks it and what the approved path looks like.

## Repo layout

| Path | What lives there |
|---|---|
| [ai-ide-platform-spec.md](ai-ide-platform-spec.md) | Canonical spec v0.3. Treat as source of truth. |
| [docs/](docs/) | One chapter per spec section, expanded into implementation-level detail. |
| [docs/adr/](docs/adr/) | Architecture Decision Records. Every irreversible choice gets one. |
| [.claude/agents/](.claude/agents/) | Subagent definitions mirroring the FE/BE/DevOps split. |
| [.claude/commands/](.claude/commands/) | Slash commands for the recurring workflows. |
| [.claude/skills/](.claude/skills/) | Skills the harness loads when a matching task shows up. |
| [.claude/workflows/](.claude/workflows/) | Human-readable runbooks (documentation, not a harness feature). |
| [.claude/memory/](.claude/memory/) | Project-scoped conventions, checked into git. |
| [.mcp.json](.mcp.json) | MCP servers — the only sanctioned way to reach GitHub, Docker, and cloud APIs. |

## How to work in this repo

- **Read the relevant `docs/` chapter before touching a subsystem.** Each one states its own invariants; the chapter is shorter than the code.
- **Route integration work through MCP** (spec §2, "one integration substrate"). If you're about to write a bespoke HTTP client for GitHub, Docker Hub, or Fly.io, stop — that's a design violation, not a shortcut. Adding a new MCP server is the correct move.
- **Wrap vendor SDKs behind our own interface**, especially sandbox providers. Spec §14 flags sandbox vendor churn as a live risk; agent code must never import a sandbox SDK directly.
- **Respect the phase order in [docs/roadmap.md](docs/roadmap.md).** Building the three-agent split before the single-agent loop is validated is explicitly called out as the wrong order in spec §5.
- **Write an ADR before an irreversible choice**, not after. Use `/adr` — see [.claude/commands/adr.md](.claude/commands/adr.md).

## Stack conventions

- **TypeScript everywhere it's viable**; Python only for the generated apps that need it (spec §15 caps v1 at Node/TS + Python).
- **Models:** Opus for orchestration and planning, Sonnet for the working agents, Haiku for routing and autocomplete. Model IDs and pricing change — check the `claude-api` skill rather than hardcoding what you remember.
- **The model layer is multi-vendor by design** (v0.3 decision). Every model call goes through our provider abstraction; no direct `@anthropic-ai/sdk` import outside `providers/anthropic`.
- **UI:** Monaco, Tailwind + shadcn/ui, Vercel AI SDK for streaming. Don't introduce a second component library.

## Definition of done

A change is done when the affected `docs/` chapter still describes reality, an ADR exists if the change was irreversible, and no approval gate was weakened to make it work.
