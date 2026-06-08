#!/usr/bin/env bash
# Hook: block-git-add-all.sh
# Lifecycle: PreToolUse (toolNames: run_in_terminal, execute/runInTerminal)
# Purpose: Block prohibited git staging commands (git add ., git add -A, git add --all)
# Exit 0 = allow, Exit 1 = block

set -euo pipefail

# The command being executed is passed via stdin or environment
# VS Code hooks pass the tool input as JSON on stdin
COMMAND="${HOOK_TOOL_INPUT:-}"

# If no input available, try reading from stdin
if [[ -z "$COMMAND" ]]; then
    COMMAND=$(cat 2>/dev/null || true)
fi

# Check for prohibited patterns
if echo "$COMMAND" | grep -qE 'git\s+add\s+(\.|--all|-A)(\s|$|")'; then
    echo "GIT POLICY VIOLATION: Prohibited command detected." >&2
    echo "  Blocked pattern: 'git add .' / 'git add -A' / 'git add --all'" >&2
    echo "  Required: Stage files explicitly with 'git add <file1> <file2> ...'" >&2
    exit 1
fi

# Command is allowed
exit 0
