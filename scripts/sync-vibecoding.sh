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
# Merge strategy (never deletes):
#   - Files present in upstream are created or overwritten locally.
#   - Files/dirs that exist only locally are LEFT UNTOUCHED.
#   - Subdirectory merges are applied recursively (e.g. new .agent.md files
#     are added, existing ones updated, extra local ones are kept).
#
# Protected paths (never touched, even if upstream has them):
#   README.md (repo-specific)
#   .github/memory-bank/ (project-specific persistent state)
#   tickets/ (project-specific ticket definitions)
#   ticket-state/ (project-specific ticket state machine)
#   agent-output/ (runtime agent artifacts)
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

# When piped via `curl | bash`, $0 is 'bash' (not a real file path).
# Fall back to $PWD (caller's working directory) in that case.
if [[ -f "$0" ]]; then
  PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
else
  PROJECT_ROOT="$PWD"
fi

TMPDIR="$(mktemp -d)"

# ---- CONFIG: what to sync + exceptions -----------------------------------
# Add/remove entries here to control sync behavior.
SYNC_DIRECTORIES=(
  ".github"
)

SYNC_FILES=(
  "AGENTS.md"
  "todo_visual.py"
  "scripts/sync-vibecoding.sh"
)

# Per-directory exceptions (space-separated names, matched at top-level of that dir).
# These paths are NEVER touched, even if upstream has updates for them.
declare -A DIR_EXCEPTIONS=(
  [".github"]="memory-bank tickets ticket-state agent-output copilot-instructions.md"
)

# Validate these must exist in upstream before syncing.
REQUIRED_SOURCE_PATHS=(
  ".github"
  "AGENTS.md"
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

# Recursively merge src into dest: overwrite matching files, add new files,
# but NEVER delete files/dirs that exist only in dest.
merge_directory() {
  local src="$1"
  local dest="$2"
  local path item rel

  mkdir -p "$dest"
  shopt -s dotglob nullglob

  for path in "$src"/*; do
    item="$(basename "$path")"
    if [[ -d "$path" ]]; then
      merge_directory "$path" "$dest/$item"
    else
      rel="${dest#$PROJECT_ROOT/}/$item"
      if [[ -n "$DRY_RUN" ]]; then
        echo "    [dry-run] Would update $rel"
      else
        cp -a "$path" "$dest/$item"
        echo "    Updated $rel"
      fi
    fi
  done

  shopt -u dotglob nullglob
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
  echo "==> Syncing $dir/ (merge — no deletions) ..."

  shopt -s dotglob nullglob

  for path in "$src_dir"/*; do
    item="$(basename "$path")"
    if contains_item "$item" "${exceptions[@]}"; then
      echo "    Skipping $dir/$item (exception)"
      continue
    fi

    if [[ -d "$path" ]]; then
      if [[ -n "$DRY_RUN" ]]; then
        echo "    [dry-run] Would merge $dir/$item/"
      else
        echo "    Merging $dir/$item/"
        merge_directory "$path" "$dest_dir/$item"
      fi
    else
      if [[ -n "$DRY_RUN" ]]; then
        echo "    [dry-run] Would update $dir/$item"
      else
        cp -a "$path" "$dest_dir/$item"
        echo "    Updated $dir/$item"
      fi
    fi
  done

  shopt -u dotglob nullglob
}

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# ---- Safety: stash uncommitted changes (only if this is a git repo) ------
STASHED=false
if git -C "$PROJECT_ROOT" rev-parse --git-dir &>/dev/null; then
  if ! git -C "$PROJECT_ROOT" diff --quiet || ! git -C "$PROJECT_ROOT" diff --cached --quiet; then
    echo "==> Stashing uncommitted changes..."
    git -C "$PROJECT_ROOT" stash push -m "sync-vibecoding: auto-stash before sync $(date +%F_%T)"
    STASHED=true
  fi
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
      mkdir -p "$PROJECT_ROOT/$(dirname "$file")"
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
echo "==> Sync complete (merge — no local files deleted)!"
echo "    Source: ReaperOAK/vibecoding@$BRANCH"
echo "    Synced directories: ${SYNC_DIRECTORIES[*]}"
echo "    Synced files: ${SYNC_FILES[*]}"
echo "    Exceptions configured in DIR_EXCEPTIONS"
echo ""
echo "    Review changes with:  git diff --stat"
echo "    Commit with:          git add .github/ AGENTS.md todo_visual.py && git commit -m 'chore: sync vibecoding infrastructure'"
