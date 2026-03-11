"""Runner hooks for agent-runner.py integration.

Provides lifecycle hooks that ``agent-runner.py`` calls at specific points
during the two-commit protocol. Hooks integrate with
:class:`~forgeos_sdk.client.ForgeOSClient` for MCP ticket operations while
``agent-runner.py`` handles all git operations.

Hook lifecycle::

    pre_claim_check  ->  [agent work]  ->  post_advance_or_rework

All hooks are optional and configurable via ``FORGEOS_HOOK_*`` environment
variables. Errors are caught, logged, and surfaced in :class:`HookResult`
without raising — the runner never crashes due to a hook failure.

Example usage from ``agent-runner.py``::

    from forgeos_sdk import ForgeOSClient
    from forgeos_sdk.runner_hooks import RunnerHooks

    client = ForgeOSClient.from_env()
    await client.connect()
    hooks = RunnerHooks(client)

    pre = await hooks.pre_claim_check("FORGEOS-BE050", agent_name="Backend")
    if not pre.success:
        print(f"Claim invalid: {pre.error}")
        return

    # ... agent does work ...

    post = await hooks.post_advance_or_rework(
        "FORGEOS-BE050",
        success=True,
        evidence=evidence,
    )
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.models import Evidence, Ticket
from forgeos_sdk.operations import TicketOperations

logger = logging.getLogger("forgeos_sdk")


@dataclass
class HookResult:
    """Result of a hook execution.

    Attributes:
        success: Whether the hook completed successfully.
        ticket: The ticket returned by the MCP operation, if any.
        error: Error message when ``success`` is ``False``.
        data: Additional metadata (e.g. ``{"skipped": True}``).
    """

    success: bool
    ticket: Ticket | None = None
    error: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class HookConfig:
    """Configuration for enabling/disabling individual hooks.

    Each flag maps to a ``FORGEOS_HOOK_*`` environment variable:

    - ``FORGEOS_HOOK_PRE_CLAIM`` — enable pre-claim validation (default: true)
    - ``FORGEOS_HOOK_POST_ADVANCE`` — enable post-advance (default: true)
    - ``FORGEOS_HOOK_POST_REWORK`` — enable post-rework (default: true)
    """

    pre_claim_enabled: bool = True
    post_advance_enabled: bool = True
    post_rework_enabled: bool = True

    @classmethod
    def from_env(cls) -> HookConfig:
        """Create a :class:`HookConfig` by reading ``FORGEOS_HOOK_*`` env vars."""
        return cls(
            pre_claim_enabled=_bool_env("FORGEOS_HOOK_PRE_CLAIM", default=True),
            post_advance_enabled=_bool_env("FORGEOS_HOOK_POST_ADVANCE", default=True),
            post_rework_enabled=_bool_env("FORGEOS_HOOK_POST_REWORK", default=True),
        )


def _bool_env(key: str, *, default: bool = True) -> bool:
    """Read an environment variable as a boolean."""
    val = os.environ.get(key, "").strip().lower()
    if not val:
        return default
    return val in ("1", "true", "yes")


class RunnerHooks:
    """Integration hooks for the ``agent-runner.py`` two-commit protocol.

    Wraps :class:`~forgeos_sdk.operations.TicketOperations` calls into
    hook methods that ``agent-runner.py`` invokes at lifecycle boundaries.
    All errors are caught and returned in :class:`HookResult` — the runner
    never crashes due to a hook failure.

    Parameters:
        client: A :class:`~forgeos_sdk.client.ForgeOSClient` instance.
        config: Optional :class:`HookConfig`; defaults loaded from env.
    """

    def __init__(
        self,
        client: ForgeOSClient,
        *,
        config: HookConfig | None = None,
    ) -> None:
        self._client = client
        self._ops = TicketOperations(client, heartbeat_interval=0)
        self._config = config or HookConfig.from_env()

    @property
    def config(self) -> HookConfig:
        """Current hook configuration."""
        return self._config

    # ------------------------------------------------------------------
    # Pre-claim hook
    # ------------------------------------------------------------------

    async def pre_claim_check(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
    ) -> HookResult:
        """Validate that *ticket_id* is claimed by *agent_name*.

        Fetches the ticket via ``tickets.status`` and verifies the claim
        metadata matches the expected agent.  Returns a failed
        :class:`HookResult` (without raising) when the ticket is unclaimed
        or claimed by a different agent.

        Args:
            ticket_id: Ticket to validate.
            agent_name: Expected claiming agent name.

        Returns:
            :class:`HookResult` with the ticket on success.
        """
        if not self._config.pre_claim_enabled:
            logger.info(
                "pre_claim_check hook disabled, skipping",
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=True, data={"skipped": True})

        try:
            ticket = await self._ops.get_ticket(ticket_id)
        except Exception as exc:
            logger.error(
                "pre_claim_check failed: %s",
                str(exc),
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=False, error=str(exc))

        if not ticket.claimed_by:
            msg = f"Ticket {ticket_id} is not claimed"
            logger.error(msg, extra={"ticket_id": ticket_id})
            return HookResult(success=False, error=msg)

        if agent_name and ticket.claimed_by != agent_name:
            msg = (
                f"Ticket {ticket_id} is claimed by another agent "
                f"({ticket.claimed_by}), expected {agent_name}"
            )
            logger.error(msg, extra={"ticket_id": ticket_id})
            return HookResult(success=False, error=msg)

        logger.info(
            "pre_claim_check succeeded",
            extra={"ticket_id": ticket_id, "stage": ticket.stage},
        )
        return HookResult(success=True, ticket=ticket)

    # ------------------------------------------------------------------
    # Post-advance / rework hook
    # ------------------------------------------------------------------

    async def post_advance_or_rework(
        self,
        ticket_id: str,
        *,
        success: bool = True,
        evidence: Evidence | None = None,
        rework_reason: str = "",
    ) -> HookResult:
        """Advance or rework a ticket based on the agent's result.

        When *success* is ``True``, calls
        :meth:`~forgeos_sdk.operations.TicketOperations.advance` with the
        provided *evidence*.  When ``False``, calls
        :meth:`~forgeos_sdk.operations.TicketOperations.rework` with
        *rework_reason*.

        Args:
            ticket_id: Ticket to advance or rework.
            success: Whether the agent work succeeded.
            evidence: Required when ``success=True``.
            rework_reason: Required when ``success=False``.

        Returns:
            :class:`HookResult` with the updated ticket.
        """
        if success:
            return await self._advance(ticket_id, evidence)
        return await self._rework(ticket_id, rework_reason)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _advance(
        self,
        ticket_id: str,
        evidence: Evidence | None,
    ) -> HookResult:
        if not self._config.post_advance_enabled:
            logger.info(
                "post_advance hook disabled, skipping",
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=True, data={"skipped": True})

        if evidence is None:
            return HookResult(
                success=False,
                error="Evidence is required for ticket advancement",
            )

        try:
            ticket = await self._ops.advance(ticket_id, evidence)
        except Exception as exc:
            logger.error(
                "post_advance failed: %s",
                str(exc),
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=False, error=str(exc))

        logger.info(
            "post_advance succeeded",
            extra={"ticket_id": ticket_id, "stage": ticket.stage},
        )
        return HookResult(success=True, ticket=ticket)

    async def _rework(
        self,
        ticket_id: str,
        reason: str,
    ) -> HookResult:
        if not self._config.post_rework_enabled:
            logger.info(
                "post_rework hook disabled, skipping",
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=True, data={"skipped": True})

        if not reason:
            return HookResult(
                success=False,
                error="Rework reason is required",
            )

        try:
            ticket = await self._ops.rework(ticket_id, reason)
        except Exception as exc:
            logger.error(
                "post_rework failed: %s",
                str(exc),
                extra={"ticket_id": ticket_id},
            )
            return HookResult(success=False, error=str(exc))

        logger.info(
            "post_rework succeeded",
            extra={"ticket_id": ticket_id},
        )
        return HookResult(success=True, ticket=ticket)
