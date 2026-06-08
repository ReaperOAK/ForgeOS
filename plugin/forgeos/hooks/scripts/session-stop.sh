#!/usr/bin/env bash
# ForgeOS plugin Stop adapter. Evidence-rule reminder. Advisory only.
# Flip the final `exit 0` to `exit 2` for hard enforcement.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
FORGE="$PROJECT/.forgeos"
[[ -d "$FORGE" ]] || exit 0

cd "$PROJECT" || exit 0
if ! bash "$FORGE/hooks/scripts/verify-evidence.sh" 2>&1; then
  echo "[forgeos] Evidence-rule reminder: every TASK_COMPLETED needs artifact paths, test results (or justified N/A), and a confidence level in agent-output/{Agent}/{ticket-id}.md."
fi
exit 0
