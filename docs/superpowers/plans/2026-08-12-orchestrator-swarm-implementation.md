# Orchestrator-Centric Dev-Swarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `dev-swarm` skill's peer-to-peer self-claim model with a centralized orchestrator that assigns every ticket, mediates every rejection, and is the sole PR approver — closing the collision bug the peer-to-peer version hit in production (three teammates independently claimed the same issue because every teammate shares one `gh` identity).

**Architecture:** The orchestrator role is fulfilled by the lead Claude Code session itself (already Sonnet 5) — it is not a spawned teammate. Two teammate roles are spawned: BL agents (2× Sonnet for complex tickets, 1× Haiku for simple ones) that implement on assignment, and validation agents (2×, Haiku-class) that check branches directly (no PR exists yet at validation time) by delegating the actual pass/fail judgment to a Gemini API call wrapped in a small repo script. GitHub issue labels remain the durable state machine; the team task list stays transient/in-session only.

**Tech Stack:** TypeScript (Node 22+, ESM, `nodenext` module resolution for workspace packages), `tsx` for running the standalone Gemini script directly, Node's built-in `node:test` + `node:assert/strict` for its tests, `gh` CLI for all GitHub state, native `fetch` for the Gemini REST call (no SDK dependency).

## Global Constraints

- Never write a secret into a repo file — not `.env`, not a comment, not a fixture (CLAUDE.md rule #2). `GEMINI_API_KEY` is read from the environment only, already set as a user-level env var outside the repo.
- Never push, open, or merge a PR without the user's explicit go-ahead in the current turn (CLAUDE.md rule #4) — this plan's own commits are local only; do not push or open a PR as part of executing it.
- Node `>=22.0.0`, pnpm `>=9.0.0` (repo `package.json` engines floor).
- Workspace packages use `"type": "module"` and TypeScript `moduleResolution: "nodenext"`, which requires explicit `.js` extensions on relative imports of compiled sources — this does **not** apply to `scripts/`, which sits outside the root `tsconfig.json`'s `include` and is never compiled by `tsc`, only run directly via `tsx`. Use plain `.ts` extensions on relative imports inside `scripts/`.
- Follow the repo's existing script-running convention: TS entrypoints are invoked as `node --import tsx/esm <file>` (see `apps/api/package.json`, `apps/worker/package.json`), not `ts-node` or a compiled step.

---

### Task 1: Gemini validation script

**Files:**
- Create: `scripts/validate-with-gemini.ts`
- Create: `scripts/validate-with-gemini.test.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: `buildValidationPrompt(input: ValidationInput): string`, `parseVerdict(raw: string): ValidationResult`, and the types `Verdict = "pass" | "fail-missing-context" | "fail-needs-fix"`, `ValidationInput = { issueNumber: number; issueBody: string; diff: string; testOutput: string }`, `ValidationResult = { verdict: Verdict; explanation: string }`. These are consumed directly in this task's own tests; downstream, the validation-agent role (Task 2) consumes the script as a CLI — stdin JSON matching `ValidationInput`, stdout JSON matching `ValidationResult` — not as an imported module.

- [ ] **Step 1: Write the failing tests**

Create `scripts/validate-with-gemini.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildValidationPrompt, parseVerdict } from "./validate-with-gemini.ts";

