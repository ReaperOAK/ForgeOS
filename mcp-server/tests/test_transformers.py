"""Tests for mcp_server.migration.transformers."""

from __future__ import annotations

from typing import Any

import pytest

from mcp_server.migration.transformers import (
    DB_TO_STAGE_DIR,
    EVENT_TYPE_MAP,
    STAGE_DIR_TO_DB,
    STAGE_ORDER,
    VALID_PRIORITIES,
    VALID_TICKET_TYPES,
    TicketTransformer,
    TransformError,
    TransformResult,
)

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def transformer() -> TicketTransformer:
    return TicketTransformer()


def _minimal_ticket(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ticket_id": "TEST-001",
        "title": "Test ticket",
        "type": "backend",
    }
    base.update(overrides)
    return base


def _full_ticket(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE070",
        "title": "Implement Filesystem-to-Database Data Import",
        "description": "Full description here",
        "type": "backend",
        "priority": "critical",
        "stage": "BACKEND",
        "sdlc_flow": [
            "READY", "BACKEND", "QA", "SECURITY",
            "CI", "DOCS", "VALIDATION", "DONE",
        ],
        "created_at": "2026-03-05T18:13:46.600379+00:00",
        "created_by": "TODO",
        "dependencies": ["FORGEOS-BE068"],
        "blocked_by": [],
        "file_paths": ["mcp-server/src/migration/importer.py"],
        "acceptance_criteria": ["AC-1", "AC-2"],
        "rework_count": 0,
        "claimed_by": "Backend",
        "machine_id": "pop-os",
        "operator": "ReaperOAK",
        "lease_expiry": "2026-03-11T03:37:11.607990+00:00",
        "lease_duration_minutes": 30,
        "tags": ["backend", "migration"],
        "source_task_file": "TODO/tasks/phase4-migration.md",
        "history": [
            {
                "timestamp": "2026-03-05T18:13:46Z",
                "event": "CREATED",
                "agent": "TODO",
                "machine_id": "system",
                "details": "Ticket created",
            },
            {
                "timestamp": "2026-03-11T03:07:11Z",
                "event": "CLAIMED",
                "agent": "Backend",
                "machine_id": "pop-os",
                "from_stage": "READY",
                "to_stage": "READY",
                "details": "Claimed by ReaperOAK",
            },
        ],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


class TestConstants:
    def test_stage_dir_to_db_has_all_fs_stages(self) -> None:
        expected = {
            "READY", "ARCHITECT", "RESEARCH", "BACKEND",
            "FRONTEND", "QA", "SECURITY", "CI",
            "DOCS", "VALIDATION", "DONE",
        }
        assert set(STAGE_DIR_TO_DB.keys()) == expected

    def test_db_to_stage_dir_roundtrip(self) -> None:
        for fs, db in STAGE_DIR_TO_DB.items():
            assert DB_TO_STAGE_DIR[db] == fs

    def test_stage_order_covers_all_db_stages(self) -> None:
        db_stages = set(STAGE_DIR_TO_DB.values())
        assert db_stages.issubset(set(STAGE_ORDER.keys()))

    def test_stage_order_is_monotonic(self) -> None:
        values = list(STAGE_ORDER.values())
        assert values == sorted(values)

    def test_valid_ticket_types_count(self) -> None:
        assert "backend" in VALID_TICKET_TYPES
        assert "frontend" in VALID_TICKET_TYPES
        assert len(VALID_TICKET_TYPES) == 10

    def test_valid_priorities(self) -> None:
        assert {
            "critical", "high", "medium", "low",
        } == VALID_PRIORITIES


# ---------------------------------------------------------------------------
# TicketTransformer.map_stage
# ---------------------------------------------------------------------------


class TestMapStage:
    def test_known_filesystem_stages(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.map_stage("BACKEND") == "BACKEND"
        assert transformer.map_stage("DOCS") == "DOCUMENTATION"
        assert transformer.map_stage("VALIDATION") == "VALIDATOR"
        assert transformer.map_stage("DONE") == "DONE"

    def test_case_insensitive(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.map_stage("backend") == "BACKEND"
        assert transformer.map_stage("docs") == "DOCUMENTATION"

    def test_already_db_name(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.map_stage("DOCUMENTATION") == "DOCUMENTATION"
        assert transformer.map_stage("VALIDATOR") == "VALIDATOR"

    def test_unknown_defaults_to_ready(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.map_stage("NONEXISTENT") == "READY"


# ---------------------------------------------------------------------------
# TicketTransformer.map_sdlc_flow
# ---------------------------------------------------------------------------


class TestMapSdlcFlow:
    def test_maps_full_flow(
        self, transformer: TicketTransformer,
    ) -> None:
        flow = [
            "READY", "BACKEND", "QA", "SECURITY",
            "CI", "DOCS", "VALIDATION", "DONE",
        ]
        result = transformer.map_sdlc_flow(flow)
        assert result == [
            "READY", "BACKEND", "QA", "SECURITY",
            "CI", "DOCUMENTATION", "VALIDATOR", "DONE",
        ]

    def test_empty_flow(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.map_sdlc_flow([]) == []


# ---------------------------------------------------------------------------
# TicketTransformer.resolve_stage
# ---------------------------------------------------------------------------


class TestResolveStage:
    def test_single_stage(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.resolve_stage(["BACKEND"]) == "BACKEND"

    def test_picks_most_advanced(
        self, transformer: TicketTransformer,
    ) -> None:
        assert (
            transformer.resolve_stage(["READY", "BACKEND"])
            == "BACKEND"
        )
        assert (
            transformer.resolve_stage(["QA", "BACKEND"]) == "QA"
        )
        assert (
            transformer.resolve_stage(["DOCS", "CI"])
            == "DOCUMENTATION"
        )

    def test_empty_defaults_to_ready(
        self, transformer: TicketTransformer,
    ) -> None:
        assert transformer.resolve_stage([]) == "READY"

    def test_done_wins_over_all(
        self, transformer: TicketTransformer,
    ) -> None:
        assert (
            transformer.resolve_stage(
                ["READY", "BACKEND", "DONE"],
            )
            == "DONE"
        )


# ---------------------------------------------------------------------------
# Status inference
# ---------------------------------------------------------------------------


class TestInferStatus:
    def test_done_stage(self) -> None:
        assert (
            TicketTransformer._infer_status("DONE", None) == "DONE"
        )
        assert (
            TicketTransformer._infer_status("DONE", "Backend")
            == "DONE"
        )

    def test_claimed(self) -> None:
        assert (
            TicketTransformer._infer_status("BACKEND", "Backend")
            == "CLAIMED"
        )

    def test_unclaimed_ready(self) -> None:
        assert (
            TicketTransformer._infer_status("READY", None)
            == "READY"
        )
        assert (
            TicketTransformer._infer_status("QA", None)
            == "READY"
        )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidate:
    def test_valid_minimal(
        self, transformer: TicketTransformer,
    ) -> None:
        transformer._validate(_minimal_ticket())

    def test_missing_ticket_id(
        self, transformer: TicketTransformer,
    ) -> None:
        with pytest.raises(TransformError, match="ticket_id"):
            transformer._validate(
                {"title": "X", "type": "backend"},
            )

    def test_missing_title(
        self, transformer: TicketTransformer,
    ) -> None:
        with pytest.raises(TransformError, match="title"):
            transformer._validate(
                {"ticket_id": "T-1", "type": "backend"},
            )

    def test_missing_type(
        self, transformer: TicketTransformer,
    ) -> None:
        with pytest.raises(TransformError, match="type"):
            transformer._validate(
                {"ticket_id": "T-1", "title": "X"},
            )


# ---------------------------------------------------------------------------
# Full transform
# ---------------------------------------------------------------------------


class TestTransformTicket:
    def test_minimal_ticket(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_minimal_ticket())
        assert isinstance(result, TransformResult)
        assert result.ticket.ticket_id == "TEST-001"
        assert result.ticket.title == "Test ticket"
        assert result.ticket.ticket_type == "backend"
        assert result.ticket.stage == "READY"
        assert result.ticket.status == "READY"
        assert result.ticket.priority == "medium"

    def test_full_ticket_fields(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        t = result.ticket
        assert t.ticket_id == "FORGEOS-BE070"
        assert t.ticket_type == "backend"
        assert t.priority == "critical"
        assert t.stage == "BACKEND"
        assert t.status == "CLAIMED"
        assert t.claimed_by_name == "Backend"
        assert t.machine_id == "pop-os"
        assert t.operator == "ReaperOAK"
        assert t.depends_on == ["FORGEOS-BE068"]
        assert t.tags == ["backend", "migration"]
        assert t.rework_count == 0
        assert t.source_task_file == "TODO/tasks/phase4-migration.md"

    def test_sdlc_flow_mapped(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        flow = result.ticket.sdlc_flow
        assert "DOCUMENTATION" in flow
        assert "VALIDATOR" in flow
        assert "DOCS" not in flow
        assert "VALIDATION" not in flow

    def test_resolved_stage_overrides_json(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(
            _full_ticket(stage="READY"),
            resolved_stage="QA",
        )
        assert result.ticket.stage == "QA"

    def test_unknown_type_warns_and_defaults(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(
            _minimal_ticket(type="bogus"),
        )
        assert result.ticket.ticket_type == "backend"
        assert any("bogus" in w for w in result.warnings)

    def test_unknown_priority_warns_and_defaults(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(
            _minimal_ticket(priority="urgent"),
        )
        assert result.ticket.priority == "medium"
        assert any("urgent" in w for w in result.warnings)

    def test_metadata_captures_extra_fields(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(
            _minimal_ticket(
                created_by="TODO", blocked_by=["X"],
            ),
        )
        assert result.ticket.metadata["created_by"] == "TODO"
        assert result.ticket.metadata["blocked_by"] == ["X"]

    def test_missing_required_raises(
        self, transformer: TicketTransformer,
    ) -> None:
        with pytest.raises(TransformError):
            transformer.transform({"title": "X"})


# ---------------------------------------------------------------------------
# Event transformation
# ---------------------------------------------------------------------------


class TestTransformEvents:
    def test_events_from_history(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        assert len(result.events) == 2

    def test_event_type_mapping(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        assert result.events[0].event_type == "CREATED"
        assert result.events[1].event_type == "CLAIMED"

    def test_event_agent_and_machine(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        assert result.events[0].agent_name == "TODO"
        assert result.events[0].machine_id == "system"

    def test_event_stage_mapping(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        claimed = result.events[1]
        assert claimed.previous_stage == "READY"
        assert claimed.new_stage == "READY"

    def test_event_payload_captures_details(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        payload = result.events[0].payload
        assert payload["details"] == "Ticket created"

    def test_event_payload_excludes_standard_keys(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        for event in result.events:
            for key in (
                "timestamp", "event", "agent", "machine_id",
            ):
                assert key not in event.payload

    def test_unknown_event_defaults_to_updated(
        self, transformer: TicketTransformer,
    ) -> None:
        raw = _minimal_ticket(
            history=[{
                "timestamp": "2026-01-01T00:00:00Z",
                "event": "UNKNOWN_EVENT",
            }],
        )
        result = transformer.transform(raw)
        assert result.events[0].event_type == "UPDATED"

    def test_empty_history(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_minimal_ticket())
        assert result.events == []

    def test_event_type_map_coverage(self) -> None:
        for fs_event, db_event in EVENT_TYPE_MAP.items():
            assert isinstance(fs_event, str)
            assert isinstance(db_event, str)


# ---------------------------------------------------------------------------
# Frozen dataclass behaviour
# ---------------------------------------------------------------------------


class TestFrozenDataclasses:
    def test_ticket_frozen(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_minimal_ticket())
        with pytest.raises(AttributeError):
            result.ticket.ticket_id = "X"  # type: ignore[misc]

    def test_event_frozen(
        self, transformer: TicketTransformer,
    ) -> None:
        result = transformer.transform(_full_ticket())
        with pytest.raises(AttributeError):
            result.events[0].event_type = "X"  # type: ignore[misc]
