#!/usr/bin/env python3
"""
 PROJECT BOARD — Distributed Ticket Visualizer
=================================================
Reads ticket JSON from .github/ticket-state/ directories
and .github/tickets/ master copies. Shows stage distribution,
ownership, dependencies, blocked/ready status, and claim info.

Read-only: NEVER mutates ticket files or state directories.

Usage:
    python3 todo_visual.py              # Terminal + HTML output
    python3 todo_visual.py --terminal   # Terminal only
    python3 todo_visual.py --html       # HTML only
    python3 todo_visual.py --json       # Machine-readable JSON
    python3 todo_visual.py --ready      # Ready tickets (READY stage, no blockers)
    python3 todo_visual.py --ready --json  # Ready tickets as JSON
    python3 todo_visual.py --stage QA   # Filter by stage
    python3 todo_visual.py --owner Owais  # Filter by operator
    python3 todo_visual.py --list       # List all state directories + counts
"""

from __future__ import annotations

import json
import logging
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ─── Logging ─────────────────────────────────────────────────
logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")
_log = logging.getLogger("board")

# ─── Configuration ───────────────────────────────────────────
ROOT = Path(__file__).resolve().parent
TICKET_STATE_DIR = ROOT / ".github" / "ticket-state"
TICKETS_DIR = ROOT / ".github" / "tickets"

STAGE_ORDER: list[str] = [
    "READY", "ARCHITECT", "RESEARCH", "BACKEND", "FRONTEND",
    "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
]

PRIORITY_ORDER: dict[str, int] = {
    "critical": 0, "high": 1, "medium": 2, "low": 3,
}

STAGE_EMOJI: dict[str, str] = {
    "READY": "\U0001f7e2", "ARCHITECT": "\U0001f4d0", "RESEARCH": "\U0001f50d",
    "BACKEND": "\u2699\ufe0f", "FRONTEND": "\U0001f5a5\ufe0f", "QA": "\U0001f9ea",
    "SECURITY": "\U0001f512", "CI": "\U0001f504", "DOCS": "\U0001f4dd",
    "VALIDATION": "\u2705", "DONE": "\U0001f3c1",
}


# ─── Data Model ──────────────────────────────────────────────
@dataclass
class Ticket:
    ticket_id: str
    title: str
    type: str = "backend"
    priority: str = "medium"
    stage: str = "READY"
    sdlc_flow: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    blocked_by: list[str] = field(default_factory=list)
    file_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    rework_count: int = 0
    claimed_by: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    lease_expiry: str | None = None
    created_at: str = ""
    created_by: str = ""
    tags: list[str] = field(default_factory=list)
    description: str = ""
    source_file: str = ""
    is_expired: bool = False


@dataclass
class BoardStats:
    total: int = 0
    by_stage: dict[str, int] = field(default_factory=dict)
    by_type: dict[str, int] = field(default_factory=dict)
    by_priority: dict[str, int] = field(default_factory=dict)
    by_operator: dict[str, int] = field(default_factory=dict)
    claimed: int = 0
    unclaimed: int = 0
    blocked: int = 0
    expired_claims: int = 0
    ready_actionable: int = 0
    critical_pending: int = 0
    high_pending: int = 0
    rework_total: int = 0
    missing_deps: list[tuple[str, str]] = field(default_factory=list)


# =====================================================================
#  DISCOVERY -- Scan ticket-state directories
# =====================================================================

def discover_tickets() -> dict[str, Ticket]:
    """Scan .github/ticket-state/<STAGE>/ directories for ticket JSON."""
    registry: dict[str, Ticket] = {}

    if not TICKET_STATE_DIR.is_dir():
        _log.warning("ticket-state directory not found: %s", TICKET_STATE_DIR)
        return registry

    for stage_dir in sorted(TICKET_STATE_DIR.iterdir()):
        if not stage_dir.is_dir():
            continue
        stage_name = stage_dir.name
        if stage_name not in STAGE_ORDER:
            continue
        for ticket_file in sorted(stage_dir.glob("*.json")):
            try:
                ticket = _parse_ticket(ticket_file, stage_name)
                if ticket.ticket_id in registry:
                    _log.warning(
                        "Duplicate ticket %s in %s (already in %s)",
                        ticket.ticket_id, stage_name,
                        registry[ticket.ticket_id].stage,
                    )
                    continue
                registry[ticket.ticket_id] = ticket
            except Exception:
                _log.exception("Failed to parse %s", ticket_file)

    # Backfill from master tickets dir
    if TICKETS_DIR.is_dir():
        for ticket_file in sorted(TICKETS_DIR.glob("*.json")):
            if ticket_file.name == "ticket-schema.json":
                continue
            try:
                data = json.loads(ticket_file.read_text(encoding="utf-8"))
                tid = data.get("ticket_id", "")
                if tid and tid not in registry:
                    ticket = _data_to_ticket(data, f"tickets/{ticket_file.name}")
                    registry[tid] = ticket
            except Exception:
                _log.exception("Failed to parse master ticket %s", ticket_file)

    return registry


def _parse_ticket(path: Path, stage_name: str) -> Ticket:
    """Parse a single ticket JSON from a state directory."""
    data = json.loads(path.read_text(encoding="utf-8"))
    rel = f"ticket-state/{stage_name}/{path.name}"
    ticket = _data_to_ticket(data, rel)
    ticket.stage = stage_name  # state dir is authoritative
    return ticket


