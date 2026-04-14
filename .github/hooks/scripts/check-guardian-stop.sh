#!/usr/bin/env bash
# Hook: check-guardian-stop.sh
# Lifecycle: SessionStart + PreToolUse
# Purpose: Check .github/guardian/STOP_ALL for emergency stop signal
# Exit 0 = allow, Exit 1 = block

set -euo pipefail

GUARDIAN_FILE=".github/guardian/STOP_ALL"

if [[ ! -f "$GUARDIAN_FILE" ]]; then
    # No guardian file — allow
    exit 0
fi

if grep -q "^STOP$" "$GUARDIAN_FILE" 2>/dev/null; then
    echo "GUARDIAN HALT: .github/guardian/STOP_ALL contains STOP signal." >&2
    echo "All agent work is blocked until the STOP signal is removed." >&2
    exit 1
fi

# Guardian file exists but does not contain STOP — allow
exit 0
