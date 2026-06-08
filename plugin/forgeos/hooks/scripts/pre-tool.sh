#!/usr/bin/env bash
# ForgeOS plugin PreToolUse adapter.
# Hard governance gates (exit 2 = BLOCK): guardian circuit-breaker + scoped-git.
# Silent no-op for non-ForgeOS projects. The canonical .github scripts use
# exit 1 to mean "block"; we translate 1 -> 2 for Claude's convention.
set -uo pipefail

PROJECT="${CLAUDE_PROJECT_DIR:-$PWD}"
FORGE="$PROJECT/.forgeos"

INPUT=$(cat 2>/dev/null || true)

# Scoped-git policy applies even before init (it's safe universally). Prefer the
# bundled canonical script when present; otherwise inline the same check.
if [[ -d "$FORGE" ]]; then
  cd "$PROJECT" || exit 0
  # 1) Guardian circuit breaker.
  if ! bash "$FORGE/hooks/scripts/check-guardian-stop.sh"; then
    exit 2
  fi
  # 2) Scoped-git policy.
  if ! printf '%s' "$INPUT" | bash "$FORGE/hooks/scripts/block-git-add-all.sh"; then
    exit 2
  fi
else
  if printf '%s' "$INPUT" | grep -qE 'git[[:space:]]+add[[:space:]]+(\.|--all|-A)([[:space:]]|$|")'; then
    echo "GIT POLICY VIOLATION: use scoped staging (git add <file> ...), not 'git add .'/'-A'/'--all'." >&2
    exit 2
  fi
fi

exit 0
