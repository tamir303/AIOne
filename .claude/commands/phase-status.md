---
description: Assess which roadmap phase we are actually in, judged against exit criteria rather than intent
allowed-tools: Read, Grep, Glob, Bash, Task
---

Assess AIOne's real roadmap position.

Read [docs/roadmap.md](../../docs/roadmap.md), then judge the codebase against each phase's **exit criterion**. The criteria are the point — a phase is done when its criterion is demonstrably true, not when its tasks look finished.

## For each phase 0–6, report

- **Status:** not started / in progress / **exit criterion met**
- **Evidence** — the files, tests, or behavior that support that call. "It looks implemented" is not evidence; a test that asserts the criterion is.
- **What's missing** — specifically, for anything short of met

## Then flag

**Out-of-order work.** Machinery from a later phase built while an earlier exit criterion is unmet. The clearest instance to look for: a Frontend/Backend/DevOps split (Phase 3) while the single-agent loop (Phase 2) hasn't been validated. [ADR 0005](../../docs/adr/0005-single-agent-before-multi-agent-split.md) says that's the wrong order, and it's the most tempting mistake available.

**Criteria quietly weakened.** A phase marked done against an easier bar than the one written down. Quote both.

**Blockers.** Especially Phase 3, which is gated on the filesystem source-of-truth decision — resolved by [ADR 0004](../../docs/adr/0004-git-as-sandbox-source-of-truth.md), so verify the code actually implements it rather than assuming.

**Cross-phase obligations.** Cost quotas, idle timeouts, and default-deny egress ship with **Phase 2**, not Phase 6. Approval gates ship in Phase 2 and extend in every later phase; they are never added retroactively to a shipped action.

**Open questions past their decide-by phase.** Check [docs/risks.md](../../docs/risks.md) — R7 (Supabase lock-in), R8 (multi-tenancy), R9 (orchestration runtime) each have a deadline.

## Close with

The single highest-value next piece of work, and why it's that one rather than the alternatives. One recommendation, not a survey.
