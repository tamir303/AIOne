---
description: Audit the approval gate — find state-changing paths that can reach an effect without traversing it
argument-hint: [subsystem or path to focus on]
allowed-tools: Read, Grep, Glob, Bash, Task
---

Audit the approval gate$ARGUMENTS.

This is the check that matters most in this codebase. The gate is the property that makes it defensible to give this product real credentials ([ADR 0001](../../docs/adr/0001-approval-gate-as-architecture.md)), and the way it fails is quietly: someone adds an effect to a path that was already approved for something else.

Delegate to the `security-reviewer` agent, focused on gate integrity.

## What to look for

**Ungated effects.** Enumerate every path that changes state — file write outside a sandbox, terminal command, git push, PR, registry push, deploy, DDL — and confirm each one traverses the gate layer. A path that reaches the effect without it is a critical finding, and it will not announce itself.

**Gates implemented as UI.** A modal is not a gate. If the check lives in a component rather than in the call path, it's one refactor from being skipped.

**Missing `ApprovalToken`.** `apply()`, `push()`, and every destructive operation must require one in their signature. If the parameter is optional, nullable, or trivially constructible, the compile-time guarantee is gone.

**Classifier default.** Unknown actions must resolve to `destructive`. A default of "allow" for unrecognized commands is critical. Check composite commands too — `npm test && flyctl deploy` must take the maximum class of its parts.

**The floor.** The always-confirm rows must be *absent from the config schema*, not merely set to `confirm`. If there's a key that could flip one to auto, that's a finding even if nothing sets it today.

**Approval record integrity.** Append-only enforced at the database level (UPDATE/DELETE revoked from the app role), not by application discipline. `action_summary` stored verbatim as rendered, not as a template ID. `tier_at_time` denormalized.

**Cache poisoning.** Semantic cache keys must include trust tier and tool scope. A plan generated under Autonomous replayed for a Cautious user silently bypasses a gate.

## Report

Findings ordered by severity, each with `file:line`, the concrete failure scenario, and the fix. If the gate is intact, say so and list which paths you enumerated — a clean result is only useful if the reader knows its coverage.
