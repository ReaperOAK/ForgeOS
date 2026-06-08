#!/usr/bin/env bash
# build-plugin.sh — Assemble the self-contained ForgeOS Claude Code plugin.
#
# Copies the canonical control-plane (.github/* + AGENTS.md + tickets.py + ...)
# and the .claude/ bridge into plugin/forgeos/, remapping every ForgeOS-internal
# `.github/<control-plane>` reference to `.forgeos/<control-plane>` so the plugin
# is portable to any project. Real-CI references (.github/workflows,
# .github/copilot-instructions.md) are deliberately preserved.
#
# Idempotent. Authored files (plugin.json, hooks/, scripts/scaffold.sh,
# payload/templates/, commands/init.md, README.md) are NOT touched here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_GH="$ROOT/.github"
SRC_CLAUDE="$ROOT/.claude"
OUT="$ROOT/plugin/forgeos"
PAYLOAD="$OUT/payload"

# --- remap: rewrite ForgeOS control-plane refs .github/X -> .forgeos/X ----------
# Preserves .github/workflows and .github/copilot-instructions.md (real CI / Copilot).
CP='agents|instructions|prompts|skills|vibecoding|hooks|guardian|memory-bank|ticket-state|tickets|tasks|agent-output|proposals|sandbox|observability|stitch-project-id'
remap() {
  # operate in place on a file
  sed -E -i \
    -e "s#\.github/(${CP})#.forgeos/\1#g" \
    -e "s#(^|[^/[:alnum:]])AGENTS\.md#\1.forgeos/AGENTS.md#g" \
    -e "s#(^|[^/.[:alnum:]_-])(tickets|todo_visual)\.py#\1.forgeos/\2.py#g" \
    -e "s#(^|[^/.[:alnum:]_-])agent-output#\1.forgeos/agent-output#g" \
    "$1"
}
remap_tree() {
  # remap every text file under $1 (skip binary-ish by extension allowlist)
  find "$1" -type f \( -name '*.md' -o -name '*.yaml' -o -name '*.yml' \
       -o -name '*.json' -o -name '*.sh' -o -name '*.txt' \) -print0 \
  | while IFS= read -r -d '' f; do remap "$f"; done
}

echo "[build] cleaning copy targets"
rm -rf "$OUT/agents" "$OUT/skills" \
       "$PAYLOAD/agents" "$PAYLOAD/instructions" "$PAYLOAD/prompts" \
       "$PAYLOAD/skills" "$PAYLOAD/vibecoding" "$PAYLOAD/hooks" \
       "$PAYLOAD/observability" "$PAYLOAD/guardian" "$PAYLOAD/AGENTS.md" \
       "$PAYLOAD/tickets.py" "$PAYLOAD/todo_visual.py"
# commands: remove only the copied ones, keep authored init.md
find "$OUT/commands" -maxdepth 1 -type f -name '*.md' ! -name 'init.md' -delete 2>/dev/null || true
find "$OUT/commands" -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + 2>/dev/null || true

mkdir -p "$OUT/agents" "$OUT/commands" "$OUT/skills" "$PAYLOAD"

echo "[build] copying .claude bridge (agents, commands, skills)"
cp -R "$SRC_CLAUDE/agents/." "$OUT/agents/"
# commands: copy all except none-special; init.md is authored separately
for f in "$SRC_CLAUDE/commands/"*; do
  bn="$(basename "$f")"
  [ "$bn" = "init.md" ] && continue
  cp -R "$f" "$OUT/commands/$bn"
done
cp -R "$SRC_CLAUDE/skills/." "$OUT/skills/"

echo "[build] copying canonical payload (control-plane)"
cp -R "$SRC_GH/agents"        "$PAYLOAD/agents"
cp -R "$SRC_GH/instructions"  "$PAYLOAD/instructions"
cp -R "$SRC_GH/prompts"       "$PAYLOAD/prompts"
cp -R "$SRC_GH/skills"        "$PAYLOAD/skills"
cp -R "$SRC_GH/vibecoding"    "$PAYLOAD/vibecoding"
cp -R "$SRC_GH/observability" "$PAYLOAD/observability"
mkdir -p "$PAYLOAD/hooks"
cp -R "$SRC_GH/hooks/scripts" "$PAYLOAD/hooks/scripts"
mkdir -p "$PAYLOAD/guardian"
cp "$SRC_GH/guardian/loop-detection-rules.md" "$PAYLOAD/guardian/loop-detection-rules.md"
cp "$ROOT/AGENTS.md"        "$PAYLOAD/AGENTS.md"
cp "$ROOT/tickets.py"       "$PAYLOAD/tickets.py"
cp "$ROOT/todo_visual.py"   "$PAYLOAD/todo_visual.py"

echo "[build] remapping .github/ -> .forgeos/ across copied trees"
remap_tree "$OUT/agents"
remap_tree "$OUT/commands"
remap_tree "$OUT/skills"
remap_tree "$PAYLOAD/agents"
remap_tree "$PAYLOAD/instructions"
remap_tree "$PAYLOAD/prompts"
remap_tree "$PAYLOAD/skills"
remap_tree "$PAYLOAD/vibecoding"
remap_tree "$PAYLOAD/hooks"
remap "$PAYLOAD/AGENTS.md"
remap "$PAYLOAD/guardian/loop-detection-rules.md"
# tickets.py/todo_visual.py resolve paths via __file__, so no remap needed inside.

echo "[build] done -> $OUT"
