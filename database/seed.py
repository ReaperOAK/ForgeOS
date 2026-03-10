#!/usr/bin/env python3
"""
ForgeOS — Database Seed Script for JSON Import.

Reads ticket JSON files from .github/tickets/ (or a custom directory)
and inserts them into the PostgreSQL tickets table with upsert semantics.
Duplicate ticket_ids are skipped with a warning.

Usage:
    python database/seed.py                       # Import from .github/tickets/
    python database/seed.py --source database/seed_data/sample_tickets.json
    python database/seed.py --dry-run              # Validate without inserting
    DATABASE_URL=postgresql://... python database/seed.py

Ticket: FORGEOS-BE005
"""

from __future__ import annotations

import argparse
import glob
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit(
        "psycopg2 is required. Install with: pip install psycopg2-binary"
    )


# ── Logging ──────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("forgeos.seed")


# ── Constants ────────────────────────────────────────────────────────

VALID_TYPES = frozenset(
    {
        "backend",
        "frontend",
        "fullstack",
        "infra",
        "security",
        "docs",
        "research",
        "architecture",
        "product",
        "design",
    }
)

VALID_PRIORITIES = frozenset({"critical", "high", "medium", "low"})

VALID_STAGES_JSON = frozenset(
    {
        "READY",
        "ARCHITECT",
        "RESEARCH",
        "PRODUCT_MANAGER",
        "UI_DESIGN",
        "BACKEND",
        "FRONTEND",
        "QA",
        "SECURITY",
        "CI",
        "DOCS",
        "VALIDATION",
        "DONE",
        # Aliases found in real ticket data
        "BLOCKED",
        "UIDESIGNER",
        "DOCUMENTATION",
        "VALIDATOR",
    }
)

# Mapping from JSON schema stage values to PostgreSQL enum values.
# The DB uses DOCUMENTATION and VALIDATOR instead of DOCS and VALIDATION.
STAGE_JSON_TO_DB: dict[str, str] = {
    "READY": "READY",
    "RESEARCH": "RESEARCH",
    "ARCHITECT": "ARCHITECT",
    "PRODUCT_MANAGER": "PRODUCT_MANAGER",
    "UI_DESIGN": "UI_DESIGN",
    "BACKEND": "BACKEND",
    "FRONTEND": "FRONTEND",
    "QA": "QA",
    "SECURITY": "SECURITY",
    "CI": "CI",
    "DOCS": "DOCUMENTATION",
    "VALIDATION": "VALIDATOR",
    "DONE": "DONE",
    # Accept DB-native values as passthrough
    "DOCUMENTATION": "DOCUMENTATION",
    "VALIDATOR": "VALIDATOR",
    # Aliases found in real ticket data
    "BLOCKED": "READY",
    "UIDESIGNER": "UI_DESIGN",
}

# Derive ticket status from stage.
STAGE_TO_STATUS: dict[str, str] = {
    "READY": "READY",
    "DONE": "DONE",
    "BLOCKED": "BLOCKED",
}

DEFAULT_DB_URL = "postgresql://forgeos:forgeos@localhost:5432/forgeos"


# ── Result Tracking ──────────────────────────────────────────────────


@dataclass
class SeedResult:
    """Tracks import statistics."""

    imported: int = 0
    skipped: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.imported + self.skipped + self.failed


# ── Validation ───────────────────────────────────────────────────────

REQUIRED_FIELDS = ("ticket_id", "title", "type", "priority", "stage", "sdlc_flow")


def validate_ticket(ticket: dict[str, Any]) -> list[str]:
    """Validate a ticket dict against required constraints.

    Returns a list of error messages. Empty list means valid.
    """
    errors: list[str] = []

    for fld in REQUIRED_FIELDS:
        if fld not in ticket:
            errors.append(f"Missing required field: {fld}")

    if errors:
        return errors

    if ticket["type"] not in VALID_TYPES:
        errors.append(
            f"Invalid type '{ticket['type']}'. "
            f"Must be one of: {sorted(VALID_TYPES)}"
        )

    if ticket["priority"] not in VALID_PRIORITIES:
        errors.append(
            f"Invalid priority '{ticket['priority']}'. "
            f"Must be one of: {sorted(VALID_PRIORITIES)}"
        )

    stage = ticket["stage"]
    if stage not in STAGE_JSON_TO_DB:
        errors.append(
            f"Invalid stage '{stage}'. "
            f"Must be one of: {sorted(VALID_STAGES_JSON)}"
        )

    sdlc_flow = ticket.get("sdlc_flow", [])
    if not isinstance(sdlc_flow, list) or len(sdlc_flow) < 3:
        errors.append("sdlc_flow must be an array with at least 3 stages")
    else:
        for s in sdlc_flow:
            if s not in STAGE_JSON_TO_DB:
                errors.append(f"Invalid stage in sdlc_flow: '{s}'")

    tid = ticket.get("ticket_id", "")
    if not isinstance(tid, str) or not tid:
        errors.append("ticket_id must be a non-empty string")

    return errors


