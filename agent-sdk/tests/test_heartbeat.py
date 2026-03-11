"""Tests for LeaseHeartbeat and heartbeat integration in TicketOperations.

Covers all acceptance criteria:
  AC1: Background task sends heartbeat at configurable interval (default: 5 min)
  AC2: Heartbeat calls tickets.heartbeat MCP tool
  AC3: Heartbeat stops when ticket claim is released or advanced
  AC4: Failed heartbeat logs warning but does not crash the agent
  AC5: Context manager (async with) starts/stops heartbeat automatically
  AC6: Heartbeat interval configurable via env var or constructor parameter

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.heartbeat import DEFAULT_INTERVAL_SECONDS, LeaseHeartbeat
from forgeos_sdk.models import Evidence
from forgeos_sdk.operations import TicketOperations

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _text_content(data: dict[str, Any] | str) -> MagicMock:
    """Create a MagicMock mimicking ``TextContent``."""
    content = MagicMock()
    content.text = data if isinstance(data, str) else json.dumps(data)
    return content


def _call_result(
    data: dict[str, Any] | str,
    *,
    is_error: bool = False,
) -> MagicMock:
    """Create a MagicMock mimicking ``CallToolResult``."""
    result = MagicMock()
    result.content = [_text_content(data)]
    result.isError = is_error
    return result


@pytest.fixture()
def mock_session() -> AsyncMock:
    """Mock MCP ``ClientSession``."""
    return AsyncMock()


@pytest.fixture()
def mock_client(mock_session: AsyncMock) -> MagicMock:
    """Mock ``ForgeOSClient`` with a connected session."""
    client = MagicMock(spec=ForgeOSClient)
    client.agent_id = "test-agent"
    type(client).session = PropertyMock(return_value=mock_session)
    return client


# ===========================================================================
# AC1: Background task sends heartbeat at configurable interval (default 5m)
# ===========================================================================


class TestLeaseHeartbeatCreation:
    """AC1 & AC6 — LeaseHeartbeat is created with correct interval."""

    def test_default_interval(self, mock_client: MagicMock) -> None:
        hb = LeaseHeartbeat(mock_client, "T-1")
        assert hb.interval_seconds == DEFAULT_INTERVAL_SECONDS
        assert hb.interval_seconds == 300.0

    def test_custom_interval_via_constructor(self, mock_client: MagicMock) -> None:
        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=60.0)
        assert hb.interval_seconds == 60.0

    def test_interval_from_env_var(self, mock_client: MagicMock) -> None:
        with patch.dict(os.environ, {"FORGEOS_HEARTBEAT_INTERVAL": "120"}):
            hb = LeaseHeartbeat(mock_client, "T-1")
        assert hb.interval_seconds == 120.0

    def test_constructor_overrides_env_var(self, mock_client: MagicMock) -> None:
        with patch.dict(os.environ, {"FORGEOS_HEARTBEAT_INTERVAL": "120"}):
            hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=45.0)
        assert hb.interval_seconds == 45.0

    def test_ticket_id_property(self, mock_client: MagicMock) -> None:
        hb = LeaseHeartbeat(mock_client, "FORGEOS-BE047")
        assert hb.ticket_id == "FORGEOS-BE047"

    def test_not_running_initially(self, mock_client: MagicMock) -> None:
        hb = LeaseHeartbeat(mock_client, "T-1")
        assert hb.running is False


# ===========================================================================
# AC2: Heartbeat calls tickets.heartbeat MCP tool
# ===========================================================================


class TestHeartbeatSendsCall:
    """AC2 — heartbeat calls tickets.heartbeat MCP tool."""

    async def test_sends_heartbeat_call(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket_id": "T-1", "lease_expiry": "2026-03-11T02:00:00Z"}
        )

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=0.05)
        hb.start()
        assert hb.running is True

        # Wait enough for at least one heartbeat
        await asyncio.sleep(0.15)
        await hb.stop()

        mock_session.call_tool.assert_called_with(
            "tickets.heartbeat", {"ticket_id": "T-1"}
        )
        assert mock_session.call_tool.call_count >= 1

    async def test_start_is_idempotent(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        hb.start()
        task1 = hb._task
        hb.start()  # Second start should be a no-op
        assert hb._task is task1
        await hb.stop()


# ===========================================================================
# AC3: Heartbeat stops when ticket is released or advanced
# ===========================================================================


class TestHeartbeatStops:
    """AC3 — heartbeat stops on release/advance/rework."""

    async def test_stop_cancels_task(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        hb.start()
        assert hb.running is True

        await hb.stop()
        assert hb.running is False

    async def test_stop_when_not_running_is_safe(
        self, mock_client: MagicMock
    ) -> None:
        hb = LeaseHeartbeat(mock_client, "T-1")
        await hb.stop()  # Should not raise
        assert hb.running is False

    async def test_stop_multiple_times_is_safe(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})
        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        hb.start()
        await hb.stop()
        await hb.stop()  # Double-stop should not raise
        assert hb.running is False


# ===========================================================================
# AC4: Failed heartbeat logs warning but does not crash
# ===========================================================================


class TestHeartbeatFailureHandling:
    """AC4 — failed heartbeat logs warning, does not crash."""

    async def test_error_response_logs_warning(
        self, mock_client: MagicMock, mock_session: AsyncMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            "LEASE_EXPIRED", is_error=True
        )

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=0.05)
        hb.start()
        await asyncio.sleep(0.15)
        await hb.stop()

        assert any("Heartbeat failed" in r.message for r in caplog.records)

    async def test_exception_logs_warning(
        self, mock_client: MagicMock, mock_session: AsyncMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        mock_session.call_tool.side_effect = OSError("network down")

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=0.05)
        hb.start()
        await asyncio.sleep(0.15)
        await hb.stop()

        assert any("Heartbeat error" in r.message for r in caplog.records)

    async def test_disconnected_client_logs_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        client = MagicMock(spec=ForgeOSClient)
        type(client).session = PropertyMock(return_value=None)

        hb = LeaseHeartbeat(client, "T-1", interval_seconds=0.05)
        hb.start()
        await asyncio.sleep(0.15)
        await hb.stop()

        assert any("not connected" in r.message for r in caplog.records)


# ===========================================================================
# AC5: Context manager (async with) starts/stops heartbeat
# ===========================================================================


class TestHeartbeatContextManager:
    """AC5 — async with starts/stops heartbeat automatically."""

    async def test_context_manager_starts_and_stops(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        async with hb:
            assert hb.running is True
        assert hb.running is False

    async def test_context_manager_returns_self(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        async with hb as ctx:
            assert ctx is hb
        await hb.stop()

    async def test_context_manager_stops_on_exception(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result({"ok": True})

        hb = LeaseHeartbeat(mock_client, "T-1", interval_seconds=10)
        with pytest.raises(ValueError, match="boom"):
            async with hb:
                assert hb.running is True
                raise ValueError("boom")
        assert hb.running is False


# ===========================================================================
# AC6: Interval configurable via env var or constructor (covered above)
# ===========================================================================

# Additional tests grouped here for completeness


class TestIntervalConfig:
    """AC6 — interval configurable via env var or constructor."""

    def test_env_var_name_is_correct(self, mock_client: MagicMock) -> None:
        """Checks only FORGEOS_HEARTBEAT_INTERVAL is used, not any other."""
        with patch.dict(os.environ, {"OTHER_INTERVAL": "10"}, clear=False):
            hb = LeaseHeartbeat(mock_client, "T-1")
        assert hb.interval_seconds == DEFAULT_INTERVAL_SECONDS


# ===========================================================================
# Integration: TicketOperations auto-manages heartbeats
# ===========================================================================


class TestOpsHeartbeatIntegration:
    """Heartbeat auto-start on claim/claim_next, auto-stop on advance/release/rework."""

    @pytest.fixture()
    def ops(self, mock_client: MagicMock) -> TicketOperations:
        """TicketOperations with a short heartbeat interval for testing."""
        return TicketOperations(mock_client, heartbeat_interval=10.0)

    @pytest.fixture()
    def ops_disabled(self, mock_client: MagicMock) -> TicketOperations:
        """TicketOperations with heartbeat disabled."""
        return TicketOperations(mock_client, heartbeat_interval=0)

    async def test_claim_starts_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )

        await ops.claim("T-1", agent_name="Backend")

        assert "T-1" in ops._heartbeats
        assert ops._heartbeats["T-1"].running is True
        await ops.stop_all_heartbeats()

    async def test_claim_next_starts_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-2", "status": "CLAIMED", "stage": "BACKEND"}}
        )

        await ops.claim_next("BACKEND")

        assert "T-2" in ops._heartbeats
        assert ops._heartbeats["T-2"].running is True
        await ops.stop_all_heartbeats()

    async def test_advance_stops_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        # First claim to start heartbeat
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")

        # Then advance
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "stage": "QA"}}
        )
        evidence = Evidence(
            artifacts=["a.py"], test_results="pass", confidence="HIGH"
        )
        await ops.advance("T-1", evidence)

        assert "T-1" not in ops._heartbeats

    async def test_release_stops_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")

        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "READY"}}
        )
        await ops.release("T-1")

        assert "T-1" not in ops._heartbeats

    async def test_rework_stops_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")

        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "rework_count": 1}}
        )
        await ops.rework("T-1", "Coverage below 80%")

        assert "T-1" not in ops._heartbeats

    async def test_stop_all_heartbeats(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-2", "status": "CLAIMED"}}
        )
        await ops.claim("T-2")

        assert len(ops._heartbeats) == 2
        await ops.stop_all_heartbeats()
        assert len(ops._heartbeats) == 0

    async def test_disabled_heartbeat_does_not_start(
        self, ops_disabled: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops_disabled.claim("T-1")

        assert len(ops_disabled._heartbeats) == 0

    async def test_heartbeat_uses_configured_interval(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        ops = TicketOperations(mock_client, heartbeat_interval=42.0)
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")

        assert ops._heartbeats["T-1"].interval_seconds == 42.0
        await ops.stop_all_heartbeats()

    async def test_reclaim_replaces_heartbeat(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1", "status": "CLAIMED"}}
        )
        await ops.claim("T-1")
        first_hb = ops._heartbeats["T-1"]

        # Claim again — should stop old and start new
        await ops.claim("T-1")
        assert ops._heartbeats["T-1"] is not first_hb
        assert ops._heartbeats["T-1"].running is True
        assert first_hb.running is False
        await ops.stop_all_heartbeats()
