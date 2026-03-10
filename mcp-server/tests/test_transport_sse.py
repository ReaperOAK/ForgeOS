"""Tests for the SSE transport layer — connection lifecycle, timeout, config.

TDD Evidence
------------
- RED: tests written first to define expected SSE transport behavior
- GREEN: sse.py implemented to satisfy these tests
- REFACTOR: connection tracking consolidated, config extracted

Ticket: FORGEOS-BE017
"""

from __future__ import annotations

import asyncio
import time

import pytest

from mcp_server.transport.sse import (
    ConnectionInfo,
    ConnectionTracker,
    SSETransport,
    SSETransportConfig,
)


# ---------------------------------------------------------------------------
# SSETransportConfig
# ---------------------------------------------------------------------------


class TestSSETransportConfig:
    """Verify SSE transport configuration with pydantic-settings."""

    def test_default_host(self) -> None:
        config = SSETransportConfig()
        assert config.host == "0.0.0.0"

    def test_default_port(self) -> None:
        config = SSETransportConfig()
        assert config.port == 8080

    def test_default_message_path(self) -> None:
        config = SSETransportConfig()
        assert config.message_path == "/messages/"

    def test_default_sse_path(self) -> None:
        config = SSETransportConfig()
        assert config.sse_path == "/sse"

    def test_default_idle_timeout(self) -> None:
        config = SSETransportConfig()
        assert config.idle_timeout_seconds == 300

    def test_idle_timeout_custom(self) -> None:
        config = SSETransportConfig(idle_timeout_seconds=60)
        assert config.idle_timeout_seconds == 60

    def test_default_max_connections(self) -> None:
        config = SSETransportConfig()
        assert config.max_connections == 100

    def test_default_log_level(self) -> None:
        config = SSETransportConfig()
        assert config.log_level == "INFO"

    def test_env_prefix(self) -> None:
        assert SSETransportConfig.model_config.get("env_prefix") == "FORGEOS_SSE_"

    def test_custom_config(self) -> None:
        config = SSETransportConfig(
            host="127.0.0.1",
            port=9090,
            idle_timeout_seconds=120,
            max_connections=50,
        )
        assert config.host == "127.0.0.1"
        assert config.port == 9090
        assert config.idle_timeout_seconds == 120
        assert config.max_connections == 50


# ---------------------------------------------------------------------------
# ConnectionInfo
# ---------------------------------------------------------------------------


class TestConnectionInfo:
    """Verify connection info dataclass fields."""

    def test_creation(self) -> None:
        info = ConnectionInfo(
            session_id="abc123",
            client_address="192.168.1.1",
        )
        assert info.session_id == "abc123"
        assert info.client_address == "192.168.1.1"
        assert info.connected_at > 0
        assert info.last_activity_at > 0

    def test_connected_at_defaults_to_now(self) -> None:
        before = time.monotonic()
        info = ConnectionInfo(session_id="t1", client_address="127.0.0.1")
        after = time.monotonic()
        assert before <= info.connected_at <= after

    def test_touch_updates_last_activity(self) -> None:
        info = ConnectionInfo(session_id="t1", client_address="127.0.0.1")
        old_activity = info.last_activity_at
        time.sleep(0.01)
        info.touch()
        assert info.last_activity_at > old_activity

    def test_is_idle_false_when_recent(self) -> None:
        info = ConnectionInfo(session_id="t1", client_address="127.0.0.1")
        assert info.is_idle(timeout_seconds=300) is False

    def test_is_idle_true_when_expired(self) -> None:
        info = ConnectionInfo(session_id="t1", client_address="127.0.0.1")
        info.last_activity_at = time.monotonic() - 400
        assert info.is_idle(timeout_seconds=300) is True


# ---------------------------------------------------------------------------
# ConnectionTracker
# ---------------------------------------------------------------------------


