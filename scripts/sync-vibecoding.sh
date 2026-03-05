#!/usr/bin/env bash
# sync-vibecoding.sh — One-way sync from ReaperOAK/vibecoding into this project
#
# Syncs:
#   - Configured directories and files from upstream (see CONFIG section below)
#
# Default configured directories:
#   .github/*  (excluding configured exceptions)
#   .claude/*  (excluding configured exceptions)
#
# Default configured root files:
#   CLAUDE.md
#   todo_visual.py
#
# Does NOT sync:
#   README.md (repo-specific)
#   .github/memory-bank/ (project-specific persistent state)
#   .github/tickets/ (project-specific ticket definitions)
#   .github/ticket-state/ (project-specific ticket state machine)
#   .github/copilot-instructions.md (project-specific Copilot config)
#
# Usage:
#   ./scripts/sync-vibecoding.sh          # sync from main
#   ./scripts/sync-vibecoding.sh <branch>  # sync from a specific branch
#   bash scripts/sync-vibecoding.sh

set -euo pipefail

REPO="https://github.com/ReaperOAK/vibecoding.git"
BRANCH="${1:-main}"
DRY_RUN="${DRY_RUN:-}"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d)"

# ---- CONFIG: what to sync + exceptions -----------------------------------
# Add/remove entries here to control sync behavior.
SYNC_DIRECTORIES=(
  ".github"
)

SYNC_FILES=(
  "agents.md"
  "todo_visual.py"
)

# Per-directory exceptions (space-separated names, matched at top-level only).
declare -A DIR_EXCEPTIONS=(
  [".github"]="memory-bank tickets workflows ticket-state agent-output copilot-instructions.md"
)

# Validate these must exist in upstream before syncing.
REQUIRED_SOURCE_PATHS=(
  ".github"
  "agents.md"
  "todo_visual.py"
)

contains_item() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "$candidate" == "$needle" ]] && return 0
  done
  return 1
}

sync_directory() {
  local dir="$1"
  local src_dir="$SRC/$dir"
  local dest_dir="$PROJECT_ROOT/$dir"
  local raw_exceptions="${DIR_EXCEPTIONS[$dir]:-}"
  local -a exceptions=()
  local path item

  if [[ -n "$raw_exceptions" ]]; then
    # shellcheck disable=SC2206
    exceptions=($raw_exceptions)
  fi

  mkdir -p "$dest_dir"
  echo "==> Syncing $dir/ ..."

  shopt -s dotglob nullglob

  if [[ -z "$DRY_RUN" ]]; then
    for path in "$dest_dir"/*; do
      item="$(basename "$path")"
      if contains_item "$item" "${exceptions[@]}"; then
        echo "    Preserving $dir/$item (exception)"
        continue
      fi
      rm -rf "$path"
    done
  fi

  for path in "$src_dir"/*; do
    item="$(basename "$path")"
    if contains_item "$item" "${exceptions[@]}"; then
      echo "    Skipping $dir/$item (exception)"
      continue
    fi

    if [[ -n "$DRY_RUN" ]]; then
      echo "    [dry-run] Would copy $dir/$item"
    else
      cp -a "$path" "$dest_dir/$item"
      echo "    Copied $dir/$item"
    fi
  done

  shopt -u dotglob nullglob
}

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# ---- Safety: stash uncommitted changes before destructive sync ----------
if git -C "$PROJECT_ROOT" diff --quiet && git -C "$PROJECT_ROOT" diff --cached --quiet; then
  STASHED=false
else
  echo "==> Stashing uncommitted changes..."
  git -C "$PROJECT_ROOT" stash push -m "sync-vibecoding: auto-stash before sync $(date +%F_%T)"
  STASHED=true
fi

echo "==> Syncing from ReaperOAK/vibecoding (branch: $BRANCH)..."
echo "    Project root: $PROJECT_ROOT"
echo "    Temp dir: $TMPDIR"
[[ -n "$DRY_RUN" ]] && echo "    *** DRY RUN — no files will be modified ***"

# Shallow clone (fast, minimal bandwidth)
echo "==> Cloning (shallow)..."
if ! git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMPDIR/vibecoding" 2>&1 | tail -1; then
  echo "ERROR: Clone failed. Aborting sync." >&2
  [[ "$STASHED" == true ]] && git -C "$PROJECT_ROOT" stash pop
  exit 1
fi

SRC="$TMPDIR/vibecoding"

# ---- Validate source has expected structure ----------------------------
for required in "${REQUIRED_SOURCE_PATHS[@]}"; do
  if [[ ! -e "$SRC/$required" ]]; then
    echo "ERROR: Expected '$required' not found in upstream clone. Aborting." >&2
    [[ "$STASHED" == true ]] && git -C "$PROJECT_ROOT" stash pop
    exit 1
  fi
done

# --- Sync configured directories ---
for dir in "${SYNC_DIRECTORIES[@]}"; do
  sync_directory "$dir"
done

# --- Sync configured root-level files ---
echo "==> Syncing root files..."

for file in "${SYNC_FILES[@]}"; do
  if [ -f "$SRC/$file" ]; then
    if [[ -n "$DRY_RUN" ]]; then
      echo "    [dry-run] Would copy $file"
    else
      cp "$SRC/$file" "$PROJECT_ROOT/$file"
      echo "    Copied $file"
    fi
  fi
done

# ---- Restore stash if we stashed earlier --------------------------------
if [[ "$STASHED" == true ]]; then
  echo "==> Restoring stashed changes..."
  git -C "$PROJECT_ROOT" stash pop || echo "WARN: stash pop had conflicts — resolve manually."
fi

# --- Summary ---
echo ""
echo "==> Sync complete!"
echo "    Source: ReaperOAK/vibecoding@$BRANCH"
echo "    Synced directories: ${SYNC_DIRECTORIES[*]}"
echo "    Synced files: ${SYNC_FILES[*]}"
echo "    Exceptions configured in DIR_EXCEPTIONS"
echo ""
echo "    Review changes with: git diff --stat"
echo "    Commit with: git add .github/ .claude/ CLAUDE.md todo_visual.py && git commit -m 'chore: sync vibecoding infrastructure from upstream'"
