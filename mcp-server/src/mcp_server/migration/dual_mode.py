"""Dual-mode wrapper for ticket lifecycle operations.

Routes operations to either the MCP server or the file-based
``tickets.py`` CLI depending on :class:`DualModeConfig`.  Supports
runtime mode switching and automatic fallback from MCP to file mode
when the server is unreachable.

Public API
----------
* :class:`OperationResult` — frozen result dataclass.
* :class:`FileMode` — delegates to ``tickets.py`` via :mod:`asyncio.subprocess`.
* :class:`McpMode` — delegates to the MCP server via JSON-RPC over HTTP.
* :class:`DualModeWrapper` — unified router with health-based fallback.
"""

from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable
from urllib.error import URLError
from urllib.request import Request, urlopen

from mcp_server.migration.config import DualModeConfig, OperationMode
from mcp_server.observability import get_logger

logger = get_logger("migration.dual_mode")


# ---------------------------------------------------------------------------
# Result value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OperationResult:
    """Immutable result of a ticket lifecycle operation.

    Attributes
    ----------
    success : bool
        Whether the operation completed without error.
    message : str
        Human-readable summary of the outcome.
    mode_used : str
        Which backend executed the operation (``"mcp"`` or ``"file"``).
    data : dict[str, Any] | None
        Optional structured payload (e.g. ticket data).
    """

    success: bool
    message: str
    mode_used: str
    data: dict[str, Any] | None = field(default=None)

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dictionary."""
        return {
            "success": self.success,
            "message": self.message,
            "mode_used": self.mode_used,
            "data": self.data,
        }


# ---------------------------------------------------------------------------
# Protocol — shared interface for backends
# ---------------------------------------------------------------------------


@runtime_checkable
class TicketOperations(Protocol):
    """Async interface for ticket lifecycle operations."""

    async def claim(
        self, ticket_id: str, agent: str, machine_id: str, operator: str
    ) -> OperationResult: ...

    async def advance(self, ticket_id: str, agent: str) -> OperationResult: ...

    async def release(self, ticket_id: str, reason: str) -> OperationResult: ...

    async def rework(
        self, ticket_id: str, agent: str, reason: str
    ) -> OperationResult: ...

    async def sync(self) -> OperationResult: ...

    async def validate(self) -> OperationResult: ...

    async def status(self, *, ticket_id: str | None = None) -> OperationResult: ...


# ---------------------------------------------------------------------------
# Subprocess helper (mockable seam)
# ---------------------------------------------------------------------------


class _SubprocessResult:
    """Thin adapter exposing stdout/stderr/returncode from an async subprocess."""

    __slots__ = ("returncode", "stderr", "stdout")

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self.returncode: int = proc.returncode or 0
        self.stdout: str = ""
        self.stderr: str = ""


async def _run_subprocess(
    args: list[str], *, timeout: int
) -> _SubprocessResult:
    """Run *args* as a subprocess, return a :class:`_SubprocessResult`."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await asyncio.wait_for(
        proc.communicate(), timeout=timeout
    )
    result = _SubprocessResult(proc)
    result.stdout = (stdout_bytes or b"").decode()
    result.stderr = (stderr_bytes or b"").decode()
    return result


# ---------------------------------------------------------------------------
# FileMode — delegate to tickets.py CLI
# ---------------------------------------------------------------------------


class FileMode:
    """Execute ticket operations by invoking ``tickets.py`` as a subprocess.

    Each method builds a CLI command matching the ``tickets.py`` argparse
    interface and captures stdout/stderr.
    """

    def __init__(self, tickets_py_path: str, timeout: int = 30) -> None:
        self._path = tickets_py_path
        self._timeout = timeout

    def _base_cmd(self) -> list[str]:
        return [sys.executable, self._path]

    async def claim(
        self, ticket_id: str, agent: str, machine_id: str, operator: str
    ) -> OperationResult:
        cmd = [*self._base_cmd(), "--claim", ticket_id, agent, machine_id, operator]
        return await self._exec(cmd, "claim")

    async def advance(self, ticket_id: str, agent: str) -> OperationResult:
        cmd = [*self._base_cmd(), "--advance", ticket_id, agent]
        return await self._exec(cmd, "advance")

    async def release(self, ticket_id: str, reason: str) -> OperationResult:
        cmd = [*self._base_cmd(), "--release", ticket_id]
        return await self._exec(cmd, "release")

    async def rework(
        self, ticket_id: str, agent: str, reason: str
    ) -> OperationResult:
        cmd = [*self._base_cmd(), "--rework", ticket_id, agent, reason]
        return await self._exec(cmd, "rework")

    async def sync(self) -> OperationResult:
        cmd = [*self._base_cmd(), "--sync"]
        return await self._exec(cmd, "sync")

    async def validate(self) -> OperationResult:
        cmd = [*self._base_cmd(), "--validate"]
        return await self._exec(cmd, "validate")

    async def status(self, *, ticket_id: str | None = None) -> OperationResult:
        cmd = [*self._base_cmd(), "--status", "--json"]
        result = await self._exec(cmd, "status")
        if result.success and result.message:
            try:
                parsed = json.loads(result.message)
                return OperationResult(
                    success=True,
                    message="status retrieved",
                    mode_used="file",
                    data=parsed,
                )
            except json.JSONDecodeError:
                pass
        return result

    async def _exec(self, cmd: list[str], operation: str) -> OperationResult:
        try:
            proc = await _run_subprocess(cmd, timeout=self._timeout)
        except asyncio.TimeoutError:
            msg = f"File-mode {operation} timed out after {self._timeout}s"
            logger.warning(msg, extra={"operation": operation})
            return OperationResult(success=False, message=msg, mode_used="file")

        if proc.returncode == 0:
            return OperationResult(
                success=True,
                message=proc.stdout.strip(),
                mode_used="file",
            )
        error_detail = (proc.stderr or proc.stdout).strip()
        return OperationResult(
            success=False,
            message=f"File-mode {operation} failed: {error_detail}",
            mode_used="file",
        )


