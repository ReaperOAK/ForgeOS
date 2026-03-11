"""Tests for POST /api/tickets/{id}/advance and POST /api/tickets/{id}/rework.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas + route handler implemented to pass all tests
- REFACTOR: consistent error mapping, schema validation

Ticket: FORGEOS-BE037
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.schemas import (
    AdvanceRequest,
    AdvanceResponse,
    ReworkRequest,
    ReworkResponse,
)
from mcp_server.server import TicketNotFoundError
from mcp_server.services.stage_engine import InvalidTransitionError
from mcp_server.services.ticket_service import (
    AdvanceTicketResult,
    ClaimValidationError,
    ReworkResult,
)

# ---------------------------------------------------------------------------
# Fake result helpers
# ---------------------------------------------------------------------------


def _advance_result(**overrides: Any) -> AdvanceTicketResult:
    defaults: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "title": "Test ticket",
        "ticket_type": "backend",
        "previous_stage": "BACKEND",
        "new_stage": "QA",
        "status": "READY",
    }
    defaults.update(overrides)
    return AdvanceTicketResult(**defaults)


def _rework_result(**overrides: Any) -> ReworkResult:
    defaults: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "title": "Test ticket",
        "ticket_type": "backend",
        "previous_stage": "QA",
        "new_stage": "BACKEND",
        "rework_count": 1,
        "escalated": False,
    }
    defaults.update(overrides)
    return ReworkResult(**defaults)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def _make_app(
    ticket_service: Any = None,
) -> Starlette:
    """Build a minimal Starlette app with advance and rework endpoints."""
    from mcp_server.api.routes.tickets import (
        create_advance_endpoint,
        create_rework_endpoint,
    )

    advance_handler = create_advance_endpoint(lambda: ticket_service)
    rework_handler = create_rework_endpoint(lambda: ticket_service)
    return Starlette(
        routes=[
            Route(
                "/api/tickets/{ticket_id}/advance",
                advance_handler,
                methods=["POST"],
            ),
            Route(
                "/api/tickets/{ticket_id}/rework",
                rework_handler,
                methods=["POST"],
            ),
        ],
    )


# ===========================================================================
# Schema tests
# ===========================================================================


class TestAdvanceRequestSchema:
    """Verify AdvanceRequest Pydantic model."""

    def test_required_fields(self) -> None:
        req = AdvanceRequest(agent_id="Backend")
        assert req.agent_id == "Backend"
        assert req.evidence is None

    def test_with_evidence(self) -> None:
        req = AdvanceRequest(
            agent_id="Backend",
            evidence={"coverage": 92, "artifacts": ["src/foo.py"]},
        )
        assert req.evidence["coverage"] == 92


class TestAdvanceResponseSchema:
    """Verify AdvanceResponse Pydantic model."""

    def test_has_required_fields(self) -> None:
        resp = AdvanceResponse(
            ticket_id="FORGEOS-BE099",
            title="Test",
            type="backend",
            previous_stage="BACKEND",
            new_stage="QA",
            status="READY",
        )
        assert resp.ticket_id == "FORGEOS-BE099"
        assert resp.previous_stage == "BACKEND"
        assert resp.new_stage == "QA"


class TestReworkRequestSchema:
    """Verify ReworkRequest Pydantic model."""

    def test_required_fields(self) -> None:
        req = ReworkRequest(agent_id="QA", reason="Tests failing")
        assert req.agent_id == "QA"
        assert req.reason == "Tests failing"
        assert req.rejection_evidence is None

    def test_with_evidence(self) -> None:
        req = ReworkRequest(
            agent_id="QA",
            reason="Coverage below threshold",
            rejection_evidence={"coverage": 40},
        )
        assert req.rejection_evidence == {"coverage": 40}


class TestReworkResponseSchema:
    """Verify ReworkResponse Pydantic model."""

    def test_has_required_fields(self) -> None:
        resp = ReworkResponse(
            ticket_id="FORGEOS-BE099",
            title="Test",
            type="backend",
            previous_stage="QA",
            new_stage="BACKEND",
            rework_count=1,
            escalated=False,
        )
        assert resp.ticket_id == "FORGEOS-BE099"
        assert resp.rework_count == 1
        assert resp.escalated is False


# ===========================================================================
# POST /api/tickets/{ticket_id}/advance — success
# ===========================================================================


class TestAdvanceEndpointSuccess:
    """POST /api/tickets/{ticket_id}/advance with valid data."""

    def test_returns_200_with_stage_transition(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.return_value = _advance_result()

        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["ticket_id"] == "FORGEOS-BE099"
        assert data["previous_stage"] == "BACKEND"
        assert data["new_stage"] == "QA"
        assert data["status"] == "READY"

    def test_passes_evidence_to_service(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.return_value = _advance_result()

        app = _make_app(mock_service)
        client = TestClient(app)
        evidence = {"coverage": 95}
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend", "evidence": evidence},
        )

        assert resp.status_code == 200
        mock_service.advance_ticket.assert_called_once_with(
            ticket_id="FORGEOS-BE099",
            agent_id="Backend",
            evidence=evidence,
        )


# ===========================================================================
# POST /api/tickets/{ticket_id}/advance — error cases
# ===========================================================================


class TestAdvanceEndpointErrors:
    """POST /api/tickets/{ticket_id}/advance — error paths."""

    def test_returns_503_when_service_unavailable(self) -> None:
        app = _make_app(ticket_service=None)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )
        assert resp.status_code == 503

    def test_returns_400_for_missing_json(self) -> None:
        mock_service = AsyncMock()
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            content=b"not json",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400

    def test_returns_400_for_missing_agent_id(self) -> None:
        mock_service = AsyncMock()
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={},
        )
        assert resp.status_code == 400

    def test_returns_404_when_ticket_not_found(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.side_effect = TicketNotFoundError("not found")
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )
        assert resp.status_code == 404

    def test_returns_409_when_agent_mismatch(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.side_effect = ClaimValidationError(
            "FORGEOS-BE099", "Backend", "claimed by another agent"
        )
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )
        assert resp.status_code == 409

    def test_returns_409_when_invalid_transition(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.side_effect = InvalidTransitionError(
            "FORGEOS-BE099", "DONE", "already at final stage"
        )
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )
        assert resp.status_code == 409

    def test_returns_500_on_unexpected_error(self) -> None:
        mock_service = AsyncMock()
        mock_service.advance_ticket.side_effect = RuntimeError("boom")
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/advance",
            json={"agent_id": "Backend"},
        )
        assert resp.status_code == 500


# ===========================================================================
# POST /api/tickets/{ticket_id}/rework — success
# ===========================================================================


class TestReworkEndpointSuccess:
    """POST /api/tickets/{ticket_id}/rework with valid data."""

    def test_returns_200_with_rework_details(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.return_value = _rework_result()

        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "Tests failing"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["ticket_id"] == "FORGEOS-BE099"
        assert data["previous_stage"] == "QA"
        assert data["new_stage"] == "BACKEND"
        assert data["rework_count"] == 1
        assert data["escalated"] is False

    def test_passes_rejection_evidence_to_service(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.return_value = _rework_result()

        app = _make_app(mock_service)
        client = TestClient(app)
        evidence = {"failing_tests": ["test_foo"]}
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={
                "agent_id": "QA",
                "reason": "Tests failing",
                "rejection_evidence": evidence,
            },
        )

        assert resp.status_code == 200
        mock_service.rework_ticket.assert_called_once_with(
            ticket_id="FORGEOS-BE099",
            agent_id="QA",
            reason="Tests failing",
            rejection_evidence=evidence,
        )

    def test_returns_200_with_escalated_status(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.return_value = _rework_result(
            rework_count=3,
            escalated=True,
            new_stage="QA",
        )

        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "3rd failure"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["rework_count"] == 3
        assert data["escalated"] is True


# ===========================================================================
# POST /api/tickets/{ticket_id}/rework — error cases
# ===========================================================================


class TestReworkEndpointErrors:
    """POST /api/tickets/{ticket_id}/rework — error paths."""

    def test_returns_503_when_service_unavailable(self) -> None:
        app = _make_app(ticket_service=None)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "Tests failing"},
        )
        assert resp.status_code == 503

    def test_returns_400_for_missing_json(self) -> None:
        mock_service = AsyncMock()
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            content=b"not json",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400

    def test_returns_400_for_missing_required_fields(self) -> None:
        mock_service = AsyncMock()
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA"},  # missing reason
        )
        assert resp.status_code == 400

    def test_returns_404_when_ticket_not_found(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.side_effect = TicketNotFoundError("not found")
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "Tests failing"},
        )
        assert resp.status_code == 404

    def test_returns_409_when_agent_mismatch(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.side_effect = ClaimValidationError(
            "FORGEOS-BE099", "QA", "claimed by another"
        )
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "failure"},
        )
        assert resp.status_code == 409

    def test_returns_500_on_unexpected_error(self) -> None:
        mock_service = AsyncMock()
        mock_service.rework_ticket.side_effect = RuntimeError("boom")
        app = _make_app(mock_service)
        client = TestClient(app)
        resp = client.post(
            "/api/tickets/FORGEOS-BE099/rework",
            json={"agent_id": "QA", "reason": "failure"},
        )
        assert resp.status_code == 500
