"""Tests for mcp_server.migration.dual_mode — DualModeWrapper, FileMode, McpMode."""

from __future__ import annotations

import asyncio
import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.migration.config import DualModeConfig, OperationMode
from mcp_server.migration.dual_mode import (
    DualModeWrapper,
    FileMode,
    McpMode,
    OperationResult,
)

_SUBPROCESS_PATCH = "mcp_server.migration.dual_mode._run_subprocess"

# ---------------------------------------------------------------------------
# OperationResult
# ---------------------------------------------------------------------------


class TestOperationResult:
    """OperationResult dataclass behaviour."""

    def test_successful_result(self) -> None:
        r = OperationResult(success=True, message="ok", mode_used="file")
        assert r.success is True
        assert r.message == "ok"
        assert r.mode_used == "file"
        assert r.data is None

    def test_result_with_data(self) -> None:
        r = OperationResult(
            success=True, message="ok", mode_used="mcp", data={"ticket_id": "T-1"}
        )
        assert r.data == {"ticket_id": "T-1"}

    def test_failed_result(self) -> None:
        r = OperationResult(success=False, message="err", mode_used="file")
        assert r.success is False

    def test_to_dict(self) -> None:
        r = OperationResult(success=True, message="done", mode_used="mcp", data={"a": 1})
        d = r.to_dict()
        assert d == {
            "success": True,
            "message": "done",
            "mode_used": "mcp",
            "data": {"a": 1},
        }

    def test_frozen(self) -> None:
        r = OperationResult(success=True, message="ok", mode_used="file")
        with pytest.raises(AttributeError):
            r.success = False  # type: ignore[misc]


# ---------------------------------------------------------------------------
# FileMode
# ---------------------------------------------------------------------------


class TestFileMode:
    """FileMode delegates operations to tickets.py via subprocess."""

    @pytest.fixture()
    def file_mode(self) -> FileMode:
        return FileMode(tickets_py_path="/fake/tickets.py", timeout=5)

    @pytest.mark.asyncio
    async def test_claim_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Claimed FORGEOS-BE001"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is True
        assert result.mode_used == "file"
        mock_run.assert_called_once()
        args = mock_run.call_args[0][0]
        assert "--claim" in args
        assert "T-1" in args

    @pytest.mark.asyncio
    async def test_claim_failure(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "Ticket not found"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is False
        assert "Ticket not found" in result.message

    @pytest.mark.asyncio
    async def test_advance_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Advanced T-1"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.advance("T-1", "Backend")

        assert result.success is True
        args = mock_run.call_args[0][0]
        assert "--advance" in args

    @pytest.mark.asyncio
    async def test_release_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Released T-1"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.release("T-1", "manual")

        assert result.success is True
        args = mock_run.call_args[0][0]
        assert "--release" in args

    @pytest.mark.asyncio
    async def test_rework_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Rework T-1"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.rework("T-1", "QA", "test failed")

        assert result.success is True
        args = mock_run.call_args[0][0]
        assert "--rework" in args

    @pytest.mark.asyncio
    async def test_sync_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"moved_to_ready": ["T-1"]})

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.sync()

        assert result.success is True
        args = mock_run.call_args[0][0]
        assert "--sync" in args

    @pytest.mark.asyncio
    async def test_validate_success(self, file_mode: FileMode) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Integrity check passed"

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.validate()

        assert result.success is True
        args = mock_run.call_args[0][0]
        assert "--validate" in args

    @pytest.mark.asyncio
    async def test_status_success(self, file_mode: FileMode) -> None:
        status_data = {"stages": {"READY": []}}
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(status_data)

        with patch(_SUBPROCESS_PATCH, new_callable=AsyncMock) as mock_run:
            mock_run.return_value = mock_result
            result = await file_mode.status()

        assert result.success is True
        assert result.data is not None
        args = mock_run.call_args[0][0]
        assert "--status" in args
        assert "--json" in args

    @pytest.mark.asyncio
    async def test_subprocess_timeout(self, file_mode: FileMode) -> None:
        with patch(
            _SUBPROCESS_PATCH,
            new_callable=AsyncMock,
            side_effect=asyncio.TimeoutError,
        ):
            result = await file_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is False
        assert "timed out" in result.message.lower()


# ---------------------------------------------------------------------------
# McpMode
# ---------------------------------------------------------------------------