# ---------------------------------------------------------------------------
# McpMode — delegate to MCP server via JSON-RPC over HTTP
# ---------------------------------------------------------------------------


class McpMode:
    """Execute ticket operations by calling MCP tools on the server.

    Uses stdlib :func:`urllib.request.urlopen` to avoid adding ``httpx``
    as a dependency.  All calls go to the ``/mcp`` endpoint as JSON-RPC
    tool invocations following the MCP Streamable HTTP transport.
    """

    def __init__(self, server_url: str, timeout: int = 30) -> None:
        self._url = server_url.rstrip("/")
        self._timeout = timeout
        self._request_id = 0

    async def claim(
        self, ticket_id: str, agent: str, machine_id: str, operator: str
    ) -> OperationResult:
        return await self._tool_op(
            "tickets.claim",
            {
                "ticket_id": ticket_id,
                "agent_id": agent,
                "machine_id": machine_id,
                "operator": operator,
            },
            "claim",
        )

    async def advance(self, ticket_id: str, agent: str) -> OperationResult:
        return await self._tool_op(
            "tickets.advance",
            {"ticket_id": ticket_id, "agent_id": agent},
            "advance",
        )

    async def release(self, ticket_id: str, reason: str) -> OperationResult:
        return await self._tool_op(
            "tickets.release",
            {"ticket_id": ticket_id, "agent_id": "system", "reason": reason},
            "release",
        )

    async def rework(
        self, ticket_id: str, agent: str, reason: str
    ) -> OperationResult:
        # The MCP server does not yet expose a rework tool.
        return OperationResult(
            success=False,
            message="Rework operation not available in MCP mode",
            mode_used="mcp",
        )

    async def sync(self) -> OperationResult:
        return await self._tool_op("tickets.sync", {}, "sync")

    async def validate(self) -> OperationResult:
        return await self._tool_op("tickets.validate", {}, "validate")

    async def status(self, *, ticket_id: str | None = None) -> OperationResult:
        params: dict[str, Any] = {}
        if ticket_id:
            params["ticket_id"] = ticket_id
        return await self._tool_op("tickets.status", params, "status")

    async def is_healthy(self) -> bool:
        """Probe the MCP server with a lightweight status call."""
        try:
            await self._call_tool("tickets.status", {})
            return True
        except (ConnectionError, OSError, URLError, TimeoutError):
            return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _tool_op(
        self, tool_name: str, params: dict[str, Any], operation: str
    ) -> OperationResult:
        try:
            resp = await self._call_tool(tool_name, params)
        except (ConnectionError, OSError, URLError, TimeoutError) as exc:
            msg = f"MCP {operation} failed: {exc}"
            logger.warning(msg, extra={"operation": operation, "tool": tool_name})
            return OperationResult(success=False, message=msg, mode_used="mcp")

        if isinstance(resp, dict) and resp.get("isError"):
            return OperationResult(
                success=False,
                message=resp.get("message", f"MCP {operation} error"),
                mode_used="mcp",
            )

        return OperationResult(
            success=True,
            message=f"MCP {operation} completed",
            mode_used="mcp",
            data=resp if isinstance(resp, dict) else None,
        )

    async def _call_tool(
        self, tool_name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """Send a JSON-RPC ``tools/call`` request to the MCP server.

        Runs the blocking HTTP call in a thread executor to stay async-safe.
        """
        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        body = json.dumps(payload).encode()

        def _do_request() -> dict[str, Any]:
            url = f"{self._url}/mcp"
            req = Request(
                url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                method="POST",
            )
            with urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read().decode()
            parsed = json.loads(raw)
            if "error" in parsed:
                raise ConnectionError(parsed["error"].get("message", "RPC error"))
            result = parsed.get("result", {})
            # MCP tool results contain content array — extract first text item
            if isinstance(result, dict) and "content" in result:
                for item in result["content"]:
                    if item.get("type") == "text":
                        try:
                            return json.loads(item["text"])
                        except (json.JSONDecodeError, KeyError):
                            return {"text": item.get("text", "")}
            return result if isinstance(result, dict) else {}

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _do_request)