def _data_to_ticket(data: dict[str, Any], source: str) -> Ticket:
    """Convert raw JSON dict to Ticket dataclass."""
    now = datetime.now(timezone.utc)
    lease = data.get("lease_expiry")
    is_expired = False
    if lease:
        try:
            expiry = datetime.fromisoformat(lease.replace("Z", "+00:00"))
            is_expired = expiry < now
        except (ValueError, TypeError):
            pass

    return Ticket(
        ticket_id=data.get("ticket_id", "UNKNOWN"),
        title=data.get("title", "Untitled")[:120],
        type=data.get("type", "backend"),
        priority=data.get("priority", "medium"),
        stage=data.get("stage", "READY"),
        sdlc_flow=data.get("sdlc_flow", []),
        dependencies=data.get("dependencies", []),
        blocked_by=data.get("blocked_by", []),
        file_paths=data.get("file_paths", []),
        acceptance_criteria=data.get("acceptance_criteria", []),
        rework_count=data.get("rework_count", 0),
        claimed_by=data.get("claimed_by"),
        machine_id=data.get("machine_id"),
        operator=data.get("operator"),
        lease_expiry=data.get("lease_expiry"),
        created_at=data.get("created_at", ""),
        created_by=data.get("created_by", ""),
        tags=data.get("tags", []),
        description=data.get("description", ""),
        source_file=source,
        is_expired=is_expired,
    )


# =====================================================================
#  RESOLUTION -- Dependency analysis + statistics
# =====================================================================

def resolve(tickets: dict[str, Ticket]) -> BoardStats:
    """Compute dependency resolution, blocked status, and board stats."""
    stats = BoardStats(total=len(tickets))

    # Detect unresolved deps
    for t in tickets.values():
        for dep in t.dependencies:
            if dep not in tickets:
                stats.missing_deps.append((t.ticket_id, dep))

    # Compute blocked: ticket in READY but has unmet deps
    for t in tickets.values():
        if t.stage == "READY":
            unmet = [
                d for d in t.dependencies
                if d in tickets and tickets[d].stage != "DONE"
            ]
            if unmet:
                t.blocked_by = unmet

    # Tally
    for t in tickets.values():
        stats.by_stage[t.stage] = stats.by_stage.get(t.stage, 0) + 1
        stats.by_type[t.type] = stats.by_type.get(t.type, 0) + 1
        stats.by_priority[t.priority] = stats.by_priority.get(t.priority, 0) + 1

        if t.operator:
            stats.by_operator[t.operator] = stats.by_operator.get(t.operator, 0) + 1

        if t.claimed_by:
            stats.claimed += 1
        else:
            stats.unclaimed += 1

        if t.is_expired:
            stats.expired_claims += 1

        if t.blocked_by:
            stats.blocked += 1

        if t.stage == "READY" and not t.blocked_by:
            stats.ready_actionable += 1

        if t.stage != "DONE":
            if t.priority == "critical":
                stats.critical_pending += 1
            elif t.priority == "high":
                stats.high_pending += 1

        stats.rework_total += t.rework_count

    return stats


def get_ready_tickets(tickets: dict[str, Ticket]) -> list[Ticket]:
    """Return tickets in READY stage with no unmet dependencies."""
    ready = [
        t for t in tickets.values()
        if t.stage == "READY" and not t.blocked_by
    ]
    ready.sort(key=lambda t: (PRIORITY_ORDER.get(t.priority, 9), t.ticket_id))
    return ready


# =====================================================================
#  Terminal Output (rich -> plain fallback)
# =====================================================================

def render_terminal(tickets: dict[str, Ticket], stats: BoardStats) -> None:
    try:
        _render_rich(tickets, stats)
    except ImportError:
        _render_plain(tickets, stats)


