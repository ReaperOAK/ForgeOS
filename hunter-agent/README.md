# 🎯 Hunter Agent — Autonomous Expensify Bounty Sniper

**Fully automated pipeline** that detects new Expensify "Help Wanted" issues, investigates the codebase using an autonomous LLM agent (DeepSeek V4 Flash via OpenRouter), and generates competition-killer proposals — all without human intervention.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    hunter.py                         │
│  Python watchdog — polls GitHub, spawns agent       │
│  Discord alerts on detection & completion            │
└──────────┬──────────────────────────────────────────┘
           │ detects new issue
           ▼
┌─────────────────────────────────────────────────────┐
│              hunter-agent/ (TypeScript)              │
│  Opens OpenRouter → DeepSeek V4 Flash                │
│  LLM has function-calling access to:                 │
│    • read_file     — read source files               │
│    • grep_search   — search codebase                 │
│    • list_directory — explore structure              │
│    • find_symbol   — locate definitions              │
│    • read_contributing_guide — Expensify conventions │
│    • extract_info  — parse issue body                │
│  LLM investigates autonomously, then calls `done`    │
│  with complete proposal                              │
└──────────┬──────────────────────────────────────────┘
           │ writes proposal
           ▼
┌─────────────────────────────────────────────────────┐
│          agent-output/hunter/proposal-N.md           │
│  Ready to submit to GitHub Issues                    │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Install agent dependencies
cd hunter-agent
bash scripts/setup.sh

# 2. Edit .env.hunter with your keys
#    - OPENROUTER_API_KEY — from https://openrouter.ai/keys
#    - GITHUB_TOKEN       — GitHub PAT with public_repo scope
#    - EXPENSIFY_PATH     — path to your Expensify/App checkout
vim .env.hunter

# 3. Test with latest issue
npx tsx src/index.ts --once

# 4. Run full pipeline (from repo root)
python3 hunter.py
```

## Usage

### `python3 hunter.py` — Watch mode (default)
Polls GitHub every 60s. When a new "Help Wanted" issue appears:
1. Sends Discord alert 🚨
2. Spawns hunter-agent to investigate
3. Sends Discord alert with proposal result 🎯
4. Saves proposal to `agent-output/hunter/proposal-for-{N}.md`

### `python3 hunter.py --once`
One-shot: check latest issue, analyze it, generate proposal, exit.

### `python3 hunter.py --dry-run`
Check latest issue without analyzing.

### `npx tsx src/index.ts --once` (from hunter-agent/)
Run the autonomous analyzer directly on the latest issue.

### `npx tsx src/index.ts --issue 12345`
Analyze a specific issue number.

### `npx tsx src/index.ts --watch`
Standalone watch mode (without Python wrapper).

## How the LLM Investigation Works

1. **Receive issue** — Gets full issue body + last 10 comments
2. **Extract info** — Calls `extract_info` to parse Action Performed / Expected / Actual
3. **Codebase recon** — Uses `grep_search`, `find_symbol`, `read_file` to trace the bug
4. **Analyze competitors** — Reads existing comments for competing proposals
5. **Generate proposal** — When ready, calls `done` with the complete proposal markdown

The LLM (DeepSeek V4 Flash) makes **autonomous tool decisions** — it decides what to search for, what files to read, and when it has enough info to call `done`.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `GITHUB_TOKEN` | ✅ | GitHub PAT with `public_repo` scope |
| `EXPENSIFY_PATH` | ✅ | Path to local Expensify/App checkout |
| `DISCORD_WEBHOOK` | ❌ | Discord webhook URL for alerts |
| `POLL_INTERVAL` | ❌ | Poll interval in seconds (default: 60) |
| `MODEL` | ❌ | LLM model (default: `deepseek/deepseek-v4-flash`) |
| `MAX_TOOL_ITERATIONS` | ❌ | Max tool calls before force-complete (default: 30) |

## File Layout

```
hunter-agent/
├── src/
│   ├── index.ts      # CLI entry point (--once, --issue N, --watch)
│   ├── config.ts     # Environment config loader
│   ├── types.ts      # Type definitions
│   ├── fetcher.ts    # GitHub API issue/comment fetcher
│   ├── tools.ts      # LLM tool definitions + executor
│   └── analyzer.ts   # Core autonomous agent loop
├── scripts/
│   └── setup.sh      # One-time setup
├── package.json
├── tsconfig.json
└── .env.hunter       # Your keys (gitignored)

hunter.py              # Python watchdog (at repo root)
```

## Discord Alerts

The pipeline sends two types of alerts:
- 🚨 **New issue detected** — when a fresh "Help Wanted" appears
- 🎯 **Proposal generated** — when the agent finishes its analysis

## Requirements

- **Node.js** 20+ (for the TypeScript agent)
- **Python 3** (for the watchdog script)
- **Expensify/App checkout** (so the agent can read source code)