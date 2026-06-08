#!/usr/bin/env python3
"""
tickets.py — Distributed Git-Native Ticket State Machine Manager

Purpose:
  - Parse L3 decomposed markdown tasks into structured ticket JSON files
  - Maintain dependency graph
  - Track blocked/unblocked tasks
  - Move unblocked tickets to READY
  - Validate integrity of state directories
  - Support claim/release operations for distributed multi-machine execution

Usage:
  python tickets.py --sync                 # Evaluate all tickets, move unblocked to READY
  python tickets.py --parse <L3-dir>       # Parse L3 markdown into ticket JSON files
  python tickets.py --status               # Show current state of all tickets
  python tickets.py --claim <ticket-id> <agent> <machine-id> <operator>
  python tickets.py --release <ticket-id>  # Release expired/stalled claim
  python tickets.py --advance <ticket-id>  # Move ticket to next stage in its SDLC flow
  python tickets.py --validate             # Full integrity check
  python tickets.py --dot                  # Output dependency graph in DOT format

Authorized callers:
  - TODO agent (after L1→L2→L3 decomposition)
  - Validator agent (before final DONE commit, to unblock freed tasks)
  - Human operators (via CLI)

No other agent may execute this script.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ─── Constants ────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent  # workspace root
TICKETS_DIR = ROOT / "tickets"
STATE_DIR = ROOT / "ticket-state"
AGENT_OUTPUT_DIR = ROOT / "agent-output"

STAGES = [
    "READY", "RESEARCH", "PM", "ARCHITECT", "DEVOPS", "BACKEND",
    "UIDESIGNER", "FRONTEND", "QA", "SECURITY", "CI", "DOCS",
    "VALIDATION", "DONE",
]

# SDLC flow templates by ticket type
SDLC_FLOWS = {
    "backend": ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
    "frontend": ["READY", "UIDESIGNER", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
    "fullstack": ["READY", "BACKEND", "UIDESIGNER", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
    "infra": ["READY", "DEVOPS", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
    "security": ["READY", "SECURITY", "QA", "CI", "DOCS", "VALIDATION", "DONE"],
    "docs": ["READY", "DOCS", "VALIDATION", "DONE"],
    "research": ["READY", "RESEARCH", "DOCS", "VALIDATION", "DONE"],
    "architecture": ["READY", "ARCHITECT", "DOCS", "VALIDATION", "DONE"],
    "pm": ["READY", "PM", "DOCS", "VALIDATION", "DONE"],
}

# Stage directory to agent name mapping
STAGE_TO_AGENT = {
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

# Map stage names to physical directory names (when they differ)
# Empty means all stages use their stage name as directory name
STAGE_TO_STATE_DIR: dict[str, str] = {}

DEFAULT_LEASE_MINUTES = 30

# ─── Helpers ──────────────────────────────────────────────────────────────────


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_ticket(path: Path) -> dict:
    with open(path, "r") as f:
        return json.load(f)


def save_ticket(ticket: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(ticket, f, indent=2, default=str)
        f.write("\n")


def ticket_path_in_state(ticket_id: str, stage: str) -> Path:
    """Get the path where a ticket JSON should live in the state directory."""
    effective_dir = STAGE_TO_STATE_DIR.get(stage, stage)
    return STATE_DIR / effective_dir / f"{ticket_id}.json"


def find_ticket_in_states(ticket_id: str) -> Optional[tuple[str, Path]]:
    """Find which state directory a ticket currently lives in."""
    for stage in STAGES:
        p = STATE_DIR / stage / f"{ticket_id}.json"
        if p.exists():
            return (stage, p)
    return None


def canonical_ticket_path(ticket_id: str) -> Path:
    """Master ticket record in tickets/"""
    return TICKETS_DIR / f"{ticket_id}.json"


def all_ticket_ids() -> list[str]:
    """List all ticket IDs from the master tickets directory."""
    ids = []
    for f in TICKETS_DIR.glob("*.json"):
        if f.name == "ticket-schema.json":
            continue
        ids.append(f.stem)
    return sorted(ids)


def all_tickets() -> list[dict]:
    """Load all tickets from master directory."""
    tickets = []
    for f in TICKETS_DIR.glob("*.json"):
        if f.name == "ticket-schema.json":
            continue
        tickets.append(load_ticket(f))
    return tickets


def get_done_ticket_ids() -> set[str]:
    """Get all ticket IDs in DONE state."""
    done_dir = STATE_DIR / "DONE"
    return {f.stem for f in done_dir.glob("*.json")}


# ─── Core Operations ─────────────────────────────────────────────────────────


def create_ticket(
    ticket_id: str,
    title: str,
    description: str,
    ticket_type: str,
    priority: str = "medium",
    dependencies: list[str] | None = None,
    file_paths: list[str] | None = None,
    acceptance_criteria: list[str] | None = None,
    created_by: str = "TODO",
    source_task_file: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    """Create a new ticket JSON and save it to tickets/"""
    if ticket_type not in SDLC_FLOWS:
        raise ValueError(f"Unknown ticket type: {ticket_type}. Valid: {list(SDLC_FLOWS.keys())}")

    ticket = {
        "ticket_id": ticket_id,
        "title": title,
        "description": description,
        "type": ticket_type,
        "priority": priority,
        "stage": "READY" if not dependencies else "BLOCKED",
        "sdlc_flow": SDLC_FLOWS[ticket_type],
        "created_at": now_iso(),
        "created_by": created_by,
        "dependencies": dependencies or [],
        "blocked_by": [],
        "file_paths": file_paths or [],
        "acceptance_criteria": acceptance_criteria or ["Implementation complete"],
        "rework_count": 0,
        "claimed_by": None,
        "machine_id": None,
        "operator": None,
        "lease_expiry": None,
        "lease_duration_minutes": DEFAULT_LEASE_MINUTES,
        "history": [
            {
                "timestamp": now_iso(),
                "event": "CREATED",
                "agent": created_by,
                "machine_id": "system",
                "details": f"Ticket created from {source_task_file or 'manual'}"
            }
        ],
        "source_task_file": source_task_file,
        "tags": tags or [],
    }

    # Save master copy
    save_ticket(ticket, canonical_ticket_path(ticket_id))
    return ticket


def sync_tickets() -> dict[str, list[str]]:
    """
    Evaluate all tickets:
    1. Check dependency resolution
    2. Move newly unblocked tickets to READY
    3. Ensure no duplicate state (ticket in multiple stage dirs)
    4. Validate integrity

    Returns summary of actions taken.
    """
    actions: dict[str, list[str]] = {
        "moved_to_ready": [],
        "still_blocked": [],
        "errors": [],
        "duplicates_fixed": [],
    }

    done_ids = get_done_ticket_ids()
    all_tix = all_tickets()

    for ticket in all_tix:
        tid = ticket["ticket_id"]

        # 1. Check for duplicates (ticket in multiple state dirs)
        locations = []
        for stage in STAGES:
            p = STATE_DIR / stage / f"{tid}.json"
            if p.exists():
                locations.append((stage, p))

        if len(locations) > 1:
            # Keep only the most advanced stage
            stage_order = {s: i for i, s in enumerate(STAGES)}
            locations.sort(key=lambda x: stage_order.get(x[0], 0), reverse=True)
            keep = locations[0]
            for stage, path in locations[1:]:
                path.unlink()
                actions["duplicates_fixed"].append(f"{tid}: removed from {stage}, kept in {keep[0]}")

        # 2. Resolve dependencies
        unresolved = [dep for dep in ticket.get("dependencies", []) if dep not in done_ids]
        ticket["blocked_by"] = unresolved

        if not unresolved:
            # Ticket is unblocked
            current = find_ticket_in_states(tid)

            if current is None:
                # Not in any state dir yet — move to READY
                ticket["stage"] = "READY"
                ticket["history"].append({
                    "timestamp": now_iso(),
                    "event": "MOVED_TO_READY",
                    "agent": "tickets.py",
                    "machine_id": "system",
                    "details": "Dependencies resolved, moved to READY"
                })
                save_ticket(ticket, ticket_path_in_state(tid, "READY"))
                save_ticket(ticket, canonical_ticket_path(tid))
                actions["moved_to_ready"].append(tid)

            elif current[0] == "READY":
                # Already in READY, just update master
                save_ticket(ticket, canonical_ticket_path(tid))

            else:
                # Already progressing, just update master
                save_ticket(ticket, canonical_ticket_path(tid))
        else:
            # Still blocked
            ticket["stage"] = "BLOCKED"
            save_ticket(ticket, canonical_ticket_path(tid))
            actions["still_blocked"].append(f"{tid} blocked by: {unresolved}")

    return actions


def claim_ticket(
    ticket_id: str,
    agent: str,
    machine_id: str,
    operator: str,
    lease_minutes: int = DEFAULT_LEASE_MINUTES,
) -> tuple[bool, str]:
    """
    Attempt to claim a ticket for processing.
    This is called BEFORE git commit 1 (claim phase).

    Returns (success, message).
    """
    # Load master ticket
    master_path = canonical_ticket_path(ticket_id)
    if not master_path.exists():
        return False, f"Ticket {ticket_id} does not exist"

    ticket = load_ticket(master_path)

    # Find current state
    current = find_ticket_in_states(ticket_id)
    if current is None:
        return False, f"Ticket {ticket_id} not in any state directory"

    current_stage, current_path = current

    # Determine expected stage for this agent
    sdlc = ticket.get("sdlc_flow", [])
    current_idx = None
    for i, s in enumerate(sdlc):
        effective = STAGE_TO_STATE_DIR.get(s, s)
        if effective == current_stage or s == current_stage:
            current_idx = i
            break

    if current_idx is None:
        return False, f"Ticket {ticket_id} in stage {current_stage} not in its SDLC flow"

    # Check if already claimed and lease not expired
    if ticket.get("claimed_by"):
        expiry = ticket.get("lease_expiry")
        if expiry:
            expiry_dt = datetime.fromisoformat(expiry)
            if expiry_dt > datetime.now(timezone.utc):
                return False, (
                    f"Ticket {ticket_id} already claimed by {ticket['claimed_by']} "
                    f"on {ticket['machine_id']} until {expiry}"
                )

    # Get the NEXT stage in SDLC flow
    next_stage = sdlc[current_idx + 1] if current_idx + 1 < len(sdlc) else None
    if current_stage == "READY":
        # First processing stage
        next_stage = sdlc[1] if len(sdlc) > 1 else None
    else:
        # Find current in flow and get next
        for i, s in enumerate(sdlc):
            effective = STAGE_TO_STATE_DIR.get(s, s)
            if effective == current_stage or s == current_stage:
                next_stage = sdlc[i + 1] if i + 1 < len(sdlc) else None
                break

    # Perform claim
    lease_expiry = datetime.now(timezone.utc) + timedelta(minutes=lease_minutes)

    ticket["claimed_by"] = agent
    ticket["machine_id"] = machine_id
    ticket["operator"] = operator
    ticket["lease_expiry"] = lease_expiry.isoformat()

    ticket["history"].append({
        "timestamp": now_iso(),
        "event": "CLAIMED",
        "agent": agent,
        "machine_id": machine_id,
        "from_stage": current_stage,
        "to_stage": current_stage,
        "details": f"Claimed by {operator}@{machine_id} via {agent}, lease until {lease_expiry.isoformat()}"
    })

    # Save updated ticket in current state dir + master
    save_ticket(ticket, current_path)
    save_ticket(ticket, canonical_ticket_path(ticket_id))

    return True, f"Claimed {ticket_id} for {agent} on {machine_id} (operator: {operator})"


def release_claim(ticket_id: str, reason: str = "manual release") -> tuple[bool, str]:
    """Release a claim on a ticket (for expired leases or manual intervention)."""
    master_path = canonical_ticket_path(ticket_id)
    if not master_path.exists():
        return False, f"Ticket {ticket_id} does not exist"

    ticket = load_ticket(master_path)

    if not ticket.get("claimed_by"):
        return False, f"Ticket {ticket_id} is not claimed"

    old_claimer = ticket["claimed_by"]
    ticket["claimed_by"] = None
    ticket["machine_id"] = None
    ticket["operator"] = None
    ticket["lease_expiry"] = None

    ticket["history"].append({
        "timestamp": now_iso(),
        "event": "CLAIM_RELEASED",
        "agent": "tickets.py",
        "machine_id": "system",
        "details": f"Released claim from {old_claimer}: {reason}"
    })

    # Update in state dir
    current = find_ticket_in_states(ticket_id)
    if current:
        save_ticket(ticket, current[1])
    save_ticket(ticket, canonical_ticket_path(ticket_id))

    return True, f"Released claim on {ticket_id} (was: {old_claimer})"


def advance_ticket(ticket_id: str, agent: str, machine_id: str = "system") -> tuple[bool, str]:
    """
    Move a ticket to the next stage in its SDLC flow.
    Called after successful work commit (commit 2).

    Returns (success, message).
    """
    master_path = canonical_ticket_path(ticket_id)
    if not master_path.exists():
        return False, f"Ticket {ticket_id} does not exist"

    ticket = load_ticket(master_path)
    sdlc = ticket.get("sdlc_flow", [])

    # Find current location
    current = find_ticket_in_states(ticket_id)
    if current is None:
        return False, f"Ticket {ticket_id} not in any state directory"

    current_stage, current_path = current

    # Find position in SDLC flow
    current_idx = None
    for i, s in enumerate(sdlc):
        effective = STAGE_TO_STATE_DIR.get(s, s)
        if effective == current_stage or s == current_stage:
            current_idx = i
            break

    if current_idx is None:
        return False, f"Stage {current_stage} not found in SDLC flow for {ticket_id}"

    if current_idx + 1 >= len(sdlc):
        return False, f"Ticket {ticket_id} is already at final stage"

    next_sdlc_stage = sdlc[current_idx + 1]
    next_dir_stage = STAGE_TO_STATE_DIR.get(next_sdlc_stage, next_sdlc_stage)

    # Move ticket file
    next_path = STATE_DIR / next_dir_stage / f"{ticket_id}.json"

    # Clear claim
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
        "from_stage": current_stage,
        "to_stage": next_dir_stage,
        "details": f"Advanced from {current_stage} to {next_dir_stage}"
    })

    # Remove from old location, save to new
    if current_path.exists():
        current_path.unlink()
    save_ticket(ticket, next_path)
    save_ticket(ticket, canonical_ticket_path(ticket_id))

    return True, f"Advanced {ticket_id}: {current_stage} → {next_dir_stage}"


def rework_ticket(ticket_id: str, agent: str, reason: str, machine_id: str = "system") -> tuple[bool, str]:
    """Send a ticket back to its implementation stage (rework)."""
    master_path = canonical_ticket_path(ticket_id)
    if not master_path.exists():
        return False, f"Ticket {ticket_id} does not exist"

    ticket = load_ticket(master_path)

    if ticket["rework_count"] >= 3:
        return False, f"Ticket {ticket_id} exceeded max rework count (3). Must escalate."

    ticket["rework_count"] += 1

    # Find the implementation stage (first non-READY stage in flow)
    sdlc = ticket.get("sdlc_flow", [])
    impl_stage = sdlc[1] if len(sdlc) > 1 else "READY"
    impl_dir = STAGE_TO_STATE_DIR.get(impl_stage, impl_stage)

    # Remove from current location
    current = find_ticket_in_states(ticket_id)
    if current:
        current[1].unlink()

    # Clear claim and move back
    ticket["claimed_by"] = None
    ticket["machine_id"] = None
    ticket["operator"] = None
    ticket["lease_expiry"] = None
    ticket["stage"] = impl_stage

    ticket["history"].append({
        "timestamp": now_iso(),
        "event": "REWORK",
        "agent": agent,
        "machine_id": machine_id,
        "from_stage": current[0] if current else "UNKNOWN",
        "to_stage": impl_dir,
        "details": f"Rework #{ticket['rework_count']}: {reason}"
    })

    rework_path = STATE_DIR / impl_dir / f"{ticket_id}.json"
    save_ticket(ticket, rework_path)
    save_ticket(ticket, canonical_ticket_path(ticket_id))

    return True, f"Rework #{ticket['rework_count']} for {ticket_id}: sent back to {impl_dir}"


# ─── L3 Markdown Parser ──────────────────────────────────────────────────────


def parse_l3_tasks(l3_dir: str, created_by: str = "TODO") -> list[dict]:
    """
    Parse L3 decomposed markdown task files into ticket JSON.

    Expected L3 markdown format:
    ```
    # TASK-XXX-YY-ZZ: Title

    **Type:** backend|frontend|...
    **Priority:** critical|high|medium|low
    **Dependencies:** TASK-XXX-YY-ZZ, TASK-XXX-YY-ZZ
    **Files:** path/to/file1.ts, path/to/file2.ts
    **Tags:** tag1, tag2

    ## Description
    ...

    ## Acceptance Criteria
    - [ ] Criterion 1
    - [ ] Criterion 2
    ```
    """
    l3_path = Path(l3_dir)
    if not l3_path.exists():
        print(f"ERROR: L3 directory not found: {l3_dir}", file=sys.stderr)
        return []

    created = []
    md_files = sorted(l3_path.glob("**/*.md"))

    for md_file in md_files:
        content = md_file.read_text(encoding="utf-8")
        tickets = _parse_single_l3_file(content, str(md_file), created_by)
        created.extend(tickets)

    return created


def _parse_single_l3_file(content: str, source_path: str, created_by: str) -> list[dict]:
    """Parse a single L3 markdown file that may contain multiple tasks."""
    tickets = []

    # Split on H1 task headers
    task_blocks = re.split(r'^# (TASK-[A-Z0-9-]+):\s*(.+)$', content, flags=re.MULTILINE)

    # task_blocks[0] is preamble text, then groups of (id, title, body)
    i = 1
    while i < len(task_blocks) - 2:
        task_id = task_blocks[i].strip()
        title = task_blocks[i + 1].strip()
        body = task_blocks[i + 2] if i + 2 < len(task_blocks) else ""
        i += 3

        # Parse metadata
        ticket_type = _extract_field(body, "Type", "backend")
        priority = _extract_field(body, "Priority", "medium")
        deps_str = _extract_field(body, "Dependencies", "")
        files_str = _extract_field(body, "Files", "")
        tags_str = _extract_field(body, "Tags", "")

        dependencies = [d.strip() for d in deps_str.split(",") if d.strip()] if deps_str else []
        file_paths = [f.strip() for f in files_str.split(",") if f.strip()] if files_str else []
        tags = [t.strip() for t in tags_str.split(",") if t.strip()] if tags_str else []

        # Parse description
        desc_match = re.search(r'## Description\s*\n(.*?)(?=\n## |\Z)', body, re.DOTALL)
        description = desc_match.group(1).strip() if desc_match else title

        # Parse acceptance criteria
        criteria = re.findall(r'- \[[ x]\] (.+)', body)
        if not criteria:
            criteria = ["Implementation complete"]

        # Check if ticket already exists
        existing = canonical_ticket_path(task_id)
        if existing.exists():
            print(f"  SKIP: {task_id} already exists")
            continue

        ticket = create_ticket(
            ticket_id=task_id,
            title=title,
            description=description,
            ticket_type=ticket_type.lower(),
            priority=priority.lower(),
            dependencies=dependencies,
            file_paths=file_paths,
            acceptance_criteria=criteria,
            created_by=created_by,
            source_task_file=source_path,
            tags=tags,
        )
        tickets.append(ticket)
        print(f"  CREATED: {task_id} — {title} ({ticket_type})")

    return tickets


def _extract_field(text: str, field_name: str, default: str) -> str:
    """Extract a **Field:** value from markdown text."""
    match = re.search(rf'\*\*{field_name}:\*\*\s*(.+)', text)
    return match.group(1).strip() if match else default


# ─── Validation ───────────────────────────────────────────────────────────────


def validate_integrity() -> list[str]:
    """
    Full integrity check:
    1. Every ticket in a state dir has a master copy
    2. No ticket in multiple state dirs
    3. Stage field matches directory location
    4. SDLC flow is valid
    5. No orphaned state files

    Returns list of error messages (empty = clean).
    """
    errors = []

    # Check all state dirs
    seen_tickets: dict[str, list[str]] = {}
    for stage in STAGES:
        stage_dir = STATE_DIR / stage
        if not stage_dir.exists():
            errors.append(f"MISSING STATE DIR: {stage}")
            continue

        for f in stage_dir.glob("*.json"):
            tid = f.stem
            seen_tickets.setdefault(tid, []).append(stage)

            # Check master exists
            if not canonical_ticket_path(tid).exists():
                errors.append(f"ORPHAN: {tid} in {stage} but no master in tickets/")

            # Check stage field matches
            try:
                ticket = load_ticket(f)
                effective_stage = STAGE_TO_STATE_DIR.get(ticket.get("stage", ""), ticket.get("stage", ""))
                if effective_stage != stage and ticket.get("stage") != stage:
                    errors.append(
                        f"STAGE MISMATCH: {tid} stage={ticket.get('stage')} but in dir {stage}"
                    )
            except (json.JSONDecodeError, KeyError) as e:
                errors.append(f"CORRUPT: {tid} in {stage}: {e}")

    # Check for duplicates
    for tid, stages in seen_tickets.items():
        if len(stages) > 1:
            errors.append(f"DUPLICATE: {tid} found in {stages}")

    # Check master tickets have valid schema fields
    for f in TICKETS_DIR.glob("*.json"):
        if f.name == "ticket-schema.json":
            continue
        try:
            ticket = load_ticket(f)
            required = ["ticket_id", "title", "type", "stage", "sdlc_flow",
                        "created_at", "dependencies", "acceptance_criteria"]
            for field in required:
                if field not in ticket:
                    errors.append(f"SCHEMA: {f.stem} missing required field: {field}")
        except (json.JSONDecodeError, KeyError) as e:
            errors.append(f"CORRUPT MASTER: {f.stem}: {e}")

    return errors


def release_expired_claims() -> list[str]:
    """Find and release all expired claims."""
    released = []
    now = datetime.now(timezone.utc)

    for ticket in all_tickets():
        if ticket.get("claimed_by") and ticket.get("lease_expiry"):
            try:
                expiry = datetime.fromisoformat(ticket["lease_expiry"])
                if expiry < now:
                    ok, msg = release_claim(
                        ticket["ticket_id"],
                        reason=f"Lease expired at {ticket['lease_expiry']}"
                    )
                    if ok:
                        released.append(msg)
            except (ValueError, TypeError):
                pass

    return released


# ─── Status Display ───────────────────────────────────────────────────────────


def print_status() -> None:
    """Print current state of all tickets."""
    print("=" * 80)
    print("DISTRIBUTED TICKET STATE MACHINE — STATUS")
    print("=" * 80)
    print()

    # Count by stage
    stage_counts: dict[str, int] = {}
    for stage in STAGES:
        stage_dir = STATE_DIR / stage
        count = len(list(stage_dir.glob("*.json"))) if stage_dir.exists() else 0
        stage_counts[stage] = count

    print("Stage Distribution:")
    for stage, count in stage_counts.items():
        bar = "█" * count
        print(f"  {stage:12s} │ {count:3d} {bar}")

    total_master = len(all_ticket_ids())
    total_in_state = sum(stage_counts.values())
    print(f"\n  Total tickets (master): {total_master}")
    print(f"  Total in state dirs:    {total_in_state}")
    print(f"  Blocked (not in state): {total_master - total_in_state}")

    # Show claimed tickets
    print("\nActive Claims:")
    found_claims = False
    for ticket in all_tickets():
        if ticket.get("claimed_by"):
            found_claims = True
            expiry = ticket.get("lease_expiry", "N/A")
            print(
                f"  {ticket['ticket_id']:20s} → {ticket['claimed_by']} "
                f"on {ticket.get('machine_id', '?')} "
                f"({ticket.get('operator', '?')}) "
                f"until {expiry}"
            )
    if not found_claims:
        print("  (none)")

    # Show errors
    errors = validate_integrity()
    if errors:
        print(f"\nIntegrity Issues ({len(errors)}):")
        for e in errors:
            print(f"  ⚠ {e}")
    else:
        print("\n✓ Integrity check passed")

    print()


def print_status_json() -> None:
    """Output machine-readable JSON status of all tickets, grouped by stage."""
    output: dict = {
        "stages": {},
        "summary": {
            "total_master": 0,
            "total_in_state": 0,
            "blocked": 0,
        },
        "active_claims": [],
        "errors": [],
    }

    # Count by stage
    total_in_state = 0
    for stage in STAGES:
        stage_dir = STATE_DIR / stage
        stage_tickets = []
        if stage_dir.exists():
            for f in sorted(stage_dir.glob("*.json")):
                try:
                    ticket = load_ticket(f)
                    stage_tickets.append({
                        "ticket_id": ticket.get("ticket_id", f.stem),
                        "title": ticket.get("title", ""),
                        "type": ticket.get("type", ""),
                        "priority": ticket.get("priority", "medium"),
                        "claimed_by": ticket.get("claimed_by"),
                        "operator": ticket.get("operator"),
                        "machine_id": ticket.get("machine_id"),
                        "lease_expiry": ticket.get("lease_expiry"),
                        "rework_count": ticket.get("rework_count", 0),
                        "dependencies": ticket.get("dependencies", []),
                        "sdlc_flow": ticket.get("sdlc_flow", []),
                        "file_paths": ticket.get("file_paths", []),
                        "acceptance_criteria": ticket.get("acceptance_criteria", []),
                    })
                except (json.JSONDecodeError, KeyError):
                    pass
        total_in_state += len(stage_tickets)
        output["stages"][stage] = stage_tickets

    # Collect active claims
    for ticket in all_tickets():
        if ticket.get("claimed_by"):
            output["active_claims"].append({
                "ticket_id": ticket["ticket_id"],
                "claimed_by": ticket["claimed_by"],
                "operator": ticket.get("operator"),
                "machine_id": ticket.get("machine_id"),
                "lease_expiry": ticket.get("lease_expiry"),
            })

    total_master = len(all_ticket_ids())
    output["summary"]["total_master"] = total_master
    output["summary"]["total_in_state"] = total_in_state
    output["summary"]["blocked"] = total_master - total_in_state

    # Integrity errors
    output["errors"] = validate_integrity()

    print(json.dumps(output, indent=2, default=str))


def print_dot_graph() -> None:
    """Output dependency graph in DOT format for visualization."""
    print("digraph tickets {")
    print("  rankdir=LR;")
    print("  node [shape=box, style=filled];")

    stage_colors = {
        "READY": "#90EE90",
        "BLOCKED": "#FFB6C1",
        "ARCHITECT": "#87CEEB",
        "RESEARCH": "#DDA0DD",
        "BACKEND": "#FFA07A",
        "FRONTEND": "#98FB98",
        "QA": "#FFDAB9",
        "SECURITY": "#FF6347",
        "CI": "#B0C4DE",
        "DOCS": "#F0E68C",
        "VALIDATION": "#DEB887",
        "DONE": "#32CD32",
    }

    for ticket in all_tickets():
        tid = ticket["ticket_id"]
        stage = ticket.get("stage", "UNKNOWN")
        color = stage_colors.get(stage, "#FFFFFF")
        print(f'  "{tid}" [label="{tid}\\n{stage}", fillcolor="{color}"];')

        for dep in ticket.get("dependencies", []):
            print(f'  "{dep}" -> "{tid}";')

    print("}")


# ─── CLI ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Distributed Git-Native Ticket State Machine Manager",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tickets.py --sync                              # Resolve deps, move unblocked to READY
  python tickets.py --parse TODO/tasks/                  # Parse L3 markdown into tickets
  python tickets.py --status                             # Show full state dashboard
  python tickets.py --claim TASK-001-01-01 Backend host1 Owais
  python tickets.py --release TASK-001-01-01             # Release claim
  python tickets.py --advance TASK-001-01-01 Backend     # Move to next stage
  python tickets.py --rework TASK-001-01-01 QA "Tests failed"
  python tickets.py --validate                           # Full integrity check
  python tickets.py --dot | dot -Tpng -o graph.png       # Dependency graph
  python tickets.py --release-expired                    # Release all expired claims
        """,
    )

    parser.add_argument("--sync", action="store_true", help="Evaluate all tickets, move unblocked to READY")
    parser.add_argument("--parse", metavar="L3_DIR", help="Parse L3 markdown directory into tickets")
    parser.add_argument("--status", action="store_true", help="Show ticket state dashboard")
    parser.add_argument("--claim", nargs=4, metavar=("TICKET_ID", "AGENT", "MACHINE_ID", "OPERATOR"),
                        help="Claim a ticket")
    parser.add_argument("--release", metavar="TICKET_ID", help="Release claim on a ticket")
    parser.add_argument("--advance", nargs=2, metavar=("TICKET_ID", "AGENT"),
                        help="Advance ticket to next SDLC stage")
    parser.add_argument("--rework", nargs=3, metavar=("TICKET_ID", "AGENT", "REASON"),
                        help="Send ticket back for rework")
    parser.add_argument("--validate", action="store_true", help="Full integrity check")
    parser.add_argument("--dot", action="store_true", help="Output dependency graph in DOT format")
    parser.add_argument("--release-expired", action="store_true", help="Release all expired claims")
    parser.add_argument("--json", action="store_true", help="Output in JSON format where applicable")

    args = parser.parse_args()

    if args.sync:
        print("Syncing tickets...")
        released = release_expired_claims()
        for msg in released:
            print(f"  RELEASED: {msg}")

        result = sync_tickets()
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            if result["moved_to_ready"]:
                print(f"  Moved to READY: {', '.join(result['moved_to_ready'])}")
            if result["still_blocked"]:
                print(f"  Still blocked:")
                for b in result["still_blocked"]:
                    print(f"    - {b}")
            if result["duplicates_fixed"]:
                print(f"  Duplicates fixed:")
                for d in result["duplicates_fixed"]:
                    print(f"    - {d}")
            if result["errors"]:
                print(f"  Errors:")
                for e in result["errors"]:
                    print(f"    ⚠ {e}")
            if not any(result.values()):
                print("  No changes needed.")

    elif args.parse:
        print(f"Parsing L3 tasks from: {args.parse}")
        tickets = parse_l3_tasks(args.parse, created_by="TODO")
        print(f"\nCreated {len(tickets)} tickets.")

        # Auto-sync after parse
        print("\nRunning sync...")
        result = sync_tickets()
        if result["moved_to_ready"]:
            print(f"  Moved to READY: {', '.join(result['moved_to_ready'])}")

    elif args.status:
        if args.json:
            print_status_json()
        else:
            print_status()

    elif args.claim:
        ticket_id, agent, machine_id, operator = args.claim
        ok, msg = claim_ticket(ticket_id, agent, machine_id, operator)
        print(f"{'OK' if ok else 'FAIL'}: {msg}")
        sys.exit(0 if ok else 1)

    elif args.release:
        ok, msg = release_claim(args.release)
        print(f"{'OK' if ok else 'FAIL'}: {msg}")
        sys.exit(0 if ok else 1)

    elif args.advance:
        ticket_id, agent = args.advance
        ok, msg = advance_ticket(ticket_id, agent)
        print(f"{'OK' if ok else 'FAIL'}: {msg}")
        sys.exit(0 if ok else 1)

    elif args.rework:
        ticket_id, agent, reason = args.rework
        ok, msg = rework_ticket(ticket_id, agent, reason)
        print(f"{'OK' if ok else 'FAIL'}: {msg}")
        sys.exit(0 if ok else 1)

    elif args.validate:
        errors = validate_integrity()
        if errors:
            print(f"INTEGRITY CHECK FAILED ({len(errors)} issues):")
            for e in errors:
                print(f"  ⚠ {e}")
            sys.exit(1)
        else:
            print("✓ All integrity checks passed")
            sys.exit(0)

    elif args.dot:
        print_dot_graph()

    elif args.release_expired:
        released = release_expired_claims()
        if released:
            for msg in released:
                print(f"  RELEASED: {msg}")
        else:
            print("  No expired claims found.")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
