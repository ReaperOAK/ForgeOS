#!/usr/bin/env bash
set -euo pipefail

# ForgeOS commit-msg hook — validates commit message format per git-protocol.instructions.md
# Required format: [TICKET-ID] description
# TICKET-ID: two or more uppercase alphanumeric segments separated by dashes

COMMIT_MSG_FILE="${1:-}"

if [[ -z "$COMMIT_MSG_FILE" || ! -f "$COMMIT_MSG_FILE" ]]; then
  echo "ERROR: Commit message file not found: ${COMMIT_MSG_FILE:-<none>}"
  exit 1
fi

# Read the first line only
FIRST_LINE=$(head -n 1 "$COMMIT_MSG_FILE")

# Trim whitespace
FIRST_LINE=$(echo "$FIRST_LINE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if [[ -z "$FIRST_LINE" ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  COMMIT REJECTED"
  echo "═══════════════════════════════════════════════════"
  echo ""
  echo "  Empty commit message."
  echo ""
  echo "  Expected format:"
  echo "    [TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)"
  echo "    [TICKET-ID] STAGE complete by AGENT on MACHINE"
  echo ""
  exit 1
fi

# Regex: must start with [UPPERCASE-UPPERCASE(-UPPERCASE)*] followed by space and description
# At least two segments: [A-Z0-9]+-[A-Z0-9]+ with optional additional -[A-Z0-9]+ segments
TICKET_REGEX='^\[[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*\] .+'

if [[ "$FIRST_LINE" =~ $TICKET_REGEX ]]; then
  echo "✓ Commit message valid: $FIRST_LINE"
  exit 0
else
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  COMMIT REJECTED"
  echo "═══════════════════════════════════════════════════"
  echo ""
  echo "  Invalid commit message:"
  echo "    $FIRST_LINE"
  echo ""
  echo "  Expected format:"
  echo "    [TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)"
  echo "    [TICKET-ID] STAGE complete by AGENT on MACHINE"
  echo ""
  echo "  Examples:"
  echo "    [TASK-FOS-01-001] CLAIM by Backend on pop-os (Owais)"
  echo "    [FORGEOS-BE001] BACKEND complete by Backend on pop-os"
  echo ""
  exit 1
fi
