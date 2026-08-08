# 0002 — The model layer is multi-vendor by design

- **Status:** Accepted
- **Date:** 2026-08-08
- **Spec reference:** §11, §14 ("Model vendor" open question), decided in v0.3
- **Affects:** docs/tech-stack.md, docs/agents.md, providers/

## Context

Spec v0.1 through v0.2 assumed Claude everywhere: agents, orchestrator, autocomplete, vision. That's genuinely simpler — one context format, one caching story, one billing relationship, one set of quirks to learn.

But this product's model calls are not uniform. The orchestrator makes one expensive high-judgment call per request. Role agents make many medium calls where code quality and cost both matter. Routing and autocomplete are latency-bound and near-zero-judgment. Those three profiles have different optimal answers, and the answers change as models ship. Committing the whole layer to one vendor means every one of those bets is a single bet.

v0.3 decided: multi-vendor.

## Decision

All model calls go through our own provider abstraction. No vendor SDK is imported outside its own provider directory.

- A `ModelProvider` interface covers completion, streaming, tool calls, and vision.
- Models are selected **by role** (`orchestrator`, `agent`, `router`, `autocomplete`), never by hardcoded model ID at a call site.
- Defaults are Claude across the board — Opus for orchestration, Sonnet for agents, Haiku for routing/autocomplete. Multi-vendor is about *capability*, not about spreading traffic for its own sake.
- Model IDs live in configuration, resolved at runtime. Never hardcoded from memory; they change.
- Provider-specific features (prompt caching, extended thinking) are exposed as optional capabilities the abstraction can report on, not lowest-common-denominator'd away. Flattening to the intersection of all vendors would give up more than the flexibility is worth.

## Alternatives rejected

**Claude-only.** One context format, one caching story, the best prompt-caching economics for our long-context agent loops, and native vision that removes a whole component from the v0.1 design. Rejected because the whole model layer becomes one vendor bet in a market that reprices every few months — and because the abstraction is cheap to build now and expensive to retrofit once dozens of call sites exist.

**LangChain / LiteLLM as the abstraction.** Solves the same problem off the shelf. Rejected because both flatten to a common denominator that loses the provider-specific features we care about, and both are large dependencies that move on their own schedule. Our surface is small — completion, streaming, tools, vision — and we'd end up wrapping the wrapper.

**Per-call model selection by the agent.** Let the agent pick. Rejected outright: it makes cost unpredictable and makes model choice prompt-injectable.

## Consequences

**Accepted costs.** An abstraction layer to build and maintain. Provider-specific optimizations need capability negotiation rather than direct use. Testing multiplies across providers. Prompt-caching semantics differ enough between vendors that the caching story is genuinely harder than the Claude-only version.

**What this enables.** Per-role model choice that can change without touching call sites. Vendor outages become a config change. New models can be evaluated against real traffic. And routing through Bedrock or Vertex for customers with those procurement constraints is a provider implementation, not a rewrite.

**The open tension.** The Anthropic Agent SDK is the leading candidate for the orchestration runtime ([R9 in risks.md](../risks.md)) and it locks the *orchestrator* to Claude models. That is compatible with this ADR if read carefully: this decision is primarily about the high-volume role-agent tier. Pinning the single orchestrator seat to Claude in exchange for native subagents and MCP support is a reasonable trade — but it must be decided explicitly in its own ADR by Phase 2, not absorbed silently because the SDK was convenient.

**What would reverse this.** Evidence that per-role provider flexibility is never exercised after a year of real usage, *and* that the abstraction is measurably costing us provider-specific capability. Both, not either.
