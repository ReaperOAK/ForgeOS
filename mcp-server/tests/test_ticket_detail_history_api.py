"""Tests for ticket detail and history endpoints.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas, routes/tickets.py endpoints implemented
- REFACTOR: shared helpers, dependency resolution, pagination

Ticket: FORGEOS-BE035
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.tickets import (
    create_ticket_detail_endpoint,
    create_ticket_history_endpoint,
)
from mcp_server.api.schemas import (
    DependencyInfo,
    HistoryEntry,
    HistoryListResponse,
    PaginationMeta,
    TicketDetailResponse,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

NOW = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 3, 2, 12, 0, 0, tzinfo=timezone.utc)


@dataclass(frozen=True)
class FakeTicketRow:
    """Minimal stand-in for TicketRow used in unit tests."""

    ticket_id: str = "FORGEOS-BE035"
    title: str = "Test ticket"
    description: str = "A test ticket description"
    type: str = "backend"
    priority: str = "high"
    stage: str = "BACKEND"
    status: str = "IN_PROGRESS"
    sdlc_flow: list[str] = field(default_factory=lambda: ["READY", "BACKEND", "QA", "DONE"])
    claimed_by_name: str | None = "Backend"
    machine_id: str | None = "pop-os"
    operator: str | None = "ReaperOAK"
    lease_expiry: datetime | None = None
    depends_on: list[str] = field(default_factory=list)
    file_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    rework_count: int = 0
    source_task_file: str | None = None
    created_at: datetime = NOW
    updated_at: datetime = NOW
    completed_at: datetime | None = None


@dataclass(frozen=True)
class FakeEvent:
    """Minimal stand-in for Event used in unit tests."""

    event_type: str = "CREATED"
    agent_id: str = "Backend"
    machine_id: str = "pop-os"
    timestamp: datetime = NOW
    previous_stage: str | None = None
    new_stage: str | None = "READY"
    payload: dict[str, Any] = field(default_factory=dict)
    sequence_number: int = 1
    aggregate_version: int = 1


def _detail_app(repo: Any) -> Starlette:
    """Build a minimal Starlette app with the ticket detail endpoint."""
    handler = create_ticket_detail_endpoint(lambda: repo)
    return Starlette(
        routes=[Route("/api/tickets/{ticket_id}", handler, methods=["GET"])]
    )


def _history_app(repo: Any, event_store: Any) -> Starlette:
    """Build a minimal Starlette app with the ticket history endpoint."""
    handler = create_ticket_history_endpoint(lambda: repo, lambda: event_store)
    return Starlette(
        routes=[Route("/api/tickets/{ticket_id}/history", handler, methods=["GET"])]
    )


# ===========================================================================
# Schema tests
# ===========================================================================


class TestDependencyInfoSchema:
    """Verify DependencyInfo Pydantic model."""

    def test_minimal(self) -> None:
        d = DependencyInfo(ticket_id="FORGEOS-BE034")
        assert d.ticket_id == "FORGEOS-BE034"
        assert d.title is None
        assert d.stage is None
        assert d.is_done is False

    def test_done_dependency(self) -> None:
        d = DependencyInfo(
            ticket_id="FORGEOS-BE034",
            title="Ticket List",
            stage="DONE",
            is_done=True,
        )
        assert d.is_done is True
        assert d.stage == "DONE"


class TestTicketDetailResponseSchema:
    """Verify TicketDetailResponse Pydantic model."""

    def test_minimal_fields(self) -> None:
        r = TicketDetailResponse(
            ticket_id="T-001",
            title="Test",
            description="Desc",
            type="backend",
            priority="high",
            stage="READY",
            status="READY",
            created_at=NOW,
            updated_at=NOW,
        )
        assert r.ticket_id == "T-001"
        assert r.depends_on == []
        assert r.resolved_dependencies == []
        assert r.file_paths == []
        assert r.completed_at is None

    def test_full_fields(self) -> None:
        dep = DependencyInfo(
            ticket_id="DEP-001", title="Dep", stage="DONE", is_done=True
        )
        r = TicketDetailResponse(
            ticket_id="T-002",
            title="Full",
            description="Full desc",
            type="frontend",
            priority="low",
            stage="QA",
            status="IN_PROGRESS",
            sdlc_flow=["READY", "FRONTEND", "QA", "DONE"],
            claimed_by_name="Frontend",
            machine_id="pop-os",
            operator="ReaperOAK",
            depends_on=["DEP-001"],
            resolved_dependencies=[dep],
            file_paths=["src/app.ts"],
            acceptance_criteria=["AC-1"],
            tags=["api"],
            rework_count=1,
            source_task_file="TODO/task.md",
            created_at=NOW,
            updated_at=LATER,
            completed_at=LATER,
        )
        assert r.resolved_dependencies[0].is_done is True
        assert r.rework_count == 1

    def test_serialisation_roundtrip(self) -> None:
        r = TicketDetailResponse(
            ticket_id="T-003",
            title="RT",
            description="Round trip",
            type="backend",
            priority="medium",
            stage="BACKEND",
            status="IN_PROGRESS",
            created_at=NOW,
            updated_at=NOW,
        )
        data = r.model_dump(mode="json")
        assert data["ticket_id"] == "T-003"
        assert isinstance(data["created_at"], str)


class TestHistoryEntrySchema:
    """Verify HistoryEntry Pydantic model."""

    def test_minimal(self) -> None:
        e = HistoryEntry(
            event_type="CREATED",
            agent_id="TODO",
            machine_id="system",
            timestamp=NOW,
        )
        assert e.event_type == "CREATED"
        assert e.payload == {}
        assert e.previous_stage is None

    def test_full_fields(self) -> None:
        e = HistoryEntry(
            event_type="STAGE_ADVANCED",
            agent_id="Backend",
            machine_id="pop-os",
            timestamp=NOW,
            previous_stage="READY",
            new_stage="BACKEND",
            payload={"reason": "claimed"},
            sequence_number=5,
            aggregate_version=3,
        )
        assert e.new_stage == "BACKEND"
        assert e.aggregate_version == 3


class TestHistoryListResponseSchema:
    """Verify HistoryListResponse Pydantic model."""

    def test_empty(self) -> None:
        r = HistoryListResponse(
            ticket_id="T-001",
            events=[],
            pagination=PaginationMeta(total=0, limit=50, offset=0),
        )
        assert r.events == []
        assert r.pagination.total == 0

    def test_serialisation(self) -> None:
        entry = HistoryEntry(
            event_type="CREATED",
            agent_id="TODO",
            machine_id="system",
            timestamp=NOW,
        )
        r = HistoryListResponse(
            ticket_id="T-001",
            events=[entry],
            pagination=PaginationMeta(total=1, limit=50, offset=0),
        )
        data = r.model_dump(mode="json")
        assert data["ticket_id"] == "T-001"
        assert len(data["events"]) == 1


# ===========================================================================
# Detail endpoint tests
# ===========================================================================


class TestTicketDetailNoDb:
    """Detail endpoint returns 503 when database is unavailable."""

    def test_returns_503(self) -> None:
        app = _detail_app(None)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")
        assert resp.status_code == 503
        assert resp.json()["error"] == "Database unavailable"


class TestTicketDetailNotFound:
    """Detail endpoint returns 404 for non-existent ticket."""

    def test_returns_404(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = None

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/NONEXISTENT")

        assert resp.status_code == 404
        body = resp.json()
        assert "not found" in body["error"].lower()
        assert "NONEXISTENT" in body["error"]
        mock_repo.get_by_id.assert_called_once_with("NONEXISTENT")


class TestTicketDetailSuccess:
    """Detail endpoint returns full ticket detail."""

    def test_returns_ticket_detail(self) -> None:
        ticket = FakeTicketRow(
            depends_on=[],
            file_paths=["src/api.py"],
            acceptance_criteria=["AC-1", "AC-2"],
            tags=["backend", "api"],
        )
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = ticket

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 200
        body = resp.json()
        assert body["ticket_id"] == "FORGEOS-BE035"
        assert body["title"] == "Test ticket"
        assert body["description"] == "A test ticket description"
        assert body["type"] == "backend"
        assert body["priority"] == "high"
        assert body["stage"] == "BACKEND"
        assert body["claimed_by_name"] == "Backend"
        assert body["machine_id"] == "pop-os"
        assert body["file_paths"] == ["src/api.py"]
        assert body["acceptance_criteria"] == ["AC-1", "AC-2"]
        assert body["tags"] == ["backend", "api"]
        assert body["resolved_dependencies"] == []


class TestTicketDetailWithDependencies:
    """Detail endpoint resolves dependency statuses."""

    def test_resolves_done_dependency(self) -> None:
        dep_ticket = FakeTicketRow(
            ticket_id="FORGEOS-BE034",
            title="Ticket List",
            stage="DONE",
        )
        ticket = FakeTicketRow(depends_on=["FORGEOS-BE034"])

        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = (
            lambda tid: {
                "FORGEOS-BE035": ticket,
                "FORGEOS-BE034": dep_ticket,
            }.get(tid)
        )

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 200
        body = resp.json()
        deps = body["resolved_dependencies"]
        assert len(deps) == 1
        assert deps[0]["ticket_id"] == "FORGEOS-BE034"
        assert deps[0]["title"] == "Ticket List"
        assert deps[0]["stage"] == "DONE"
        assert deps[0]["is_done"] is True

    def test_resolves_pending_dependency(self) -> None:
        dep_ticket = FakeTicketRow(
            ticket_id="FORGEOS-BE012",
            title="Event Store",
            stage="BACKEND",
        )
        ticket = FakeTicketRow(depends_on=["FORGEOS-BE012"])

        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = (
            lambda tid: {
                "FORGEOS-BE035": ticket,
                "FORGEOS-BE012": dep_ticket,
            }.get(tid)
        )

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 200
        deps = resp.json()["resolved_dependencies"]
        assert len(deps) == 1
        assert deps[0]["is_done"] is False
        assert deps[0]["stage"] == "BACKEND"

    def test_resolves_missing_dependency(self) -> None:
        """Dependency ticket not found in DB — still listed with nulls."""
        ticket = FakeTicketRow(depends_on=["FORGEOS-GONE"])

        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = (
            lambda tid: ticket if tid == "FORGEOS-BE035" else None
        )

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 200
        deps = resp.json()["resolved_dependencies"]
        assert len(deps) == 1
        assert deps[0]["ticket_id"] == "FORGEOS-GONE"
        assert deps[0]["title"] is None
        assert deps[0]["is_done"] is False

    def test_multiple_dependencies_mixed(self) -> None:
        dep_done = FakeTicketRow(ticket_id="DEP-1", title="Done dep", stage="DONE")
        dep_pending = FakeTicketRow(ticket_id="DEP-2", title="Pending dep", stage="QA")
        ticket = FakeTicketRow(depends_on=["DEP-1", "DEP-2", "DEP-3"])

        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = lambda tid: {
            "FORGEOS-BE035": ticket,
            "DEP-1": dep_done,
            "DEP-2": dep_pending,
        }.get(tid)

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 200
        deps = resp.json()["resolved_dependencies"]
        assert len(deps) == 3
        assert deps[0]["is_done"] is True
        assert deps[1]["is_done"] is False
        assert deps[2]["title"] is None  # missing dep


class TestTicketDetailServerError:
    """Detail endpoint handles repo exceptions gracefully."""

    def test_returns_500_on_repo_error(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = RuntimeError("DB crashed")

        app = _detail_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Internal server error"


# ===========================================================================
# History endpoint tests
# ===========================================================================


class TestTicketHistoryNoDb:
    """History endpoint returns 503 when database is unavailable."""

    def test_returns_503_when_repo_none(self) -> None:
        app = _history_app(None, MagicMock())
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")
        assert resp.status_code == 503
        assert resp.json()["error"] == "Database unavailable"

    def test_returns_503_when_event_store_none(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()

        app = _history_app(mock_repo, None)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")
        assert resp.status_code == 503
        assert resp.json()["error"] == "Event store unavailable"


class TestTicketHistoryNotFound:
    """History endpoint returns 404 for non-existent ticket."""

    def test_returns_404(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = None
        mock_event_store = MagicMock()

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/NONEXISTENT/history")

        assert resp.status_code == 404
        body = resp.json()
        assert "not found" in body["error"].lower()
        assert "NONEXISTENT" in body["error"]


class TestTicketHistorySuccess:
    """History endpoint returns event history."""

    def test_returns_empty_history(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = []

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")

        assert resp.status_code == 200
        body = resp.json()
        assert body["ticket_id"] == "FORGEOS-BE035"
        assert body["events"] == []
        assert body["pagination"]["total"] == 0

    def test_returns_events(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()

        events = [
            FakeEvent(
                event_type="CREATED",
                agent_id="TODO",
                machine_id="system",
                timestamp=NOW,
                new_stage="READY",
                sequence_number=1,
                aggregate_version=1,
            ),
            FakeEvent(
                event_type="CLAIMED",
                agent_id="Backend",
                machine_id="pop-os",
                timestamp=LATER,
                previous_stage="READY",
                new_stage="BACKEND",
                sequence_number=2,
                aggregate_version=2,
            ),
        ]
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = events

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["events"]) == 2
        assert body["events"][0]["event_type"] == "CREATED"
        assert body["events"][0]["agent_id"] == "TODO"
        assert body["events"][1]["event_type"] == "CLAIMED"
        assert body["events"][1]["agent_id"] == "Backend"
        assert body["events"][1]["previous_stage"] == "READY"
        assert body["events"][1]["new_stage"] == "BACKEND"
        assert body["pagination"]["total"] == 2

        mock_event_store.replay_ticket_events.assert_called_once_with(
            "FORGEOS-BE035"
        )


class TestTicketHistoryPagination:
    """History endpoint supports offset/limit pagination."""

    def _make_events(self, count: int) -> list[FakeEvent]:
        return [
            FakeEvent(
                event_type="CREATED",
                sequence_number=i + 1,
                aggregate_version=i + 1,
            )
            for i in range(count)
        ]

    def test_default_pagination(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = self._make_events(3)

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["total"] == 3
        assert body["pagination"]["limit"] == 50
        assert body["pagination"]["offset"] == 0
        assert len(body["events"]) == 3

    def test_limit_and_offset(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = self._make_events(10)

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history?limit=3&offset=2")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["total"] == 10
        assert body["pagination"]["limit"] == 3
        assert body["pagination"]["offset"] == 2
        assert len(body["events"]) == 3

    def test_offset_beyond_total(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = self._make_events(5)

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history?offset=100")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["total"] == 5
        assert body["events"] == []

    def test_limit_capped_at_max(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = self._make_events(2)

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history?limit=999")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["limit"] == 200  # capped at _MAX_LIMIT

    def test_invalid_limit_uses_default(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.return_value = []

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history?limit=abc")

        assert resp.status_code == 200
        assert resp.json()["pagination"]["limit"] == 50


class TestTicketHistoryServerError:
    """History endpoint handles exceptions gracefully."""

    def test_returns_500_on_repo_error(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.side_effect = RuntimeError("DB down")
        mock_event_store = MagicMock()

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Internal server error"

    def test_returns_500_on_event_store_error(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_event_store = MagicMock()
        mock_event_store.replay_ticket_events.side_effect = RuntimeError("Store down")

        app = _history_app(mock_repo, mock_event_store)
        client = TestClient(app)
        resp = client.get("/api/tickets/FORGEOS-BE035/history")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Internal server error"