# ── Ticket Transform ────────────────────────────────────────────────


def transform_ticket(ticket: dict[str, Any]) -> dict[str, Any]:
    """Transform a JSON ticket into DB-compatible column values."""
    stage_db = STAGE_JSON_TO_DB[ticket["stage"]]

    sdlc_flow_db = [
        STAGE_JSON_TO_DB[s] for s in ticket["sdlc_flow"]
    ]

    # Derive status from stage
    status = STAGE_TO_STATUS.get(ticket["stage"], "BLOCKED")
    if ticket.get("claimed_by"):
        status = "CLAIMED"

    # Build metadata from extra fields not in the main columns
    metadata: dict[str, Any] = {}
    if ticket.get("history"):
        metadata["history"] = ticket["history"]
    if ticket.get("source_task_file"):
        metadata["source_task_file_data"] = ticket["source_task_file"]

    return {
        "ticket_id": ticket["ticket_id"],
        "title": ticket["title"],
        "description": ticket.get("description", ""),
        "type": ticket["type"],
        "priority": ticket.get("priority", "medium"),
        "status": status,
        "stage": stage_db,
        "sdlc_flow": sdlc_flow_db,
        "depends_on": ticket.get("dependencies", []),
        "file_paths": ticket.get("file_paths", []),
        "acceptance_criteria": ticket.get("acceptance_criteria", []),
        "tags": ticket.get("tags", []),
        "rework_count": ticket.get("rework_count", 0),
        "metadata": json.dumps(metadata),
        "parent_id": ticket.get("parent_id"),
        "source_task_file": ticket.get("source_task_file"),
        "created_at": ticket.get("created_at"),
    }


# ── File Loading ─────────────────────────────────────────────────────


def load_tickets_from_directory(directory: str) -> list[dict[str, Any]]:
    """Load all .json ticket files from a directory."""
    pattern = os.path.join(directory, "*.json")
    files = sorted(glob.glob(pattern))

    if not files:
        logger.warning("No JSON files found in %s", directory)
        return []

    tickets: list[dict[str, Any]] = []
    for filepath in files:
        basename = os.path.basename(filepath)
        # Skip schema files
        if basename.startswith("ticket-schema"):
            continue
        try:
            with open(filepath, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                tickets.append(data)
            else:
                logger.warning(
                    "Skipping %s: root element is not an object", basename
                )
        except json.JSONDecodeError as exc:
            logger.warning("Skipping %s: invalid JSON — %s", basename, exc)

    return tickets


def load_tickets_from_file(filepath: str) -> list[dict[str, Any]]:
    """Load tickets from a single JSON file (array or object)."""
    with open(filepath, encoding="utf-8") as fh:
        data = json.load(fh)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]

    logger.error("Unexpected JSON structure in %s", filepath)
    return []


# ── Database Operations ──────────────────────────────────────────────

UPSERT_SQL = """
INSERT INTO tickets (
    ticket_id, title, description, type, priority,
    status, stage, sdlc_flow,
    depends_on, file_paths, acceptance_criteria, tags,
    rework_count, metadata, parent_id, source_task_file,
    created_at
) VALUES (
    %(ticket_id)s, %(title)s, %(description)s,
    %(type)s::ticket_type, %(priority)s::ticket_priority,
    %(status)s::ticket_status, %(stage)s::ticket_stage,
    %(sdlc_flow)s::ticket_stage[],
    %(depends_on)s, %(file_paths)s, %(acceptance_criteria)s, %(tags)s,
    %(rework_count)s, %(metadata)s::jsonb, %(parent_id)s, %(source_task_file)s,
    COALESCE(%(created_at)s::timestamptz, NOW())
)
ON CONFLICT (ticket_id) DO NOTHING
"""


