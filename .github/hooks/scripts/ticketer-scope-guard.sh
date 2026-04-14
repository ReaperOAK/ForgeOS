#!/usr/bin/env bash
# Hook: ticketer-scope-guard.sh
# Lifecycle: PreToolUse (agent-scoped to Ticketer)
# Purpose: Block Ticketer from editing any non-ticket files
# Exit 0 = allow, Exit 1 = deny

set -euo pipefail

INPUT="${HOOK_TOOL_INPUT:-}"

if [[ -z "$INPUT" ]]; then
    INPUT=$(cat 2>/dev/null || true)
fi

# If no file path detected in input, allow (non-file operations)
if ! echo "$INPUT" | grep -qE '\.(ts|js|md|sh|yml|yaml|py)'; then
    exit 0
fi

# Allow ticket JSON files
if echo "$INPUT" | grep -qE '(tickets/|ticket-state/).*\.json'; then
    exit 0
fi

# Allow agent-output summary writes
if echo "$INPUT" | grep -qE 'agent-output/.*\.md'; then
    exit 0
fi

# Allow memory-bank writes
if echo "$INPUT" | grep -qE '\.github/memory-bank/'; then
    exit 0
fi

# Block everything else
echo "TICKETER SCOPE VIOLATION: Ticketer is a dispatcher, not an implementer." >&2
echo "  Ticketer may only modify: tickets/*.json, ticket-state/**/*.json, agent-output/**/*.md, memory-bank/*.md" >&2
echo "  Attempted file operation: $(echo "$INPUT" | head -c 200)" >&2
exit 1
