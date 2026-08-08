# GitHub workflow

Expands spec §7.

## GitHub App, not OAuth

We install as a **GitHub App**. Bare OAuth issues a token scoped to the user's whole account — every repo they can see, for as long as the token lives. A GitHub App gets:

- **Per-repository installation.** The user picks which repos we touch.
- **Granular, declared permissions** the user reads before installing.
- **Revocation that actually works** — uninstall kills access immediately, with no token still valid in a log somewhere.
- **Webhooks**, which is how CI status reaches the IDE without polling.
- **Short-lived installation tokens** (1 hour) rather than a long-lived credential.

Requested permissions, and why each is needed:

| Permission | Level | Why |
|---|---|---|
| Contents | read/write | Commit to feature branches |
| Pull requests | read/write | Open PRs, write descriptions |
| Checks / Commit statuses | read | CI status badges in-IDE |
| Metadata | read | Mandatory |
| Workflows | write | Only if the DevOps agent generates `.github/workflows/` — request separately, it's a powerful scope |

We do **not** request Administration, Members, or Secrets. An agent that can rewrite branch protection can remove the guardrails it's supposed to run inside.

## Branch-per-task

One Run, one branch: `aione/<session-short-id>/<slug>`, e.g. `aione/7f3a/invoice-pdf-export`.

- Never commit to the default branch. Not in any tier.
- Local commits are auto-approved (spec §10) — they're cheap, local, and revertible.
- Push is gated in every tier. Pushing makes the work visible to collaborators and CI, which is a real-world side effect.
- The branch is created at Run start so the agent's work is recoverable even if the session dies.

## Pull requests

The PR is the review artifact for anyone not sitting in the IDE. Generated PRs carry:

- **Title** — the user's original intent, cleaned up, not the agent's restatement.
- **Body** — what changed and why; a per-file diff summary; the plan the Run executed; anything the agent flagged but did not do.
- **Provenance** — which agent(s) ran, which model, which approvals were given, linked to the Run.
- **Explicit uncertainty.** If the agent guessed at a requirement, the PR says so. A guess buried in a diff is worse than a guess labeled as one.

PR bodies end with the generated-with attribution line. Never open a PR without asking, and never merge to the default branch without asking — both are `confirm` in all three tiers.

## CI status

Webhook → our backend → push to the session channel → badge in the IDE. Never poll the GitHub API on a timer; that burns rate limit and is slower.

A failing check is context the agent should get automatically. The desired loop: check fails → agent reads the failure log via MCP → proposes a fix diff → normal diff-review gate. That loop must not be autonomous end-to-end; a self-pushing fix loop is exactly how you end up with 40 commits nobody read.

## Repo import

Spec §4 allows importing an existing repo by URL or zip upload. On import:

1. Shallow clone into the session working tree.
2. Detect stack (package manager, framework, test runner, existing Dockerfile) and record it in the Project — the agents' prompts are conditioned on it.
3. **Do not reformat, do not upgrade dependencies, do not "clean up."** An import that produces a 4,000-line diff before the user has asked for anything destroys trust immediately.
4. Read `CONTRIBUTING.md`, `CLAUDE.md`, lint config, and existing conventions, and follow them over our defaults.

## Rate limits and idempotency

Installation tokens are per-installation rate-limited. Cache aggressively, back off on 403 with `x-ratelimit-remaining: 0`, and make every write idempotent — a retried "open PR" must find the existing PR rather than opening a second one.

## Related

- [mcp-integrations.md](mcp-integrations.md) — the GitHub MCP server is the only path to these APIs
- [trust-model.md](trust-model.md) · [docker-pipeline.md](docker-pipeline.md)
- [.claude/workflows/feature-to-pr.md](../.claude/workflows/feature-to-pr.md)