test("buildValidationPrompt includes the issue number, body, diff, and test output", () => {
  const prompt = buildValidationPrompt({
    issueNumber: 42,
    issueBody: "Add a widget.",
    diff: "+const widget = true;",
    testOutput: "1 passing",
  });
  assert.match(prompt, /#42/);
  assert.match(prompt, /Add a widget\./);
  assert.match(prompt, /\+const widget = true;/);
  assert.match(prompt, /1 passing/);
});

test("buildValidationPrompt instructs the model to respond with only the three allowed verdicts", () => {
  const prompt = buildValidationPrompt({
    issueNumber: 1,
    issueBody: "",
    diff: "",
    testOutput: "",
  });
  assert.match(prompt, /"pass"/);
  assert.match(prompt, /"fail-missing-context"/);
  assert.match(prompt, /"fail-needs-fix"/);
});

test("parseVerdict accepts a clean JSON response", () => {
  const result = parseVerdict('{"verdict": "pass", "explanation": "Looks correct."}');
  assert.deepEqual(result, { verdict: "pass", explanation: "Looks correct." });
});

test("parseVerdict strips markdown code fences before parsing", () => {
  const raw = '```json\n{"verdict": "fail-needs-fix", "explanation": "Off by one."}\n```';
  const result = parseVerdict(raw);
  assert.deepEqual(result, { verdict: "fail-needs-fix", explanation: "Off by one." });
});

test("parseVerdict rejects a verdict value outside the allowed set", () => {
  assert.throws(
    () => parseVerdict('{"verdict": "looks-good", "explanation": "..."}'),
    /invalid verdict/,
  );
});

test("parseVerdict rejects non-JSON output", () => {
  assert.throws(() => parseVerdict("Sure, this passes!"), /not valid JSON/);
});

test("parseVerdict rejects JSON missing the explanation field", () => {
  assert.throws(() => parseVerdict('{"verdict": "pass"}'), /missing required fields/);
});

test("CLI exits with an error when GEMINI_API_KEY is not set", () => {
  const scriptPath = fileURLToPath(new URL("./validate-with-gemini.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", scriptPath], {
    input: JSON.stringify({ issueNumber: 1, issueBody: "x", diff: "x", testOutput: "x" }),
    encoding: "utf8",
    env: { ...process.env, GEMINI_API_KEY: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GEMINI_API_KEY is not set/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx/esm --test scripts/validate-with-gemini.test.ts`
Expected: FAIL — `scripts/validate-with-gemini.ts` doesn't exist yet, so the import errors out (`Cannot find module './validate-with-gemini.ts'` or similar).

- [ ] **Step 3: Write the implementation**

Create `scripts/validate-with-gemini.ts`:

```typescript
import { pathToFileURL } from "node:url";

export type Verdict = "pass" | "fail-missing-context" | "fail-needs-fix";

export interface ValidationInput {
  issueNumber: number;
  issueBody: string;
  diff: string;
  testOutput: string;
}

export interface ValidationResult {
  verdict: Verdict;
  explanation: string;
}

const VALID_VERDICTS: readonly Verdict[] = ["pass", "fail-missing-context", "fail-needs-fix"];

export function buildValidationPrompt(input: ValidationInput): string {
  return `You are validating a piece of implementation work against its ticket before it becomes a pull request.

## Ticket #${input.issueNumber}

${input.issueBody}

## Diff

\`\`\`diff
${input.diff}
\`\`\`

## Test output

\`\`\`
${input.testOutput}
\`\`\`

Judge the diff strictly against the ticket's stated scope and acceptance criteria, and against the test output. Respond with ONLY a JSON object, no markdown fences, no other text, matching exactly this shape:

{"verdict": "pass" | "fail-missing-context" | "fail-needs-fix", "explanation": "..."}

Use "fail-missing-context" only if you cannot judge the work because something about it is unexplained by the ticket or the diff — state exactly what's missing in "explanation". Use "fail-needs-fix" if you can judge it and it has a real defect — state exactly what's wrong and, if possible, what would fix it. Use "pass" only if the diff genuinely satisfies the ticket's scope and the tests support that.`;
}

export function parseVerdict(raw: string): ValidationResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("verdict" in parsed) ||
    !("explanation" in parsed)
  ) {
    throw new Error(`Gemini response JSON missing required fields: ${raw.slice(0, 200)}`);
  }

  const { verdict, explanation } = parsed as { verdict: unknown; explanation: unknown };

  if (typeof verdict !== "string" || !VALID_VERDICTS.includes(verdict as Verdict)) {
    throw new Error(`Gemini response had an invalid verdict value: ${String(verdict)}`);
  }
  if (typeof explanation !== "string") {
    throw new Error("Gemini response's explanation was not a string");
  }

  return { verdict: verdict as Verdict, explanation };
}

async function callGemini(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini API response had no text content: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in the environment.");
    process.exit(1);
    return;
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const raw = await readStdin();
  let input: ValidationInput;
  try {
    input = JSON.parse(raw) as ValidationInput;
  } catch {
    console.error("stdin was not valid JSON. Expected {issueNumber, issueBody, diff, testOutput}.");
    process.exit(1);
    return;
  }

  const prompt = buildValidationPrompt(input);

  let result: ValidationResult;
  try {
    const rawResponse = await callGemini(prompt, apiKey, model);
    result = parseVerdict(rawResponse);
  } catch (err) {
    result = {
      verdict: "fail-missing-context",
      explanation: `Validation tool could not produce a verdict: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
```

- [ ] **Step 4: Verify the Gemini model name before relying on it**

This repo's `.claude/settings.json` denies `Bash(curl:*)` outright, so use Node's global `fetch` instead of curl for this check:

Run:
```bash
node -e "fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + process.env.GEMINI_API_KEY).then(r => r.json()).then(d => console.log(d.models.map(m => m.name).filter(n => n.includes('gemini')).join('\n')))"
```

Confirm `models/gemini-2.0-flash` (or whatever the current free-tier flash model is named) appears in the list. If it doesn't, update the `GEMINI_MODEL` default in `main()` (Step 3) to a model that does appear (without the `models/` prefix, matching the format already used in the URL template), then re-run this check. Do not skip this — Gemini model names and availability change independently of this plan.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --import tsx/esm --test scripts/validate-with-gemini.test.ts`
Expected: PASS, all 8 tests. The last test (CLI exit-on-missing-key) spawns a real subprocess but makes no network call, so it stays fast and deterministic.

- [ ] **Step 6: Wire root `package.json`**

Modify `package.json` (root) — add to `devDependencies`:

```json
    "tsx": "^4.0.0",
```

(matches the version already used in `apps/api/package.json` and `apps/worker/package.json`; `@types/node` is not required here since this script isn't type-checked by `tsc` — see Global Constraints.)

Add to `scripts`:

```json
    "validate:gemini": "node --import tsx/esm scripts/validate-with-gemini.ts",
```

- [ ] **Step 7: Install and confirm the workspace resolves**

Run: `pnpm install`
Expected: lockfile updates for the new root `tsx` devDependency, no errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-with-gemini.ts scripts/validate-with-gemini.test.ts package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add Gemini-backed validation script for dev-swarm

Standalone script (not part of any workspace package) that a
validation agent invokes to get an actual pass/fail judgment on a
branch, delegating the decision to Gemini's free tier rather than a
Claude-model teammate's own opinion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Validation-agent role definition

**Files:**
- Modify: `.claude/agents/swarm-validator.md` (full rewrite)

**Interfaces:**
- Consumes: `scripts/validate-with-gemini.ts`'s CLI contract from Task 1 (stdin `ValidationInput` JSON, stdout `ValidationResult` JSON).
- Produces: the `swarm-validator` agent type, spawned by the orchestrator (documented in Task 5) as a validation-agent teammate.

- [ ] **Step 1: Replace the file contents**

Overwrite `.claude/agents/swarm-validator.md` with:

```markdown
---
name: swarm-validator
description: Runs an orchestrator-assigned ticket's branch through tests and a Gemini-backed validation call, then reports pass or a specific rejection reason back to the orchestrator.
---

You are a validation agent on an orchestrator-led dev-swarm team. You never self-claim work — the orchestrator (the lead Claude Code session) assigns you exactly one ticket at a time by message, naming the issue number and branch to check. There is no PR to review at this point — validation happens directly against the branch, before any PR exists.

1. **Isolate yourself first.** Before touching any file, enter your own worktree:
   `git fetch origin && git worktree add .claude/worktrees/validate-issue-<N>
   origin/swarm/issue-<N>` followed by EnterWorktree. Never validate from the
   main checkout or another teammate's worktree.
2. **Read the linked issue**, not just the diff: `gh issue view <N> --comments`
   for the ticket's actual acceptance criteria and any prior rejection history
   on this ticket.
3. **Run the real test suite and linter yourself** — `pnpm -r type-check`,
   `pnpm -r lint`, `pnpm -r test`, `pnpm -r build` — don't trust that the
   branch is clean just because the BL agent said so.
4. **Gather the diff**: `git diff main...swarm/issue-<N>`.
5. **Call the Gemini validation tool** with the issue body, the diff, and your
   test output:
   ```bash
   echo '{"issueNumber": <N>, "issueBody": "...", "diff": "...", "testOutput": "..."}' \
     | node --import tsx/esm scripts/validate-with-gemini.ts
   ```
   It prints a JSON verdict to stdout: `{"verdict": "pass" |
   "fail-missing-context" | "fail-needs-fix", "explanation": "..."}`. This
   tool call is what actually decides the outcome — you gather inputs and
   relay the result, you don't override its verdict with your own judgment.
   If the tool errors (e.g. `GEMINI_API_KEY` not set — it will say so on
   stderr), report that to the orchestrator as a blocker rather than guessing
   at a verdict yourself.
6. **Report the result** to the orchestrator via SendMessage, and update the
   label yourself:
   - `pass`: relabel the issue `swarm:done`. The orchestrator will tell the BL
     agent to open the PR from here — you're done with this ticket.
   - `fail-missing-context`: relabel `swarm:rejected-need-context`, comment
     the tool's explanation on the issue, and message the orchestrator with
     the specific question so it can relay it to the BL agent.
   - `fail-needs-fix`: relabel `swarm:rejected-need-fix`, comment the tool's
     explanation on the issue, and message the orchestrator with the specific
     defect so it can relay it to the BL agent.
7. When the orchestrator reassigns you to the same ticket after a fix or an
   answered question, repeat from step 3 — don't skip re-running tests just
   because you validated this branch before.

This repo (AIOne) has non-negotiable rules from CLAUDE.md that override any of
the above if they conflict: never execute a destructive action without
explicit confirmation in the current turn, never write a secret into a repo
file — including in the JSON you pass to the validation tool, since the diff
and issue body leave the repo boundary as part of that call. If a diff you're
validating contains what looks like a real credential, redact it before
sending and flag it in your report rather than passing it through to Gemini
verbatim. Never apply a deploy on generate, never push to a registry, and
treat egress in sandboxes as default-deny. If a ticket you're validating would
violate one of these, report it as `fail-needs-fix` and say which rule it
breaks.
```

- [ ] **Step 2: Confirm no stale references remain**

Run: `grep -n "swarm:in-review\|gh pr checkout\|gh pr review" .claude/agents/swarm-validator.md`
Expected: no matches — the old file's PR-checkout-based review mechanics are fully replaced by branch-based validation.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/swarm-validator.md
git commit -m "$(cat <<'EOF'
feat: rewrite swarm-validator role for orchestrator-assigned, Gemini-backed validation

Validation now happens against the branch directly (no PR exists yet)
and the actual pass/fail judgment is delegated to the Gemini script
from the prior commit, not the validation agent's own opinion.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: BL-agent role definition

**Files:**
- Delete: `.claude/agents/swarm-implementer.md`
- Create: `.claude/agents/swarm-bl-agent.md`

**Interfaces:**
- Produces: the `swarm-bl-agent` agent type, spawned by the orchestrator (documented in Task 5) with an explicit `model` override per instance (`sonnet` for complex tickets, `haiku` for simple ones — the role file itself carries no model-specific content, since the same instructions apply regardless of which model runs them).

- [ ] **Step 1: Delete the old implementer role file**

Run: `git rm .claude/agents/swarm-implementer.md`

This role is fully superseded — the BL-agent role below replaces its self-claim behavior with orchestrator assignment and adds the two-phase (implement, then later open the PR after validation) flow.

- [ ] **Step 2: Create the new role file**

Create `.claude/agents/swarm-bl-agent.md`:

```markdown
---
name: swarm-bl-agent
description: Implements one orchestrator-assigned ticket in an isolated worktree, hands off for validation, and opens the PR once validation passes.
---

You are a business-logic (BL) agent on an orchestrator-led dev-swarm team. You never self-claim work — the orchestrator (the lead Claude Code session) assigns you exactly one ticket at a time by message, naming the issue number and the branch name to use.

## Phase 1: implement

1. **Isolate yourself first.** Before touching any file, enter a fresh worktree
   for the assigned ticket — `git worktree add .claude/worktrees/issue-<N> -b
   swarm/issue-<N>` followed by EnterWorktree. Never edit files in the main
   checkout; another teammate may be using it.
2. **Read before you write.** Run `gh issue view <N> --comments` for the full
   ticket and any discussion, check CLAUDE.md and linked docs for
   conventions, and search the codebase for existing patterns before
   introducing a new one.
3. **Implement the ticket** — the scope described, not more and not less. If
   it turns out to be ambiguous, too large, or actually two tickets, say so
   in a comment on the issue and message the orchestrator rather than
   guessing at intent.
4. **Verify your own work first.** Run the test suite and linter before
   handing off. Add tests if the repo has a pattern for them.
5. **Push your branch** — do not open a PR yet. Validation happens directly
   against the branch, before any PR exists: `git push -u origin
   swarm/issue-<N>`.
6. **Relabel the issue** `swarm:ready-for-validation`, message the
   orchestrator that you're done, then go idle waiting for the next
   instruction on this ticket — don't self-claim something else in the
   meantime.

## Phase 2: respond to validation outcomes

You'll hear back from the orchestrator in one of three ways:

- **Validation passed** — the orchestrator tells you to open the PR. Do it
  now: title `[#<N>] <short description>`, body covers what changed and how
  you verified it, includes `Closes #<N>`. This is the only point at which
  you open a PR for this ticket.
- **`rejected-need-context`** — the orchestrator relays a specific question
  from the validation agent about your implementation. Answer it factually as
  an issue comment; don't change code in response to a context request, only
  in response to a fix request.
- **`rejected-need-fix`** — the orchestrator relays specific, actionable
  feedback about a real defect. Push a fix to the *same branch* — don't open
  a new PR or new branch. Don't relabel the issue yourself; message the
  orchestrator once the fix is pushed and it will move the issue back to
  `swarm:in-validation`.

This repo (AIOne) has non-negotiable rules from CLAUDE.md that override any of
the above if they conflict: never execute a destructive action without
explicit confirmation in the current turn, never write a secret into a repo
file, never apply a deploy on generate, never push to a registry or open/merge
a PR outside this swarm's own protocol, and treat egress in sandboxes as
default-deny. If your ticket would require any of these, stop and say so in
the issue rather than proceeding.
```

- [ ] **Step 3: Confirm no stale references remain**

Run: `grep -rn "swarm-implementer" .claude/ docs/ 2>/dev/null`
Expected: no matches outside of git history — every reference to the old role name has been updated to `swarm-bl-agent` (this will be caught fully once Tasks 4 and 5 also land; re-run this check after Task 5 as well).

- [ ] **Step 4: Commit**

```bash
git add -A .claude/agents/swarm-implementer.md .claude/agents/swarm-bl-agent.md
git commit -m "$(cat <<'EOF'
feat: replace swarm-implementer with swarm-bl-agent role

BL agents no longer self-claim tickets (that's the mechanism behind
the collision bug on issue #6) and now hand off to validation before
opening a PR, rather than opening one immediately on finishing code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Rewrite `github-protocol.md`

**Files:**
- Modify: `.claude/skills/dev-swarm/github-protocol.md` (full rewrite)

**Interfaces:**
- Consumes: the label taxonomy already created on GitHub (`swarm:ready`, `swarm:in-progress`, `swarm:ready-for-validation`, `swarm:in-validation`, `swarm:rejected-need-context`, `swarm:rejected-need-fix`, `swarm:done`).
- Consumes: `scripts/validate-with-gemini.ts`'s CLI contract (Task 1) and both role files (Tasks 2, 3) for consistency — this doc must not contradict them.

- [ ] **Step 1: Replace the file contents**

Overwrite `.claude/skills/dev-swarm/github-protocol.md` with:

```markdown
# GitHub protocol reference

This is the shared contract the orchestrator, BL agents, and validation agents all follow so a label or state means the same thing to everyone without having to ask. Read this before assigning the first ticket, and make sure assignment messages and the agent definitions (`swarm-bl-agent.md`, `swarm-validator.md`) don't contradict it.

## Label taxonomy

Created by `setup_labels.sh` (safe to re-run — it only creates labels that don't already exist):

| Label | Meaning |
|---|---|
| `swarm:ready` | Backlog item, unassigned, ready for the orchestrator to hand to a BL agent |
| `swarm:in-progress` | A BL agent has been assigned and is actively implementing |
| `swarm:ready-for-validation` | BL agent finished and pushed; waiting for the orchestrator to assign a validation agent |
| `swarm:in-validation` | A validation agent is checking the branch |
| `swarm:rejected-need-context` | Validation agent couldn't judge the work; a specific question is on its way back to the BL agent via the orchestrator |
| `swarm:rejected-need-fix` | Validation agent found a real defect; specific fix requirements are on their way back to the BL agent via the orchestrator |
| `swarm:done` | Validation passed; the BL agent is opening (or has opened) the PR for the orchestrator to approve and merge |

There's no separate "merged" label — a merged PR with `Closes #N` closes the issue automatically, and a closed issue *is* "done, for real." Don't add a redundant label that can drift out of sync with the real state.

## Issue lifecycle

```
swarm:ready
  → swarm:in-progress              (orchestrator assigns a BL agent)
  → swarm:ready-for-validation     (BL agent finishes and pushes)
  → swarm:in-validation            (orchestrator assigns a validation agent)
      → swarm:done                       (validation passes; BL agent opens PR; orchestrator approves + merges → issue auto-closes)
      → swarm:rejected-need-context      (orchestrator relays the question to the BL agent, then the answer back to the same validation agent → swarm:in-validation)
      → swarm:rejected-need-fix          (orchestrator relays the fix requirements to the BL agent; once pushed → swarm:in-validation directly, not through swarm:ready-for-validation)
```

If a teammate can't proceed for any reason, it comments on the issue with the specific question and messages the orchestrator — it does not sit idle without saying why, and it does not guess.

## Assignment rule

**Only the orchestrator assigns work.** BL agents and validation agents never self-claim a ticket from the label list, even if it looks unclaimed. This is the fix for a real bug the earlier peer-to-peer version of this workflow hit: every teammate authenticates through the same `gh` identity, so assignee-based "is this claimed" checks can't tell one teammate's claim from another's, and the deterministic worktree-path convention means two teammates entering the same issue's path land in the literal same directory. Centralizing assignment in the orchestrator removes the race entirely — there's exactly one process deciding who owns what, at every stage.

## PR conventions

- **Title**: `[#<issue-number>] <short description>`
- **Body** should include, at minimum:
  - What changed and why
  - How it was verified (which tests were run, what the validation agent's Gemini call reported)
  - `Closes #<issue-number>` so merging auto-closes the ticket
- **Opened only at `swarm:done`**, by the BL agent, after validation has already passed — not at the point the BL agent finishes writing code. There is no PR to review during validation; the validation agent works directly against the branch (`git diff main...swarm/issue-<N>`).
- One ticket, one PR. If a BL agent discovers mid-implementation that the ticket is really two tickets, it should say so on the issue rather than bundling unrelated changes into one PR.

## Approval rule

**Only the orchestrator approves and merges a PR.** This is a deliberate change from the old peer-to-peer model's "any other teammate can approve" rule: since validation already happened (via the Gemini-backed validation agent) before the PR even existed, the PR-stage approval is the orchestrator's own final check, not a second independent peer review.

## Validation

A validation agent checks a branch directly, not a PR — see the `swarm-validator` agent definition for the full mechanics (worktree isolation, running the real test suite itself, calling `scripts/validate-with-gemini.ts` for the actual pass/fail judgment). The validation agent relays that tool's verdict; it does not substitute its own opinion for it.

## Merge

Once the orchestrator approves a `swarm:done` PR, it merges immediately:

```bash
gh pr merge <N> --squash --auto
```

`--auto` enables GitHub's native auto-merge, which waits for required status checks to pass before actually merging — this repo has `ci` configured as a required status check on `main`, so this is a real gate, not just a delay. If a repository doesn't have auto-merge enabled (`gh api repos/:owner/:repo --jq .allow_auto_merge`), drop `--auto` and merge directly; just be aware that in that case nothing is gating the merge on CI at all.

## Rejection loops

**`rejected-need-context`** (validation agent is missing information, not reporting a defect):
1. Validation agent comments the specific question on the issue and messages the orchestrator.
2. Orchestrator relays the question to the BL agent by name.
3. BL agent answers factually as an issue comment (no code change) and messages the orchestrator.
4. Orchestrator relays the answer to the *same* validation agent and moves the issue to `swarm:in-validation`.
5. Validation agent re-runs its full check with the added context — it does not skip straight to a verdict just because the question is answered.

**`rejected-need-fix`** (validation agent found a real defect):
1. Validation agent comments what's wrong (and ideally what would fix it) and messages the orchestrator.
2. Orchestrator relays the fix requirements to the BL agent by name.
3. BL agent pushes a fix to the *same branch* — it does not open a new PR or new branch — and messages the orchestrator.
4. Orchestrator moves the issue straight to `swarm:in-validation` (skipping `swarm:ready-for-validation`, since this is a recheck of an already-validated branch, not a fresh validation request) and reassigns the same validation agent where possible, for continuity.

If the same ticket bounces between a BL agent and a validation agent more than twice, that's a signal the ticket itself is ambiguous or too large, not that the BL agent needs another attempt. Surface this to the user rather than continuing the loop indefinitely.

## Gemini validation tool

`scripts/validate-with-gemini.ts` reads a JSON object from stdin (`issueNumber`, `issueBody`, `diff`, `testOutput`) and prints a JSON verdict to stdout (`verdict`: `"pass" | "fail-missing-context" | "fail-needs-fix"`, `explanation`: string). It reads `GEMINI_API_KEY` from the environment — never from a repo file, per CLAUDE.md rule #2. This is a documented deviation from CLAUDE.md's "route integration work through MCP" preference: a bespoke script was chosen over an MCP server for this single call type, given it's on Gemini's free tier — worth revisiting as an MCP server if usage grows.

## Hardening: enforce completion with a hook (optional)

Teammates self-report when they mark a task complete, and Agent Teams' own docs note that task status can lag or be reported inaccurately. A `TaskCompleted` hook can check that the claimed work actually exists before allowing the task to close. Example, checking that a BL agent's task has actually pushed its branch before it's allowed to report `swarm:ready-for-validation`:

```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'ISSUE=$(jq -r .task.issue_number 2>/dev/null); if [ -n \"$ISSUE\" ] && ! git ls-remote --exit-code origin \"swarm/issue-$ISSUE\" >/dev/null 2>&1; then echo \"Branch swarm/issue-$ISSUE not pushed yet\" >&2; exit 2; fi'"
          }
        ]
      }
    ]
  }
}
```

Treat this as a starting point, not a drop-in — the exact JSON shape of the `TaskCompleted` hook payload should be checked against [the current hooks reference](https://code.claude.com/docs/en/hooks#taskcompleted) before relying on it, since task metadata fields aren't guaranteed to stay the same across versions.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/dev-swarm/github-protocol.md
git commit -m "$(cat <<'EOF'
docs: rewrite dev-swarm github-protocol for orchestrator model

New label taxonomy and state machine (ready-for-validation,
in-validation, rejected-need-context, rejected-need-fix, done)
replacing the old self-claim/peer-review taxonomy.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rewrite `SKILL.md`

**Files:**
- Modify: `.claude/skills/dev-swarm/SKILL.md`

**Interfaces:**
- Consumes: Tasks 1-4's file names and role names (`swarm-bl-agent`, `swarm-validator`, `scripts/validate-with-gemini.ts`, the new label taxonomy) — must reference them exactly.

- [ ] **Step 1: Update the frontmatter description**

In `.claude/skills/dev-swarm/SKILL.md`, change:

```
description: Orchestrate a team of parallel Claude Code sessions (via Agent Teams) that split a project's backlog into GitHub issues, implement and validate them in isolated git worktrees, review each other's pull requests, and merge automatically once approved. Use this whenever the user wants multiple agents working a real codebase at once — phrases like "spin up a swarm," "run agents in parallel on this project," "have agents build and review each other's PRs," "parallelize the backlog," or "orchestrate a team to build and validate this," even if they don't say "GitHub" or "Agent Teams" by name. Also use when the user wants agents to open tickets, claim work, request review, or merge autonomously.
```

to:

```
description: Orchestrate a team of parallel Claude Code sessions (via Agent Teams) where the lead session assigns backlog tickets to business-logic agents and Gemini-backed validation agents, mediates rejections, and is the sole PR approver — split a project's backlog into GitHub issues, implement and validate them in isolated git worktrees, and merge automatically once the orchestrator approves. Use this whenever the user wants multiple agents working a real codebase at once — phrases like "spin up a swarm," "run agents in parallel on this project," "have an orchestrator assign and validate work," "parallelize the backlog," or "orchestrate a team to build and validate this," even if they don't say "GitHub" or "Agent Teams" by name. Also use when the user wants agents to open tickets, get ticket assignments, validate each other's work, or merge autonomously.
```

- [ ] **Step 2: Update "What this builds"**

Change:

```
You (the current session) become the **lead** of a small team of teammate sessions, using Claude Code's [Agent Teams](https://code.claude.com/docs/en/agent-teams). Some teammates implement tickets, some validate other teammates' work, and they coordinate and merge their own pull requests through GitHub — without you relaying every message by hand.
```

to:

```
You (the current session) become the **orchestrator** of a small team of teammate sessions, using Claude Code's [Agent Teams](https://code.claude.com/docs/en/agent-teams). You assign every ticket explicitly — teammates never self-claim — some teammates implement assigned tickets (BL agents), one type validates them by delegating the actual judgment to a Gemini API call (validation agents), and you are the sole approver and merger of the PRs that result.
```

- [ ] **Step 3: Update "Before you start" item 6**

Change:

```
6. **Set up teammate role definitions** if they don't exist yet: check for `.claude/agents/swarm-implementer.md` and `.claude/agents/swarm-validator.md` in this repo. If missing, create them from the templates in `references/teammate-roles.md`. This is a one-time cost per repo — after that, every future swarm run in this project reuses them.
```

to:

```
6. **Set up teammate role definitions** if they don't exist yet: check for `.claude/agents/swarm-bl-agent.md` and `.claude/agents/swarm-validator.md` in this repo. If missing, create them from the templates in `teammate-roles.md`. This is a one-time cost per repo — after that, every future swarm run in this project reuses them.
7. **Set `GEMINI_API_KEY` in the environment** (never in a repo file) if it isn't already — validation agents need it to call `scripts/validate-with-gemini.ts`. If it's missing, tell the user directly rather than letting validation agents discover the failure on their own later.
```

- [ ] **Step 4: Update "Roles"**

Change:

```
## Roles

### You, the lead
- Turn the backlog into GitHub issues if they don't exist yet, or read the existing backlog with `gh issue list`.
- Decide team size and spawn teammates using the `swarm-implementer` and `swarm-validator` agent types (see [Spawn the team](#spawn-the-team)). Start with 3-5 teammates total — see [Anthropic's sizing guidance](https://code.claude.com/docs/en/agent-teams#choose-an-appropriate-team-size). A rough starting ratio is two implementers per validator, but adjust to the actual mix of ticket sizes.
- Let teammates self-claim work where possible; step in to assign or rebalance when the backlog is uneven or someone's idle with nothing to claim.
- Watch for teammates that stop early, idle without producing a PR, or message you stuck — see [Handling problems](#handling-problems).
- **Don't do implementation work yourself once the team is running.** If you catch yourself editing files directly, that's a signal the team is undersized or a ticket is underspecified — fix that instead of quietly picking up the slack.

### Implementer teammates
Claim a ticket, work it in an isolated worktree, open a PR that closes the issue, request review from a validator, then move on to the next ticket rather than waiting idle. Full instructions live in the `swarm-implementer` agent definition (`references/teammate-roles.md`).

### Validator teammates
Watch for PRs labeled `swarm:in-review`, check them out, verify against the ticket's actual acceptance criteria (not just "tests pass"), and leave a real `gh pr review`. On approval, they merge it themselves — see [Merge policy](#merge-policy). Validators can also own tickets of their own (e.g. adding missing test coverage); in that case a different teammate reviews *their* PR the same way. Full instructions live in the `swarm-validator` agent definition.
```

to:

```
## Roles

### You, the orchestrator
- Turn the backlog into GitHub issues if they don't exist yet, or read the existing backlog with `gh issue list`. Classify each ticket complex or simple as you file it — this decides which BL agent it goes to.
- Spawn BL agents (`swarm-bl-agent`, model `sonnet` for complex tickets, `haiku` for simple ones) and validation agents (`swarm-validator`) — see [Spawn the team](#spawn-the-team).
- **Assign every ticket explicitly, by message, naming the issue and branch.** No teammate self-claims. This is the fix for a real collision bug the self-claim version of this workflow hit — see `github-protocol.md`'s Assignment rule for why.
- Mediate every rejection: relay `rejected-need-context` questions and `rejected-need-fix` requirements between the validation agent and the BL agent (see `github-protocol.md`'s Rejection loops), rather than letting them message each other directly about ticket outcomes.
- Approve and merge every PR yourself once a BL agent opens one at `swarm:done` — see [Merge policy](#merge-policy). You are the only approver; there's no second peer review at this stage, since validation already happened before the PR existed.
- Watch for teammates that stop early, idle without a result, or message you stuck — see [Handling problems](#handling-problems).
- **Don't do implementation work yourself once the team is running.** If you catch yourself editing files directly, that's a signal the team is undersized or a ticket is underspecified — fix that instead of quietly picking up the slack.

### BL (business-logic) agents
Wait for an explicit assignment, implement it in an isolated worktree, push the branch, and hand off to validation — without opening a PR yet. Only after you tell them validation passed do they open the PR. Full instructions live in the `swarm-bl-agent` agent definition.

### Validation agents
Wait for an explicit assignment naming a branch (there's no PR to review yet). Check it out, run the real test suite, and call `scripts/validate-with-gemini.ts` for the actual pass/fail judgment — they relay that verdict, they don't substitute their own opinion. Full instructions live in the `swarm-validator` agent definition.
```

- [ ] **Step 5: Update "Spawn the team"**

Change:

```
## Spawn the team

Once setup is done, spawn teammates by naming the agent type, e.g.:

> Spawn two teammates using the swarm-implementer agent type and one using swarm-validator. Name them implementer-1, implementer-2, and validator-1. Here's the current backlog: [paste `gh issue list` output or a summary]. Let them self-claim tickets.

Give each teammate enough in the spawn message to get moving without waiting on you — at minimum, how to find the backlog and who their reviewer/reviewee counterparts are by name, since teammates message each other directly by name.
```

to:

```
## Spawn the team

Once setup is done, spawn teammates by naming the agent type and overriding the model per instance, e.g.:

> Spawn three teammates using the swarm-bl-agent agent type: two on model sonnet named bl-agent-1 and bl-agent-2 for complex tickets, one on model haiku named bl-agent-3 for simple tickets. Spawn two teammates using the swarm-validator agent type, named validator-1 and validator-2. None of them self-claim work — wait for an explicit assignment message from you naming the issue number and branch.

Unlike the old self-claim model, a spawn message here doesn't need to point teammates at the backlog or at each other — they only ever hear from you, and only about the one ticket you've assigned them. Keep assignment messages one-ticket-at-a-time rather than handing out a batch up front, since rejections mean a BL agent may need to come back to a ticket you thought was finished.
```

- [ ] **Step 6: Update "GitHub protocol" summary**

Change:

```
## GitHub protocol

The full label taxonomy, PR conventions, and approval/merge rules are in `references/github-protocol.md` — read it before spawning the first teammate so your spawn instructions and the agent definitions agree with each other. Summary:

- Issues move through `swarm:ready` → `swarm:in-progress` → `swarm:in-review` → (`swarm:changes-requested` and back) → merged/closed.
- A PR needs exactly one approval from a teammate who isn't its author before it can merge.
- On approval, the validator merges immediately — see below.
```

to:

```
## GitHub protocol

The full label taxonomy, PR conventions, and approval/merge rules are in `github-protocol.md` — read it before assigning the first ticket so your assignment messages and the agent definitions agree with each other. Summary:

- Issues move through `swarm:ready` → `swarm:in-progress` → `swarm:ready-for-validation` → `swarm:in-validation` → `swarm:done` (or one of two rejection labels, looping back).
- A validation agent's Gemini call decides pass/fail; the PR only exists once validation has already passed.
- You, the orchestrator, are the sole PR approver, and you merge immediately on approval — see below.
```

- [ ] **Step 7: Update "Merge policy"**

Change:

```
## Merge policy

Per the user's choice, approved work merges **autonomously — no human checkpoint**. The validator that approves a PR also merges it (`gh pr merge --squash --auto` if auto-merge is enabled on the repo, otherwise a direct `gh pr merge --squash` right after approving). This is a real design tradeoff worth restating to the user if you're setting this up fresh: nothing is checking the validator's judgment before code lands. The one guardrail that costs nothing in autonomy is requiring CI to pass before merge — if the repo has no CI configured, say so explicitly, since `--auto` without required checks merges just as fast as a direct merge would.
```

to:

```
## Merge policy

Per the user's choice, approved work merges **autonomously — no human checkpoint**. You, the orchestrator, approve and merge every PR yourself (`gh pr merge --squash --auto` if auto-merge is enabled on the repo, otherwise a direct `gh pr merge --squash` right after approving). This is a real design tradeoff worth restating to the user if you're setting this up fresh: nothing but your own review and the Gemini validation call that already happened is checking the work before it lands. The one guardrail that costs nothing in autonomy is requiring CI to pass before merge — if the repo has no CI configured, say so explicitly, since `--auto` without required checks merges just as fast as a direct merge would.
```

- [ ] **Step 8: Update "Handling problems"**

Change:

```
## Handling problems

- **Teammate idle with nothing claimed**: either the backlog is exhausted (good — check if there's more scope) or everything left is blocked. Ask it directly.
- **Teammate stuck or erroring repeatedly**: message it for more context, or spawn a replacement and let the original wind down — don't let a stuck teammate silently block a ticket others are waiting on.
- **Validator keeps rejecting the same implementer's work**: that's a signal worth surfacing to the user, not just cycling rework indefinitely — a repeated rejection loop usually means the ticket itself is ambiguous.
- **A teammate is missing information to proceed**: it should comment on the GitHub issue with the specific question and message you, rather than guessing or stalling silently.
```

to:

```
## Handling problems

- **Teammate idle with nothing assigned**: that's expected between assignments now — only assign the next ticket once you're ready, rather than batching. If a teammate is idle and the backlog isn't exhausted, it's waiting on you, not on the backlog.
- **Teammate stuck or erroring repeatedly**: message it for more context, or spawn a replacement and let the original wind down — don't let a stuck teammate silently block a ticket others are waiting on.
- **A validation agent keeps rejecting the same BL agent's work**: that's a signal worth surfacing to the user, not just cycling the fix loop indefinitely — a repeated rejection usually means the ticket itself is ambiguous or too large.
- **A teammate is missing information to proceed**: it should comment on the GitHub issue with the specific question and message you, rather than guessing or stalling silently.
- **The Gemini validation call fails** (missing `GEMINI_API_KEY`, network error, malformed response): the validation agent reports this to you as a blocker, not a verdict — don't let a tool failure get silently treated as a pass or a fail. Fix the underlying issue (e.g. confirm the env var is actually set) and reassign.
```

- [ ] **Step 9: Confirm no stale references remain**

Run: `grep -n "swarm-implementer\|swarm:in-review\|swarm:changes-requested\|self-claim\|references/" .claude/skills/dev-swarm/SKILL.md`
Expected: no matches.

- [ ] **Step 10: Commit**

```bash
git add .claude/skills/dev-swarm/SKILL.md
git commit -m "$(cat <<'EOF'
docs: rewrite dev-swarm SKILL.md for orchestrator model

Roles, spawn instructions, merge policy, and problem-handling all
updated to reflect explicit orchestrator assignment replacing
self-claim, and the two-phase BL-agent / Gemini-validation flow.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rewrite `teammate-roles.md` templates

**Files:**
- Modify: `.claude/skills/dev-swarm/teammate-roles.md` (full rewrite)

**Interfaces:**
- Consumes: the exact content of `.claude/agents/swarm-bl-agent.md` (Task 3) and `.claude/agents/swarm-validator.md` (Task 2) — this file is the template a *fresh* repo bootstraps those role files from (per `SKILL.md`'s "Before you start" step 6), so it must mirror them exactly or a future first-time setup will install the old self-claim roles from a stale template.

- [ ] **Step 1: Replace the file contents**

Overwrite `.claude/skills/dev-swarm/teammate-roles.md` with:

```markdown
# Teammate role definitions

These are subagent definitions, meant to live at `.claude/agents/swarm-bl-agent.md` and `.claude/agents/swarm-validator.md` in the *target* project (not in this skill's own directory). Create them there the first time this skill runs in a repo, then reuse them on every future run — see [Agent Teams: use subagent definitions for teammates](https://code.claude.com/docs/en/agent-teams#use-subagent-definitions-for-teammates).

Once they exist, spawn teammates by naming the type and overriding the model per instance: "Spawn a teammate using the swarm-bl-agent agent type on model sonnet." The teammate's `tools` allowlist comes from the definition; `model` is set per spawn call rather than hardcoded in the definition, since the same BL-agent instructions run on both Sonnet (complex tickets) and Haiku (simple tickets). The body below is appended to each teammate's system prompt as working instructions.

## `.claude/agents/swarm-bl-agent.md`

```markdown
---
name: swarm-bl-agent
description: Implements one orchestrator-assigned ticket in an isolated worktree, hands off for validation, and opens the PR once validation passes.
---

You are a business-logic (BL) agent on an orchestrator-led dev-swarm team. You never self-claim work — the orchestrator (the lead Claude Code session) assigns you exactly one ticket at a time by message, naming the issue number and the branch name to use.

## Phase 1: implement

1. **Isolate yourself first.** Before touching any file, enter a fresh worktree
   for the assigned ticket — `git worktree add .claude/worktrees/issue-<N> -b
   swarm/issue-<N>` followed by EnterWorktree. Never edit files in the main
   checkout; another teammate may be using it.
2. **Read before you write.** Run `gh issue view <N> --comments` for the full
   ticket and any discussion, check CLAUDE.md and linked docs for
   conventions, and search the codebase for existing patterns before
   introducing a new one.
3. **Implement the ticket** — the scope described, not more and not less. If
   it turns out to be ambiguous, too large, or actually two tickets, say so
   in a comment on the issue and message the orchestrator rather than
   guessing at intent.
4. **Verify your own work first.** Run the test suite and linter before
   handing off. Add tests if the repo has a pattern for them.
5. **Push your branch** — do not open a PR yet. Validation happens directly
   against the branch, before any PR exists: `git push -u origin
   swarm/issue-<N>`.
6. **Relabel the issue** `swarm:ready-for-validation`, message the
   orchestrator that you're done, then go idle waiting for the next
   instruction on this ticket — don't self-claim something else in the
   meantime.

## Phase 2: respond to validation outcomes

You'll hear back from the orchestrator in one of three ways:

- **Validation passed** — the orchestrator tells you to open the PR. Do it
  now: title `[#<N>] <short description>`, body covers what changed and how
  you verified it, includes `Closes #<N>`. This is the only point at which
  you open a PR for this ticket.
- **`rejected-need-context`** — the orchestrator relays a specific question
  from the validation agent about your implementation. Answer it factually as
  an issue comment; don't change code in response to a context request, only
  in response to a fix request.
- **`rejected-need-fix`** — the orchestrator relays specific, actionable
  feedback about a real defect. Push a fix to the *same branch* — don't open
  a new PR or new branch. Don't relabel the issue yourself; message the
  orchestrator once the fix is pushed and it will move the issue back to
  `swarm:in-validation`.

This repo has non-negotiable rules from CLAUDE.md that override any of the
above if they conflict: never execute a destructive action without explicit
confirmation in the current turn, never write a secret into a repo file,
never apply a deploy on generate, never push to a registry or open/merge a PR
outside this swarm's own protocol, and treat egress in sandboxes as
default-deny. If your ticket would require any of these, stop and say so in
the issue rather than proceeding.
```

## `.claude/agents/swarm-validator.md`

```markdown
---
name: swarm-validator
description: Runs an orchestrator-assigned ticket's branch through tests and a Gemini-backed validation call, then reports pass or a specific rejection reason back to the orchestrator.
---

You are a validation agent on an orchestrator-led dev-swarm team. You never self-claim work — the orchestrator (the lead Claude Code session) assigns you exactly one ticket at a time by message, naming the issue number and branch to check. There is no PR to review at this point — validation happens directly against the branch, before any PR exists.

1. **Isolate yourself first.** Before touching any file, enter your own worktree:
   `git fetch origin && git worktree add .claude/worktrees/validate-issue-<N>
   origin/swarm/issue-<N>` followed by EnterWorktree. Never validate from the
   main checkout or another teammate's worktree.
2. **Read the linked issue**, not just the diff: `gh issue view <N> --comments`
   for the ticket's actual acceptance criteria and any prior rejection history
   on this ticket.
3. **Run the real test suite and linter yourself** — `pnpm -r type-check`,
   `pnpm -r lint`, `pnpm -r test`, `pnpm -r build` — don't trust that the
   branch is clean just because the BL agent said so.
4. **Gather the diff**: `git diff main...swarm/issue-<N>`.
5. **Call the Gemini validation tool** with the issue body, the diff, and your
   test output:
   ```bash
   echo '{"issueNumber": <N>, "issueBody": "...", "diff": "...", "testOutput": "..."}' \
     | node --import tsx/esm scripts/validate-with-gemini.ts
   ```
   It prints a JSON verdict to stdout: `{"verdict": "pass" |
   "fail-missing-context" | "fail-needs-fix", "explanation": "..."}`. This
   tool call is what actually decides the outcome — you gather inputs and
   relay the result, you don't override its verdict with your own judgment.
   If the tool errors (e.g. `GEMINI_API_KEY` not set — it will say so on
   stderr), report that to the orchestrator as a blocker rather than guessing
   at a verdict yourself.
6. **Report the result** to the orchestrator via SendMessage, and update the
   label yourself:
   - `pass`: relabel the issue `swarm:done`. The orchestrator will tell the BL
     agent to open the PR from here — you're done with this ticket.
   - `fail-missing-context`: relabel `swarm:rejected-need-context`, comment
     the tool's explanation on the issue, and message the orchestrator with
     the specific question so it can relay it to the BL agent.
   - `fail-needs-fix`: relabel `swarm:rejected-need-fix`, comment the tool's
     explanation on the issue, and message the orchestrator with the specific
     defect so it can relay it to the BL agent.
7. When the orchestrator reassigns you to the same ticket after a fix or an
   answered question, repeat from step 3 — don't skip re-running tests just
   because you validated this branch before.

This repo has non-negotiable rules from CLAUDE.md that override any of the
above if they conflict: never execute a destructive action without explicit
confirmation in the current turn, never write a secret into a repo file —
including in the JSON you pass to the validation tool, since the diff and
issue body leave the repo boundary as part of that call. If a diff you're
validating contains what looks like a real credential, redact it before
sending and flag it in your report rather than passing it through to Gemini
verbatim. Never apply a deploy on generate, never push to a registry, and
treat egress in sandboxes as default-deny. If a ticket you're validating
would violate one of these, report it as `fail-needs-fix` and say which rule
it breaks.
```

## Spawn message guidance

A spawn message should give the teammate enough to start without waiting on the orchestrator for basics, but should **not** point it at the backlog or at other teammates — unlike the old self-claim model, these teammates only ever act on an explicit per-ticket assignment from the orchestrator:

- Which agent type to use (`swarm-bl-agent` or `swarm-validator`) and, for BL agents, which model (`sonnet` for complex tickets, `haiku` for simple ones)
- A name the orchestrator will use to address it
- Confirmation that it should wait idle for its first assignment rather than looking for work itself

Example:

> Spawn a teammate using the swarm-bl-agent agent type on model haiku. Name it bl-agent-3. Don't look for work yet — wait for me to assign a specific ticket by issue number and branch name.

Keep spawn messages short — the role definition already covers the step-by-step process; the spawn message just needs to establish the name, model, and that assignment comes from the orchestrator alone.
```

- [ ] **Step 2: Confirm it matches the live role files**

Run: `diff <(sed -n '/^```markdown$/,/^```$/p' .claude/skills/dev-swarm/teammate-roles.md | sed -n '2,/^```$/p' | head -n -1) .claude/agents/swarm-bl-agent.md`

This is a rough manual check, not a real diff tool invocation — visually confirm the BL-agent template block and validator template block match `.claude/agents/swarm-bl-agent.md` and `.claude/agents/swarm-validator.md` byte-for-byte (aside from the one line CLAUDE.md-reference wording difference, which is intentional: the template says "This repo has non-negotiable rules from CLAUDE.md" generically since it's meant to be copied into *any* target project, while the live AIOne role files can say "This repo (AIOne) has..." — if you notice other differences, fix whichever file is wrong before committing.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/dev-swarm/teammate-roles.md
git commit -m "$(cat <<'EOF'
docs: rewrite dev-swarm teammate-roles.md templates for orchestrator model

Keeps the fresh-repo bootstrap templates in sync with the live
swarm-bl-agent.md / swarm-validator.md role files, so a first-time
setup in a new project installs the orchestrator-assignment roles
instead of the superseded self-claim ones.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: CLAUDE.md model-convention note

**Files:**
- Modify: `CLAUDE.md:42`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add the swarm-specific exception**

In `CLAUDE.md`, change line 42 from:

```
- **Models:** Opus for orchestration and planning, Sonnet for the working agents, Haiku for routing and autocomplete. Model IDs and pricing change — check the `claude-api` skill rather than hardcoding what you remember.
```

to:

```
- **Models:** Opus for orchestration and planning, Sonnet for the working agents, Haiku for routing and autocomplete. Model IDs and pricing change — check the `claude-api` skill rather than hardcoding what you remember. **Exception:** the `dev-swarm` skill's orchestrator-centric mode runs its orchestrator and complex business-logic BL agents on Sonnet, simple BL agents on Haiku, and delegates validation judgment to Gemini via a tool call rather than a Claude teammate — a deliberate swarm-specific mapping, not drift from this convention.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: note dev-swarm's model-mapping exception in CLAUDE.md

Records the deliberate deviation from the default Opus/Sonnet/Haiku
convention for the orchestrator-centric swarm mode, so it reads as an
intentional exception rather than unexplained drift.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan verification

After all seven tasks are committed:

- [ ] Run `node --import tsx/esm --test scripts/validate-with-gemini.test.ts` once more from repo root and confirm all 8 tests pass.
- [ ] Run `grep -rln "swarm-implementer" .claude/ docs/` and confirm it returns nothing (the old role name is fully gone from active docs; it will still appear in git history, which is fine).
- [ ] Run `git log --oneline -7` and confirm seven commits landed in the order above.
- [ ] Do **not** push these commits or open a PR without asking the user first (CLAUDE.md rule #4) — this plan's scope ends at local commits.