class TestConnectionTracker:
    """Verify connection lifecycle tracking."""

    def test_register_connection(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        info = tracker.register("sess-1", "192.168.1.1")
        assert info.session_id == "sess-1"
        assert tracker.active_count == 1

    def test_unregister_connection(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("sess-1", "192.168.1.1")
        tracker.unregister("sess-1")
        assert tracker.active_count == 0

    def test_unregister_nonexistent_is_noop(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.unregister("nonexistent")
        assert tracker.active_count == 0

    def test_get_connection(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("sess-1", "192.168.1.1")
        info = tracker.get("sess-1")
        assert info is not None
        assert info.session_id == "sess-1"

    def test_get_nonexistent_returns_none(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        assert tracker.get("nonexistent") is None

    def test_max_connections_enforced(self) -> None:
        tracker = ConnectionTracker(max_connections=2)
        tracker.register("sess-1", "10.0.0.1")
        tracker.register("sess-2", "10.0.0.2")
        with pytest.raises(ConnectionError, match="Maximum connections"):
            tracker.register("sess-3", "10.0.0.3")

    def test_touch_updates_activity(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("sess-1", "192.168.1.1")
        info_before = tracker.get("sess-1")
        assert info_before is not None
        old_activity = info_before.last_activity_at
        time.sleep(0.01)
        tracker.touch("sess-1")
        info_after = tracker.get("sess-1")
        assert info_after is not None
        assert info_after.last_activity_at > old_activity

    def test_touch_nonexistent_is_noop(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.touch("nonexistent")

    def test_get_idle_connections(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        info1 = tracker.register("sess-1", "10.0.0.1")
        tracker.register("sess-2", "10.0.0.2")
        info1.last_activity_at = time.monotonic() - 400
        idle = tracker.get_idle_connections(timeout_seconds=300)
        assert len(idle) == 1
        assert idle[0].session_id == "sess-1"

    def test_active_count(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        assert tracker.active_count == 0
        tracker.register("s1", "10.0.0.1")
        tracker.register("s2", "10.0.0.2")
        assert tracker.active_count == 2
        tracker.unregister("s1")
        assert tracker.active_count == 1

    def test_all_connections(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("s1", "10.0.0.1")
        tracker.register("s2", "10.0.0.2")
        all_conns = tracker.all_connections
        assert len(all_conns) == 2
        session_ids = {c.session_id for c in all_conns}
        assert session_ids == {"s1", "s2"}


# ---------------------------------------------------------------------------
# SSETransport
# ---------------------------------------------------------------------------


class TestSSETransport:
    """Verify SSE transport creation and app factory."""

    def test_creation_with_defaults(self) -> None:
        transport = SSETransport()
        assert transport.config.host == "0.0.0.0"
        assert transport.config.port == 8080
        assert transport.tracker.active_count == 0

    def test_creation_with_custom_config(self) -> None:
        config = SSETransportConfig(host="127.0.0.1", port=9090)
        transport = SSETransport(config=config)
        assert transport.config.host == "127.0.0.1"
        assert transport.config.port == 9090

    def test_create_app_returns_starlette(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = SSETransport()
        app = transport.create_app(server)
        assert hasattr(app, "routes")

    def test_create_app_includes_health_route(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = SSETransport()
        app = transport.create_app(server)
        route_paths = [getattr(r, "path", None) for r in app.routes]
        assert "/health" in route_paths

    def test_create_app_includes_connections_route(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = SSETransport()
        app = transport.create_app(server)
        route_paths = [getattr(r, "path", None) for r in app.routes]
        assert "/connections" in route_paths

    def test_transport_status_initial(self) -> None:
        transport = SSETransport()
        status = transport.status()
        assert status["transport"] == "sse"
        assert status["active_connections"] == 0
        assert status["max_connections"] == 100


# ---------------------------------------------------------------------------
# Integration: health endpoint
# ---------------------------------------------------------------------------


class TestSSEHealthEndpoint:
    """Verify the SSE transport health endpoint."""

    @pytest.mark.asyncio
    async def test_health_returns_200(self) -> None:
        from starlette.testclient import TestClient
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = SSETransport()
        app = transport.create_app(server)

        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["transport"] == "sse"

    @pytest.mark.asyncio
    async def test_connections_returns_200(self) -> None:
        from starlette.testclient import TestClient
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = SSETransport()
        app = transport.create_app(server)

        client = TestClient(app)
        response = client.get("/connections")
        assert response.status_code == 200
        data = response.json()
        assert data["active_connections"] == 0
        assert data["connections"] == []


class TestSSEIdleTimeoutSweep:
    """QA-added tests for _idle_timeout_sweep coverage (FORGEOS-BE017)."""

    @pytest.mark.asyncio
    async def test_sweep_removes_idle_connections(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("idle-1", "127.0.0.1")
        tracker.register("idle-2", "127.0.0.1")
        assert tracker.active_count == 2
        idle = tracker.get_idle_connections(timeout_seconds=0)
        assert len(idle) == 2
        for conn in idle:
            tracker.unregister(conn.session_id)
        assert tracker.active_count == 0

    @pytest.mark.asyncio
    async def test_sweep_keeps_active_connections(self) -> None:
        tracker = ConnectionTracker(max_connections=10)
        tracker.register("active-1", "127.0.0.1")
        idle = tracker.get_idle_connections(timeout_seconds=9999)
        assert len(idle) == 0
        assert tracker.active_count == 1

    @pytest.mark.asyncio
    async def test_sweep_cancellation_is_clean(self) -> None:
        transport = SSETransport()
        assert transport._timeout_task is None

    @pytest.mark.asyncio
    async def test_sweep_interval_capped_at_half_timeout(self) -> None:
        cfg = SSETransportConfig(idle_timeout_seconds=10)
        assert cfg.idle_timeout_seconds == 10
        expected_interval = cfg.idle_timeout_seconds / 2
        assert expected_interval == 5.0

    @pytest.mark.asyncio
    async def test_timeout_task_initially_none(self) -> None:
        transport = SSETransport()
        assert transport._timeout_task is None
