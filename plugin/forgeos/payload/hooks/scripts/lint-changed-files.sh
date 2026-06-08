#!/usr/bin/env bash
# Hook: lint-changed-files.sh
# Lifecycle: PostToolUse (agent-scoped to Backend, Frontend)
# Purpose: Auto-lint modified files after every edit operation
# Exit 0 = always (PostToolUse hooks provide feedback, not blocking)

set -uo pipefail

INPUT="${HOOK_TOOL_INPUT:-}"

if [[ -z "$INPUT" ]]; then
    INPUT=$(cat 2>/dev/null || true)
fi

# Extract file paths from the input
FILES=$(echo "$INPUT" | grep -oE '[^ "]+\.(ts|tsx|js|jsx)' | sort -u)

if [[ -z "$FILES" ]]; then
    exit 0
fi

# Check if eslint is available
if command -v npx &>/dev/null && [[ -f "node_modules/.bin/eslint" ]] || [[ -f ".eslintrc.json" ]] || [[ -f ".eslintrc.js" ]] || [[ -f "eslint.config.js" ]]; then
    echo "Running lint on changed files..." >&2
    for file in $FILES; do
        if [[ -f "$file" ]]; then
            npx eslint "$file" --no-error-on-unmatched-pattern 2>&1 || true
        fi
    done
else
    echo "INFO: ESLint not configured. Skipping lint." >&2
fi

exit 0
