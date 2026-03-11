"""Migration Phase B — SDK with Fallback.

Agents use the ForgeOS SDK for ticket operations, with automatic
fallback to the filesystem (``tickets.py``) when the MCP server is
unreachable.  Feature flags transition per-operation from ``filesystem``
to ``dual``.  The CLAIM operation migrates first, while WORK commits
remain purely git-based.

Key properties of Phase B:

* **MCP primary, filesystem fallback** — the ``claim`` flag is set to
  ``dual`` mode.  The SDK attempts the MCP path first and transparently
  falls back to ``tickets.py`` if the server is unreachable.
* **WORK commits unchanged** — work commits remain git-based.
* **Operation logging** — every operation records whether it succeeded
  via MCP or fallback, enabling manual sync verification.
* **Transition gate** — Phase B exits only when **95 %+ operations
  succeed via MCP** for **48+ consecutive hours** (configurable).

Usage::

    phase_b = PhaseB(config)
    await phase_b.enter()
    result = await phase_b.execute_claim(ticket_id, agent, machine, op)
    report = await phase_b.validate()
    if report.can_transition:
        await phase_b.exit()
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any

from mcp_server.migration.feature_flags import FeatureFlagManager, FlagMode
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from pathlib import Path

logger = get_logger("migration.phase_b")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_GATE_MCP_PERCENT = 95.0
_DEFAULT_GATE_HOURS = 48.0
_MAX_OP_LOG_SIZE = 10_000


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class PhaseBStatus(str, Enum):
    """Lifecycle state of Phase B."""

    INACTIVE = "inactive"
    ACTIVE = "active"
    TRANSITIONING = "transitioning"


# ---------------------------------------------------------------------------
# Operation result tracking
# ---------------------------------------------------------------------------


class OperationBackend(str, Enum):
    """Which backend handled the operation."""

    MCP = "mcp"
    FALLBACK = "fallback"


@dataclass(frozen=True)
class OperationRecord:
    """Record of a single ticket operation.

    Attributes:
        operation: The operation name (e.g. ``"claim"``).
        ticket_id: The ticket the operation targeted.
        backend: Which backend handled the request.
        success: Whether the operation succeeded.
        timestamp: ISO-8601 timestamp of the operation.
        error: Error message if the operation failed.
    """

    operation: str
    ticket_id: str
    backend: OperationBackend
    success: bool
    timestamp: str
    error: str = ""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PhaseBConfig:
    """Settings for Phase B.

    Attributes:
        flags_config_path: Path to the migration-flags YAML file.
        transition_gate_mcp_percent: Minimum MCP success percentage
            required to exit Phase B (default 95.0).
        transition_gate_hours: Hours of sustained MCP success percentage
            required to exit Phase B (default 48.0).
        max_operation_log_size: Maximum number of operation records to
            retain in the rolling window (default 10 000).
    """

    flags_config_path: Path
    transition_gate_mcp_percent: float = _DEFAULT_GATE_MCP_PERCENT
    transition_gate_hours: float = _DEFAULT_GATE_HOURS
    max_operation_log_size: int = _MAX_OP_LOG_SIZE


# ---------------------------------------------------------------------------
# Transition report
# ---------------------------------------------------------------------------


@dataclass
class TransitionReport:
    """Result of evaluating the Phase B transition gate.

    Attributes:
        total_operations: Total number of operations in the window.
        mcp_successes: Operations that succeeded via MCP.
        fallback_operations: Operations handled by fallback.
        mcp_success_percent: Percentage of operations via MCP.
        can_transition: Whether the gate criteria are met.
        gate_met_since: ISO-8601 timestamp when the gate was first met
            in the current window, or ``None``.
        gate_met_hours: Hours the gate has been continuously met.
        validated_at: ISO-8601 timestamp of this report.
    """

    total_operations: int = 0
    mcp_successes: int = 0
    fallback_operations: int = 0
    mcp_success_percent: float = 0.0
    can_transition: bool = False
    gate_met_since: str | None = None
    gate_met_hours: float = 0.0
    validated_at: str = ""


# ---------------------------------------------------------------------------
# SDK adapter protocol
# ---------------------------------------------------------------------------


class SDKClaimAdapter:
    """Adapter that calls the ForgeOS SDK to perform a claim.

    This is a thin wrapper so Phase B can be tested without importing
    the real SDK.  In production, pass an instance backed by a real
    :class:`~forgeos_sdk.operations.TicketOperations`.
    """

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
    ) -> dict[str, Any]:
        """Perform a claim via MCP SDK.

        Returns:
            Dict with at least ``"ticket_id"`` on success.

        Raises:
            Exception: On any MCP communication or tool-call failure.
        """
        raise NotImplementedError  # pragma: no cover


class FilesystemClaimAdapter:
    """Adapter that performs a claim via the filesystem / ``tickets.py``.

    Like :class:`SDKClaimAdapter`, this is a testable interface.
    """

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
    ) -> dict[str, Any]:
        """Perform a claim via the filesystem fallback.

        Returns:
            Dict with at least ``"ticket_id"`` on success.

        Raises:
            Exception: On any filesystem operation failure.
        """
        raise NotImplementedError  # pragma: no cover


# ---------------------------------------------------------------------------
# Phase B
# ---------------------------------------------------------------------------


class PhaseB:
    """Migration Phase B — SDK-primary claim with filesystem fallback.

    Parameters
    ----------
    config:
        Phase B configuration.
    sdk_adapter:
        Adapter for MCP SDK claim operations.
    fs_adapter:
        Adapter for filesystem fallback claim operations.
    """

    def __init__(
        self,
        config: PhaseBConfig,
        sdk_adapter: SDKClaimAdapter,
        fs_adapter: FilesystemClaimAdapter,
    ) -> None:
        self._config = config
        self._sdk_adapter = sdk_adapter
        self._fs_adapter = fs_adapter
        self._status = PhaseBStatus.INACTIVE
        self._entered_at: str | None = None
        self._exited_at: str | None = None
        self._gate_met_since: str | None = None
        self._operations: deque[OperationRecord] = deque(
            maxlen=config.max_operation_log_size,
        )

    # -- properties --------------------------------------------------------

    @property
    def status(self) -> PhaseBStatus:
        """Current lifecycle status."""
        return self._status

    @property
    def entered_at(self) -> str | None:
        """ISO-8601 timestamp of phase entry, or ``None``."""
        return self._entered_at

    @property
    def exited_at(self) -> str | None:
        """ISO-8601 timestamp of phase exit, or ``None``."""
        return self._exited_at

    @property
    def operation_log(self) -> list[OperationRecord]:
        """Snapshot of the operation log (most-recent first)."""
        return list(self._operations)

    # -- lifecycle ---------------------------------------------------------

    async def enter(self) -> None:
        """Enter Phase B: verify claim flag is ``dual``, log entry.

        Raises:
            RuntimeError: If Phase B is already active.
            ValueError: If the ``claim`` flag is not set to ``dual``.
        """
        if self._status == PhaseBStatus.ACTIVE:
            raise RuntimeError("Phase B is already active")

        self._verify_claim_flag_dual()

        self._entered_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseBStatus.ACTIVE
        self._operations.clear()
        self._gate_met_since = None

        mcp_pct, total = self._mcp_success_stats()
        logger.info(
            "Phase B entered — SDK-primary claim with fallback",
            extra={
                "entered_at": self._entered_at,
                "mcp_success_percent": mcp_pct,
                "total_operations": total,
                "gate_mcp_percent": self._config.transition_gate_mcp_percent,
                "gate_hours": self._config.transition_gate_hours,
            },
        )

    async def exit(self) -> TransitionReport:
        """Exit Phase B: build report, log exit.

        Returns:
            Final :class:`TransitionReport`.

        Raises:
            RuntimeError: If Phase B is not active.
        """
        if self._status != PhaseBStatus.ACTIVE:
            raise RuntimeError("Phase B is not active — cannot exit")

        self._status = PhaseBStatus.TRANSITIONING
        report = self.validate()

        self._exited_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseBStatus.INACTIVE

        mcp_pct, total = self._mcp_success_stats()
        logger.info(
            "Phase B exited",
            extra={
                "exited_at": self._exited_at,
                "mcp_success_percent": mcp_pct,
                "total_operations": total,
                "can_transition": report.can_transition,
            },
        )
        return report

    # -- dual-mode claim ---------------------------------------------------

    async def execute_claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
    ) -> dict[str, Any]:
        """Execute a claim in dual mode: MCP primary, filesystem fallback.

        If Phase B is not active, raises ``RuntimeError``.

        Parameters
        ----------
        ticket_id:
            Ticket to claim.
        agent_name:
            Claiming agent identifier.
        machine_id:
            Machine hostname.
        operator:
            Human operator name.

        Returns
        -------
        dict
            The claim result dict (contains at least ``"ticket_id"``).

        Raises
        ------
        RuntimeError
            If Phase B is not active.
        RuntimeError
            If both MCP and fallback fail.
        """
        if self._status != PhaseBStatus.ACTIVE:
            raise RuntimeError("Phase B is not active — call enter() first")

        now_iso = datetime.now(timezone.utc).isoformat()
        kwargs = {
            "agent_name": agent_name,
            "machine_id": machine_id,
            "operator": operator,
        }

        # --- attempt MCP path ---
        mcp_error: Exception | None = None
        try:
            result = await self._sdk_adapter.claim(ticket_id, **kwargs)
            self._record_operation(
                operation="claim",
                ticket_id=ticket_id,
                backend=OperationBackend.MCP,
                success=True,
                timestamp=now_iso,
            )
            logger.info(
                "Claim succeeded via MCP",
                extra={"ticket_id": ticket_id, "backend": "mcp"},
            )
            return result
        except Exception as exc:
            mcp_error = exc
            logger.warning(
                "MCP claim failed — activating fallback",
                extra={
                    "ticket_id": ticket_id,
                    "error": str(exc),
                },
            )

        # --- fallback to filesystem ---
        try:
            result = await self._fs_adapter.claim(ticket_id, **kwargs)
            self._record_operation(
                operation="claim",
                ticket_id=ticket_id,
                backend=OperationBackend.FALLBACK,
                success=True,
                timestamp=now_iso,
            )
            logger.warning(
                "Claim succeeded via FALLBACK — needs manual sync verification",
                extra={"ticket_id": ticket_id, "backend": "fallback"},
            )
            return result
        except Exception as fs_err:
            self._record_operation(
                operation="claim",
                ticket_id=ticket_id,
                backend=OperationBackend.FALLBACK,
                success=False,
                timestamp=now_iso,
                error=str(fs_err),
            )
            raise RuntimeError(
                f"Both MCP and fallback claim failed for {ticket_id}: "
                f"mcp={mcp_error}, fs={fs_err}"
            ) from fs_err

    # -- validation / transition gate --------------------------------------

    def validate(self) -> TransitionReport:
        """Evaluate whether the Phase B transition gate is met.

        The gate requires ``transition_gate_mcp_percent`` of operations
        to have succeeded via MCP for ``transition_gate_hours`` consecutive
        hours.

        Returns:
            :class:`TransitionReport` with current metrics.
        """
        mcp_pct, total = self._mcp_success_stats()
        mcp_successes = sum(
            1
            for r in self._operations
            if r.backend == OperationBackend.MCP and r.success
        )
        fallback_count = sum(
            1 for r in self._operations if r.backend == OperationBackend.FALLBACK
        )

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        gate_threshold = self._config.transition_gate_mcp_percent
        meets_pct = total > 0 and mcp_pct >= gate_threshold

        if meets_pct:
            if self._gate_met_since is None:
                self._gate_met_since = now_iso
            since = datetime.fromisoformat(self._gate_met_since)
            hours = (now - since).total_seconds() / 3600.0
        else:
            self._gate_met_since = None
            hours = 0.0

        can_transition = (
            meets_pct and hours >= self._config.transition_gate_hours
        )

        report = TransitionReport(
            total_operations=total,
            mcp_successes=mcp_successes,
            fallback_operations=fallback_count,
            mcp_success_percent=round(mcp_pct, 2),
            can_transition=can_transition,
            gate_met_since=self._gate_met_since,
            gate_met_hours=round(hours, 2),
            validated_at=now_iso,
        )

        logger.info(
            "Phase B validation complete",
            extra={
                "total_ops": total,
                "mcp_pct": round(mcp_pct, 2),
                "fallback_ops": fallback_count,
                "can_transition": can_transition,
                "gate_hours": round(hours, 2),
            },
        )
        return report

    # -- metrics helpers ---------------------------------------------------

    def _mcp_success_stats(self) -> tuple[float, int]:
        """Return ``(mcp_success_percentage, total_operations)``."""
        total = len(self._operations)
        if total == 0:
            return 0.0, 0
        mcp_ok = sum(
            1
            for r in self._operations
            if r.backend == OperationBackend.MCP and r.success
        )
        return (mcp_ok / total) * 100.0, total

    def get_fallback_operations(self) -> list[OperationRecord]:
        """Return all operations that used the fallback backend.

        These require manual sync verification.
        """
        return [
            r for r in self._operations if r.backend == OperationBackend.FALLBACK
        ]

    def get_success_ratio(self) -> dict[str, Any]:
        """Return a summary dict of operation success ratios."""
        total = len(self._operations)
        mcp_ok = sum(
            1
            for r in self._operations
            if r.backend == OperationBackend.MCP and r.success
        )
        fb_ok = sum(
            1
            for r in self._operations
            if r.backend == OperationBackend.FALLBACK and r.success
        )
        failures = sum(1 for r in self._operations if not r.success)
        return {
            "total": total,
            "mcp_successes": mcp_ok,
            "fallback_successes": fb_ok,
            "failures": failures,
            "mcp_percent": round((mcp_ok / total * 100.0) if total else 0.0, 2),
        }

    # -- internal helpers --------------------------------------------------

    def _record_operation(
        self,
        *,
        operation: str,
        ticket_id: str,
        backend: OperationBackend,
        success: bool,
        timestamp: str,
        error: str = "",
    ) -> None:
        """Append an operation record to the rolling log."""
        record = OperationRecord(
            operation=operation,
            ticket_id=ticket_id,
            backend=backend,
            success=success,
            timestamp=timestamp,
            error=error,
        )
        self._operations.append(record)

    def _verify_claim_flag_dual(self) -> None:
        """Ensure the ``claim`` feature flag is set to ``dual`` mode.

        Raises:
            ValueError: If the ``claim`` flag is not ``dual``.
        """
        manager = FeatureFlagManager(self._config.flags_config_path)
        manager.load()

        mode = manager.get_mode("claim")
        if mode != FlagMode.DUAL:
            raise ValueError(
                f"Phase B requires the 'claim' flag in 'dual' mode, "
                f"but found '{mode.value}'"
            )
