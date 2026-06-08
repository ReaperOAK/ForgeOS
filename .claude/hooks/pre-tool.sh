#!/usr/bin/env bash
# Claude Code PreToolUse adapter for the vibecoding governance hooks.
# Wraps the canonical scripts in .github/hooks/scripts/ and remaps their
# exit codes to Claude's convention: exit 2 = BLOCK (stderr fed to Claude),
# exit 0 = allow. The .github scripts use exit 1 to mean "block" (VS Code),
# so we translate 1 -> 2 here. Source of truth stays in .github/.
set -uo pipefail

# Claude passes the tool call as JSON on stdin: {"tool_name":...,"tool_input":{"command":...}}
INPUT=$(cat 2>/dev/null || true)

# 1) Guardian circuit breaker — blocks ALL action when STOP_ALL contains STOP.
if ! bash .github/hooks/scripts/check-guardian-stop.sh; then
    exit 2
fi

# 2) Scoped-git policy — block `git add .` / `-A` / `--all`. The script greps
#    its stdin for the command, so forward the raw JSON (the command string is in it).
if ! printf '%s' "$INPUT" | bash .github/hooks/scripts/block-git-add-all.sh; then
    exit 2
fi

exit 0
