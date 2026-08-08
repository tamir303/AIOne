---
description: Decompose a feature request into a reviewable plan with roles, gates, and open questions
argument-hint: <what you want built>
allowed-tools: Read, Grep, Glob, Task, TodoWrite
---

Plan this feature: **$ARGUMENTS**

Delegate to the `orchestrator` agent. Do not write any code in this turn — the output is a plan the user reviews and can reject cheaply.

Before planning, ground yourself:

- [docs/roadmap.md](../../docs/roadmap.md) — which phase are we in, and does this belong in it?
- [docs/agents.md](../../docs/agents.md) — the tool-scope table that determines who does what
- [docs/adr/](../../docs/adr/) — decisions already made that constrain the approach

Return:

1. **Intent** in one sentence, with any guesses flagged as guesses.
2. **Ordered steps**, each tagged `[frontend]` / `[backend]` / `[devops]`, with files touched and a one-line rationale. Schema before API before UI unless there's a reason otherwise.
3. **Handoffs** — where one role's step depends on another's output.
4. **Gates expected** — plan review, diff review, push/PR, registry push, deploy.
5. **Out of scope** — what you considered and cut, and why.
6. **Open questions** — decisions needed before step 1. Write "none" explicitly if there are none.
7. **ADR needed?** — if any step commits us to something expensive to reverse, say so and name the decision.

Then stop and ask whether to proceed. This is the plan-review gate; it exists so a wrong direction costs one planning call.
