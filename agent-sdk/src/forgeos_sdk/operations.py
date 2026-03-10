"""High-level ticket operations API for ForgeOS agents.

:class:`TicketOperations` provides an ergonomic async interface for
ticket lifecycle actions. Each method calls the corresponding MCP tool
via the connected :class:`~forgeos_sdk.client.ForgeOSClient` session
and returns typed Pydantic models.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.exceptions import ToolCallError
from forgeos_sdk.models import Evidence, OperationResult, Ticket

logger = logging.getLogger("forgeos_sdk")


class TicketOperations:
    """High-level API for ticket lifecycle operations.

    Wraps MCP tool calls with typed inputs and outputs. Requires a
    connected :class:`ForgeOSClient`.

    Parameters:
        client: A connected ForgeOS client instance.
    """

    def __init__(self, client: ForgeOSClient) -> None:
        self._client = client

    async def _call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """Call an MCP tool and return the parsed JSON response.

        Raises:
            ToolCallError: If the client is not connected, the tool returns
                an error, or the response cannot be parsed.
        """
        session = self._client.session
        if session is None:
            raise ToolCallError(tool_name, "Client is not connected")

        result = await session.call_tool(tool_name, arguments)

        text = ""
        for content_block in result.content:
            if hasattr(content_block, "text"):
                text = content_block.text
                break

        if result.isError:
            raise ToolCallError(tool_name, text or "Unknown error")

        if not text:
            return {}

        try:
            parsed: dict[str, Any] = json.loads(text)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ToolCallError(
                tool_name, f"Invalid JSON in response: {exc}"
            ) from exc

        return parsed

    def _parse_ticket(self, data: dict[str, Any]) -> Ticket:
        """Extract and validate a :class:`Ticket` from a tool response.

        Supports responses where the ticket is nested under a ``"ticket"``
        key or returned as a flat dict.
        """
        if "ticket" in data and isinstance(data["ticket"], dict):
            return Ticket.model_validate(data["ticket"])
        return Ticket.model_validate(data)

    async def claim_next(
        self,
        role: str,
        *,
        machine_id: str = "",
        operator: str = "",
    ) -> Ticket:
        """Find and return the next available ticket for the given role.

        Calls the ``tickets.next`` MCP tool.

        Parameters:
            role: SDLC stage or agent role (e.g. ``"BACKEND"``, ``"QA"``).
            machine_id: Hostname of the machine running the agent.
            operator: Human operator initiating the request.

        Returns:
            The next available ticket.

        Raises:
            ToolCallError: If no tickets are available or the call fails.
        """
        arguments: dict[str, Any] = {"stage": role}
        if machine_id:
            arguments["machine_id"] = machine_id
        if operator:
            arguments["operator"] = operator

        data = await self._call_tool("tickets.next", arguments)

        if "ticket" in data and data["ticket"] is None:
            raise ToolCallError(
                "tickets.next",
                data.get("message", "No tickets available"),
            )

        return self._parse_ticket(data)

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
        lease_minutes: int | None = None,
    ) -> Ticket:
        """Claim a specific ticket by ID.

        Calls the ``tickets.claim`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to claim (e.g. ``"FORGEOS-BE003"``).
            agent_name: Name of the claiming agent (defaults to client's agent_id).
            machine_id: Hostname (defaults to ``"unknown"``).
            operator: Human operator initiating the claim.
            lease_minutes: Custom lease duration (1–480 minutes).

        Returns:
            The claimed ticket.

        Raises:
            ToolCallError: If the claim fails (conflict, not found, etc.).
        """
        arguments: dict[str, Any] = {
            "ticket_id": ticket_id,
            "agent_name": agent_name or self._client.agent_id,
            "machine_id": machine_id or "unknown",
        }
        if operator:
            arguments["operator"] = operator
        if lease_minutes is not None:
            arguments["lease_minutes"] = lease_minutes

        data = await self._call_tool("tickets.claim", arguments)
        return self._parse_ticket(data)

    async def advance(
        self,
        ticket_id: str,
        evidence: Evidence,
    ) -> Ticket:
        """Complete the current stage and advance the ticket.

        Calls the ``tickets.complete`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to advance.
            evidence: Structured evidence proving stage completion.

        Returns:
            The ticket in its new stage.

        Raises:
            ToolCallError: If the advancement fails.
        """
        arguments: dict[str, Any] = {
            "ticket_id": ticket_id,
            "evidence": evidence.model_dump(exclude_none=True),
        }

        data = await self._call_tool("tickets.complete", arguments)
        return self._parse_ticket(data)

    async def rework(
        self,
        ticket_id: str,
        reason: str,
        *,
        evidence: dict[str, Any] | None = None,
    ) -> Ticket:
        """Reject a ticket and send it back for rework.

        Calls the ``tickets.reject`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to reject.
            reason: Human-readable reason (min 10 characters on the server).
            evidence: Optional structured evidence supporting the rejection.

        Returns:
            The ticket with updated rework state.

        Raises:
            ToolCallError: If the rejection fails.
        """
        arguments: dict[str, Any] = {
            "ticket_id": ticket_id,
            "reason": reason,
        }
        if evidence is not None:
            arguments["evidence"] = evidence

        data = await self._call_tool("tickets.reject", arguments)
        return self._parse_ticket(data)

    async def release(
        self,
        ticket_id: str,
        *,
        reason: str | None = None,
        force: bool = False,
    ) -> OperationResult:
        """Release a claim on a ticket.

        Calls the ``tickets.release`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to release.
            reason: Optional reason for releasing the claim.
            force: If ``True``, force-release (admin only).

        Returns:
            An :class:`OperationResult` with the released ticket.

        Raises:
            ToolCallError: If the release fails.
        """
        arguments: dict[str, Any] = {
            "ticket_id": ticket_id,
            "agent_name": self._client.agent_id,
        }
        if reason:
            arguments["reason"] = reason
        if force:
            arguments["force"] = force

        data = await self._call_tool("tickets.release", arguments)
        ticket = self._parse_ticket(data) if data else None
        return OperationResult(
            success=True,
            message="Ticket released successfully",
            ticket=ticket,
            data=data,
        )

    async def get_ticket(
        self,
        ticket_id: str,
    ) -> Ticket:
        """Get the current state of a ticket.

        Calls the ``tickets.status`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to query.

        Returns:
            The ticket's current state.

        Raises:
            ToolCallError: If the query fails or ticket is not found.
        """
        data = await self._call_tool("tickets.status", {"ticket_id": ticket_id})
        return self._parse_ticket(data)
