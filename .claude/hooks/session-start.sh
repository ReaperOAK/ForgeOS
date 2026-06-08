#!/usr/bin/env bash
# Claude Code SessionStart adapter. Runs the guardian check (advisory at
# session start — surfaced, not blocking) and auto-syncs ticket state.
# stdout from a SessionStart hook is added to Claude's context.
set -uo pipefail

# Surface guardian state into context if STOP is active.
if ! bash .github/hooks/scripts/check-guardian-stop.sh 2>&1; then
    echo "[vibecoding] GUARDIAN STOP is active — all agent work must halt until .github/guardian/STOP_ALL is cleared."
fi

# Resolve dependencies, release expired claims, move unblocked tickets to READY.
bash .github/hooks/scripts/auto-sync-tickets.sh 2>&1 || true

exit 0
