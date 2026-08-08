---
name: agent-prompt-design
description: How to write or change a role agent's system prompt in AIOne — scope boundaries, the senior-judgment bar, handoff protocol, and what must never be delegated to prompt text. Use when adding an agent, editing an existing agent prompt, or debugging an agent that acts outside its role.
---

# Designing an agent prompt

Background: [docs/agents.md](../../../docs/agents.md), [ADR 0005](../../../docs/adr/0005-single-agent-before-multi-agent-split.md). Existing prompts live in [.claude/agents/](../../agents/).

## The rule that shapes everything else

**Security boundaries are never enforced by prompt text.** A prompt saying "do not push to the registry" is a suggestion; a missing tool is a fact. Prompt instructions are exactly what fails under adversarial input, and we import arbitrary repositories.

So the prompt's job is not to enforce the boundary — the MCP layer does that. The prompt's job is to make the agent *behave well inside* the boundary and hand off cleanly at its edge.

Practically: if you're about to write "never do X" for something the agent has a tool for, stop and remove the tool instead.

## Structure

**1. Identity and slice, in one or two sentences.** "You are the Backend agent. Your slice is the server: API routes, business logic, data model, migrations, auth."

**2. Scope — owns / does not touch.** Concrete paths, not categories. `api/`, `server/`, `db/` — not "backend things." Say plainly that the boundary is a security boundary and not a style preference, because an agent that understands *why* handles novel cases better than one following a list.

**3. Handoff.** What to do when work needs something outside the slice: emit a `Requirement` with enough detail to act on (method, path, shape, reason) and hand up. Say explicitly that a partial implementation plus a note is *not* the right answer.

**4. Standards — the senior-judgment bar.** This is where prompt text genuinely earns its place. Make each item checkable in review:

- Secure defaults, named specifically for this role (parameterized queries; auth on new endpoints; no permissive CORS)
- Real error handling — actionable errors, never `catch {}`, never a stack trace to a user
- Decisions carrying reasons — a migration explains why the column is nullable and what the index costs
- Knowing when *not* to. An agent that says "this needs a decision from you" is doing its job, not failing
- Matching the surrounding code: naming, idiom, comment density

**5. Working method.** The order of operations, and the instruction to name assumptions and non-actions in the summary.

## What to leave out

- **Restating the gates.** They're enforced by the layer. The DevOps prompt names them because *that* agent holds credentials and the reminder changes its bias toward asking — but no other prompt should recite the trust matrix.
- **General coding advice.** "Write clean code" costs tokens and changes nothing.
- **Anything a tool scope already handles.** See the rule above.
- **Long examples.** Prompts are read every call; pay tokens only for what changes behavior.

## Frontmatter

```yaml
---
name: backend-agent
description: <what it does, and — critically — when to use it>
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---
```

The `description` is what the orchestrator routes on, so write it for *selection*: what the agent does **and when to pick it**. "Builds APIs" is weak; "Builds APIs, business logic, schema and migrations; use for anything under `api/`, `server/`, or `db/`" is routable.

`tools` should be the **minimum** that works. Adding a tool "just in case" widens a security boundary silently.

## Model choice

Opus for planning (runs once per request, planning errors are the expensive kind), Sonnet for working agents, Haiku for routing and autocomplete. These are per-role defaults, not bindings — the model layer is multi-vendor by design ([ADR 0002](../../../docs/adr/0002-multi-vendor-model-layer.md)).

## Debugging an agent acting outside its role

In order:

1. **Does it have a tool it shouldn't?** Fix the scope, not the prompt. This is the actual cause most of the time.
2. **Is the scope section vague?** "Backend things" invites interpretation; paths don't.
3. **Is the handoff path unclear?** An agent with no clean way to hand off will improvise across the boundary — that's a design gap, not disobedience.
4. Only then consider prompt wording.

## Self-check

- [ ] No security property depends on prompt text
- [ ] Scope stated as concrete paths
- [ ] Handoff protocol is explicit and preferred over improvising
- [ ] Standards are checkable, not aspirational
- [ ] `description` says when to select this agent
- [ ] `tools` is minimal
