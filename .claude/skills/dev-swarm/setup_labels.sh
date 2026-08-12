#!/usr/bin/env bash
# Creates the dev-swarm label taxonomy in the current repo's GitHub Issues.
# Safe to re-run: skips any label that already exists.
#
# Requires: gh CLI, authenticated, run from inside the target git repo
# (or pass --repo owner/name as extra args, forwarded to `gh label create`).

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install it and run 'gh auth login' first." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# name|color|description
labels=(
  "swarm:ready|0e8a16|Backlog item, unassigned, ready for the orchestrator to hand to a BL agent"
  "swarm:in-progress|fbca04|A BL agent has been assigned and is actively implementing"
  "swarm:ready-for-validation|1d76db|BL agent finished and pushed; waiting for the orchestrator to assign a validation agent"
  "swarm:in-validation|5319e7|A validation agent is checking the branch"
  "swarm:rejected-need-context|f9d0c4|Validation agent couldn't judge the work; a question is on its way back to the BL agent via the orchestrator"
  "swarm:rejected-need-fix|d93f0b|Validation agent found a real defect; fix requirements are on their way back to the BL agent via the orchestrator"
  "swarm:done|2cbe4e|Validation passed; the BL agent is opening (or has opened) the PR for the orchestrator to approve and merge"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name color description <<< "$entry"
  if gh label list --search "$name" --json name --jq '.[].name' 2>/dev/null | grep -Fxq "$name"; then
    echo "skip:    $name (already exists)"
  else
    gh label create "$name" --color "$color" --description "$description" "$@"
    echo "created: $name"
  fi
done

echo "Done. Labels are ready for dev-swarm."
