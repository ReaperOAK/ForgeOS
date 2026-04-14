#!/usr/bin/env bash
# Hook: auto-sync-tickets.sh
# Lifecycle: SessionStart
# Purpose: Run tickets.py --sync before any agent session work begins
# Exit 0 = allow session to proceed, Exit 1 = surface error but don't block

set -euo pipefail

TICKETS_SCRIPT="tickets.py"

# Check Python availability
if ! command -v python3 &>/dev/null; then
    echo "WARNING: python3 not found. Ticket sync skipped." >&2
    exit 0
fi

# Check tickets.py exists
if [[ ! -f "$TICKETS_SCRIPT" ]]; then
    echo "WARNING: $TICKETS_SCRIPT not found in workspace root. Ticket sync skipped." >&2
    exit 0
fi

# Run sync
echo "Auto-syncing ticket state..." >&2
if python3 "$TICKETS_SCRIPT" --sync 2>&1; then
    echo "Ticket sync complete." >&2
else
    echo "WARNING: Ticket sync encountered errors. Check tickets.py output above." >&2
fi

# Always allow session to proceed
exit 0
