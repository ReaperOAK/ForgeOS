"""Tests for GET /api/tickets — ticket list endpoint with filtering and pagination.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas.py, routes/tickets.py, repo.list_tickets implemented
- REFACTOR: validation enum extraction, shared _parse_int helper

Ticket: FORGEOS-BE034
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.tickets import create_tickets_endpoint
from mcp_server.api.schemas import (
    PaginationMeta,
    TicketListResponse,
    TicketPriorityEnum,
    TicketStageEnum,
    TicketSummary,
    TicketTypeEnum,
)

# ---------------------------------------------------------------------------
# Helpers — fake TicketRow for testing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FakeTicketRow:
    """Minimal stand-in for TicketRow used in unit tests."""

    ticket_id: str = "FORGEOS-BE001"
    title: str = "Test ticket"
    type: str = "backend"
    priority: str = "high"
    stage: str = "READY"
    status: str = "READY"
    claimed_by_name: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    rework_count: int = 0
    tags: list[str] | None = None
    created_at: datetime = datetime(2026, 1, 1, tzinfo=timezone.utc)
    updated_at: datetime = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __post_init__(self) -> None:
        if self.tags is None:
            object.__setattr__(self, "tags", [])


def _make_app(repo: Any) -> Starlette:
    """Build a minimal Starlette app with the tickets endpoint."""
    handler = create_tickets_endpoint(lambda: repo)
    return Starlette(routes=[Route("/api/tickets", handler, methods=["GET"])])


def _make_rows(count: int, **overrides: Any) -> list[FakeTicketRow]:
    """Create a list of fake ticket rows."""
    rows = []
    for i in range(count):
        kwargs: dict[str, Any] = {
            "ticket_id": f"FORGEOS-T{i:03d}",
            "title": f"Ticket {i}",
            **overrides,
        }
        rows.append(FakeTicketRow(**kwargs))
    return rows


# ---------------------------------------------------------------------------
# Schema tests
# ---------------------------------------------------------------------------


class TestTicketSummarySchema:
    """Verify TicketSummary Pydantic model."""

    def test_minimal_fields(self) -> None:
        s = TicketSummary(
            ticket_id="T-001",
            title="Test",
            type="backend",
            priority="high",
            stage="READY",
            status="READY",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        assert s.ticket_id == "T-001"
        assert s.claimed_by_name is None
        assert s.tags == []

    def test_all_fields(self) -> None:
        s = TicketSummary(
            ticket_id="T-002",
            title="Full",
            type="frontend",
            priority="low",
            stage="QA",
            status="IN_PROGRESS",
            claimed_by_name="Backend",
            machine_id="pop-os",
            operator="ReaperOAK",
            rework_count=1,
            tags=["api"],
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
        assert s.claimed_by_name == "Backend"
        assert s.rework_count == 1


class TestPaginationMetaSchema:
    """Verify PaginationMeta model."""

    def test_fields(self) -> None:
        p = PaginationMeta(total=100, limit=50, offset=0)
        assert p.total == 100
        assert p.limit == 50
        assert p.offset == 0


class TestTicketListResponseSchema:
    """Verify TicketListResponse model."""

    def test_empty_list(self) -> None:
        r = TicketListResponse(
            tickets=[],
            pagination=PaginationMeta(total=0, limit=50, offset=0),
        )
        assert r.tickets == []
        assert r.pagination.total == 0

    def test_serialisation(self) -> None:
        summary = TicketSummary(
            ticket_id="T-001",
            title="Test",
            type="backend",
            priority="high",
            stage="READY",
            status="READY",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        r = TicketListResponse(
            tickets=[summary],
            pagination=PaginationMeta(total=1, limit=50, offset=0),
        )
        data = r.model_dump(mode="json")
        assert len(data["tickets"]) == 1
        assert data["pagination"]["total"] == 1


class TestEnumValues:
    """Verify enum values match database schema."""

    def test_stage_enum_has_all_stages(self) -> None:
        expected = {
            "READY", "RESEARCH", "ARCHITECT", "PRODUCT_MANAGER",
            "UI_DESIGN", "BACKEND", "FRONTEND", "QA", "SECURITY",
            "CI", "DOCUMENTATION", "VALIDATOR", "DONE",
        }
        actual = {e.value for e in TicketStageEnum}
        assert actual == expected

    def test_type_enum_has_all_types(self) -> None:
        expected = {
            "backend", "frontend", "fullstack", "infra", "security",
            "docs", "research", "architecture", "product", "design",
        }
        actual = {e.value for e in TicketTypeEnum}
        assert actual == expected

    def test_priority_enum_has_all_priorities(self) -> None:
        expected = {"critical", "high", "medium", "low"}
        actual = {e.value for e in TicketPriorityEnum}
        assert actual == expected


# ---------------------------------------------------------------------------
# Endpoint tests — using Starlette TestClient + mock repo
# ---------------------------------------------------------------------------


class TestTicketsEndpointNoDb:
    """Endpoint returns 503 when database is unavailable."""

    def test_returns_503_when_repo_is_none(self) -> None:
        app = _make_app(None)
        client = TestClient(app)
        resp = client.get("/api/tickets")
        assert resp.status_code == 503
        assert resp.json()["error"] == "Database unavailable"


class TestTicketsEndpointEmptyFilter:
    """GET /api/tickets with no filters returns all tickets."""

    def test_returns_all_tickets(self) -> None:
        mock_repo = AsyncMock()
        rows = _make_rows(3)
        mock_repo.list_tickets.return_value = (rows, 3)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["tickets"]) == 3
        assert body["pagination"]["total"] == 3
        assert body["pagination"]["limit"] == 50
        assert body["pagination"]["offset"] == 0

        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type=None,
            priority=None,
            claimed_by=None,
            machine_id=None,
            limit=50,
            offset=0,
        )


class TestTicketsEndpointFiltering:
    """GET /api/tickets with query filters."""

    def test_filter_by_stage(self) -> None:
        mock_repo = AsyncMock()
        rows = _make_rows(1, stage="BACKEND")
        mock_repo.list_tickets.return_value = (rows, 1)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?stage=BACKEND")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage="BACKEND",
            ticket_type=None,
            priority=None,
            claimed_by=None,
            machine_id=None,
            limit=50,
            offset=0,
        )

    def test_filter_by_type(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?type=frontend")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type="frontend",
            priority=None,
            claimed_by=None,
            machine_id=None,
            limit=50,
            offset=0,
        )

    def test_filter_by_priority(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?priority=critical")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type=None,
            priority="critical",
            claimed_by=None,
            machine_id=None,
            limit=50,
            offset=0,
        )

    def test_filter_by_claimed_by(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?claimed_by=Backend")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type=None,
            priority=None,
            claimed_by="Backend",
            machine_id=None,
            limit=50,
            offset=0,
        )

    def test_filter_by_machine_id(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?machine_id=pop-os")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type=None,
            priority=None,
            claimed_by=None,
            machine_id="pop-os",
            limit=50,
            offset=0,
        )

    def test_multiple_filters(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?stage=QA&type=backend&priority=high")

        assert resp.status_code == 200
        mock_repo.list_tickets.assert_called_once_with(
            stage="QA",
            ticket_type="backend",
            priority="high",
            claimed_by=None,
            machine_id=None,
            limit=50,
            offset=0,
        )


class TestTicketsEndpointPagination:
    """GET /api/tickets pagination via limit/offset."""

    def test_custom_limit_and_offset(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?limit=10&offset=20")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["limit"] == 10
        assert body["pagination"]["offset"] == 20
        mock_repo.list_tickets.assert_called_once_with(
            stage=None,
            ticket_type=None,
            priority=None,
            claimed_by=None,
            machine_id=None,
            limit=10,
            offset=20,
        )

    def test_limit_capped_at_max(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?limit=999")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["limit"] == 200

    def test_negative_offset_becomes_zero(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?offset=-5")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["offset"] == 0

    def test_non_numeric_limit_uses_default(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.return_value = ([], 0)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?limit=abc")

        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["limit"] == 50

    def test_total_count_in_response(self) -> None:
        mock_repo = AsyncMock()
        rows = _make_rows(2)
        mock_repo.list_tickets.return_value = (rows, 100)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?limit=2&offset=0")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["tickets"]) == 2
        assert body["pagination"]["total"] == 100


class TestTicketsEndpointValidation:
    """Invalid filter values return 400 Bad Request."""

    def test_invalid_stage_returns_400(self) -> None:
        mock_repo = AsyncMock()
        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?stage=INVALID_STAGE")

        assert resp.status_code == 400
        assert "Invalid value for 'stage'" in resp.json()["error"]
        mock_repo.list_tickets.assert_not_called()

    def test_invalid_type_returns_400(self) -> None:
        mock_repo = AsyncMock()
        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?type=not_a_type")

        assert resp.status_code == 400
        assert "Invalid value for 'type'" in resp.json()["error"]

    def test_invalid_priority_returns_400(self) -> None:
        mock_repo = AsyncMock()
        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets?priority=urgent")

        assert resp.status_code == 400
        assert "Invalid value for 'priority'" in resp.json()["error"]


class TestTicketsEndpointErrorHandling:
    """Endpoint returns 500 on unexpected repo errors."""

    def test_repo_exception_returns_500(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.list_tickets.side_effect = RuntimeError("db fail")

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets")

        assert resp.status_code == 500
        assert resp.json()["error"] == "Internal server error"


class TestTicketsEndpointResponseShape:
    """Verify response body structure matches TicketListResponse schema."""

    def test_response_contains_expected_fields(self) -> None:
        mock_repo = AsyncMock()
        rows = _make_rows(1, stage="BACKEND", claimed_by_name="Backend", machine_id="pop-os")
        mock_repo.list_tickets.return_value = (rows, 1)

        app = _make_app(mock_repo)
        client = TestClient(app)
        resp = client.get("/api/tickets")

        assert resp.status_code == 200
        body = resp.json()

        ticket = body["tickets"][0]
        assert "ticket_id" in ticket
        assert "title" in ticket
        assert "type" in ticket
        assert "priority" in ticket
        assert "stage" in ticket
        assert "status" in ticket
        assert "claimed_by_name" in ticket
        assert "machine_id" in ticket
        assert "operator" in ticket
        assert "rework_count" in ticket
        assert "tags" in ticket
        assert "created_at" in ticket
        assert "updated_at" in ticket

        assert "pagination" in body
        assert "total" in body["pagination"]
        assert "limit" in body["pagination"]
        assert "offset" in body["pagination"]
