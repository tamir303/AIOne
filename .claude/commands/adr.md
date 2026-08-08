---
description: Draft an Architecture Decision Record for a decision that is expensive to reverse
argument-hint: <the decision, stated as a rule>
allowed-tools: Read, Grep, Glob, Write
---

Draft an ADR for: **$ARGUMENTS**

## Before writing

1. Read [docs/adr/README.md](../../docs/adr/README.md) for the rules and [docs/adr/template.md](../../docs/adr/template.md) for the shape.
2. Read the existing ADRs. If this decision **supersedes** one, say so — the old record gets `Superseded by NNNN` and is never edited otherwise.
3. Check the spec section this touches. If the decision contradicts the spec, that's fine and it's exactly what ADRs are for — but say so explicitly in Context.
4. Pick the next sequential number. Never reuse one.

## Write it

Filename: `docs/adr/NNNN-kebab-case-title.md`. The title states the **decision**, not the topic — "Fly.io is the single v1 deploy target," not "Deploy target selection."

Sections, per the template:

- **Context** — what forces a decision now, including the constraint that makes it hard. If there's no tension, this probably doesn't need an ADR.
- **Decision** — stated as a rule someone can follow or violate. Not "we will consider."
- **Alternatives rejected** — **steelman each one.** Give it its genuine advantage, then the specific reason it lost. An alternative described weakly means the decision wasn't really made, and this is the section people actually read six months later.
- **Consequences** — accepted costs (be honest; this is what makes the record trustworthy), what it enables, and what evidence would reverse it.

Set status to **Proposed**. Do not mark it Accepted yourself — that's the user's call.

## After writing

Add the row to the index table in [docs/adr/README.md](../../docs/adr/README.md), and note any docs chapter that now needs a cross-reference.
