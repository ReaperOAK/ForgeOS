#!/usr/bin/env python3
"""
agent-runner.py — Distributed Agent Execution Runner

Runs on any machine by any operator. Implements the dispatcher-claim / worker-work
protocol for claiming and processing tickets through the Git-native SDLC pipeline.

Usage:
  # Dispatcher (ReaperOAK) claims a ticket before launching a subagent:
  python agent-runner.py --claim-only --agent Backend --operator Owais --ticket TASK-001-01-01

  # Subagent completes work (Commit 2 only — claim was already done by dispatcher):
  python agent-runner.py --complete TASK-001-01-01 --agent Backend --operator Owais

  # List claimable tickets:
  python agent-runner.py --list-ready
  python agent-runner.py --list-claimable --agent Backend

This script:
1. Identifies claimable tickets for the given agent role
2. Executes Commit 1 (CLAIM) via --claim-only (called by ReaperOAK/dispatcher)
3. After agent work, executes Commit 2 (WORK) via --complete (called by subagent)

Subagents NEVER perform claim commits — only ReaperOAK (dispatcher) does.
The actual agent work is done by the human+AI pair via Copilot prompts.
This script handles the git protocol bookkeeping.
"""

import argparse
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # .github/
TICKETS_DIR = ROOT / "tickets"
STATE_DIR = ROOT / "ticket-state"
AGENT_OUTPUT_DIR = ROOT / "agent-output"
REPO_ROOT = ROOT.parent

# Agent role → stage mapping (which stage directory does each agent process)
AGENT_TO_STAGE = {
    "Research": "RESEARCH",
    "ProductManager": "PM",
    "Architect": "ARCHITECT",
    "DevOps": "DEVOPS",
    "Backend": "BACKEND",
    "UIDesigner": "UIDESIGNER",
    "Frontend": "FRONTEND",
    "QA": "QA",
    "Security": "SECURITY",
    "CIReviewer": "CI",
    "Documentation": "DOCS",
    "Validator": "VALIDATION",
}

# What stage feeds into each agent's stage (previous stage in various flows)
AGENT_SOURCE_STAGES = {
    "Research": ["READY"],
    "ProductManager": ["READY"],
    "Architect": ["READY"],
    "DevOps": ["READY"],
    "Backend": ["READY"],
    "UIDesigner": ["READY", "BACKEND"],
    "Frontend": ["UIDESIGNER"],
    "QA": ["BACKEND", "FRONTEND", "DEVOPS", "SECURITY", "ARCHITECT", "RESEARCH", "PM"],
    "Security": ["READY", "QA"],
    "CIReviewer": ["SECURITY", "QA"],
    "Documentation": ["CI", "READY", "RESEARCH", "ARCHITECT", "PM"],
    "Validator": ["DOCS"],
}

# Previous agent name mapping for summary handoff
STAGE_TO_AGENT_NAME = {
    "READY": None,
    "RESEARCH": "Research",
    "PM": "ProductManager",
    "ARCHITECT": "Architect",
    "DEVOPS": "DevOps",
    "BACKEND": "Backend",
    "UIDESIGNER": "UIDesigner",
    "FRONTEND": "Frontend",
    "QA": "QA",
    "SECURITY": "Security",
    "CI": "CIReviewer",
    "DOCS": "Documentation",
    "VALIDATION": "Validator",
}

DEFAULT_LEASE_MINUTES = 30


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_machine_id() -> str:
    return platform.node() or "unknown-machine"


def run_git(*args, check=True, capture=True) -> subprocess.CompletedProcess:
    """Run a git command from the repo root."""
    cmd = ["git", "-C", str(REPO_ROOT)] + list(args)
    return subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=check,
    )


def git_pull_rebase() -> bool:
    """git pull --rebase. Returns True on success."""
    try:
        run_git("pull", "--rebase")
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: git pull --rebase failed:\n{e.stderr}", file=sys.stderr)
        return False


def git_push() -> bool:
    """git push. Returns True on success."""
    try:
        run_git("push")
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: git push failed:\n{e.stderr}", file=sys.stderr)
        return False


