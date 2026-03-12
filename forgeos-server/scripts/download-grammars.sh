#!/usr/bin/env bash
# download-grammars.sh — Copy pre-built tree-sitter WASM grammar files
# from the tree-sitter-wasms npm package into the grammars directory.
#
# Usage:  npm run grammars:setup   (or ./scripts/download-grammars.sh)
# Ticket: TASK-INT-DO001

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GRAMMARS_DIR="$PROJECT_DIR/src/services/parsers/grammars"
WASMS_PKG="$PROJECT_DIR/node_modules/tree-sitter-wasms/out"

mkdir -p "$GRAMMARS_DIR"

LANGUAGES=(typescript javascript python)

echo "Setting up tree-sitter grammar WASM files..."
echo "Source: $WASMS_PKG"
echo "Target: $GRAMMARS_DIR"
echo ""

for lang in "${LANGUAGES[@]}"; do
  src="$WASMS_PKG/tree-sitter-${lang}.wasm"
  dest="$GRAMMARS_DIR/tree-sitter-${lang}.wasm"

  if [ -f "$src" ]; then
    cp "$src" "$dest"
    echo "  ✓ $lang ($(du -h "$dest" | cut -f1))"
  else
    echo "  ✗ $lang — source WASM not found at $src"
  fi
done

echo ""

# SQL grammar is not included in tree-sitter-wasms.
# To add it, build from https://github.com/DerekStride/tree-sitter-sql
# using tree-sitter CLI:
#   npx tree-sitter build --wasm node_modules/tree-sitter-sql
# Then copy the resulting wasm to:
#   $GRAMMARS_DIR/tree-sitter-sql.wasm
if [ -f "$GRAMMARS_DIR/tree-sitter-sql.wasm" ]; then
  echo "  ✓ sql (pre-existing)"
else
  echo "  ⚠ sql — not available in tree-sitter-wasms."
  echo "    Build manually: npx tree-sitter build --wasm <grammar-dir>"
fi

echo ""
echo "Done. Available grammars:"
ls -1 "$GRAMMARS_DIR"/*.wasm 2>/dev/null | xargs -I{} basename {} || echo "  (none)"
