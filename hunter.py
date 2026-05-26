#!/usr/bin/env python3
"""
hunter.py — Autonomous Expensify Bounty Hunter

Pipeline:
  1. Poll GitHub for new "Help Wanted" issues
  2. When found → send Discord alert
  3. Spawn the hunter-agent (TypeScript) to analyze + generate proposal
  4. Auto-submit proposal as GitHub issue comment (if --auto-submit)
  5. Send follow-up Discord alert with proposal result
  6. Loop forever

Usage:
  python3 hunter.py                    # Production: poll + analyze (default)
  python3 hunter.py --once             # One-shot: check + analyze latest
  python3 hunter.py --dry-run          # Check without analyzing
  python3 hunter.py --auto-submit      # Analyze + submit to GitHub automatically

Config: Reads from .env.hunter or environment variables:
  GITHUB_TOKEN       (required)
  DISCORD_WEBHOOK    (optional — disable Discord alerts)
  HUNTER_AGENT_PATH  (default: hunter-agent/)
  EXPENSIFY_PATH     (required — path to Expensify checkout)
  POLL_INTERVAL      (default: 60)
"""

import os
import sys
import json
import time
import logging
import subprocess
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional

# ─── Load .env.hunter ────────────────────────────────────────────────────

def load_env_file(env_path: str) -> dict:
    """Parse a simple KEY=VALUE env file."""
    env = {}
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, val = line.partition('=')
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key not in os.environ:
                    env[key] = val
    except FileNotFoundError:
        pass
    return env

# ─── Configuration ───────────────────────────────────────────────────────

def get_config() -> dict:
    """Load config from .env.hunter or environment."""
    search_dirs = [
        Path.cwd(),
        Path(__file__).parent,
        Path(__file__).parent.parent,
    ]
    env_file = {}
    for d in search_dirs:
        candidate = d / '.env.hunter'
        if candidate.exists():
            env_file = load_env_file(str(candidate))
            break

    for d in search_dirs:
        candidate = d / '.env'
        if candidate.exists():
            env_file.update(load_env_file(str(candidate)))
            break

    def get(key: str, fallback: str = '') -> str:
        return os.environ.get(key, env_file.get(key, fallback))

    config = {
        'github_token': get('GITHUB_TOKEN'),
        'discord_webhook': get('DISCORD_WEBHOOK', ''),
        'hunter_agent_path': get('HUNTER_AGENT_PATH', 'hunter-agent'),
        'expensify_path': get('EXPENSIFY_PATH'),
        'poll_interval': int(get('POLL_INTERVAL', '60')),
        'project_root': str(Path(__file__).parent.resolve()),
    }

    if not config['github_token']:
        print("ERROR: GITHUB_TOKEN is required. Set in .env.hunter or environment.")
        sys.exit(1)

    return config

# ─── Logging ──────────────────────────────────────────────────────────────

log_dir = Path(__file__).parent / 'agent-output' / 'hunter'
log_dir.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    filename=str(log_dir / 'hunter.log'),
    level=logging.INFO,
    format='[%(asctime)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
logger = logging.getLogger('hunter')

# ─── GitHub API ───────────────────────────────────────────────────────────

API_URL = "https://api.github.com/repos/Expensify/App/issues"
PARAMS = {
    "labels": "Help Wanted",
    "state": "open",
    "sort": "created",
    "direction": "desc",
    "per_page": 1,
}

def get_latest_issue(config: dict) -> Optional[dict]:
    """Fetch the latest Help Wanted issue from Expensify/App."""
    headers = {
        "Authorization": f"token {config['github_token']}",
        "Accept": "application/vnd.github.v3+json",
    }
    try:
        response = requests.get(API_URL, headers=headers, params=PARAMS, timeout=15)
        response.raise_for_status()
        issues = response.json()
        if issues:
            logger.info(f"Fetched issue: {issues[0]['title']} (ID: {issues[0]['id']})")
            return issues[0]
        logger.info("No issues returned from API")
        return None
    except Exception as e:
        logger.error(f"Error fetching from GitHub: {e}")
        return None

# ─── Discord Alerts ───────────────────────────────────────────────────────

def send_discord(config: dict, message: str) -> bool:
    """Send a message to Discord. Returns True if successful."""
    webhook = config.get('discord_webhook', '')
    if not webhook:
        return False
    try:
        resp = requests.post(webhook, json={"content": message}, timeout=10)
        resp.raise_for_status()
        logger.info(f"Discord sent: {message[:80]}...")
        return True
    except Exception as e:
        logger.error(f"Discord error: {e}")
        return False