def _render_rich(tickets: dict[str, Ticket], stats: BoardStats) -> None:
    from rich import box
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table

    c = Console()
    done = stats.by_stage.get("DONE", 0)
    pct = f"{done / stats.total * 100:.1f}" if stats.total else "0.0"

    # -- Banner --
    c.print()
    c.print(Panel.fit(
        f"[bold cyan]DISTRIBUTED TICKET BOARD[/]\n"
        f"[dim]{stats.total} tickets | {pct}% done | "
        f"{stats.claimed} claimed | {stats.expired_claims} expired[/]",
        border_style="cyan",
    ))

    # -- Stage Pipeline --
    c.print("\n[bold]Stage Pipeline:[/]")
    pipeline = Table(box=box.SIMPLE, padding=(0, 1), show_header=False)
    for stage in STAGE_ORDER:
        pipeline.add_column(stage, justify="center")
    pipeline.add_row(
        *[
            f"[bold]{STAGE_EMOJI.get(s, '')} {stats.by_stage.get(s, 0)}[/]"
            for s in STAGE_ORDER
        ]
    )
    c.print(pipeline)

    # -- Summary Stats --
    tbl = Table(box=box.ROUNDED, show_header=False, padding=(0, 2))
    tbl.add_column("Metric", style="bold")
    tbl.add_column("Value", justify="right")
    tbl.add_row("Done", f"[green]{done}[/]")
    tbl.add_row("Ready (actionable)", f"[green]{stats.ready_actionable}[/]")
    tbl.add_row("Blocked", f"[red]{stats.blocked}[/]")
    tbl.add_row("Claimed (active)", f"[yellow]{stats.claimed}[/]")
    tbl.add_row("Expired Claims", f"[red]{stats.expired_claims}[/]")
    tbl.add_row("Critical Pending", f"[bold red]{stats.critical_pending}[/]")
    tbl.add_row("High Pending", f"[bold yellow]{stats.high_pending}[/]")
    tbl.add_row("Rework Total", f"[magenta]{stats.rework_total}[/]")
    c.print(tbl)

    # -- Per-Stage Table --
    c.print("\n[bold]Tickets by Stage:[/]")
    st = Table(box=box.ROUNDED)
    st.add_column("Stage", style="bold cyan", no_wrap=True)
    st.add_column("Count", justify="right")
    st.add_column("Tickets")
    for stage in STAGE_ORDER:
        stage_tickets = sorted(
            [t for t in tickets.values() if t.stage == stage],
            key=lambda x: (PRIORITY_ORDER.get(x.priority, 9), x.ticket_id),
        )
        if not stage_tickets:
            st.add_row(
                f"{STAGE_EMOJI.get(stage, '')} {stage}",
                "[dim]0[/]",
                "[dim]---[/]",
            )
            continue
        ticket_strs = []
        for t in stage_tickets[:10]:
            owner = f" @{t.operator}" if t.operator else ""
            claimed = f" [dim](-> {t.claimed_by})[/]" if t.claimed_by else ""
            expired = " [red]EXPIRED[/]" if t.is_expired else ""
            blocked = " [red]BLOCKED[/]" if t.blocked_by else ""
            prio_s = {"critical": "[bold red]P0[/]", "high": "[yellow]P1[/]",
                       "medium": "[dim]P2[/]", "low": "[dim]P3[/]"}.get(t.priority, "")
            ticket_strs.append(
                f"{prio_s} [bold]{t.ticket_id}[/] {t.title[:40]}{owner}{claimed}{expired}{blocked}"
            )
        if len(stage_tickets) > 10:
            ticket_strs.append(f"[dim]... +{len(stage_tickets) - 10} more[/]")
        st.add_row(
            f"{STAGE_EMOJI.get(stage, '')} {stage}",
            str(len(stage_tickets)),
            "\n".join(ticket_strs),
        )
    c.print(st)

    # -- Active Claims --
    claimed_tickets = sorted(
        [t for t in tickets.values() if t.claimed_by],
        key=lambda x: (x.stage, x.ticket_id),
    )
    if claimed_tickets:
        c.print(f"\n[bold yellow]ACTIVE CLAIMS -- {len(claimed_tickets)} ticket(s)[/]")
        ct = Table(box=box.SIMPLE, padding=(0, 1))
        ct.add_column("Ticket", style="bold cyan", no_wrap=True)
        ct.add_column("Stage", justify="center")
        ct.add_column("Agent", style="yellow")
        ct.add_column("Operator")
        ct.add_column("Machine", style="dim")
        ct.add_column("Expires", style="dim")
        ct.add_column("Status", justify="center")
        for t in claimed_tickets:
            exp_str = ""
            if t.lease_expiry:
                try:
                    exp = datetime.fromisoformat(t.lease_expiry.replace("Z", "+00:00"))
                    exp_str = exp.strftime("%H:%M:%S")
                except (ValueError, TypeError):
                    exp_str = t.lease_expiry[:19]
            status = "[red]EXPIRED[/]" if t.is_expired else "[green]ACTIVE[/]"
            ct.add_row(
                t.ticket_id,
                t.stage,
                t.claimed_by or "---",
                t.operator or "---",
                t.machine_id or "---",
                exp_str or "---",
                status,
            )
        c.print(ct)

    # -- Critical Tickets --
    critical = sorted(
        [t for t in tickets.values() if t.priority == "critical" and t.stage != "DONE"],
        key=lambda x: x.ticket_id,
    )
    if critical:
        c.print(f"\n[bold red]CRITICAL TICKETS -- {len(critical)} pending[/]")
        for t in critical:
            owner = f" @{t.operator}" if t.operator else ""
            c.print(f"  [bold]{t.ticket_id}[/] [{t.stage}] {t.title[:50]}{owner}")

    # -- Blocked Detail --
    blocked = sorted(
        [t for t in tickets.values() if t.blocked_by],
        key=lambda x: x.ticket_id,
    )
    if blocked:
        c.print(f"\n[bold yellow]BLOCKED -- {len(blocked)} ticket(s)[/]")
        for t in blocked:
            dep_strs = []
            for d in t.blocked_by:
                if d in tickets:
                    dep_strs.append(f"{d} [{tickets[d].stage}]")
                else:
                    dep_strs.append(f"{d}?")
            c.print(f"  [dim]{t.ticket_id}[/] <- {', '.join(dep_strs)}")

    # -- Missing Deps --
    if stats.missing_deps:
        c.print(f"\n[bold magenta]UNRESOLVED DEPS -- {len(stats.missing_deps)}[/]")
        for tid, did in stats.missing_deps[:15]:
            c.print(f"  [dim]{tid}[/] -> [bold]{did}[/] (not found)")
        if len(stats.missing_deps) > 15:
            c.print(f"  [dim]... +{len(stats.missing_deps) - 15} more[/]")

    # -- Type Distribution --
    if stats.by_type:
        c.print("\n[bold]By Type:[/]  ", end="")
        c.print("  ".join(f"[dim]{k}[/]={v}" for k, v in sorted(stats.by_type.items())))

    # -- Operator Distribution --
    if stats.by_operator:
        c.print("[bold]By Operator:[/]  ", end="")
        c.print("  ".join(f"@{k}={v}" for k, v in sorted(stats.by_operator.items())))

    c.print()


