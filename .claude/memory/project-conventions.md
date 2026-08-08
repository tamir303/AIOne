---
name: project-conventions
description: How code, documentation, and decisions are written in the AIOne repository
metadata:
  pinned: false
---

# Project conventions

## Code

**TypeScript across the platform.** Python only in generated apps that need it. v1 supports generating Node/TS and Python only (spec §15) — not because other runtimes are hard, but because each one multiplies the surface of the sandbox router, the Dockerfile generator, and the deploy adapters.

**Vendor SDKs live in exactly one directory each.** `@anthropic-ai/sdk` in `providers/anthropic`, `@webcontainer/api` and `e2b` in their lane adapters, target SDKs in `adapters/<target>`. A module outside that directory importing the SDK fails review. This is what makes vendor churn a one-file change instead of a migration.

**No bespoke HTTP clients for external services.** Everything external goes through MCP. If you're writing a fetch wrapper for GitHub, Fly.io, or a registry, that's a design violation, not a shortcut — write or adopt an MCP server ([ADR 0003](../../docs/adr/0003-mcp-as-sole-integration-substrate.md)).

**Types encode invariants where they can.** `apply(plan, approval: ApprovalToken)` makes forgetting an approval a compile error rather than an incident. Prefer that over a runtime check plus a comment.

**Match the surrounding code.** Same naming, same idiom, same comment density as the file's neighbors. This matters more here than in a normal codebase because users read a lot of generated output, and code that looks foreign gets rewritten.

**One component library: Tailwind + shadcn/ui.** Don't add a second, and don't hand-roll what shadcn already has.

## Documentation

**One chapter per spec section**, in `docs/`, expanding it to implementation level and stating its own invariants. A chapter is shorter than the code it governs — read it before touching the subsystem.

**Documentation that no longer matches reality is a bug**, tracked like any other. `/spec-sync` finds them.

**Precedence when sources disagree:** spec → accepted ADR (supersedes the spec on its specific decision) → docs chapters → code. If the code contradicts everything above and is *right*, the drift is upstream and needs an ADR. Silently updating docs to match unreviewed code is how a design erodes.

**Write for the reader who arrives in six months** without the conversation that produced the file. Full sentences. State the why, not just the what.

## Decisions

**Write the ADR before the decision is executed**, not after it ships. One decision per record.

**Never edit an accepted ADR's decision** — supersede it with a new one and mark the old `Superseded by NNNN`. The history is the point.

**Steelman the rejected alternatives.** Give each its genuine advantage before the reason it lost. An alternative described weakly means the decision wasn't really made, and that section is what people actually read later.

## Phases

Respect the order in [docs/roadmap.md](../../docs/roadmap.md). Each phase's exit criterion is the next phase's assumption, and the criteria are load-bearing rather than ceremonial. Building the three-agent split before the single-agent loop is validated is explicitly the wrong order ([ADR 0005](../../docs/adr/0005-single-agent-before-multi-agent-split.md)) — and it's the most tempting mistake available, because it's the interesting part.

## Models

Opus for orchestration and planning, Sonnet for working agents, Haiku for routing and autocomplete. **Never hardcode a model ID from memory** — they change. Resolve through the provider abstraction, and check the `claude-api` skill when pricing or capability matters.
