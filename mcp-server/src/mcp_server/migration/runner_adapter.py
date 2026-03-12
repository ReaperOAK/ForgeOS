"""Runner adapter for agent-runner.py migration evolution.

Maps claim/advance operations to the correct backend (git or SDK)
based on the current migration phase. Provides fallback in Phase B.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from mcp_server.observability import get_logger

logger = get_logger("migration.runner_adapter")


class MigrationPhase(enum.Enum):
    """Migration phases for runner routing."""

    PHASE_A = "A"
    PHASE_B = "B"
    PHASE_C = "C"

    @classmethod
    def from_string(cls, value: str) -> MigrationPhase:
        """Parse a phase string, defaulting to PHASE_A."""
        normalized = value.strip().upper()
        for member in cls:
            if member.value == normalized:
                return member
        logger.warning(
            "unknown_phase_defaulting_to_a",
            extra={"phase": value},
        )
        return cls.PHASE_A


@dataclass(frozen=True)
class RunnerAdapterConfig:
    """Configuration for runner adapter routing."""

    phase: MigrationPhase = MigrationPhase.PHASE_A


@dataclass(frozen=True)
class AdaptedResult:
    """Result of an adapted operation."""

    success: bool
    backend: str  # "sdk", "git", "git_fallback"
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@runtime_checkable
class SDKClient(Protocol):
    """Protocol for MCP SDK operations."""

    async def claim(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> dict[str, Any]: ...

    async def advance(
        self,
        ticket_id: str,
        agent: str,
    ) -> dict[str, Any]: ...


@runtime_checkable
class GitClaimer(Protocol):
    """Protocol for git-based claim operations."""

    async def claim(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> dict[str, Any]: ...


class RunnerAdapter:
    """Routes claim/advance operations based on migration phase.

    Phase A: pure git — claim and advance via git.
    Phase B: SDK claim with git fallback, git advance.
    Phase C: SDK claim + SDK advance, no fallback.
    """

    def __init__(
        self,
        config: RunnerAdapterConfig,
        sdk_client: SDKClient | None = None,
        git_claimer: GitClaimer | None = None,
    ) -> None:
        self._config = config
        self._sdk_client = sdk_client
        self._git_claimer = git_claimer

    @property
    def phase(self) -> MigrationPhase:
        return self._config.phase

    async def claim(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> AdaptedResult:
        """Execute a claim operation routed by migration phase."""
        phase = self._config.phase
        logger.info(
            "claim_routing",
            extra={
                "phase": phase.value,
                "ticket_id": ticket_id,
                "agent": agent,
            },
        )

        if phase == MigrationPhase.PHASE_A:
            return await self._claim_git(ticket_id, agent, machine, operator)
        elif phase == MigrationPhase.PHASE_B:
            return await self._claim_sdk_with_fallback(
                ticket_id, agent, machine, operator
            )
        else:
            return await self._claim_sdk_only(ticket_id, agent, machine, operator)

    async def advance(
        self,
        ticket_id: str,
        agent: str,
    ) -> AdaptedResult:
        """Execute an advance operation routed by migration phase."""
        phase = self._config.phase
        logger.info(
            "advance_routing",
            extra={
                "phase": phase.value,
                "ticket_id": ticket_id,
                "agent": agent,
            },
        )

        if phase == MigrationPhase.PHASE_C:
            return await self._advance_sdk(ticket_id, agent)
        else:
            # Phase A and B: advance via git (noop adapter)
            logger.info("advance_via_git", extra={"ticket_id": ticket_id})
            return AdaptedResult(
                success=True,
                backend="git",
                data={"ticket_id": ticket_id, "agent": agent},
            )

    async def _claim_git(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> AdaptedResult:
        """Claim via git-only backend."""
        if self._git_claimer is None:
            return AdaptedResult(
                success=False,
                backend="git",
                error="No git claimer configured",
            )
        data = await self._git_claimer.claim(ticket_id, agent, machine, operator)
        logger.info("claim_via_git", extra={"ticket_id": ticket_id})
        return AdaptedResult(success=True, backend="git", data=data)

    async def _claim_sdk_with_fallback(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> AdaptedResult:
        """Claim via SDK with git fallback on failure."""
        if self._sdk_client is not None:
            try:
                data = await self._sdk_client.claim(
                    ticket_id, agent, machine, operator
                )
                logger.info("claim_via_sdk", extra={"ticket_id": ticket_id})
                return AdaptedResult(success=True, backend="sdk", data=data)
            except Exception as exc:
                logger.warning(
                    "sdk_claim_failed_falling_back",
                    extra={
                        "ticket_id": ticket_id,
                        "error": str(exc),
                    },
                )

        # Fallback to git
        if self._git_claimer is None:
            raise RuntimeError("No git claimer configured for fallback")
        data = await self._git_claimer.claim(ticket_id, agent, machine, operator)
        logger.info("claim_via_git_fallback", extra={"ticket_id": ticket_id})
        return AdaptedResult(success=True, backend="git_fallback", data=data)

    async def _claim_sdk_only(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> AdaptedResult:
        """Claim via SDK with no fallback (Phase C)."""
        if self._sdk_client is None:
            raise RuntimeError("No SDK client configured for Phase C")
        data = await self._sdk_client.claim(ticket_id, agent, machine, operator)
        logger.info("claim_via_sdk_only", extra={"ticket_id": ticket_id})
        return AdaptedResult(success=True, backend="sdk", data=data)

    async def _advance_sdk(
        self,
        ticket_id: str,
        agent: str,
    ) -> AdaptedResult:
        """Advance via SDK (Phase C only)."""
        if self._sdk_client is None:
            raise RuntimeError("No SDK client configured for Phase C advance")
        data = await self._sdk_client.advance(ticket_id, agent)
        logger.info("advance_via_sdk", extra={"ticket_id": ticket_id})
        return AdaptedResult(success=True, backend="sdk", data=data)