class TestMcpMode:
    """McpMode sends tool calls via MCP client HTTP."""

    @pytest.fixture()
    def mcp_mode(self) -> McpMode:
        return McpMode(server_url="http://localhost:8080", timeout=5)

    @pytest.mark.asyncio
    async def test_claim_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"ticket_id": "T-1", "stage": "BACKEND"}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is True
        assert result.mode_used == "mcp"
        mock_call.assert_called_once_with(
            "tickets.claim",
            {
                "ticket_id": "T-1",
                "agent_id": "Backend",
                "machine_id": "pop-os",
                "operator": "ReaperOAK",
            },
        )

    @pytest.mark.asyncio
    async def test_claim_error_response(self, mcp_mode: McpMode) -> None:
        mock_resp = {"isError": True, "message": "Already claimed"}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is False
        assert "Already claimed" in result.message

    @pytest.mark.asyncio
    async def test_advance_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"ticket_id": "T-1", "stage": "QA"}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.advance("T-1", "Backend")

        assert result.success is True
        mock_call.assert_called_once_with(
            "tickets.advance",
            {"ticket_id": "T-1", "agent_id": "Backend"},
        )

    @pytest.mark.asyncio
    async def test_release_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"ticket_id": "T-1"}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.release("T-1", "manual")

        assert result.success is True
        mock_call.assert_called_once_with(
            "tickets.release",
            {"ticket_id": "T-1", "agent_id": "system", "reason": "manual"},
        )

    @pytest.mark.asyncio
    async def test_rework_not_implemented(self, mcp_mode: McpMode) -> None:
        result = await mcp_mode.rework("T-1", "QA", "test failed")
        assert result.success is False
        assert "not available" in result.message.lower()

    @pytest.mark.asyncio
    async def test_sync_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"released": 0, "moved_to_ready": 1}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.sync()

        assert result.success is True

    @pytest.mark.asyncio
    async def test_validate_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"errors": []}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.validate()

        assert result.success is True

    @pytest.mark.asyncio
    async def test_status_success(self, mcp_mode: McpMode) -> None:
        mock_resp = {"stages": {"READY": []}}
        with patch.object(mcp_mode, "_call_tool", new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_resp
            result = await mcp_mode.status()

        assert result.success is True
        assert result.data == mock_resp

    @pytest.mark.asyncio
    async def test_connection_error(self, mcp_mode: McpMode) -> None:
        with patch.object(
            mcp_mode,
            "_call_tool",
            new_callable=AsyncMock,
            side_effect=ConnectionError("refused"),
        ):
            result = await mcp_mode.claim("T-1", "Backend", "pop-os", "ReaperOAK")

        assert result.success is False
        assert result.mode_used == "mcp"

    @pytest.mark.asyncio
    async def test_health_check_healthy(self, mcp_mode: McpMode) -> None:
        with patch.object(
            mcp_mode, "_call_tool", new_callable=AsyncMock
        ) as mock_call:
            mock_call.return_value = {}
            healthy = await mcp_mode.is_healthy()
        assert healthy is True

    @pytest.mark.asyncio
    async def test_health_check_unhealthy(self, mcp_mode: McpMode) -> None:
        with patch.object(
            mcp_mode,
            "_call_tool",
            new_callable=AsyncMock,
            side_effect=ConnectionError("refused"),
        ):
            healthy = await mcp_mode.is_healthy()
        assert healthy is False


# ---------------------------------------------------------------------------
# DualModeWrapper
# ---------------------------------------------------------------------------


class TestDualModeWrapper:
    """DualModeWrapper routes operations based on config and provides fallback."""

    @pytest.fixture()
    def file_mode(self) -> FileMode:
        return MagicMock(spec=FileMode)

    @pytest.fixture()
    def mcp_mode_mock(self) -> McpMode:
        return MagicMock(spec=McpMode)

    @pytest.fixture()
    def file_config(self) -> DualModeConfig:
        return DualModeConfig(mode=OperationMode.FILE)

    @pytest.fixture()
    def mcp_config(self) -> DualModeConfig:
        return DualModeConfig(mode=OperationMode.MCP, fallback_enabled=True)

    @pytest.fixture()
    def mcp_no_fallback_config(self) -> DualModeConfig:
        return DualModeConfig(mode=OperationMode.MCP, fallback_enabled=False)

    @pytest.mark.asyncio
    async def test_file_mode_routes_to_file(
        self, file_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        file_mode.claim = AsyncMock(  # type: ignore[assignment]
            return_value=OperationResult(success=True, message="ok", mode_used="file")
        )
        wrapper = DualModeWrapper(
            config=file_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.claim("T-1", "Backend", "pop-os", "ReaperOAK")
        assert result.mode_used == "file"
        file_mode.claim.assert_called_once()

    @pytest.mark.asyncio
    async def test_mcp_mode_routes_to_mcp(
        self, mcp_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        mcp_mode_mock.is_healthy = AsyncMock(return_value=True)  # type: ignore[assignment]
        mcp_mode_mock.claim = AsyncMock(  # type: ignore[assignment]
            return_value=OperationResult(success=True, message="ok", mode_used="mcp")
        )
        wrapper = DualModeWrapper(
            config=mcp_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.claim("T-1", "Backend", "pop-os", "ReaperOAK")
        assert result.mode_used == "mcp"
        mcp_mode_mock.claim.assert_called_once()

    @pytest.mark.asyncio
    async def test_mcp_fallback_to_file(
        self, mcp_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        mcp_mode_mock.is_healthy = AsyncMock(return_value=False)  # type: ignore[assignment]
        file_mode.claim = AsyncMock(  # type: ignore[assignment]
            return_value=OperationResult(success=True, message="ok", mode_used="file")
        )
        wrapper = DualModeWrapper(
            config=mcp_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.claim("T-1", "Backend", "pop-os", "ReaperOAK")
        assert result.mode_used == "file"
        file_mode.claim.assert_called_once()

    @pytest.mark.asyncio
    async def test_mcp_no_fallback_returns_error(
        self,
        mcp_no_fallback_config: DualModeConfig,
        file_mode: FileMode,
        mcp_mode_mock: McpMode,
    ) -> None:
        mcp_mode_mock.is_healthy = AsyncMock(return_value=False)  # type: ignore[assignment]
        wrapper = DualModeWrapper(
            config=mcp_no_fallback_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.claim("T-1", "Backend", "pop-os", "ReaperOAK")
        assert result.success is False
        assert "unavailable" in result.message.lower()

    @pytest.mark.asyncio
    async def test_mcp_error_fallback_to_file(
        self, mcp_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        mcp_mode_mock.is_healthy = AsyncMock(return_value=True)  # type: ignore[assignment]
        mcp_mode_mock.advance = AsyncMock(  # type: ignore[assignment]
            side_effect=ConnectionError("connection lost")
        )
        file_mode.advance = AsyncMock(  # type: ignore[assignment]
            return_value=OperationResult(success=True, message="ok", mode_used="file")
        )
        wrapper = DualModeWrapper(
            config=mcp_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.advance("T-1", "Backend")
        assert result.mode_used == "file"
        file_mode.advance.assert_called_once()

    @pytest.mark.asyncio
    async def test_set_mode_at_runtime(
        self, file_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        wrapper = DualModeWrapper(
            config=file_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        assert wrapper.current_mode is OperationMode.FILE
        wrapper.set_mode(OperationMode.MCP)
        assert wrapper.current_mode is OperationMode.MCP

    @pytest.mark.asyncio
    async def test_all_operations_routed(
        self, file_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        ok = OperationResult(success=True, message="ok", mode_used="file")
        file_mode.claim = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.advance = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.release = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.rework = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.sync = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.validate = AsyncMock(return_value=ok)  # type: ignore[assignment]
        file_mode.status = AsyncMock(return_value=ok)  # type: ignore[assignment]

        wrapper = DualModeWrapper(
            config=file_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )

        await wrapper.claim("T-1", "B", "m", "o")
        await wrapper.advance("T-1", "B")
        await wrapper.release("T-1", "done")
        await wrapper.rework("T-1", "QA", "reason")
        await wrapper.sync()
        await wrapper.validate()
        await wrapper.status()

        assert file_mode.claim.call_count == 1
        assert file_mode.advance.call_count == 1
        assert file_mode.release.call_count == 1
        assert file_mode.rework.call_count == 1
        assert file_mode.sync.call_count == 1
        assert file_mode.validate.call_count == 1
        assert file_mode.status.call_count == 1

    @pytest.mark.asyncio
    async def test_operations_log_mode(
        self,
        file_config: DualModeConfig,
        file_mode: FileMode,
        mcp_mode_mock: McpMode,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        ok = OperationResult(success=True, message="ok", mode_used="file")
        file_mode.sync = AsyncMock(return_value=ok)  # type: ignore[assignment]

        wrapper = DualModeWrapper(
            config=file_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )

        with caplog.at_level(logging.INFO):
            await wrapper.sync()

        log_messages = " ".join(r.message.lower() for r in caplog.records)
        assert "file" in log_messages and "sync" in log_messages

    @pytest.mark.asyncio
    async def test_create_from_config(self) -> None:
        cfg = DualModeConfig(mode=OperationMode.FILE)
        wrapper = DualModeWrapper.from_config(cfg)
        assert wrapper.current_mode is OperationMode.FILE
        assert isinstance(wrapper._file_backend, FileMode)
        assert isinstance(wrapper._mcp_backend, McpMode)

    @pytest.mark.asyncio
    async def test_status_with_ticket_id(
        self, file_config: DualModeConfig, file_mode: FileMode, mcp_mode_mock: McpMode
    ) -> None:
        ok = OperationResult(
            success=True, message="ok", mode_used="file", data={"ticket_id": "T-1"}
        )
        file_mode.status = AsyncMock(return_value=ok)  # type: ignore[assignment]

        wrapper = DualModeWrapper(
            config=file_config, file_backend=file_mode, mcp_backend=mcp_mode_mock
        )
        result = await wrapper.status(ticket_id="T-1")
        assert result.data is not None
        file_mode.status.assert_called_once_with(ticket_id="T-1")
