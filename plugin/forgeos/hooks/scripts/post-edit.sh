#!/usr/bin/env bash
# ForgeOS plugin PostToolUse adapter (Edit|Write|MultiEdit).
# Auto-lints changed TS/JS files. Advisory only — never blocks.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
FORGE="$PROJECT/.forgeos"
[[ -d "$FORGE" ]] || exit 0

cd "$PROJECT" || exit 0
INPUT=$(cat 2>/dev/null || true)
printf '%s' "$INPUT" | bash "$FORGE/hooks/scripts/lint-changed-files.sh" 2>&1 || true
exit 0
