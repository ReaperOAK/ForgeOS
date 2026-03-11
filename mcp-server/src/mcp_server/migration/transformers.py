"""Transformers for converting filesystem ticket JSON to database schema.

Maps the file-based ticket format (JSON in ``.github/tickets/``) to the
PostgreSQL schema.  Handles field mapping, stage-name translation, status
inference, and history→event decomposition.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Stage mapping: filesystem directory name → DB ticket_stage enum
# ---------------------------------------------------------------------------

STAGE_DIR_TO_DB: dict[str, str] = {
    "READY": "READY",
    "ARCHITECT": "ARCHITECT",
    "RESEARCH": "RESEARCH",
    "BACKEND": "BACKEND",
    "FRONTEND": "FRONTEND",
    "QA": "QA",
    "SECURITY": "SECURITY",
    "CI": "CI",
    "DOCS": "DOCUMENTATION",
    "VALIDATION": "VALIDATOR",
    "DONE": "DONE",
}

DB_TO_STAGE_DIR: dict[str, str] = {v: k for k, v in STAGE_DIR_TO_DB.items()}

# Numeric order for resolving "most advanced" stage.
STAGE_ORDER: dict[str, int] = {
    "READY": 0,
    "RESEARCH": 1,
    "ARCHITECT": 2,
    "PRODUCT_MANAGER": 3,
    "UI_DESIGN": 4,
    "BACKEND": 5,
    "FRONTEND": 6,
    "QA": 7,
    "SECURITY": 8,
    "CI": 9,
    "DOCUMENTATION": 10,
    "VALIDATOR": 11,
    "DONE": 12,
}

# ---------------------------------------------------------------------------
# Event-type mapping: filesystem history "event" → DB event_type enum
# ---------------------------------------------------------------------------

EVENT_TYPE_MAP: dict[str, str] = {
    "CREATED": "CREATED",
    "CLAIMED": "CLAIMED",
    "RELEASED": "RELEASED",
    "MOVED_TO_READY": "UPDATED",
    "STAGE_ADVANCED": "STAGE_ADVANCED",
    "STAGE_REJECTED": "STAGE_REJECTED",
    "UPDATED": "UPDATED",
    "ESCALATED": "ESCALATED",
    "LEASE_EXTENDED": "LEASE_EXTENDED",
    "FORCE_RELEASED": "FORCE_RELEASED",
    "RECONCILED": "RECONCILED",
}

# ---------------------------------------------------------------------------
# Validation sets
# ---------------------------------------------------------------------------

VALID_TICKET_TYPES: frozenset[str] = frozenset({
    "backend", "frontend", "fullstack", "infra", "security",
    "docs", "research", "architecture", "product", "design",
})

VALID_PRIORITIES: frozenset[str] = frozenset({
    "critical", "high", "medium", "low",
})


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TransformedTicket:
    """Database-ready ticket record."""

    ticket_id: str
    title: str
    description: str | None
    ticket_type: str
    priority: str
    status: str
    stage: str
    sdlc_flow: list[str]
    claimed_by_name: str | None
    machine_id: str | None
    operator: str | None
    lease_expiry: str | None
    lease_duration_minutes: int
    depends_on: list[str]
    file_paths: list[str]
    acceptance_criteria: list[str]
    tags: list[str]
    rework_count: int
    metadata: dict[str, Any]
    source_task_file: str | None
    created_at: str


@dataclass(frozen=True)
class TransformedEvent:
    """Database-ready event record."""

    ticket_id: str
    event_type: str
    agent_name: str | None
    machine_id: str | None
    operator: str | None
    previous_stage: str | None
    new_stage: str | None
    payload: dict[str, Any]
    created_at: str


@dataclass
class TransformResult:
    """Result of transforming one ticket JSON file."""

    ticket: TransformedTicket
    events: list[TransformedEvent]
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class TransformError(Exception):
    """Raised when ticket data cannot be transformed to DB format."""

    def __init__(self, ticket_id: str, reason: str) -> None:
        self.ticket_id = ticket_id
        self.reason = reason
        super().__init__(f"Transform error [{ticket_id}]: {reason}")


# ---------------------------------------------------------------------------
# Transformer
# ---------------------------------------------------------------------------


class TicketTransformer:
    """Stateless transformer: raw ticket dict → DB-ready records."""

    def transform(
        self,
        raw: dict[str, Any],
        *,
        resolved_stage: str | None = None,
    ) -> TransformResult:
        """Transform a single ticket JSON dict to database format.

        Parameters
        ----------
        raw:
            Parsed ticket JSON dictionary.
        resolved_stage:
            If given, a **DB-enum** stage name that overrides the
            ``stage`` field in the JSON.  Typically produced by
            :meth:`resolve_stage`.

        Raises
        ------
        TransformError
            If required fields are missing or invalid.
        """
        self._validate(raw)
        ticket_id: str = raw["ticket_id"]
        warnings: list[str] = []

        # --- stage ---
        if resolved_stage is not None:
            db_stage = resolved_stage
        else:
            db_stage = self.map_stage(raw.get("stage", "READY"))

        # --- type ---
        ticket_type: str = raw["type"]
        if ticket_type not in VALID_TICKET_TYPES:
            warnings.append(
                f"Unknown ticket type '{ticket_type}',"
                " defaulting to 'backend'"
            )
            ticket_type = "backend"

        # --- priority ---
        priority: str = raw.get("priority", "medium")
        if priority not in VALID_PRIORITIES:
            warnings.append(
                f"Unknown priority '{priority}',"
                " defaulting to 'medium'"
            )
            priority = "medium"

        # --- sdlc_flow ---
        sdlc_flow = self.map_sdlc_flow(raw.get("sdlc_flow", []))

        # --- status ---
        status = self._infer_status(db_stage, raw.get("claimed_by"))

        # --- metadata (non-schema fields) ---
        metadata: dict[str, Any] = {}
        if raw.get("created_by"):
            metadata["created_by"] = raw["created_by"]
        if raw.get("blocked_by"):
            metadata["blocked_by"] = raw["blocked_by"]

        ticket = TransformedTicket(
            ticket_id=ticket_id,
            title=raw["title"],
            description=raw.get("description"),
            ticket_type=ticket_type,
            priority=priority,
            status=status,
            stage=db_stage,
            sdlc_flow=sdlc_flow,
            claimed_by_name=raw.get("claimed_by"),
            machine_id=raw.get("machine_id"),
            operator=raw.get("operator"),
            lease_expiry=raw.get("lease_expiry"),
            lease_duration_minutes=raw.get(
                "lease_duration_minutes", 30,
            ),
            depends_on=raw.get("dependencies", []),
            file_paths=raw.get("file_paths", []),
            acceptance_criteria=raw.get("acceptance_criteria", []),
            tags=raw.get("tags", []),
            rework_count=raw.get("rework_count", 0),
            metadata=metadata,
            source_task_file=raw.get("source_task_file"),
            created_at=raw.get("created_at", ""),
        )

        events = self._transform_events(
            ticket_id, raw.get("history", []),
        )
        return TransformResult(
            ticket=ticket, events=events, warnings=warnings,
        )

    # --- public helpers ---------------------------------------------------

    def resolve_stage(self, directory_names: list[str]) -> str:
        """Pick the most advanced stage from filesystem directory names.

        Returns a **DB-enum** stage name.
        """
        if not directory_names:
            return "READY"
        db_stages = [self.map_stage(d) for d in directory_names]
        return max(
            db_stages, key=lambda s: STAGE_ORDER.get(s, -1),
        )

    def map_stage(self, fs_name: str) -> str:
        """Map a filesystem directory / JSON stage name to DB enum."""
        upper = fs_name.upper()
        mapped = STAGE_DIR_TO_DB.get(upper)
        if mapped is not None:
            return mapped
        # Already a valid DB enum value?
        if upper in STAGE_ORDER:
            return upper
        return "READY"

    def map_sdlc_flow(self, flow: list[str]) -> list[str]:
        """Map a list of filesystem stage names to DB enum values."""
        return [self.map_stage(s) for s in flow]

    # --- private helpers --------------------------------------------------

    @staticmethod
    def _infer_status(
        db_stage: str, claimed_by: str | None,
    ) -> str:
        """Infer ticket_status from stage and claim state."""
        if db_stage == "DONE":
            return "DONE"
        if claimed_by:
            return "CLAIMED"
        return "READY"

    @staticmethod
    def _validate(raw: dict[str, Any]) -> None:
        """Ensure required fields exist in the raw ticket dict."""
        ticket_id = raw.get("ticket_id", "<unknown>")
        missing = [
            f for f in ("ticket_id", "title", "type")
            if not raw.get(f)
        ]
        if missing:
            raise TransformError(
                ticket_id,
                f"Missing required fields: {', '.join(missing)}",
            )

    def _transform_events(
        self,
        ticket_id: str,
        history: list[dict[str, Any]],
    ) -> list[TransformedEvent]:
        """Convert history array entries to DB event records."""
        events: list[TransformedEvent] = []
        skip_keys = {
            "timestamp", "event", "agent", "machine_id",
            "operator", "from_stage", "to_stage",
        }
        for entry in history:
            event_name = entry.get("event", "")
            db_event_type = EVENT_TYPE_MAP.get(
                event_name, "UPDATED",
            )

            payload: dict[str, Any] = {
                k: v for k, v in entry.items()
                if k not in skip_keys
            }

            prev = entry.get("from_stage")
            new = entry.get("to_stage")

            events.append(TransformedEvent(
                ticket_id=ticket_id,
                event_type=db_event_type,
                agent_name=entry.get("agent"),
                machine_id=entry.get("machine_id"),
                operator=entry.get("operator"),
                previous_stage=(
                    self.map_stage(prev) if prev else None
                ),
                new_stage=(
                    self.map_stage(new) if new else None
                ),
                payload=payload,
                created_at=entry.get("timestamp", ""),
            ))
        return events
