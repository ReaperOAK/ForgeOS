#!/usr/bin/env bash
# ──────────────────────────────────────────────────────
# ForgeOS commit message validator
#
# Validates that the commit message begins with a ticket ID
# in the format [TICKET-ID].
#
# Pattern: [ALPHANUMERIC-ALPHANUMERIC(-ALPHANUMERIC)*]
# Examples:
#   CLAIM:  [TASK-FOS-01-001] CLAIM by Backend on machine-1 (operator)
#   WORK:   [TASK-FOS-01-001] BACKEND complete by Backend on machine-1
#   Simple: [FORGEOS-001] Fix login bug
# ──────────────────────────────────────────────────────

set -euo pipefail

COMMIT_MSG_FILE="${1:-}"

if [[ -z "${COMMIT_MSG_FILE}" ]]; then
  echo "ERROR: No commit message file provided."
  echo "Usage: validate-commit.sh <commit-msg-file>"
  exit 1
fi

if [[ ! -f "${COMMIT_MSG_FILE}" ]]; then
  echo "ERROR: Commit message file not found: ${COMMIT_MSG_FILE}"
  exit 1
fi

COMMIT_MSG=$(head -1 "${COMMIT_MSG_FILE}")

# Pattern: must start with [TICKET-ID] where TICKET-ID is
# UPPER-UPPER or UPPER-UPPER-UPPER etc.
TICKET_PATTERN='^\[[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*\]'

if [[ ! "${COMMIT_MSG}" =~ ${TICKET_PATTERN} ]]; then
  echo "═══════════════════════════════════════════════════"
  echo " COMMIT REJECTED — Missing ticket ID"
  echo "═══════════════════════════════════════════════════"
  echo ""
  echo " Commit messages must begin with a ticket ID:"
  echo "   [TICKET-ID] Your message here"
  echo ""
  echo " Valid formats:"
  echo "   CLAIM: [TASK-FOS-01-001] CLAIM by Backend on machine-1 (operator)"
  echo "   WORK:  [TASK-FOS-01-001] BACKEND complete by Backend on machine-1"
  echo ""
  echo " Got: ${COMMIT_MSG}"
  echo ""
  echo " Bypass with: git commit --no-verify -m \"...\""
  echo "═══════════════════════════════════════════════════"
  exit 1
fi

echo "✓ Commit message format valid: ${COMMIT_MSG}"