def load_ticket(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def save_ticket(ticket: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(ticket, f, indent=2, default=str)
        f.write("\n")


def find_claimable_tickets(agent: str) -> list[dict]:
    """Find tickets the given agent can claim based on their SDLC flow position."""
    claimable = []
    now = datetime.now(timezone.utc)

    # Look in source stages for this agent
    source_stages = AGENT_SOURCE_STAGES.get(agent, [])
    target_stage = AGENT_TO_STAGE.get(agent)

    if not target_stage:
        return []

    for src_stage in source_stages:
        stage_dir = STATE_DIR / src_stage
        if not stage_dir.exists():
            continue

        for f in stage_dir.glob("*.json"):
            try:
                ticket = load_ticket(f)
            except (json.JSONDecodeError, KeyError):
                continue

            # Check SDLC flow — is target_stage the next stage for this ticket?
            sdlc = ticket.get("sdlc_flow", [])
            try:
                current_idx = None
                for i, s in enumerate(sdlc):
                    if s == src_stage:
                        current_idx = i
                        break

                if current_idx is None:
                    continue

                if current_idx + 1 < len(sdlc):
                    next_stage = sdlc[current_idx + 1]

                    # Check if this agent handles the next stage
                    if next_stage != target_stage:
                        continue
                else:
                    continue
            except (ValueError, IndexError):
                continue

            # Check claim status
            if ticket.get("claimed_by"):
                expiry = ticket.get("lease_expiry")
                if expiry:
                    try:
                        expiry_dt = datetime.fromisoformat(expiry)
                        if expiry_dt > now:
                            continue  # Still claimed
                    except (ValueError, TypeError):
                        pass

            claimable.append(ticket)

    return claimable


def execute_claim(ticket_id: str, agent: str, machine_id: str, operator: str) -> bool:
    """
    Execute Commit 1 — CLAIM PHASE (called by ReaperOAK/dispatcher only).

    Subagents NEVER call this directly. ReaperOAK performs the claim
    before dispatching the subagent via --claim-only.

    1. git pull --rebase
    2. Verify ticket in expected stage
    3. Update claim metadata
    4. Commit only ticket JSON
    5. Push (this IS the distributed lock)

    Returns True if claim succeeded.
    """
    print(f"\n{'='*60}")
    print(f"COMMIT 1 — CLAIM PHASE")
    print(f"Ticket: {ticket_id} | Agent: {agent} | Machine: {machine_id}")
    print(f"{'='*60}\n")

    # Step 1: git pull --rebase
    print("Step 1: git pull --rebase...")
    if not git_pull_rebase():
        print("ABORT: git pull failed")
        return False

    # Step 2: Find ticket
    master_path = TICKETS_DIR / f"{ticket_id}.json"
    if not master_path.exists():
        print(f"ABORT: Ticket {ticket_id} not found in {TICKETS_DIR}")
        return False

    ticket = load_ticket(master_path)

    # Find in state dirs
    found_stage = None
    found_path = None
    for stage_name in os.listdir(STATE_DIR):
        p = STATE_DIR / stage_name / f"{ticket_id}.json"
        if p.exists():
            found_stage = stage_name
            found_path = p
            break

    if not found_path:
        print(f"ABORT: Ticket {ticket_id} not in any state directory")
        return False

    print(f"  Found in: {found_stage}")

    # Step 3: Check not already claimed
    now = datetime.now(timezone.utc)
    if ticket.get("claimed_by"):
        expiry = ticket.get("lease_expiry")
        if expiry:
            expiry_dt = datetime.fromisoformat(expiry)
            if expiry_dt > now:
                print(f"ABORT: Already claimed by {ticket['claimed_by']} until {expiry}")
                return False
            else:
                print(f"  Previous claim expired, reclaiming...")

    # Step 4: Update metadata
    lease_expiry = now + timedelta(minutes=DEFAULT_LEASE_MINUTES)

    ticket["claimed_by"] = f"{agent}Worker-{machine_id[:8]}"
    ticket["machine_id"] = machine_id
    ticket["operator"] = operator
    ticket["lease_expiry"] = lease_expiry.isoformat()

    ticket["history"].append({
        "timestamp": now_iso(),
        "event": "CLAIMED",
        "agent": agent,
        "machine_id": machine_id,
        "from_stage": found_stage,
        "to_stage": found_stage,
        "details": f"Claimed by {operator}@{machine_id} via {agent}, lease until {lease_expiry.isoformat()}"
    })

    # Save to both locations
    save_ticket(ticket, found_path)
    save_ticket(ticket, master_path)

    # Step 5: Commit claim only
    state_rel = found_path.relative_to(REPO_ROOT)
    master_rel = master_path.relative_to(REPO_ROOT)

    print(f"\nStep 5: Committing claim...")
    try:
        run_git("add", str(state_rel), str(master_rel))
        run_git("commit", "-m", f"[{ticket_id}] CLAIM by {agent} on {machine_id} ({operator})")
    except subprocess.CalledProcessError as e:
        print(f"ABORT: git commit failed:\n{e.stderr}")
        return False

    # Step 6: Push (THIS IS THE LOCK)
    print("Step 6: Pushing claim (distributed lock)...")
    if not git_push():
        print("\n*** PUSH FAILED — another machine may have claimed first ***")
        print("Attempting recovery: git pull --rebase...")
        if git_pull_rebase():
            # Check if someone else claimed
            reloaded = load_ticket(master_path)
            if reloaded.get("claimed_by") and reloaded["claimed_by"] != ticket["claimed_by"]:
                print(f"ABORT: Ticket claimed by {reloaded['claimed_by']} — skipping")
                run_git("reset", "HEAD~1", check=False)
                run_git("checkout", "--", str(state_rel), str(master_rel), check=False)
                return False
            # Retry push
            if not git_push():
                print("ABORT: Push retry failed")
                run_git("reset", "HEAD~1", check=False)
                return False
        else:
            print("ABORT: Recovery pull failed")
            return False

    print(f"\n✓ CLAIM SUCCESSFUL — {ticket_id} locked by {operator}@{machine_id}")
    print(f"  Lease expires: {lease_expiry.isoformat()}")
    return True


def execute_work_commit(
    ticket_id: str,
    agent: str,
    machine_id: str,
    operator: str,
    modified_files: list[str],
    summary_content: str,
) -> bool:
    """
    Execute Commit 2 — WORK PHASE.

    1. Write summary file
    2. Delete previous stage summary
    3. Update ticket metadata
    4. Move ticket to next stage
    5. Commit all changes
    6. Push

    Returns True if work commit succeeded.
    """
    print(f"\n{'='*60}")
    print(f"COMMIT 2 — WORK PHASE")
    print(f"Ticket: {ticket_id} | Agent: {agent}")
    print(f"{'='*60}\n")

    master_path = TICKETS_DIR / f"{ticket_id}.json"
    ticket = load_ticket(master_path)

    # Find current location
    found_stage = None
    found_path = None
    for stage_name in os.listdir(STATE_DIR):
        p = STATE_DIR / stage_name / f"{ticket_id}.json"
        if p.exists():
            found_stage = stage_name
            found_path = p
            break

    if not found_path:
        print(f"ABORT: Ticket {ticket_id} not in any state directory")
        return False

    # Verify we hold the claim
    if not ticket.get("claimed_by") or machine_id not in (ticket.get("machine_id") or ""):
        print(f"ABORT: We don't hold the claim on {ticket_id}")
        return False

    # Determine next stage
    sdlc = ticket.get("sdlc_flow", [])
    current_idx = None
    for i, s in enumerate(sdlc):
        if s == found_stage:
            current_idx = i
            break

    if current_idx is None or current_idx + 1 >= len(sdlc):
        print(f"ABORT: Cannot determine next stage for {ticket_id}")
        return False

    next_sdlc_stage = sdlc[current_idx + 1]
    next_dir = next_sdlc_stage

    # Step 1: Write summary file
    summary_dir = AGENT_OUTPUT_DIR / agent
    summary_dir.mkdir(parents=True, exist_ok=True)
    summary_path = summary_dir / f"{ticket_id}.md"
    summary_path.write_text(summary_content, encoding="utf-8")
    print(f"  Written: {summary_path.relative_to(REPO_ROOT)}")

    # Step 2: Find and delete previous stage summary
    prev_agent = STAGE_TO_AGENT_NAME.get(found_stage)
    prev_summary = None
    deleted_prev = False
    if prev_agent:
        prev_summary = AGENT_OUTPUT_DIR / prev_agent / f"{ticket_id}.md"
        if prev_summary.exists():
            prev_summary.unlink()
            deleted_prev = True
            print(f"  Deleted previous summary: {prev_summary.relative_to(REPO_ROOT)}")

    # Step 3: Update ticket
    ticket["claimed_by"] = None
    ticket["machine_id"] = None
    ticket["operator"] = None
    ticket["lease_expiry"] = None
    ticket["stage"] = next_sdlc_stage

    ticket["history"].append({
        "timestamp": now_iso(),
        "event": "STAGE_COMPLETED",
        "agent": agent,
        "machine_id": machine_id,
        "from_stage": found_stage,
        "to_stage": next_dir,
        "details": f"Stage {found_stage} completed by {operator}@{machine_id}"
    })

    # Step 4: Move ticket to next stage
    next_path = STATE_DIR / next_dir / f"{ticket_id}.json"
    save_ticket(ticket, next_path)
    save_ticket(ticket, master_path)

    # Remove from old stage (will be git rm'd)
    if found_path.exists():
        found_path.unlink()

    # Step 5: Build git add list (explicit files only!)
    git_files = []

    # Modified code files
    for f in modified_files:
        git_files.append(f)

    # Summary file
    git_files.append(str(summary_path.relative_to(REPO_ROOT)))

    # New ticket location
    git_files.append(str(next_path.relative_to(REPO_ROOT)))

    # Master ticket
    git_files.append(str(master_path.relative_to(REPO_ROOT)))

    # Git rm old ticket location
    old_state_rel = str(found_path.relative_to(REPO_ROOT))

    # Git rm previous summary if it was deleted
    prev_summary_rel = None
    if deleted_prev and prev_summary:
        prev_summary_rel = str(prev_summary.relative_to(REPO_ROOT))

    print(f"\nStep 5: Staging files...")
    try:
        run_git("add", *git_files)
        run_git("rm", "--cached", old_state_rel, check=False)
        if prev_summary_rel:
            run_git("rm", "--cached", prev_summary_rel, check=False)

        msg = f"[{ticket_id}] {found_stage} complete by {agent} on {machine_id}"
        run_git("commit", "-m", msg)
    except subprocess.CalledProcessError as e:
        print(f"ABORT: git commit failed:\n{e.stderr}")
        return False

    # Step 6: Push
    print("Step 6: Pushing work commit...")
    if not git_push():
        print("WARNING: Push failed. Attempting pull --rebase + retry...")
        if git_pull_rebase() and git_push():
            print("  Push retry succeeded")
        else:
            print("ABORT: Push failed after retry")
            return False

    print(f"\n✓ WORK COMMIT SUCCESSFUL — {ticket_id}: {found_stage} → {next_dir}")
    return True


def list_ready_tickets() -> None:
    """List all tickets in READY state."""
    ready_dir = STATE_DIR / "READY"
    if not ready_dir.exists():
        print("No READY directory")
        return

    tickets = list(ready_dir.glob("*.json"))
    if not tickets:
        print("No tickets in READY state")
        return

    print(f"\nREADY Tickets ({len(tickets)}):")
    print("-" * 60)
    for f in sorted(tickets):
        t = load_ticket(f)
        claimed = f" [CLAIMED by {t.get('claimed_by')}]" if t.get("claimed_by") else ""
        print(f"  {t['ticket_id']:20s} {t.get('type', '?'):10s} {t.get('priority', '?'):8s} {t.get('title', '')[:40]}{claimed}")


def list_claimable(agent: str) -> None:
    """List tickets claimable by a specific agent."""
    tickets = find_claimable_tickets(agent)
    if not tickets:
        print(f"No claimable tickets for {agent}")
        return

    print(f"\nClaimable by {agent} ({len(tickets)}):")
    print("-" * 60)
    for t in tickets:
        stage = t.get("stage", "?")
        print(f"  {t['ticket_id']:20s} in {stage:12s} {t.get('type', '?'):10s} {t.get('title', '')[:40]}")


def main():
    parser = argparse.ArgumentParser(
        description="Distributed Agent Execution Runner — Dispatcher-Claim / Worker-Work Protocol",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--agent", help="Agent role name (e.g., Backend, QA, Security)")
    parser.add_argument("--operator", help="Human operator name (e.g., Owais, Sujal)")
    parser.add_argument("--machine", help="Machine identifier (default: hostname)")
    parser.add_argument("--ticket", help="Specific ticket ID to claim")
    parser.add_argument("--list-ready", action="store_true", help="List all READY tickets")
    parser.add_argument("--list-claimable", action="store_true", help="List tickets claimable by agent")
    parser.add_argument("--claim-only", action="store_true", help="Execute claim only (Commit 1) — used by ReaperOAK/dispatcher")
    parser.add_argument("--complete", metavar="TICKET_ID", help="Execute work commit (Commit 2) for a pre-claimed ticket — used by subagents")
    parser.add_argument("--modified-files", nargs="*", default=[], help="Files modified during work (for --complete)")
    parser.add_argument("--summary-file", help="Path to summary .md file (for --complete; auto-detected if omitted)")

    args = parser.parse_args()
    machine_id = args.machine or get_machine_id()

    if args.list_ready:
        list_ready_tickets()
        return

    if args.list_claimable:
        if not args.agent:
            print("ERROR: --agent required with --list-claimable")
            sys.exit(1)
        list_claimable(args.agent)
        return

    if not args.agent or not args.operator:
        parser.print_help()
        print("\nERROR: --agent and --operator are required for claim/work operations")
        sys.exit(1)

    # Handle --complete (Commit 2 — work phase)
    if args.complete:
        ticket_id = args.complete

        # Determine modified files: from --modified-files or auto-detect from git diff
        modified_files = list(args.modified_files)
        if not modified_files:
            try:
                result = run_git("diff", "--name-only", "HEAD")
                auto_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
                # Filter out ticket JSON and summary files — those are handled by execute_work_commit
                modified_files = [
                    f for f in auto_files
                    if not f.startswith(".github/ticket-state/")
                    and not f.startswith(".github/tickets/")
                    and not f.startswith(".github/agent-output/")
                ]
                if modified_files:
                    print(f"Auto-detected modified files: {modified_files}")
            except subprocess.CalledProcessError:
                pass

        # Determine summary content
        summary_content = None
        if args.summary_file:
            summary_path = Path(args.summary_file)
            if summary_path.exists():
                summary_content = summary_path.read_text(encoding="utf-8")
            else:
                print(f"ERROR: Summary file not found: {args.summary_file}")
                sys.exit(1)
        else:
            # Auto-detect from expected location
            expected = AGENT_OUTPUT_DIR / args.agent / f"{ticket_id}.md"
            if expected.exists():
                summary_content = expected.read_text(encoding="utf-8")
                print(f"Using existing summary: {expected.relative_to(REPO_ROOT)}")
            else:
                # Generate a minimal summary
                summary_content = (
                    f"# {ticket_id} — {args.agent} Stage Summary\n\n"
                    f"**Agent:** {args.agent}\n"
                    f"**Machine:** {machine_id}\n"
                    f"**Operator:** {args.operator}\n"
                    f"**Timestamp:** {now_iso()}\n\n"
                    f"## Artifacts\n\n"
                    + "\n".join(f"- {f}" for f in modified_files) + "\n\n"
                    f"## Status\n\nStage completed.\n"
                )
                print("Generated minimal summary (no summary file found)")

        if not execute_work_commit(
            ticket_id, args.agent, machine_id, args.operator,
            modified_files, summary_content,
        ):
            sys.exit(1)
        sys.exit(0)

    # Find a ticket to claim
    if args.ticket:
        ticket_id = args.ticket
    else:
        claimable = find_claimable_tickets(args.agent)
        if not claimable:
            print(f"No claimable tickets available for {args.agent}")
            sys.exit(0)
        # Pick first by priority
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        claimable.sort(key=lambda t: priority_order.get(t.get("priority", "medium"), 2))
        ticket_id = claimable[0]["ticket_id"]
        print(f"Selected ticket: {ticket_id} ({claimable[0].get('title', '')})")

    # Execute claim (Commit 1)
    if not execute_claim(ticket_id, args.agent, machine_id, args.operator):
        sys.exit(1)

    if args.claim_only:
        print("\n--- Claim complete. Dispatch subagent now (subagent will do work commit only). ---")
        sys.exit(0)

    # After claim, print instructions for agent work
    ticket = load_ticket(TICKETS_DIR / f"{ticket_id}.json")

    # Find previous summary
    found_stage = None
    for stage_name in os.listdir(STATE_DIR):
        if (STATE_DIR / stage_name / f"{ticket_id}.json").exists():
            found_stage = stage_name
            break

    prev_agent = STAGE_TO_AGENT_NAME.get(found_stage)
    prev_summary_path = None
    if prev_agent:
        p = AGENT_OUTPUT_DIR / prev_agent / f"{ticket_id}.md"
        if p.exists():
            prev_summary_path = p

    print(f"\n{'='*60}")
    print(f"AGENT WORK INSTRUCTIONS")
    print(f"{'='*60}")
    print(f"Ticket:     {ticket_id}")
    print(f"Title:      {ticket.get('title', 'N/A')}")
    print(f"Type:       {ticket.get('type', 'N/A')}")
    print(f"Stage:      {found_stage}")
    print(f"Agent:      {args.agent}")
    print(f"Files:      {', '.join(ticket.get('file_paths', []))}")
    print(f"Criteria:   {ticket.get('acceptance_criteria', [])}")
    if prev_summary_path:
        print(f"Prev Summary: {prev_summary_path.relative_to(REPO_ROOT)}")
    print(f"\nPerform agent work now. When done, run:")
    print(f"  python .github/agent-runner.py --complete {ticket_id} --agent {args.agent} --operator {args.operator}")
    print(f"\n  Optional flags:")
    print(f"    --modified-files src/file1.ts src/file2.ts   (auto-detected from git diff if omitted)")
    print(f"    --summary-file .github/agent-output/{args.agent}/{ticket_id}.md")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
