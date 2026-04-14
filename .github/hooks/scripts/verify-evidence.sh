#!/usr/bin/env bash
# Hook: verify-evidence.sh
# Lifecycle: Stop
# Purpose: Verify agent output summary contains required evidence before session end
# Exit 0 = allow, Exit 1 = block

set -euo pipefail

AGENT_OUTPUT_DIR="agent-output"

# Find the most recently modified summary file
LATEST_SUMMARY=$(find "$AGENT_OUTPUT_DIR" -name "*.md" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)

if [[ -z "$LATEST_SUMMARY" ]]; then
    echo "EVIDENCE VIOLATION: No agent output summary found in $AGENT_OUTPUT_DIR/" >&2
    echo "  Required: Write summary to agent-output/{AgentName}/{ticket-id}.md" >&2
    exit 1
fi

# Check for required evidence fields
MISSING=()

if ! grep -qi "artifact" "$LATEST_SUMMARY"; then
    MISSING+=("Artifact paths")
fi

if ! grep -qi "confidence" "$LATEST_SUMMARY"; then
    MISSING+=("Confidence level")
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "EVIDENCE VIOLATION: Summary $LATEST_SUMMARY is missing required fields:" >&2
    for field in "${MISSING[@]}"; do
        echo "  - $field" >&2
    done
    echo "  Required: Artifact paths, test results (or justified N/A), confidence level" >&2
    exit 1
fi

# Evidence check passed
exit 0