def send_new_issue_alert(config: dict, issue: dict):
    msg = (
        f"🚨 **NEW EXPENSIFY ISSUE** 🚨\n"
        f"**#{issue['number']}** — {issue['title']}\n"
        f"{issue['html_url']}"
    )
    send_discord(config, msg)
    print(f"\n🚨 New issue #{issue['number']}: {issue['title']}")

def send_proposal_alert(config: dict, issue: dict, proposal_path: str, tool_calls: int, submitted: bool = False):
    if submitted:
        msg = (
            f"🎯 **PROPOSAL SUBMITTED** 🎯\n"
            f"**#{issue['number']}** — {issue['title']}\n"
            f"{issue['html_url']}\n\n"
            f"**Tool Calls:** {tool_calls}"
        )
    else:
        msg = (
            f"🎯 **PROPOSAL GENERATED** 🎯\n"
            f"**#{issue['number']}** — {issue['title']}\n"
            f"**File:** `{proposal_path}`\n"
            f"**Tool Calls:** {tool_calls}\n\n"
            f"📋 Submit here: {issue['html_url']}"
        )
    send_discord(config, msg)
    print(f"✅ Proposal saved: {proposal_path}")

# ─── Hunter Agent Launcher ────────────────────────────────────────────────

def launch_agent(config: dict, issue_number: int, auto_submit: bool = False) -> dict:
    """
    Launch the TypeScript hunter-agent to analyze a specific issue.
    If auto_submit is True, also submit the proposal as a GitHub comment.
    Returns {"success": bool, "file": str, "tool_calls": int, "error": str}
    """
    agent_dir = Path(config['project_root']) / config['hunter_agent_path']
    if not agent_dir.exists():
        return {"success": False, "file": "", "tool_calls": 0,
                "error": f"Agent directory not found: {agent_dir}"}

    node_modules = agent_dir / 'node_modules'
    if not node_modules.exists():
        logger.info("Installing hunter-agent dependencies...")
        try:
            subprocess.run(
                ['npm', 'install'],
                cwd=str(agent_dir),
                check=True,
                capture_output=True,
                timeout=120,
            )
        except subprocess.CalledProcessError as e:
            return {"success": False, "file": "", "tool_calls": 0,
                    "error": f"npm install failed: {e.stderr.decode()[:500]}"}

    # Use --auto instead of --issue to get analyze+submit in one shot
    mode = '--auto' if auto_submit else '--issue'
    print(f"\n🔍 Launching hunter-agent for issue #{issue_number}...")
    logger.info(f"Launching agent for issue #{issue_number}")

    try:
        result = subprocess.run(
            ['npx', 'tsx', 'src/index.ts', mode, str(issue_number)],
            cwd=str(agent_dir),
            capture_output=True,
            text=True,
            timeout=300,
        )

        output = result.stdout + result.stderr
        logger.info(f"Agent output:\n{output[:2000]}")

        proposal_file = ""
        tool_calls = 0
        for line in result.stdout.split('\n'):
            if 'Proposal saved:' in line or 'proposal saved:' in line.lower():
                parts = line.split(':', 1)
                if len(parts) > 1:
                    proposal_file = parts[1].strip()
            if 'Tool calls:' in line:
                try:
                    tool_calls = int(line.split(':')[1].strip())
                except ValueError:
                    pass

        if proposal_file and os.path.exists(proposal_file):
            return {"success": True, "file": proposal_file, "tool_calls": tool_calls, "error": ""}
        elif proposal_file:
            return {"success": True, "file": proposal_file, "tool_calls": tool_calls, "error": "File path may not exist"}
        else:
            proposal_dir = agent_dir / 'agent-output' / 'hunter'
            if proposal_dir.exists():
                proposal_files = list(proposal_dir.glob(f'proposal-for-{issue_number}.md'))
                if proposal_files:
                    return {"success": True, "file": str(proposal_files[0]), "tool_calls": tool_calls, "error": ""}
            return {"success": False, "file": "", "tool_calls": tool_calls,
                    "error": f"No proposal file found in output:\n{output[:1000]}"}

    except subprocess.TimeoutExpired:
        logger.error(f"Agent timed out for issue #{issue_number}")
        return {"success": False, "file": "", "tool_calls": 0,
                "error": "Agent timed out after 5 minutes"}
    except Exception as e:
        logger.error(f"Agent launch failed: {e}")
        return {"success": False, "file": "", "tool_calls": 0,
                "error": str(e)}

# ─── Main Logic ──────────────────────────────────────────────────────────

