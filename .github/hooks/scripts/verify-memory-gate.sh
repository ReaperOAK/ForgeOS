#!/usr/bin/env bash
# Hook: verify-memory-gate.sh
# Lifecycle: SubagentStop
# Purpose: Verify agent wrote to .github/memory-bank/activeContext.md before completing
# Exit 0 = allow, Exit 1 = block

set -euo pipefail

MEMORY_FILE=".github/memory-bank/activeContext.md"

if [[ ! -f "$MEMORY_FILE" ]]; then
    echo "MEMORY GATE VIOLATION: $MEMORY_FILE does not exist." >&2
    echo "  Required: Write ticket summary entry to activeContext.md before completing." >&2
    echo "  Format: ### [TICKET-ID] — Summary with Artifacts, Decisions, Timestamp" >&2
    exit 1
fi

# Check if file was modified in the last 30 minutes (current lease window)
if [[ "$(uname)" == "Darwin" ]]; then
    MOD_TIME=$(stat -f %m "$MEMORY_FILE")
else
    MOD_TIME=$(stat -c %Y "$MEMORY_FILE")
fi

CURRENT_TIME=$(date +%s)
DIFF=$(( CURRENT_TIME - MOD_TIME ))
THRESHOLD=1800  # 30 minutes

if [[ $DIFF -gt $THRESHOLD ]]; then
    echo "MEMORY GATE WARNING: $MEMORY_FILE was last modified $(( DIFF / 60 )) minutes ago." >&2
    echo "  Expected: Recent entry within the current lease window (30 min)." >&2
    echo "  Ensure you have added your ticket summary before completing." >&2
    exit 1
fi

# Memory gate passed
exit 0
