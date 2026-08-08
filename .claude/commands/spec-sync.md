---
description: Find drift between the spec, the docs chapters, the ADRs, and the code
argument-hint: [chapter or subsystem to focus on]
allowed-tools: Read, Grep, Glob, Task
---

Audit for spec/docs/code drift$ARGUMENTS.

Delegate to the `spec-auditor` agent.

Documentation that no longer matches reality is a bug in this repo, tracked like any other. This command finds those bugs.

## Precedence when sources disagree

1. **The spec** ([ai-ide-platform-spec.md](../../ai-ide-platform-spec.md)) defines the product.
2. **An accepted ADR** supersedes the spec on its specific decision.
3. **The docs chapters** expand both. A chapter contradicting the spec with no ADR behind it is the bug.
4. **The code** is what runs — but if it contradicts everything above and it's *right*, the drift is upstream and needs an ADR. Silently updating docs to match unreviewed code is how a design erodes.

Report which side you think is wrong. Don't assume the code wins by virtue of existing.

## Priority order

1. **Security drift** — a boundary that no longer holds. Tool scopes disagreeing between [docs/agents.md](../../docs/agents.md), [docs/mcp-integrations.md](../../docs/mcp-integrations.md), and the actual MCP config is a security bug, not a docs bug. So is any ungated effect path.
2. **Contradiction** — two documents stating incompatible things. Quote both.
3. **Staleness** — a chapter describing something that no longer exists.
4. **Gap** — something built with nothing documenting it, or an irreversible-looking decision with no ADR.
5. **Broken cross-references** — links to files that don't exist.

## Report

`file:line` for every finding, specific enough that the fix is obvious. Propose the correction; **do not apply it** unless asked.

A clean audit reported as clean is a useful result. Don't pad it — a report full of maybes trains people to skim.