def _render_plain(tickets: dict[str, Ticket], stats: BoardStats) -> None:
    done = stats.by_stage.get("DONE", 0)
    pct = f"{done / stats.total * 100:.1f}" if stats.total else "0.0"
    print(f"\n{'=' * 60}")
    print(f"   DISTRIBUTED TICKET BOARD  ({stats.total} tickets, {pct}% done)")
    print(f"{'=' * 60}")

    print("\n  Stage Pipeline:")
    for stage in STAGE_ORDER:
        count = stats.by_stage.get(stage, 0)
        emoji = STAGE_EMOJI.get(stage, " ")
        print(f"    {emoji} {stage:<12} {count}")

    line = "-" * 40
    print(f"\n  {line}")
    print(f"  Ready (actionable)  {stats.ready_actionable}")
    print(f"  Blocked             {stats.blocked}")
    print(f"  Claimed             {stats.claimed}")
    print(f"  Expired Claims      {stats.expired_claims}")
    print(f"  Critical Pending    {stats.critical_pending}")
    print(f"  High Pending        {stats.high_pending}")
    print(f"  Rework Total        {stats.rework_total}")

    for stage in STAGE_ORDER:
        stage_tickets = [t for t in tickets.values() if t.stage == stage]
        if not stage_tickets:
            continue
        print(f"\n  {STAGE_EMOJI.get(stage, '')} {stage} ({len(stage_tickets)}):")
        for t in sorted(stage_tickets, key=lambda x: x.ticket_id)[:15]:
            owner = f" @{t.operator}" if t.operator else ""
            claimed = f" -> {t.claimed_by}" if t.claimed_by else ""
            print(f"    {t.ticket_id}: {t.title[:45]}  [{t.priority}]{owner}{claimed}")

    if stats.missing_deps:
        print(f"\n  UNRESOLVED DEPS ({len(stats.missing_deps)}):")
        for tid, did in stats.missing_deps[:15]:
            print(f"    {tid} -> {did}")
    print()


# =====================================================================
#  Ready-Task Renderers
# =====================================================================

def render_ready_terminal(ready: list[Ticket]) -> None:
    if not ready:
        print("No actionable tickets. All tickets are blocked, claimed, or done.")
        return
    try:
        from rich import box
        from rich.console import Console
        from rich.table import Table

        c = Console()
        c.print(f"\n[bold green]READY FOR ASSIGNMENT -- {len(ready)} ticket(s)[/]\n")
        tbl = Table(box=box.SIMPLE, padding=(0, 1))
        tbl.add_column("Ticket ID", style="bold cyan", no_wrap=True)
        tbl.add_column("Priority", justify="center")
        tbl.add_column("Type", style="dim")
        tbl.add_column("Title")
        tbl.add_column("Deps", style="dim")
        tbl.add_column("Files", style="dim")
        _P_STYLE = {
            "critical": "[bold red]CRIT[/]",
            "high": "[yellow]HIGH[/]",
            "medium": "[dim]MED[/]",
            "low": "[dim]LOW[/]",
        }
        for t in ready:
            deps = ", ".join(t.dependencies[:3]) or "---"
            files = ", ".join(t.file_paths[:2]) or "---"
            tbl.add_row(
                t.ticket_id,
                _P_STYLE.get(t.priority, t.priority),
                t.type,
                t.title[:50],
                deps,
                files,
            )
        c.print(tbl)
        c.print()
    except ImportError:
        print(f"\nREADY FOR ASSIGNMENT -- {len(ready)} ticket(s)")
        print("-" * 90)
        print(f"{'ID':<22} {'Pri':<8} {'Type':<10} {'Title':<45}")
        print("-" * 90)
        for t in ready:
            print(f"{t.ticket_id:<22} {t.priority:<8} {t.type:<10} {t.title[:45]}")
        print()


def render_ready_json(ready: list[Ticket]) -> None:
    out = {
        "ready_count": len(ready),
        "tickets": [
            {
                "ticket_id": t.ticket_id,
                "title": t.title,
                "type": t.type,
                "priority": t.priority,
                "dependencies": t.dependencies,
                "file_paths": t.file_paths,
                "acceptance_criteria": t.acceptance_criteria,
                "tags": t.tags,
            }
            for t in ready
        ],
    }
    print(json.dumps(out, indent=2))


# =====================================================================
#  HTML / Mermaid Output
# =====================================================================

