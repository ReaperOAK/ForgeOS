#!/usr/bin/env bash
set -euo pipefail

# ForgeOS pre-commit hook — blast radius validation and quality gates
# Validates staged files against ticket scope and runs quality checks.

# ── Count staged files ────────────────────────────────────────────
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)
STAGED_COUNT=$(echo "$STAGED_FILES" | grep -c '.' || true)

if [[ "$STAGED_COUNT" -eq 0 ]]; then
  echo "✓ No staged files — nothing to validate."
  exit 0
fi

# ── Detect prohibited mass-staging patterns ───────────────────────
# Prohibited by git-protocol.instructions.md:
#   git add .
#   git add -A
#   git add --all
# This hook cannot detect the command used, but it can warn on excessive staging.
if [[ "$STAGED_COUNT" -gt 50 ]]; then
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  WARNING: $STAGED_COUNT files staged"
  echo "═══════════════════════════════════════════════════"
  echo ""
  echo "  ForgeOS requires explicit file-by-file staging."
  echo "  Verify you did not use: git add . / git add -A / git add --all"
  echo ""
fi

# ── Ticket scope validation ──────────────────────────────────────
# When FORGEOS_TICKET env var is set, validate staged files against ticket scope.
if [[ -n "${FORGEOS_TICKET:-}" ]]; then
  TICKET_ID="$FORGEOS_TICKET"
  TICKET_JSON=".github/tickets/${TICKET_ID}.json"

  if [[ -f "$TICKET_JSON" ]]; then
    # Extract file_paths from ticket JSON (try jq first, fallback to python3)
    if command -v jq &>/dev/null; then
      ALLOWED_PATHS=$(jq -r '.file_paths[]? // empty' "$TICKET_JSON" 2>/dev/null || echo "")
    else
      ALLOWED_PATHS=$(python3 -c "
import json, sys
try:
    with open('$TICKET_JSON') as f:
        data = json.load(f)
    for p in data.get('file_paths', []):
        print(p)
except Exception:
    pass
" 2>/dev/null || echo "")
    fi

    if [[ -n "$ALLOWED_PATHS" ]]; then
      HAS_VIOLATION=false

      while IFS= read -r staged_file; do
        [[ -z "$staged_file" ]] && continue

        # Always allow .github/* files regardless of ticket scope
        if [[ "$staged_file" == .github/* ]]; then
          continue
        fi

        # Check if staged file is within any allowed path
        IS_ALLOWED=false
        while IFS= read -r allowed_path; do
          [[ -z "$allowed_path" ]] && continue
          if [[ "$staged_file" == "$allowed_path"* ]]; then
            IS_ALLOWED=true
            break
          fi
        done <<< "$ALLOWED_PATHS"

        if [[ "$IS_ALLOWED" == "false" ]]; then
          echo "  File scope violation: $staged_file"
          echo "    Not in ticket $TICKET_ID file_paths"
          HAS_VIOLATION=true
        fi
      done <<< "$STAGED_FILES"

      if [[ "$HAS_VIOLATION" == "true" ]]; then
        echo ""
        echo "═══════════════════════════════════════════════════"
        echo "  COMMIT REJECTED"
        echo "═══════════════════════════════════════════════════"
        echo ""
        echo "  Staged files outside ticket scope for $TICKET_ID."
        echo "  Only files listed in ticket file_paths are allowed."
        echo ""
        exit 1
      fi
    fi
  fi
fi

# ── TypeScript type check (if available) ─────────────────────────
if [[ -f "tsconfig.json" ]] && command -v npx &>/dev/null; then
  TS_STAGED=$(echo "$STAGED_FILES" | grep -E '\.(ts|tsx)$' || true)
  if [[ -n "$TS_STAGED" ]]; then
    echo "Running TypeScript type check..."
    if npx tsc --noEmit 2>/dev/null; then
      echo "✓ TypeScript type check passed"
    else
      echo "⚠ TypeScript type check failed (non-blocking)"
    fi
  fi
fi

echo "✓ Pre-commit checks passed ($STAGED_COUNT files staged)"
exit 0
