#!/usr/bin/env bash
# ForgeOS plugin SessionStart adapter.
# No-op (silent) unless the project has been initialized with /forgeos:init.
# When initialized: surfaces guardian STOP state and auto-syncs ticket state.
# stdout is added to Claude's context.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
FORGE="$PROJECT/.forgeos"

if [[ ! -d "$FORGE" ]]; then
  # Not a ForgeOS project. Hint once, stay out of the way.
  echo "[forgeos] Plugin loaded. Run /forgeos:init to scaffold the engine in this project."
  exit 0
fi

cd "$PROJECT" || exit 0

# Surface guardian state into context if STOP is active.
if ! bash "$FORGE/hooks/scripts/check-guardian-stop.sh" 2>&1; then
  echo "[forgeos] GUARDIAN STOP is active — all agent work must halt until .forgeos/guardian/STOP_ALL is cleared."
fi

# Resolve dependencies, release expired claims, move unblocked tickets to READY.
bash "$FORGE/hooks/scripts/auto-sync-tickets.sh" 2>&1 || true

exit 0