def _safe_node(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", raw)


def generate_html(tickets: dict[str, Ticket], stats: BoardStats) -> str:
    mermaid = _build_mermaid(tickets)
    rows = _build_rows(tickets)
    done = stats.by_stage.get("DONE", 0)
    pct = f"{done / stats.total * 100:.1f}" if stats.total else "0.0"
    in_progress = sum(
        stats.by_stage.get(s, 0) for s in
        ["BACKEND", "FRONTEND", "ARCHITECT", "RESEARCH", "QA",
         "SECURITY", "CI", "DOCS", "VALIDATION"]
    )
    ready_count = stats.by_stage.get("READY", 0)

    stage_bar_items = []
    for s in STAGE_ORDER:
        cnt = stats.by_stage.get(s, 0)
        emoji = STAGE_EMOJI.get(s, "")
        stage_bar_items.append(
            '<div class="stage-chip" data-stage="' + s + '">'
            '<span class="stage-emoji">' + emoji + '</span>'
            '<span class="stage-name">' + s + '</span>'
            '<span class="stage-count">' + str(cnt) + '</span></div>'
        )
    stage_bar_html = "\n    ".join(stage_bar_items)

    html = _HTML_TEMPLATE
    replacements = {
        "%%TOTAL%%": str(stats.total),
        "%%DONE%%": str(done),
        "%%IN_PROGRESS%%": str(in_progress),
        "%%BLOCKED%%": str(stats.blocked),
        "%%READY%%": str(ready_count),
        "%%CLAIMED%%": str(stats.claimed),
        "%%EXPIRED%%": str(stats.expired_claims),
        "%%CRITICAL%%": str(stats.critical_pending),
        "%%HIGH%%": str(stats.high_pending),
        "%%REWORK%%": str(stats.rework_total),
        "%%PROGRESS%%": pct,
        "%%MISSING%%": str(len(stats.missing_deps)),
        "%%STAGE_BAR%%": stage_bar_html,
        "%%MERMAID%%": mermaid,
        "%%ROWS%%": rows,
    }
    for k, v in replacements.items():
        html = html.replace(k, v)
    return html


def _build_mermaid(tickets: dict[str, Ticket]) -> str:
    lines = ["graph TD"]

    by_stage: dict[str, list[Ticket]] = {}
    for t in tickets.values():
        by_stage.setdefault(t.stage, []).append(t)

    for stage in STAGE_ORDER:
        stage_tickets = by_stage.get(stage, [])
        if not stage_tickets:
            continue
        emoji = STAGE_EMOJI.get(stage, "")
        lines.append('    subgraph ' + _safe_node(stage) + '["' + emoji + ' ' + stage + ' (' + str(len(stage_tickets)) + ')"]')
        for t in sorted(stage_tickets, key=lambda x: x.ticket_id):
            safe_t = (
                t.title[:50]
                .replace('"', "'")
                .replace("<", " ")
                .replace(">", " ")
                .replace("&", "+")
            )
            prio_map = {"critical": "P0", "high": "P1", "medium": "P2", "low": "P3"}
            prio_icon = prio_map.get(t.priority, "")
            owner_str = "<br/>@" + t.operator if t.operator else ""
            nid = _safe_node(t.ticket_id)
            cls = _ticket_class(t)
            lines.append('        ' + nid + '["' + prio_icon + ' ' + t.ticket_id + '<br/>' + safe_t + owner_str + '"]:::' + cls)
        lines.append("    end")

    lines.append("")

    seen_ext: set[str] = set()
    for t in tickets.values():
        for dep in t.dependencies:
            src, dst = _safe_node(dep), _safe_node(t.ticket_id)
            if dep in tickets:
                lines.append("    " + src + " --> " + dst)
            elif dep not in seen_ext:
                lines.append('    ' + src + '["' + dep + ' ?"]:::missing')
                lines.append("    " + src + " -.-> " + dst)
                seen_ext.add(dep)
            else:
                lines.append("    " + src + " -.-> " + dst)

    lines.append("")
    lines.append('    classDef done fill:#dcfce7,stroke:#166534,stroke-width:2px,color:#14532d')
    lines.append('    classDef ready fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#065f46')
    lines.append('    classDef active fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e')
    lines.append('    classDef claimed fill:#dbeafe,stroke:#1e40af,stroke-width:2px,color:#1e3a8a')
    lines.append('    classDef blocked fill:#fee2e2,stroke:#991b1b,stroke-width:2px,color:#7f1d1d')
    lines.append('    classDef expired fill:#fce7f3,stroke:#9d174d,stroke-width:2px,color:#831843')
    lines.append('    classDef missing fill:#f3f4f6,stroke:#6b7280,stroke-width:1px,stroke-dasharray:5,color:#374151')
    return "\n".join(lines)


def _ticket_class(t: Ticket) -> str:
    if t.stage == "DONE":
        return "done"
    if t.is_expired:
        return "expired"
    if t.blocked_by:
        return "blocked"
    if t.claimed_by:
        return "claimed"
    if t.stage == "READY":
        return "ready"
    return "active"


def _build_rows(tickets: dict[str, Ticket]) -> str:
    badges = {
        "DONE": '<span class="badge done">Done</span>',
        "READY": '<span class="badge ready">Ready</span>',
    }
    active_stages = {"BACKEND", "FRONTEND", "ARCHITECT", "RESEARCH",
                     "QA", "SECURITY", "CI", "DOCS", "VALIDATION"}

    rows: list[str] = []
    for t in sorted(tickets.values(),
                    key=lambda x: (PRIORITY_ORDER.get(x.priority, 9),
                                   STAGE_ORDER.index(x.stage) if x.stage in STAGE_ORDER else 99,
                                   x.ticket_id)):
        if t.stage in badges:
            badge = badges[t.stage]
        elif t.stage in active_stages:
            badge = '<span class="badge active">' + STAGE_EMOJI.get(t.stage, "") + ' ' + t.stage + '</span>'
        else:
            badge = '<span class="badge">' + t.stage + '</span>'

        if t.is_expired:
            badge += ' <span class="badge expired">EXPIRED</span>'
        if t.blocked_by:
            badge += ' <span class="badge blocked-tag">BLOCKED</span>'

        deps = ", ".join(t.dependencies) or "---"
        owner = t.operator or "---"
        agent = t.claimed_by or "---"
        prio_class = t.priority

        rows.append(
            "<tr data-priority='" + t.priority + "' data-stage='" + t.stage + "' data-type='" + t.type + "'>"
            "<td><b>" + t.ticket_id + "</b></td>"
            "<td>" + t.title + "</td>"
            "<td class='prio-" + prio_class + "'>" + t.priority + "</td>"
            "<td>" + badge + "</td>"
            "<td>" + t.type + "</td>"
            "<td>" + owner + "</td>"
            "<td>" + agent + "</td>"
            "<td class='deps'>" + deps + "</td></tr>"
        )
    return "\n            ".join(rows)


_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Distributed Ticket Board</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
header{background:#1e293b;border-bottom:1px solid #334155;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;flex-wrap:wrap;gap:10px}
header h1{font-size:1.4rem;color:#38bdf8;white-space:nowrap}
.stats-bar{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.stat{text-align:center;min-width:48px}
.stat-value{font-size:1.4rem;font-weight:bold}
.stat-label{font-size:.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.controls{display:flex;gap:6px}
.controls button{background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:6px;padding:5px 11px;cursor:pointer;font-size:1rem;transition:background .15s}
.controls button:hover{background:#475569}
.stage-pipeline{display:flex;gap:4px;padding:10px 24px;background:#1e293b;border-bottom:1px solid #334155;overflow-x:auto;flex-wrap:nowrap}
.stage-chip{display:flex;align-items:center;gap:4px;padding:6px 12px;border-radius:8px;background:#334155;border:1px solid #475569;font-size:.8rem;white-space:nowrap;cursor:pointer;transition:all .15s}
.stage-chip:hover{border-color:#38bdf8;background:#1e3a5f}
.stage-chip .stage-emoji{font-size:1rem}
.stage-chip .stage-name{color:#94a3b8;font-weight:500}
.stage-chip .stage-count{background:#475569;color:#e2e8f0;padding:1px 7px;border-radius:10px;font-weight:bold;font-size:.75rem}
.tabs{display:flex;border-bottom:1px solid #334155;background:#1e293b}
.tab{padding:11px 22px;cursor:pointer;border-bottom:2px solid transparent;color:#94a3b8;font-size:.9rem;user-select:none;transition:color .15s}
.tab.active{color:#38bdf8;border-bottom-color:#38bdf8}
.tab:hover{color:#e2e8f0}
#graph-container{overflow:hidden;height:calc(100vh - 200px);position:relative;cursor:grab;display:block}
#graph-container:active{cursor:grabbing}
#graph-inner{transform-origin:0 0;padding:40px;display:inline-block;min-width:100%}
#task-table-container{display:none;padding:0}
#filter-bar{padding:10px 16px;background:#1e293b;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid #334155;align-items:center}
.filter-btn{background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:20px;padding:4px 14px;cursor:pointer;font-size:.8rem;transition:all .15s}
.filter-btn.active{background:#38bdf8;color:#0f172a;border-color:#38bdf8}
.filter-btn:hover{border-color:#38bdf8}
.table-scroll{overflow-x:auto;max-height:calc(100vh - 260px);overflow-y:auto}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th{background:#1e293b;padding:9px 12px;text-align:left;position:sticky;top:0;border-bottom:2px solid #38bdf8;color:#38bdf8;z-index:2;cursor:pointer}
th:hover{color:#22d3ee}
td{padding:7px 12px;border-bottom:1px solid #1e293b}
tr:hover td{background:rgba(56,189,248,.06)}
.badge{padding:2px 8px;border-radius:4px;font-size:.73rem;font-weight:600;white-space:nowrap;display:inline-block;margin:1px 2px}
.badge.done{background:#166534;color:#dcfce7}
.badge.ready{background:#059669;color:#d1fae5}
.badge.active{background:#d97706;color:#fef3c7}
.badge.expired{background:#9d174d;color:#fce7f3}
.badge.blocked-tag{background:#991b1b;color:#fee2e2}
.deps{color:#64748b;font-size:.73rem;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.prio-critical{color:#ef4444;font-weight:bold}
.prio-high{color:#eab308}
.prio-medium{color:#94a3b8}
.prio-low{color:#64748b}
.progress-bar{width:180px;height:7px;background:#334155;border-radius:4px;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,#38bdf8,#22d3ee);border-radius:4px}
.search-box{background:#334155;border:1px solid #475569;border-radius:6px;padding:5px 12px;color:#e2e8f0;font-size:.85rem;width:220px;outline:none;transition:border-color .15s}
.search-box:focus{border-color:#38bdf8}
.search-box::placeholder{color:#64748b}
footer{background:#1e293b;border-top:1px solid #334155;padding:8px 24px;text-align:center;font-size:.7rem;color:#64748b}
@media(max-width:768px){header{flex-direction:column;gap:8px}.stats-bar{gap:10px}.search-box{width:100%}.stage-pipeline{flex-wrap:wrap}}
</style>
</head>
<body>
<header>
  <h1>Distributed Ticket Board</h1>
  <div class="stats-bar">
    <div class="stat"><div class="stat-value" style="color:#22c55e">%%DONE%%</div><div class="stat-label">Done</div></div>
    <div class="stat"><div class="stat-value" style="color:#eab308">%%IN_PROGRESS%%</div><div class="stat-label">Active</div></div>
    <div class="stat"><div class="stat-value" style="color:#22c55e">%%READY%%</div><div class="stat-label">Ready</div></div>
    <div class="stat"><div class="stat-value" style="color:#ef4444">%%BLOCKED%%</div><div class="stat-label">Blocked</div></div>
    <div class="stat"><div class="stat-value" style="color:#3b82f6">%%CLAIMED%%</div><div class="stat-label">Claimed</div></div>
    <div class="stat"><div class="stat-value" style="color:#ec4899">%%EXPIRED%%</div><div class="stat-label">Expired</div></div>
    <div class="stat">
      <div class="stat-value">%%PROGRESS%%%</div>
      <div class="progress-bar"><div class="progress-fill" style="width:%%PROGRESS%%%;max-width:100%"></div></div>
    </div>
  </div>
  <div class="controls">
    <button onclick="zoomIn()" title="Zoom In">+</button>
    <button onclick="zoomOut()" title="Zoom Out">-</button>
    <button onclick="resetView()" title="Reset View">R</button>
    <button onclick="fitView()" title="Fit to Screen">F</button>
  </div>
</header>
<div class="stage-pipeline">
    %%STAGE_BAR%%
</div>
<div class="tabs">
  <div class="tab active" onclick="showView('graph')">Dependency Graph</div>
  <div class="tab" onclick="showView('table')">Ticket List (%%TOTAL%%)</div>
</div>
<div id="graph-container">
  <div id="graph-inner">
    <pre class="mermaid">
%%MERMAID%%
    </pre>
  </div>
</div>
<div id="task-table-container">
  <div id="filter-bar">
    <input class="search-box" type="text" placeholder="Search tickets..." oninput="filterTable()">
    <button class="filter-btn active" data-filter="all" onclick="setFilter(this)">All (%%TOTAL%%)</button>
    <button class="filter-btn" data-filter="READY" onclick="setFilter(this)">Ready (%%READY%%)</button>
    <button class="filter-btn" data-filter="critical" onclick="setFilter(this)">Critical (%%CRITICAL%%)</button>
    <button class="filter-btn" data-filter="high" onclick="setFilter(this)">High (%%HIGH%%)</button>
    <button class="filter-btn" data-filter="blocked" onclick="setFilter(this)">Blocked (%%BLOCKED%%)</button>
    <button class="filter-btn" data-filter="DONE" onclick="setFilter(this)">Done (%%DONE%%)</button>
  </div>
  <div class="table-scroll">
    <table>
      <thead><tr>
        <th onclick="sortTable(0)">Ticket ID</th>
        <th onclick="sortTable(1)">Title</th>
        <th onclick="sortTable(2)">Priority</th>
        <th onclick="sortTable(3)">Stage</th>
        <th onclick="sortTable(4)">Type</th>
        <th onclick="sortTable(5)">Operator</th>
        <th onclick="sortTable(6)">Agent</th>
        <th>Deps</th>
      </tr></thead>
      <tbody>
            %%ROWS%%
      </tbody>
    </table>
  </div>
</div>
<footer>Distributed Ticket Board -- Read-only snapshot from .github/ticket-state/ -- Ticket files untouched</footer>
<script>
mermaid.initialize({startOnLoad:true,theme:'dark',flowchart:{useMaxWidth:false,htmlLabels:true,curve:'basis',padding:15},securityLevel:'loose',maxTextSize:500000});
function showView(v){
  var g=document.getElementById('graph-container'),t=document.getElementById('task-table-container'),tabs=document.querySelectorAll('.tab');
  if(v==='graph'){g.style.display='block';t.style.display='none';tabs[0].classList.add('active');tabs[1].classList.remove('active')}
  else{g.style.display='none';t.style.display='block';tabs[0].classList.remove('active');tabs[1].classList.add('active')}
}
var container=document.getElementById('graph-container'),inner=document.getElementById('graph-inner');
var scale=1,tx=0,ty=0,drag=false,sx,sy;
function upd(){inner.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')'}
function zoomIn(){scale=Math.min(scale*1.25,6);upd()}
function zoomOut(){scale=Math.max(scale/1.25,.05);upd()}
function resetView(){scale=1;tx=0;ty=0;upd()}
function fitView(){var svg=inner.querySelector('svg');if(!svg)return;var r=svg.getBoundingClientRect();scale=Math.min(container.clientWidth/(r.width||1),container.clientHeight/(r.height||1),.95);tx=10;ty=10;upd()}
container.addEventListener('wheel',function(e){e.preventDefault();scale=Math.max(.05,Math.min(6,scale*(e.deltaY>0?.88:1.12)));upd()},{passive:false});
container.addEventListener('mousedown',function(e){drag=true;sx=e.clientX-tx;sy=e.clientY-ty});
container.addEventListener('mousemove',function(e){if(!drag)return;tx=e.clientX-sx;ty=e.clientY-sy;upd()});
container.addEventListener('mouseup',function(){drag=false});
container.addEventListener('mouseleave',function(){drag=false});
document.addEventListener('keydown',function(e){if(e.target.tagName==='INPUT')return;if(e.key==='+'||e.key==='=')zoomIn();if(e.key==='-')zoomOut();if(e.key==='0')resetView()});
setTimeout(fitView,1500);
var activeFilter='all';
function setFilter(btn){
  document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active')});
  btn.classList.add('active');activeFilter=btn.dataset.filter;filterTable();
}
function filterTable(){
  var q=(document.querySelector('.search-box')||{}).value||'';q=q.toLowerCase();
  document.querySelectorAll('tbody tr').forEach(function(tr){
    var mf=true;
    if(activeFilter!=='all'){
      if(activeFilter==='blocked'){mf=tr.innerHTML.indexOf('BLOCKED')!==-1}
      else if(activeFilter==='critical'||activeFilter==='high'){mf=tr.dataset.priority===activeFilter}
      else{mf=tr.dataset.stage===activeFilter}
    }
    var ms=!q||tr.textContent.toLowerCase().indexOf(q)!==-1;
    tr.style.display=(mf&&ms)?'':'none';
  });
}
var sortDir={};
function sortTable(col){
  var tbody=document.querySelector('tbody'),rows=Array.from(tbody.querySelectorAll('tr'));
  sortDir[col]=!sortDir[col];var dir=sortDir[col]?1:-1;
  rows.sort(function(a,b){var av=a.children[col].textContent.trim(),bv=b.children[col].textContent.trim();return av<bv?-dir:av>bv?dir:0});
  rows.forEach(function(r){tbody.appendChild(r)});
}
document.querySelectorAll('.stage-chip').forEach(function(chip){
  chip.addEventListener('click',function(){
    var stage=chip.dataset.stage;
    showView('table');
    document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('active')});
    activeFilter=stage;filterTable();
  });
});
</script>
</body>
</html>
"""


# --- CLI Entry Point ---------------------------------------------------
def main() -> None:
    args = set(sys.argv[1:])

    if args & {"-h", "--help", "help"}:
        print(__doc__)
        return

    # --list: directory structure + counts
    if args & {"--list", "-l"}:
        print("Ticket State Directories (" + str(TICKET_STATE_DIR) + "):")
        if not TICKET_STATE_DIR.is_dir():
            print("  ticket-state directory not found!")
            return
        for stage in STAGE_ORDER:
            d = TICKET_STATE_DIR / stage
            if d.is_dir():
                tickets = list(d.glob("*.json"))
                print("  " + STAGE_EMOJI.get(stage, " ") + " " + stage.ljust(12) + "  " + str(len(tickets)) + " ticket(s)")
            else:
                print("  ! " + stage.ljust(12) + "  MISSING")
        return

    # Discovery
    tickets = discover_tickets()
    if not tickets:
        print("No tickets found in .github/ticket-state/ or .github/tickets/")
        print("  Hint: Create tickets with  python3 .github/tickets.py --parse <dir>")
        return

    # Resolution
    stats = resolve(tickets)

    # --stage STAGE filter
    stage_filter = None
    if "--stage" in args:
        argv = sys.argv[1:]
        for i, a in enumerate(argv):
            if a == "--stage" and i + 1 < len(argv):
                stage_filter = argv[i + 1].upper()
                break
        if stage_filter:
            tickets = {k: v for k, v in tickets.items() if v.stage == stage_filter}

    # --owner OPERATOR filter
    owner_filter = None
    if "--owner" in args:
        argv = sys.argv[1:]
        for i, a in enumerate(argv):
            if a == "--owner" and i + 1 < len(argv):
                owner_filter = argv[i + 1]
                break
        if owner_filter:
            tickets = {
                k: v for k, v in tickets.items()
                if v.operator and v.operator.lower() == owner_filter.lower()
            }

    # --ready
    if "--ready" in args:
        ready = get_ready_tickets(tickets)
        if "--json" in args:
            render_ready_json(ready)
        else:
            render_ready_terminal(ready)
        return

    # --json
    if "--json" in args:
        out = {
            "tickets": {tid: asdict(t) for tid, t in tickets.items()},
            "stats": asdict(stats),
            "stage_order": STAGE_ORDER,
        }
        print(json.dumps(out, indent=2, default=str))
        return

    # Outputs
    want_terminal = "--html" not in args
    want_html = "--terminal" not in args

    if want_terminal:
        render_terminal(tickets, stats)

    if want_html:
        html = generate_html(tickets, stats)
        out_path = ROOT / "index.html"
        out_path.write_text(html, encoding="utf-8")
        size = out_path.stat().st_size
        msg = "Board written to index.html (" + str(size) + " bytes)"
        try:
            from rich.console import Console
            Console().print("[green]" + msg + "[/]")
        except ImportError:
            print(msg)


if __name__ == "__main__":
    main()