def seed_tickets(
    database_url: str,
    tickets: list[dict[str, Any]],
    dry_run: bool = False,
) -> SeedResult:
    """Validate, transform, and insert tickets into PostgreSQL.

    Parameters
    ----------
    database_url : str
        PostgreSQL connection string.
    tickets : list[dict]
        Raw ticket dicts loaded from JSON.
    dry_run : bool
        If True, validate and transform but do not insert.

    Returns
    -------
    SeedResult
        Summary of import, skip, and failure counts.
    """
    result = SeedResult()

    # Phase 1: validate all tickets
    valid_tickets: list[dict[str, Any]] = []
    for ticket in tickets:
        tid = ticket.get("ticket_id", "<unknown>")
        errors = validate_ticket(ticket)
        if errors:
            result.failed += 1
            for err in errors:
                msg = f"{tid}: {err}"
                result.errors.append(msg)
                logger.error("Validation failed — %s", msg)
        else:
            valid_tickets.append(ticket)

    if dry_run:
        # In dry-run, count all valid as "would import"
        for ticket in valid_tickets:
            tid = ticket["ticket_id"]
            try:
                transform_ticket(ticket)
                result.imported += 1
                logger.info("[DRY-RUN] Would import: %s", tid)
            except (KeyError, ValueError) as exc:
                result.failed += 1
                msg = f"{tid}: transform error — {exc}"
                result.errors.append(msg)
                logger.error("Transform failed — %s", msg)
        return result

    # Phase 2: connect and insert
    conn = psycopg2.connect(database_url)
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            for ticket in valid_tickets:
                tid = ticket["ticket_id"]
                try:
                    row = transform_ticket(ticket)
                    cur.execute(UPSERT_SQL, row)
                    if cur.rowcount == 1:
                        result.imported += 1
                        logger.info("Imported: %s", tid)
                    else:
                        result.skipped += 1
                        logger.warning(
                            "Skipped (duplicate): %s", tid
                        )
                except psycopg2.Error as exc:
                    result.failed += 1
                    msg = f"{tid}: DB error — {exc.pgerror or exc}"
                    result.errors.append(msg)
                    logger.error("Insert failed — %s", msg)
                    conn.rollback()
                    # Re-open transaction for remaining tickets
                    continue

            conn.commit()
    except psycopg2.Error as exc:
        conn.rollback()
        logger.error("Database error: %s", exc)
        raise
    finally:
        conn.close()

    return result


# ── CLI ──────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Import ticket JSON files into the ForgeOS PostgreSQL database.",
        prog="seed",
    )
    parser.add_argument(
        "--source",
        default=None,
        help=(
            "Path to a JSON file (array of tickets) or directory of ticket JSONs. "
            "Defaults to .github/tickets/ in the repository root."
        ),
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help=(
            "PostgreSQL connection string. "
            "Defaults to DATABASE_URL env var or "
            f"{DEFAULT_DB_URL}"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and transform tickets without inserting into the database.",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable debug-level logging.",
    )
    return parser


def resolve_source(source: str | None) -> str:
    """Resolve the ticket source path, defaulting to .github/tickets/."""
    if source:
        return source

    # Walk up from the script location to find the repo root
    script_dir = Path(__file__).resolve().parent
    candidates = [
        script_dir.parent / ".github" / "tickets",
        Path.cwd() / ".github" / "tickets",
    ]
    for candidate in candidates:
        if candidate.is_dir():
            return str(candidate)

    sys.exit(
        "Could not find .github/tickets/ directory. "
        "Run from the repository root or specify --source."
    )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    source = resolve_source(args.source)
    db_url = args.database_url or os.environ.get("DATABASE_URL", DEFAULT_DB_URL)

    logger.info("Source: %s", source)
    if args.dry_run:
        logger.info("Mode: DRY-RUN (no database writes)")
    else:
        # Log DB host only, not credentials
        db_host = db_url.split("@")[-1].split("/")[0] if "@" in db_url else "localhost"
        logger.info("Target DB host: %s", db_host)

    # Load tickets
    source_path = Path(source)
    if source_path.is_dir():
        tickets = load_tickets_from_directory(str(source_path))
    elif source_path.is_file():
        tickets = load_tickets_from_file(str(source_path))
    else:
        logger.error("Source not found: %s", source)
        return 1

    if not tickets:
        logger.warning("No tickets to import.")
        return 0

    logger.info("Found %d ticket(s) to process", len(tickets))

    # Seed
    result = seed_tickets(db_url, tickets, dry_run=args.dry_run)

    # Report
    prefix = "[DRY-RUN] " if args.dry_run else ""
    logger.info(
        "%sSeed complete — imported: %d, skipped: %d, failed: %d (total: %d)",
        prefix,
        result.imported,
        result.skipped,
        result.failed,
        result.total,
    )

    if result.errors:
        logger.warning("Errors encountered:")
        for err in result.errors:
            logger.warning("  • %s", err)

    return 1 if result.failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
