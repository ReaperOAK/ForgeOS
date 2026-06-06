#!/usr/bin/env bash
# setup.sh — One-time setup for the hunter-agent
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== 🎯 Hunter Agent Setup ==="
echo ""

# 1. Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required. Install via:"
  echo "  nvm install 22  # or your preferred method"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
echo "✅ Node.js $(node -v)"

# 2. Install deps
echo ""
echo "Installing dependencies..."
npm install
echo "✅ Dependencies installed"

# 3. Create .env.hunter if not exists
if [ ! -f .env.hunter ]; then
  echo ""
  echo "Creating .env.hunter template..."
  cat > .env.hunter << 'EOF'
# ─── Hunter Agent Configuration ───────────────────────────────
# Required: OpenRouter API key (get from https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Required: GitHub token with public_repo scope
GITHUB_TOKEN=ghp_your_token_here

# Required: Absolute path to your local Expensify/App checkout
EXPENSIFY_PATH=/path/to/Expensify/App

# Branch Hunter must verify and fast-forward before analysis
EXPENSIFY_BRANCH=main

# Discord webhook URL (optional — sends notifications)
DISCORD_WEBHOOK=

# Poll interval in seconds (default: 60)
POLL_INTERVAL=60

# LLM model (default: deepseek/deepseek-v4-flash)
MODEL=deepseek/deepseek-v4-flash

# Max tool call iterations before forcing completion (default: 30)
MAX_TOOL_ITERATIONS=30

# Maximum completion tokens per OpenRouter call (default: 1024)
OPENROUTER_MAX_TOKENS=1024

# Output directory for proposals
OUTPUT_DIR=agent-output/hunter
EOF
  echo "✅ .env.hunter created — EDIT IT with your keys"
else
  echo "✅ .env.hunter already exists"
fi

# 4. Create output directory
mkdir -p agent-output/hunter

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env.hunter with your API keys"
echo "  2. Run a test: npx tsx src/index.ts --once"
echo "  3. Production: cd .. && python3 hunter.py"
echo ""
