"""Tests for GET /api/health — health status endpoint.

TDD Evidence
------------
- RED: tests written before implementation to define API contract
- GREEN: schemas + routes/health.py implemented
- REFACTOR: response structure aligned with HealthResponse schema

Ticket: FORGEOS-BE038
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.api.routes.health import create_health_endpoint
from mcp_server.api.schemas import HealthResponse

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_app(checker: Any) -> Starlette:
    """Build a minimal Starlette app with the health endpoint."""
    handler = create_health_endpoint(lambda: checker)
    return Starlette(routes=[Route("/api/health", handler, methods=["GET"])])


def _make_checker(
    report: dict[str, Any] | None = None,
    raise_exc: Exception | None = None,
) -> AsyncMock:
    """Create a mock HealthChecker."""
    checker = AsyncMock()
    if raise_exc:
        checker.health_check.side_effect = raise_exc
    else:
        checker.health_check.return_value = report or {
            "status": "healthy",
            "version": "1.0.0",
            "uptime_seconds": 42.5,
            "database": {"status": "ok", "pool": {"size": 10, "free_size": 8}},
        }
    return checker


# ===================================================================
# AC1 — GET /api/health returns server health status
# ===================================================================


class TestHealthBasic:
    """AC1: Health endpoint returns server status with component checks."""

    def test_healthy_returns_200(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "healthy"
        assert body["version"] == "1.0.0"
        assert body["uptime_seconds"] == 42.5

    def test_response_matches_pydantic_schema(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        body = resp.json()
        parsed = HealthResponse(**body)
        assert parsed.status == "healthy"
        assert len(parsed.components) >= 1

    def test_components_include_database(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        body = resp.json()
        comp_names = [c["name"] for c in body["components"]]
        assert "database" in comp_names


# ===================================================================
# AC2 — Health endpoint checks database connectivity
# ===================================================================


class TestHealthDatabaseCheck:
    """AC2: Health endpoint reports database connectivity status."""

    def test_database_ok(self) -> None:
        checker = _make_checker(report={
            "status": "healthy",
            "version": "1.0.0",
            "uptime_seconds": 10.0,
            "database": {"status": "ok", "pool": {"size": 5}},
        })
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        body = resp.json()
        db_comp = next(c for c in body["components"] if c["name"] == "database")
        assert db_comp["status"] == "ok"
        assert db_comp["details"]["pool"]["size"] == 5

    def test_database_error_returns_503(self) -> None:
        checker = _make_checker(report={
            "status": "unhealthy",
            "version": "1.0.0",
            "uptime_seconds": 10.0,
            "database": {"status": "error", "error": "connection refused"},
        })
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "unhealthy"
        db_comp = next(c for c in body["components"] if c["name"] == "database")
        assert db_comp["status"] == "error"

    def test_database_not_configured(self) -> None:
        checker = _make_checker(report={
            "status": "degraded",
            "version": "1.0.0",
            "uptime_seconds": 5.0,
            "database": {"status": "not_configured"},
        })
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"


# ===================================================================
# AC3 — Response times included in health check
# ===================================================================


class TestHealthResponseTime:
    """AC3: Health response includes response_time_ms."""

    def test_response_time_present(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        body = resp.json()
        assert "response_time_ms" in body
        assert isinstance(body["response_time_ms"], (int, float))
        assert body["response_time_ms"] >= 0

    def test_response_time_in_pydantic_model(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        parsed = HealthResponse(**resp.json())
        assert parsed.response_time_ms >= 0


# ===================================================================
# AC4 — Checker not configured returns 503
# ===================================================================


class TestHealthCheckerUnavailable:
    """AC4: Returns 503 when health checker is not configured."""

    def test_returns_503_when_checker_is_none(self) -> None:
        handler = create_health_endpoint(lambda: None)
        app = Starlette(routes=[Route("/api/health", handler, methods=["GET"])])
        client = TestClient(app)

        resp = client.get("/api/health")

        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "degraded"
        comp_names = [c["name"] for c in body["components"]]
        assert "health_checker" in comp_names

    def test_returns_503_when_check_raises(self) -> None:
        checker = _make_checker(raise_exc=RuntimeError("boom"))
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "unhealthy"


# ===================================================================
# AC5 — No authentication required (public read-only)
# ===================================================================


class TestHealthNoAuth:
    """AC5: Health endpoint requires no authentication."""

    def test_accessible_without_auth_headers(self) -> None:
        checker = _make_checker()
        client = TestClient(_make_app(checker))

        resp = client.get("/api/health")

        assert resp.status_code == 200