def check_proposal_exists(config: dict, issue_number: int) -> bool:
    """Check if we already have a proposal for this issue."""
    candidates = [
        Path(config['project_root']) / config['hunter_agent_path'] / 'agent-output' / 'hunter' / f'proposal-for-{issue_number}.md',
        Path(config['project_root']) / 'agent-output' / 'hunter' / f'proposal-for-{issue_number}.md',
        Path(config['project_root']) / f'proposal-for-{issue_number}.md',
    ]
    for c in candidates:
        if c.exists():
            return True
    return False

def run_once(config: dict, auto_submit: bool = False):
    """Single analysis pass."""
    print(f"\n🔍 Fetching latest Help Wanted issue...")
    issue = get_latest_issue(config)
    if not issue:
        print("No open Help Wanted issues found.")
        return

    print(f"\n📌 #{issue['number']}: {issue['title']}")
    print(f"   {issue['html_url']}")

    if check_proposal_exists(config, issue['number']):
        print("   ⏭️  Proposal already exists. Skipping.")
        return

    send_new_issue_alert(config, issue)
    result = launch_agent(config, issue['number'], auto_submit)

    if result['success']:
        send_proposal_alert(config, issue, result['file'], result['tool_calls'], auto_submit)
    else:
        print(f"\n❌ Agent failed: {result['error']}")
        send_discord(config, f"❌ **Analysis Failed** for #{issue['number']}: {result['error']}")

def run_watch(config: dict, auto_submit: bool = False):
    """Continuous polling mode."""
    mode_label = "auto-submit" if auto_submit else "analyze only"
    print(f"\n👀 Watch mode — polling every {config['poll_interval']}s ({mode_label})")
    print(f"   Press Ctrl+C to stop\n")

    last_issue_id = None

    initial = get_latest_issue(config)
    if initial:
        last_issue_id = initial['id']
        print(f"   Baseline: #{initial['number']} — \"{initial['title']}\"")
    else:
        print("   No existing issues found — will alert on first new one.")

    while True:
        time.sleep(config['poll_interval'])

        issue = get_latest_issue(config)
        if not issue:
            continue

        if issue['id'] != last_issue_id:
            print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🚨 New issue #{issue['number']} detected!")
            logger.info(f"New issue detected: #{issue['number']}: {issue['title']}")

            send_new_issue_alert(config, issue)
            result = launch_agent(config, issue['number'], auto_submit)

            if result['success']:
                send_proposal_alert(config, issue, result['file'], result['tool_calls'], auto_submit)
                if auto_submit:
                    print(f"   ✅ Submitted: {issue['html_url']}")
                else:
                    print(f"   ✅ Proposal saved: {result['file']}")
            else:
                print(f"   ❌ Agent failed: {result['error']}")
                send_discord(config, f"❌ **Analysis Failed** for #{issue['number']}: {result['error']}")

            last_issue_id = issue['id']
        else:
            logger.debug(f"No new issue. Current ID: {last_issue_id}")

# ─── CLI Entry Point ─────────────────────────────────────────────────────

def main():
    try:
        import requests  # noqa: F401
    except ImportError:
        print("Installing 'requests' library...")
        subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests'], check=True)
        import requests  # noqa: F811

    global requests  # noqa: F811
    import requests  # noqa: F811

    parser = argparse.ArgumentParser(description='Expensify Autonomous Bounty Hunter')
    parser.add_argument('--once', action='store_true', help='One-shot: analyze latest issue and exit')
    parser.add_argument('--dry-run', action='store_true', help='Check for new issues without analyzing')
    parser.add_argument('--watch', action='store_true', help='Continuous polling mode (default)')
    parser.add_argument('--auto-submit', action='store_true', help='Automatically submit proposals as GitHub comments')
    args = parser.parse_args()

    auto_submit = args.auto_submit

    config = get_config()

    expensify_path = config.get('expensify_path', '')
    if expensify_path and not Path(expensify_path).exists():
        print(f"⚠️  Warning: EXPENSIFY_PATH '{expensify_path}' not found.")
        print(f"   The hunter-agent needs a valid Expensify checkout to investigate code.")

    print("=" * 55)
    print("  🎯  HUNTER AGENT  —  Autonomous Bounty Sniper")
    print("  ForgeOS Expensify/App Issue Hunter")
    if auto_submit:
        print("  🌐  Auto-submit: ON")
    print("=" * 55)

    if args.dry_run:
        issue = get_latest_issue(config)
        if issue:
            print(f"\n📌 Latest Help Wanted: #{issue['number']} — {issue['title']}")
            print(f"   {issue['html_url']}")
        else:
            print("\nNo open Help Wanted issues found.")
        return

    if args.once:
        run_once(config, auto_submit)
    elif args.watch:
        run_watch(config, auto_submit)
    else:
        run_watch(config, auto_submit)

if __name__ == "__main__":
    main()