#!/usr/bin/env bash
# Claude Code PostToolUse adapter (matcher: Edit|Write|MultiEdit).
# Auto-lints changed TS/JS files. Advisory only — never blocks.
set -uo pipefail
INPUT=$(cat 2>/dev/null || true)
# The canonical script reads file paths from stdin (HOOK_TOOL_INPUT or raw stdin).
printf '%s' "$INPUT" | bash .github/hooks/scripts/lint-changed-files.sh 2>&1 || true
exit 0