# ---------------------------------------------------------------------------
# DualModeWrapper — unified router
# ---------------------------------------------------------------------------


class DualModeWrapper:
    """Unified ticket operations router with health-based fallback.

    In **file** mode every operation delegates to :class:`FileMode`.
    In **mcp** mode the wrapper first checks server health; if the
    server is unreachable and ``fallback_enabled`` is ``True`` in
    the config, the operation transparently falls back to file mode.

    Logs which mode was used for every operation (observability).
    """

    def __init__(
        self,
        config: DualModeConfig,
        file_backend: FileMode | None = None,
        mcp_backend: McpMode | None = None,
    ) -> None:
        self._config = config
        self._mode = config.mode
        self._file_backend = file_backend or FileMode(
            tickets_py_path=config.tickets_py_path,
            timeout=config.operation_timeout,
        )
        self._mcp_backend = mcp_backend or McpMode(
            server_url=config.mcp_server_url,
            timeout=config.operation_timeout,
        )

    @classmethod
    def from_config(cls, config: DualModeConfig | None = None) -> DualModeWrapper:
        """Factory that builds a fully-wired wrapper from config."""
        cfg = config or DualModeConfig()
        return cls(config=cfg)

    # -- Mode management ---------------------------------------------------

    @property
    def current_mode(self) -> OperationMode:
        """Return the currently active mode."""
        return self._mode

    def set_mode(self, mode: OperationMode) -> None:
        """Switch operational mode at runtime."""
        logger.info(
            "Mode switched from %s to %s",
            self._mode.value,
            mode.value,
            extra={"old_mode": self._mode.value, "new_mode": mode.value},
        )
        self._mode = mode

    # -- Public operations -------------------------------------------------

    async def claim(
        self, ticket_id: str, agent: str, machine_id: str, operator: str
    ) -> OperationResult:
        return await self._dispatch(
            "claim", ticket_id=ticket_id, agent=agent, machine_id=machine_id, operator=operator
        )

    async def advance(self, ticket_id: str, agent: str) -> OperationResult:
        return await self._dispatch("advance", ticket_id=ticket_id, agent=agent)

    async def release(self, ticket_id: str, reason: str) -> OperationResult:
        return await self._dispatch("release", ticket_id=ticket_id, reason=reason)

    async def rework(
        self, ticket_id: str, agent: str, reason: str
    ) -> OperationResult:
        return await self._dispatch(
            "rework", ticket_id=ticket_id, agent=agent, reason=reason
        )

    async def sync(self) -> OperationResult:
        return await self._dispatch("sync")

    async def validate(self) -> OperationResult:
        return await self._dispatch("validate")

    async def status(self, *, ticket_id: str | None = None) -> OperationResult:
        return await self._dispatch("status", ticket_id=ticket_id)

    # -- Internal routing --------------------------------------------------

    async def _dispatch(self, operation: str, **kwargs: Any) -> OperationResult:
        """Route *operation* to the appropriate backend."""
        backend = await self._select_backend(operation)

        if backend is None:
            return OperationResult(
                success=False,
                message=f"MCP server unavailable and fallback disabled for {operation}",
                mode_used="mcp",
            )

        mode_label = "mcp" if backend is self._mcp_backend else "file"
        logger.info(
            "Executing %s via %s mode",
            operation,
            mode_label,
            extra={"operation": operation, "mode": mode_label},
        )

        try:
            method = getattr(backend, operation)
            result: OperationResult = await method(**kwargs)
        except (ConnectionError, OSError, TimeoutError) as exc:
            # MCP backend failed mid-operation — try fallback
            if (
                backend is self._mcp_backend
                and self._config.fallback_enabled
            ):
                logger.warning(
                    "MCP %s failed (%s), falling back to file mode",
                    operation,
                    exc,
                    extra={"operation": operation, "error": str(exc)},
                )
                method = getattr(self._file_backend, operation)
                result = await method(**kwargs)
            else:
                return OperationResult(
                    success=False,
                    message=f"{operation} failed: {exc}",
                    mode_used=mode_label,
                )

        logger.info(
            "Completed %s via %s mode (success=%s)",
            operation,
            result.mode_used,
            result.success,
            extra={
                "operation": operation,
                "mode_used": result.mode_used,
                "success": result.success,
            },
        )
        return result

    async def _select_backend(self, operation: str) -> FileMode | McpMode | None:
        """Pick the backend to use, considering health and fallback policy."""
        if self._mode is OperationMode.FILE:
            return self._file_backend

        # MCP mode — check health first
        healthy = await self._mcp_backend.is_healthy()
        if healthy:
            return self._mcp_backend

        if self._config.fallback_enabled:
            logger.warning(
                "MCP server unhealthy for %s, falling back to file mode",
                operation,
                extra={"operation": operation},
            )
            return self._file_backend

        logger.error(
            "MCP server unavailable and fallback disabled for %s",
            operation,
            extra={"operation": operation},
        )
        return None
