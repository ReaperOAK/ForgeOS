#!/usr/bin/env bash
# Claude Code SubagentStop adapter. Reminds about the memory gate
# (.github/memory-bank/activeContext.md) when a dispatched agent finishes.
# Advisory only — surfaces the gate without hard-blocking, because Claude's
# SubagentStop fires for ALL Task subagents, not just ticket workers.
# Flip the final `exit 0` to `exit 2` if you want hard enforcement.
set -uo pipefail
if ! bash .github/hooks/scripts/verify-memory-gate.sh 2>&1; then
    echo "[vibecoding] Memory-gate reminder: write a ### [TICKET-ID] — Summary entry to .github/memory-bank/activeContext.md before marking a ticket DONE."
fi
exit 0
