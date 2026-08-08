# Agent memory (project-scoped)

Durable, checked-in context for any agent working on AIOne. These files answer "what does someone need to know before touching this repo that they can't infer from the code."

## What this is, and what it isn't

**This directory** is project memory: versioned, shared by everyone on the team, reviewed like code. It travels with the repo.

**Claude Code's own auto-memory** is per-user and lives outside the repo (under `~/.claude/projects/<project>/memory/`). That's where an individual's personal working preferences accumulate across sessions. It is not shared and is not reviewed.

Don't confuse them. A team convention belongs here, in a commit. A personal preference — "I like to see the test output before the summary" — belongs in the per-user memory.

## Files

| File | Contents |
|---|---|
| [non-negotiables.md](non-negotiables.md) | The rules that override convenience, always. Read first. |
| [project-conventions.md](project-conventions.md) | How code and docs are written here |
| [decision-index.md](decision-index.md) | What's already decided, so it isn't re-litigated |
| [working-agreements.md](working-agreements.md) | How agents and humans divide work |

## Writing a memory here

Frontmatter, then prose:

```markdown
---
name: kebab-case-slug
description: one line
metadata:
  pinned: true   # applies to every session — be discerning
---
```

The bar: **applicable** (it would change what an agent does), **durable** (true next month, not just this task), and **legible** (readable without the conversation that produced it — full sentences, includes the *why*).

Transient status, task plans, and things an agent worked out for itself do not belong here. If it reads like a scratchpad note, it isn't a memory.
