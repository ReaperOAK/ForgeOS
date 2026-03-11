"""Tests for admin force operations — routes and service.

TDD Evidence
------------
- RED: tests written to define admin API contract
- GREEN: admin_service.py + admin.py route handlers implemented
- REFACTOR: consolidated auth check helper, consistent error responses

Ticket: FORGEOS-BE057
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.admin import (
    create_admin_force_advance_endpoint,
    create_admin_force_release_endpoint,
    create_admin_force_rework_endpoint,
)
from mcp_server.middleware.auth_middleware import AuthContext, IdentityType
from mcp_server.server import TicketNotFoundError
from mcp_server.services.admin_service import (
    AdminService,
    ForceAdvanceResult,
    ForceReleaseResult,
    ForceReworkResult,
)
from mcp_server.services.stage_engine import InvalidTransitionError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ADMIN_CTX = AuthContext(
    identity_type=IdentityType.ADMIN,
    identity_id="admin-user-001",
    role="admin",
    machine_id="pop-os",
    agent_name="admin",
)

_AGENT_CTX = AuthContext(
    identity_type=IdentityType.AGENT,
    identity_id="backend-agent",
    role="backend",
    machine_id="pop-os",
    agent_name="Backend",
)


def _build_admin_app(admin_service: AdminService | None) -> Starlette:
    """Build a minimal Starlette app with admin routes for testing."""

    def _getter() -> AdminService | None:
        return admin_service

    release_handler = create_admin_force_release_endpoint(_getter)
    advance_handler = create_admin_force_advance_endpoint(_getter)
    rework_handler = create_admin_force_rework_endpoint(_getter)

    routes = [
        Route(
            "/api/admin/tickets/{ticket_id}/force-release",
            release_handler,
            methods=["POST"],
        ),
        Route(
            "/api/admin/tickets/{ticket_id}/force-advance",
            advance_handler,
            methods=["POST"],
        ),
        Route(
            "/api/admin/tickets/{ticket_id}/force-rework",
            rework_handler,
            methods=["POST"],
        ),
    ]
    return Starlette(routes=routes)


def _make_mock_service() -> AsyncMock:
    """Create a mock AdminService with all methods as AsyncMock."""
    svc = AsyncMock(spec=AdminService)
    return svc


# ---------------------------------------------------------------------------
# Auth tests — apply to all three endpoints
# ---------------------------------------------------------------------------


class TestAdminAuthEnforcement:
    """All admin endpoints must reject non-admin requests."""

    @pytest.fixture()
    def client(self) -> TestClient:
        svc = _make_mock_service()
        app = _build_admin_app(svc)
        return TestClient(app, raise_server_exceptions=False)

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_401_when_no_auth_context(
        self, client: TestClient, path: str
    ) -> None:
        """Unauthenticated requests get 401."""
        with patch(
            "mcp_server.api.routes.admin.get_auth_context", return_value=None
        ):
            resp = client.post(path, json={"reason": "test"})
        assert resp.status_code == 401
        assert resp.json()["error"] == "Authentication required"

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_403_for_non_admin(
        self, client: TestClient, path: str
    ) -> None:
        """Agent (non-admin) requests get 403."""
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_AGENT_CTX,
        ):
            resp = client.post(path, json={"reason": "test"})
        assert resp.status_code == 403
        assert resp.json()["error"] == "Admin role required"

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_400_when_reason_missing(
        self, client: TestClient, path: str
    ) -> None:
        """Missing reason field returns 400."""
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(path, json={})
        assert resp.status_code == 400
        assert "reason" in resp.json()["error"].lower()

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_400_when_reason_empty(
        self, client: TestClient, path: str
    ) -> None:
        """Empty reason field returns 400."""
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(path, json={"reason": "  "})
        assert resp.status_code == 400

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_503_when_service_unavailable(
        self, path: str
    ) -> None:
        """Returns 503 when admin service is None."""
        app = _build_admin_app(None)
        client = TestClient(app, raise_server_exceptions=False)
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(path, json={"reason": "test"})
        assert resp.status_code == 503


# ---------------------------------------------------------------------------
# Force release tests
# ---------------------------------------------------------------------------


class TestAdminForceRelease:
    """Tests for POST /api/admin/tickets/{id}/force-release."""

    @pytest.fixture()
    def mock_service(self) -> AsyncMock:
        return _make_mock_service()

    @pytest.fixture()
    def client(self, mock_service: AsyncMock) -> TestClient:
        app = _build_admin_app(mock_service)
        return TestClient(app, raise_server_exceptions=False)

    def test_successful_force_release(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Admin can force-release a claimed ticket."""
        mock_service.force_release.return_value = ForceReleaseResult(
            ticket_id="FORGEOS-BE001",
            previous_stage="BACKEND",
            previous_claim={
                "claimed_by": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
            released_by_admin="admin-user-001",
            reason="Stuck claim",
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-release",
                json={"reason": "Stuck claim"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticket_id"] == "FORGEOS-BE001"
        assert data["released_by_admin"] == "admin-user-001"
        assert data["previous_claim"]["claimed_by"] == "Backend"
        assert data["reason"] == "Stuck claim"

    def test_force_release_ticket_not_found(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 404 for non-existent ticket."""
        mock_service.force_release.side_effect = TicketNotFoundError(
            "Ticket 'FORGEOS-NONE' not found"
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-NONE/force-release",
                json={"reason": "test"},
            )
        assert resp.status_code == 404

    def test_force_release_internal_error(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 500 on unexpected exception."""
        mock_service.force_release.side_effect = RuntimeError("db down")
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-release",
                json={"reason": "test"},
            )
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Force advance tests
# ---------------------------------------------------------------------------


class TestAdminForceAdvance:
    """Tests for POST /api/admin/tickets/{id}/force-advance."""

    @pytest.fixture()
    def mock_service(self) -> AsyncMock:
        return _make_mock_service()

    @pytest.fixture()
    def client(self, mock_service: AsyncMock) -> TestClient:
        app = _build_admin_app(mock_service)
        return TestClient(app, raise_server_exceptions=False)

    def test_successful_force_advance(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Admin can force-advance a ticket to next stage."""
        mock_service.force_advance.return_value = ForceAdvanceResult(
            ticket_id="FORGEOS-BE001",
            title="Test",
            ticket_type="backend",
            previous_stage="BACKEND",
            new_stage="QA",
            advanced_by_admin="admin-user-001",
            reason="Expedite",
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-advance",
                json={"reason": "Expedite"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticket_id"] == "FORGEOS-BE001"
        assert data["previous_stage"] == "BACKEND"
        assert data["new_stage"] == "QA"
        assert data["advanced_by_admin"] == "admin-user-001"

    def test_force_advance_ticket_not_found(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 404 for non-existent ticket."""
        mock_service.force_advance.side_effect = TicketNotFoundError(
            "Ticket 'FORGEOS-NONE' not found"
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-NONE/force-advance",
                json={"reason": "test"},
            )
        assert resp.status_code == 404

    def test_force_advance_invalid_transition(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 409 when ticket is at final stage."""
        mock_service.force_advance.side_effect = InvalidTransitionError(
            "FORGEOS-BE001", "DONE", "Already at final stage"
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-advance",
                json={"reason": "test"},
            )
        assert resp.status_code == 409

    def test_force_advance_internal_error(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 500 on unexpected exception."""
        mock_service.force_advance.side_effect = RuntimeError("db down")
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-advance",
                json={"reason": "test"},
            )
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Force rework tests
# ---------------------------------------------------------------------------


class TestAdminForceRework:
    """Tests for POST /api/admin/tickets/{id}/force-rework."""

    @pytest.fixture()
    def mock_service(self) -> AsyncMock:
        return _make_mock_service()

    @pytest.fixture()
    def client(self, mock_service: AsyncMock) -> TestClient:
        app = _build_admin_app(mock_service)
        return TestClient(app, raise_server_exceptions=False)

    def test_successful_force_rework(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Admin can force-rework a ticket back to implementation stage."""
        mock_service.force_rework.return_value = ForceReworkResult(
            ticket_id="FORGEOS-BE001",
            title="Test",
            ticket_type="backend",
            previous_stage="QA",
            new_stage="BACKEND",
            rework_count=1,
            escalated=False,
            reworked_by_admin="admin-user-001",
            reason="Failing tests",
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-rework",
                json={"reason": "Failing tests"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ticket_id"] == "FORGEOS-BE001"
        assert data["previous_stage"] == "QA"
        assert data["new_stage"] == "BACKEND"
        assert data["rework_count"] == 1
        assert data["escalated"] is False
        assert data["reworked_by_admin"] == "admin-user-001"

    def test_force_rework_escalation(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Force rework with max reworks reached triggers escalation."""
        mock_service.force_rework.return_value = ForceReworkResult(
            ticket_id="FORGEOS-BE001",
            title="Test",
            ticket_type="backend",
            previous_stage="QA",
            new_stage="QA",
            rework_count=3,
            escalated=True,
            reworked_by_admin="admin-user-001",
            reason="Persistent failures",
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-rework",
                json={"reason": "Persistent failures"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["escalated"] is True
        assert data["rework_count"] == 3

    def test_force_rework_ticket_not_found(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 404 for non-existent ticket."""
        mock_service.force_rework.side_effect = TicketNotFoundError(
            "Ticket 'FORGEOS-NONE' not found"
        )
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-NONE/force-rework",
                json={"reason": "test"},
            )
        assert resp.status_code == 404

    def test_force_rework_internal_error(
        self, client: TestClient, mock_service: AsyncMock
    ) -> None:
        """Returns 500 on unexpected exception."""
        mock_service.force_rework.side_effect = RuntimeError("db down")
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                "/api/admin/tickets/FORGEOS-BE001/force-rework",
                json={"reason": "test"},
            )
        assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Service unit tests (result to_dict)
# ---------------------------------------------------------------------------


class TestResultSerialization:
    """Verify result dataclass serialization."""

    def test_force_release_result_to_dict(self) -> None:
        result = ForceReleaseResult(
            ticket_id="T-001",
            previous_stage="BACKEND",
            previous_claim={"claimed_by": "Backend"},
            released_by_admin="admin",
            reason="test",
        )
        d = result.to_dict()
        assert d["ticket_id"] == "T-001"
        assert d["released_by_admin"] == "admin"
        assert d["previous_claim"] == {"claimed_by": "Backend"}

    def test_force_release_result_no_claim(self) -> None:
        result = ForceReleaseResult(
            ticket_id="T-001",
            previous_stage="BACKEND",
            previous_claim=None,
            released_by_admin="admin",
            reason="no claim",
        )
        d = result.to_dict()
        assert d["previous_claim"] is None

    def test_force_advance_result_to_dict(self) -> None:
        result = ForceAdvanceResult(
            ticket_id="T-001",
            title="Test",
            ticket_type="backend",
            previous_stage="BACKEND",
            new_stage="QA",
            advanced_by_admin="admin",
            reason="test",
        )
        d = result.to_dict()
        assert d["previous_stage"] == "BACKEND"
        assert d["new_stage"] == "QA"
        assert d["type"] == "backend"

    def test_force_rework_result_to_dict(self) -> None:
        result = ForceReworkResult(
            ticket_id="T-001",
            title="Test",
            ticket_type="backend",
            previous_stage="QA",
            new_stage="BACKEND",
            rework_count=2,
            escalated=False,
            reworked_by_admin="admin",
            reason="test",
        )
        d = result.to_dict()
        assert d["rework_count"] == 2
        assert d["escalated"] is False
        assert d["type"] == "backend"

    def test_force_rework_result_escalated(self) -> None:
        result = ForceReworkResult(
            ticket_id="T-001",
            title="Test",
            ticket_type="backend",
            previous_stage="QA",
            new_stage="QA",
            rework_count=3,
            escalated=True,
            reworked_by_admin="admin",
            reason="excalated",
        )
        d = result.to_dict()
        assert d["escalated"] is True


# ---------------------------------------------------------------------------
# Admin route helper tests
# ---------------------------------------------------------------------------


class TestAdminRouteHelpers:
    """Test internal helper functions."""

    def test_parse_reason_returns_stripped_string(self) -> None:
        from mcp_server.api.routes.admin import _parse_reason

        assert _parse_reason({"reason": "  hello  "}) == "hello"

    def test_parse_reason_returns_none_for_missing(self) -> None:
        from mcp_server.api.routes.admin import _parse_reason

        assert _parse_reason({}) is None

    def test_parse_reason_returns_none_for_whitespace(self) -> None:
        from mcp_server.api.routes.admin import _parse_reason

        assert _parse_reason({"reason": "   "}) is None

    def test_parse_reason_returns_none_for_non_string(self) -> None:
        from mcp_server.api.routes.admin import _parse_reason

        assert _parse_reason({"reason": 123}) is None

    def test_require_admin_returns_none_for_admin(self) -> None:
        from mcp_server.api.routes.admin import _require_admin

        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            assert _require_admin() is None

    def test_require_admin_returns_401_for_no_context(self) -> None:
        from mcp_server.api.routes.admin import _require_admin

        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=None,
        ):
            resp = _require_admin()
            assert resp is not None
            assert resp.status_code == 401

    def test_require_admin_returns_403_for_agent(self) -> None:
        from mcp_server.api.routes.admin import _require_admin

        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_AGENT_CTX,
        ):
            resp = _require_admin()
            assert resp is not None
            assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Invalid body tests
# ---------------------------------------------------------------------------


class TestInvalidRequestBody:
    """Tests for malformed request bodies."""

    @pytest.fixture()
    def client(self) -> TestClient:
        svc = _make_mock_service()
        app = _build_admin_app(svc)
        return TestClient(app, raise_server_exceptions=False)

    @pytest.mark.parametrize("path", [
        "/api/admin/tickets/FORGEOS-BE001/force-release",
        "/api/admin/tickets/FORGEOS-BE001/force-advance",
        "/api/admin/tickets/FORGEOS-BE001/force-rework",
    ])
    def test_returns_400_for_non_json_body(
        self, client: TestClient, path: str
    ) -> None:
        """Non-JSON body returns 400."""
        with patch(
            "mcp_server.api.routes.admin.get_auth_context",
            return_value=_ADMIN_CTX,
        ):
            resp = client.post(
                path,
                content=b"not json",
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 400
        assert "JSON" in resp.json()["error"]
