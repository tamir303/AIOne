#!/usr/bin/env node
/**
 * PreToolUse guard for Bash — the harness-level echo of spec §10's destructive floor.
 *
 * This is a backstop, not the approval gate. The real gate lives in the product
 * (docs/trust-model.md). This script exists so that the agents *building* AIOne
 * operate under the same rule the product enforces: destructive actions are
 * always confirmed, in every tier, with no exceptions.
 *
 * Contract: reads the PreToolUse payload as JSON on stdin. Exit 0 to allow,
 * exit 2 to block with the reason on stderr (the reason is fed back to Claude).
 * Any other failure exits 0 — a broken guard must not wedge the session, since
 * permissions.deny in settings.json still covers the worst cases.
 */

const DESTRUCTIVE = [
  { re: /\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/, why: "force-push destroys history on the remote" },
  { re: /\bgit\s+push\b[^\n]*\s--delete\b/, why: "deletes a remote branch" },
  { re: /\bgit\s+branch\s+-D\b/, why: "force-deletes a branch, discarding unmerged commits" },
  { re: /\bgit\s+reset\s+--hard\b/, why: "discards uncommitted work irreversibly" },
  { re: /\bgit\s+clean\s+-[a-z]*f/, why: "deletes untracked files irreversibly" },
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, why: "recursive force delete" },
  { re: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, why: "drops a database object and its data" },
  { re: /\bTRUNCATE\s+TABLE\b/i, why: "empties a table irreversibly" },
  { re: /\bDELETE\s+FROM\b(?![\s\S]*\bWHERE\b)/i, why: "unqualified DELETE removes every row" },
  { re: /\bflyctl\s+(apps\s+destroy|machine\s+destroy|volumes?\s+destroy)\b/, why: "destroys a Fly.io resource" },
  { re: /\bterraform\s+destroy\b|\bpulumi\s+destroy\b/, why: "tears down infrastructure" },
  { re: /\baws\s+\S+\s+delete-/, why: "deletes an AWS resource" },
  { re: /\bkubectl\s+delete\b/, why: "deletes a Kubernetes resource" },
  { re: /\bdocker\s+system\s+prune\b/, why: "removes images, containers, and volumes" },
  { re: /\bgh\s+repo\s+delete\b/, why: "deletes a GitHub repository" },
];

const SECRET_WRITE = [
  { re: /(^|\s)(>|>>)\s*\S*\.env(\.\S+)?(\s|$)/, why: "writes to a .env file — secrets belong in the platform secret manager" },
  { re: /\bgit\s+add\b[^\n]*\.env(\s|$)/, why: "stages a .env file for commit" },
];

import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin();
  if (!raw.trim()) process.exit(0);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command) process.exit(0);

  for (const { re, why } of DESTRUCTIVE) {
    if (re.test(command)) {
      process.stderr.write(
        `Blocked by AIOne destructive-action guard: ${why}.\n\n` +
          `Command: ${command}\n\n` +
          `Spec §10 makes destructive actions always-confirm, in every trust tier. ` +
          `Do not retry this command or work around the guard. Describe the exact ` +
          `action and the resource it affects, and ask the user to run it themselves ` +
          `or to confirm explicitly in this turn.\n`,
      );
      process.exit(2);
    }
  }

  for (const { re, why } of SECRET_WRITE) {
    if (re.test(command)) {
      process.stderr.write(
        `Blocked by AIOne secret-handling guard: ${why}.\n\n` +
          `Command: ${command}\n\n` +
          `See docs/security.md. Reference secrets by name; never write values into repo files.\n`,
      );
      process.exit(2);
    }
  }

  process.exit(0);
}

try {
  main();
} catch {
  process.exit(0);
}
