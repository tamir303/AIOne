---
name: github-workflow
description: Create branches, commit, push, and open PRs following AIOne's repo workflow — branch naming, commit format, gated pushes, PR descriptions.
---

# GitHub workflow skill

Agents use this skill to work with the AIOne repo: creating feature branches, committing changes, pushing safely, and opening pull requests. Everything follows the patterns in [docs/github-workflow.md](../../docs/github-workflow.md) and [CLAUDE.md](../../CLAUDE.md).

## Key constraints

**Branch naming:** `aione/<session-short-id>/<slug>` — e.g., `aione/7f3a/invoice-pdf-export`. Never commit to `master` or `main`, even in any tier.

**Commits:** Local commits are auto-approved (spec §10). Message format: imperative, says what changed and why (not which files). End with co-author line:
```
Add invoice PDF export via Supabase storage

Generates PDFs server-side and streams to the client. Uses Puppeteer
for layout and keeps generated files off the working tree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

**Push and PR:** Both are `confirm` in every tier. Before either:
1. `git status` — know what's going out
2. `git diff` — scan for secrets (stop if found)
3. Run build, lint, tests
4. Show the user what will be pushed, then stop and ask

**Rejection:** If a diff is rejected, that's information. Take the reason, try a different approach. Never re-propose the identical change.

## Workflow: prompt to PR

One loop, three gates:

```
plan review ──► build ──► diff review ──► commit ──► push/PR ──► CI
   (gate)                  (gate)            (auto)      (gate)
```

### 1. Plan review

The orchestrator produces a plan. User reviews it. See `/plan-feature`.

### 2. Diff review

Agent builds, produces a diff. User reviews per-file or per-hunk. Can edit before accepting.

**See [docs/github-workflow.md](../../docs/github-workflow.md) section "5. Diff review."**

### 3. Commit (auto-approved)

After acceptance:
```bash
git add <files>
git commit -m "$(cat <<'EOF'
Your message here

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

Local commits never need approval (spec §10). They're cheap, revertible, auditable in `git log`.

### 4. Push and PR (confirm every time)

**Always gated. Always ask first.**

Before running:
1. `git status` — current state
2. `git diff <local> <remote>` — what's going out (if remote exists)
3. Build: `pnpm run build` (or project equivalent)
4. Lint: `pnpm run lint`
5. Tests: `pnpm run test`
6. Scan for secrets: grep for patterns like `sk-`, `ghp_`, `github_pat_`, or any value looking like a credential

If anything fails or a secret appears, **stop here.** Report it and do not proceed.

If all pass:
```bash
# Show the diff
git diff origin/main..HEAD  # or local branch against master

# Ask the user: "Ready to push to [branch] and open PR on [repo]? Show:
# - branch name
# - commit count
# - files changed summary
# Wait for confirmation.
```

Only after confirmation:
```bash
git push -u origin <branch>
```

Then open the PR with `/open-pr` or via MCP `create_pull_request`.

### 5. PR description

Written for a reviewer not in the IDE:

**Structure:**
1. **What changed and why** — the user's intent (e.g., "add invoice PDF export") NOT a restatement of your steps
2. **Per-file summary** — for non-obvious changes
3. **The plan** — if one existed, mention it
4. **Assumptions flagged** — "I guessed X. Please verify." Labeled assumptions are useful; buried ones are landmines
5. **What was noticed but not done** — edge cases you saw but skipped, with reasons
6. **Test evidence** — what you ran, what passed. Include failures with output.

**Example:**
```
## What changed

Added server-side PDF export for invoices. Generates on-demand via
Puppeteer, streams to client, keeps generated files off the working tree.

## Changes per file

- `api/routes/invoices.ts`: Added POST `/invoices/:id/export-pdf`
  endpoint. Returns binary PDF stream.
- `lib/pdf-generator.ts`: New module wrapping Puppeteer for invoice
  layout. Inlines CSS to avoid font/asset issues.

## Assumptions

- Puppeteer is available in the runtime (package.json dep). Untested on
  Windows; may need fontconfig setup.
- Client-side PDF libraries (jsPDF, pdfkit) were rejected because
  server-side generation gives better control over layout.

## Not done

- Caching generated PDFs — too many variables (invoice updates, config
  changes). Re-generate on each request for now.
- Email delivery — that's a separate feature.

## Tests

```
pnpm test api/routes/invoices.test.ts
> PASS  api/routes/invoices.test.ts
  invoices
    ✓ POST /invoices/:id/export-pdf returns 200 with PDF (124ms)
    ✓ returns 404 if invoice not found (45ms)
    ✓ strips auth from HTML before rendering (89ms)
```

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Rejection is normal

If a diff is rejected:
- Read the reason carefully
- Do not re-propose the identical change
- Return to the build phase with the feedback as context
- Try a genuinely different approach

A rejection that says "this adds too much coupling to the auth system" is information. "Actually, here's a decoupled version" is the right response. "Let me propose the same thing again" is not.

## Commands and tools

**High-level:** `/open-pr` — full workflow (branch → commit → push → PR). Use this for straightforward changes.

**Low-level:** GitHub MCP server tools — `create_branch`, `create_pull_request`, `push_files`, `list_branches`, `get_commit`. Use when you need fine-grained control.

**Raw git:** `git` commands via Bash. Always available. Use for inspection (`git log`, `git diff`, `git status`).

**Integration with gates:** Bash `git push` and `gh pr create` are gated in [.claude/settings.json](./.claude/settings.json) — they require confirmation in every trust tier.

## Gotchas

**Line endings:** `.gitattributes` normalizes to LF on commit, CRLF on Windows checkout. You won't see this in diffs; it's handled automatically.

**No force-push:** `git push --force` is blocked by [.claude/hooks/guard-destructive.mjs](./.claude/hooks/guard-destructive.mjs). Never force-push — use `git revert` or create a new PR instead.

**Secret in history is not removed by deletion:** If a secret makes it into a commit, it's compromised. Deleting the line in a later commit doesn't un-publish it. The secret needs **rotating**, not just removing. See [docs/security.md](../../docs/security.md).

**Commit to master by accident:** Won't happen — it's blocked by the branch-per-task rule. But if it does, you'll need to undo it (which is a destructive operation and requires approval).

## Related

- [docs/github-workflow.md](../../docs/github-workflow.md) — full architecture of the branch/PR flow
- [CLAUDE.md](../../CLAUDE.md) — project operating guide, including the non-negotiable rule about pushing
- [docs/security.md](../../docs/security.md) — secret handling
- `/open-pr` — the command that runs this workflow end-to-end
