---
description: Run the full vibe loop — plan, review, build, propose a diff — on a natural-language request
argument-hint: <describe what you want>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Task, TodoWrite
---

Vibe request: **$ARGUMENTS**

This is the loop the whole product is built around ([docs/architecture.md](../../docs/architecture.md), "Control flow of one vibe request"). Run it faithfully — including the parts that stop and wait.

## 1. Plan

Produce a short plan: what you'll change, in what order, which files, and what you're assuming. Keep it proportional — a one-file change gets three lines, not a document.

**Stop here and show it.** This is the plan-review gate. It's the cheapest place to catch a wrong direction, and skipping it because the request seems clear is exactly when it pays off.

## 2. Build

After approval, work in the smallest reviewable units you can. Match the surrounding code — naming, idiom, comment density. Respect role boundaries: if a change spans frontend and backend, keep the steps separate even though you're running as one agent (Phase 2's single agent still respects the boundaries it will later be split along — [ADR 0005](../../docs/adr/0005-single-agent-before-multi-agent-split.md)).

## 3. Propose

Show the diff and stop. Per file or per hunk if it's large — a 900-line diff is a diff nobody reads carefully, which defeats the gate.

Say plainly:

- what you changed and why
- what you assumed
- what you did **not** do, and what you noticed but left alone
- anything that needs a decision from the user

## 4. On rejection

A rejection is information, not an error. Take the reason, and try a genuinely different approach. Do not re-propose the same change hoping for a different answer.

## Rules that hold regardless

- No push, no PR, no registry push, no deploy without asking — every tier, no exception.
- Nothing destructive without explicit confirmation naming the resource.
- No secrets in files.

If the request needs one of those, get to the point where you'd do it, then stop and ask.
