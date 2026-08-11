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
  "swarm:ready|0e8a16|Backlog item, unclaimed, ready for an implementer to pick up"
  "swarm:in-progress|fbca04|An implementer has claimed it and is actively working"
  "swarm:in-review|1d76db|PR is open and waiting on a validator"
  "swarm:changes-requested|d93f0b|A validator asked for changes; back with the implementer"
  "swarm:blocked|b60205|Stuck - needs more information or a human decision"
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
