#!/usr/bin/env bash
# ForgeOS plugin SubagentStop adapter. Memory-gate reminder. Advisory only.
# Flip the final `exit 0` to `exit 2` for hard enforcement.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
FORGE="$PROJECT/.forgeos"
[[ -d "$FORGE" ]] || exit 0

cd "$PROJECT" || exit 0
if ! bash "$FORGE/hooks/scripts/verify-memory-gate.sh" 2>&1; then
  echo "[forgeos] Memory-gate reminder: write a ### [TICKET-ID] — Summary entry to .forgeos/memory-bank/activeContext.md before marking a ticket DONE."
fi
exit 0
