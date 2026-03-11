"""Tests for POST/DELETE /api/tickets/{ticket_id}/claim — claim/release endpoints.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas + route handler implemented to pass all tests
- REFACTOR: error mapping, validation consolidation

Ticket: FORGEOS-BE036
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.tickets import create_claim_endpoint
from mcp_server.api.schemas import ClaimRequest, ClaimResponse, ReleaseResponse
from mcp_server.locking.claim_queue import ClaimError, NoEligibleTicketError
from mcp_server.server import TicketNotFoundError
from mcp_server.services.ticket_service import ClaimOwnershipError

# ---------------------------------------------------------------------------
# Helpers
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
    created_at: datetime = datetime(2026, 1, 1, tzinfo=timezone.utc)
    updated_at: datetime = datetime(2026, 1, 1, tzinfo=timezone.utc)


@dataclass(frozen=True)
class FakeClaimResult:
    """Minimal stand-in for NextTicketResult."""

    ticket_id: str = "FORGEOS-BE001"
    title: str = "Test ticket"
    ticket_type: str = "backend"
    stage: str = "BACKEND"
    file_paths: list[str] | None = None
    acceptance_criteria: list[str] | None = None

    def __post_init__(self) -> None:
        if self.file_paths is None:
            object.__setattr__(self, "file_paths", [])
        if self.acceptance_criteria is None:
            object.__setattr__(self, "acceptance_criteria", [])

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "type": self.ticket_type,
            "stage": self.stage,
            "file_paths": self.file_paths,
            "acceptance_criteria": self.acceptance_criteria,
        }


@dataclass(frozen=True)
class FakeReleaseResult:
    """Minimal stand-in for ReleaseResult."""

    ticket_id: str = "FORGEOS-BE001"
    previous_stage: str = "BACKEND"
    released_by: str = "Backend"
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "previous_stage": self.previous_stage,
            "released_by": self.released_by,
            "reason": self.reason,
        }


def _make_app(
    ticket_service: Any = None,
    ticket_repo: Any = None,
) -> Starlette:
    """Build a minimal Starlette app with the claim endpoint."""
    handler = create_claim_endpoint(
        lambda: ticket_service,
        lambda: ticket_repo,
    )
    return Starlette(
        routes=[
            Route(
                "/api/tickets/{ticket_id}/claim",
                handler,
                methods=["POST", "DELETE"],
            ),
        ],
    )


# ---------------------------------------------------------------------------
# Schema tests
# ---------------------------------------------------------------------------


class TestClaimRequestSchema:
    """Verify ClaimRequest Pydantic model."""

    def test_required_fields(self) -> None:
        req = ClaimRequest(
            agent_id="Backend",
            machine_id="pop-os",
            operator="ReaperOAK",
        )
        assert req.agent_id == "Backend"
        assert req.machine_id == "pop-os"
        assert req.operator == "ReaperOAK"
        assert req.lease_duration_minutes == 30

    def test_custom_lease_duration(self) -> None:
        req = ClaimRequest(
            agent_id="QA",
            machine_id="dev-box",
            operator="dev1",
            lease_duration_minutes=60,
        )
        assert req.lease_duration_minutes == 60


class TestClaimResponseSchema:
    """Verify ClaimResponse Pydantic model."""

    def test_has_required_fields(self) -> None:
        resp = ClaimResponse(
            ticket_id="FORGEOS-BE001",
            title="Test",
            type="backend",
            stage="BACKEND",
            file_paths=["src/foo.py"],
            acceptance_criteria=["AC1"],
        )
        assert resp.ticket_id == "FORGEOS-BE001"
        assert resp.stage == "BACKEND"


class TestReleaseResponseSchema:
    """Verify ReleaseResponse Pydantic model."""

    def test_has_required_fields(self) -> None:
        resp = ReleaseResponse(
            ticket_id="FORGEOS-BE001",
            previous_stage="BACKEND",
            released_by="Backend",
            reason="done",
        )
        assert resp.ticket_id == "FORGEOS-BE001"


# ---------------------------------------------------------------------------
# POST /api/tickets/{ticket_id}/claim — success
# ---------------------------------------------------------------------------


class TestClaimEndpointSuccess:
    """POST /api/tickets/{ticket_id}/claim with valid data."""

    def test_returns_200_with_claim_details(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_service.claim_by_id.return_value = FakeClaimResult()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["ticket_id"] == "FORGEOS-BE001"
        assert body["stage"] == "BACKEND"

        mock_service.claim_by_id.assert_called_once_with(
            ticket_id="FORGEOS-BE001",
            agent_role="Backend",
            machine_id="pop-os",
            operator="ReaperOAK",
            lease_minutes=30,
        )

    def test_custom_lease_duration(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_service.claim_by_id.return_value = FakeClaimResult()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
                "lease_duration_minutes": 60,
            },
        )

        assert resp.status_code == 200
        mock_service.claim_by_id.assert_called_once_with(
            ticket_id="FORGEOS-BE001",
            agent_role="Backend",
            machine_id="pop-os",
            operator="ReaperOAK",
            lease_minutes=60,
        )


# ---------------------------------------------------------------------------
# POST /api/tickets/{ticket_id}/claim — error cases
# ---------------------------------------------------------------------------


class TestClaimEndpoint404:
    """POST /api/tickets/{ticket_id}/claim → 404 when ticket doesn't exist."""

    def test_returns_404_when_ticket_not_found(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = None

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-NOPE/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 404
        assert "not found" in resp.json()["error"].lower()
        mock_service.claim_by_id.assert_not_called()


class TestClaimEndpoint409:
    """POST /api/tickets/{ticket_id}/claim → 409 when already claimed."""

    def test_returns_409_when_not_eligible(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow(
            stage="BACKEND",
            claimed_by_name="OtherAgent",
        )
        mock_service.claim_by_id.side_effect = NoEligibleTicketError(
            "Ticket 'FORGEOS-BE001' is not claimable"
        )

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 409
        assert "not claimable" in resp.json()["error"].lower()

    def test_returns_409_on_claim_error(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_service.claim_by_id.side_effect = ClaimError(
            "File conflict on ticket"
        )

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 409
        assert "error" in resp.json()


class TestClaimEndpoint400:
    """POST /api/tickets/{ticket_id}/claim → 400 on bad input."""

    def test_returns_400_on_missing_body_fields(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={"agent_id": "Backend"},
        )

        assert resp.status_code == 400
        assert "error" in resp.json()

    def test_returns_400_on_empty_body(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            content=b"",
            headers={"content-type": "application/json"},
        )

        assert resp.status_code == 400

    def test_returns_400_on_unknown_agent_role(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_repo.get_by_id.return_value = FakeTicketRow()
        mock_service.claim_by_id.side_effect = ValueError(
            "Unknown agent role: FakeAgent"
        )

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "FakeAgent",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 400
        assert "error" in resp.json()


class TestClaimEndpoint503:
    """POST /api/tickets/{ticket_id}/claim → 503 when service unavailable."""

    def test_returns_503_when_service_is_none(self) -> None:
        app = _make_app(None, None)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE001/claim",
            json={
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

        assert resp.status_code == 503
        assert resp.json()["error"] == "Service unavailable"


# ---------------------------------------------------------------------------
# DELETE /api/tickets/{ticket_id}/claim — success
# ---------------------------------------------------------------------------


class TestReleaseEndpointSuccess:
    """DELETE /api/tickets/{ticket_id}/claim releases a claim."""

    def test_returns_200_on_successful_release(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_service.release_ticket.return_value = FakeReleaseResult()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.delete(
            "/api/tickets/FORGEOS-BE001/claim?agent_id=Backend",
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["ticket_id"] == "FORGEOS-BE001"
        assert body["released_by"] == "Backend"

        mock_service.release_ticket.assert_called_once_with(
            ticket_id="FORGEOS-BE001",
            agent_id="Backend",
            reason="",
        )

    def test_release_with_reason(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_service.release_ticket.return_value = FakeReleaseResult(reason="rework")

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.delete(
            "/api/tickets/FORGEOS-BE001/claim?agent_id=Backend&reason=rework",
        )

        assert resp.status_code == 200
        mock_service.release_ticket.assert_called_once_with(
            ticket_id="FORGEOS-BE001",
            agent_id="Backend",
            reason="rework",
        )


# ---------------------------------------------------------------------------
# DELETE /api/tickets/{ticket_id}/claim — error cases
# ---------------------------------------------------------------------------


class TestReleaseEndpoint400:
    """DELETE /api/tickets/{ticket_id}/claim → 400 when agent_id missing."""

    def test_returns_400_when_agent_id_missing(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.delete("/api/tickets/FORGEOS-BE001/claim")

        assert resp.status_code == 400
        assert "agent_id" in resp.json()["error"].lower()


class TestReleaseEndpoint404:
    """DELETE /api/tickets/{ticket_id}/claim → 404 when ticket missing."""

    def test_returns_404_when_ticket_not_found(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_service.release_ticket.side_effect = TicketNotFoundError(
            "Ticket 'FORGEOS-NOPE' not found"
        )

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.delete(
            "/api/tickets/FORGEOS-NOPE/claim?agent_id=Backend",
        )

        assert resp.status_code == 404
        assert "not found" in resp.json()["error"].lower()


class TestReleaseEndpoint409:
    """DELETE /api/tickets/{ticket_id}/claim → 409 when not owned."""

    def test_returns_409_when_not_claim_owner(self) -> None:
        mock_service = AsyncMock()
        mock_repo = AsyncMock()
        mock_service.release_ticket.side_effect = ClaimOwnershipError(
            "Agent 'Backend' does not own the claim"
        )

        app = _make_app(mock_service, mock_repo)
        client = TestClient(app)
        resp = client.delete(
            "/api/tickets/FORGEOS-BE001/claim?agent_id=Backend",
        )

        assert resp.status_code == 409
        assert "error" in resp.json()


class TestReleaseEndpoint503:
    """DELETE /api/tickets/{ticket_id}/claim → 503 when service unavailable."""

    def test_returns_503_when_service_is_none(self) -> None:
        app = _make_app(None, None)
        client = TestClient(app)
        resp = client.delete(
            "/api/tickets/FORGEOS-BE001/claim?agent_id=Backend",
        )

        assert resp.status_code == 503
        assert resp.json()["error"] == "Service unavailable"
