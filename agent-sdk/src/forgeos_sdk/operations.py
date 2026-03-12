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
from forgeos_sdk.heartbeat import LeaseHeartbeat
from forgeos_sdk.models import (
    BlastRadiusResult,
    ContextResponse,
    DelegationPayload,
    Evidence,
    ImportChainResult,
    IndexResult,
    Lesson,
    ListResponse,
    MemoryAddLessonInput,
    MemoryGetContextInput,
    MemorySearchLessonsInput,
    OperationResult,
    OrientationResult,
    SymbolSearchResult,
    Ticket,
)

logger = logging.getLogger("forgeos_sdk")


class TicketOperations:
    """High-level API for ticket lifecycle operations.

    Wraps MCP tool calls with typed inputs and outputs. Requires a
    connected :class:`ForgeOSClient`.

    Parameters:
        client: A connected ForgeOS client instance.
        heartbeat_interval: Heartbeat interval in seconds (default: from env
            or 300). Pass ``0`` to disable automatic heartbeats.
    """

    def __init__(
        self,
        client: ForgeOSClient,
        *,
        heartbeat_interval: float | None = None,
    ) -> None:
        self._client = client
        self._heartbeat_interval = heartbeat_interval
        self._heartbeats: dict[str, LeaseHeartbeat] = {}

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

        ticket = self._parse_ticket(data)
        await self._start_heartbeat(ticket.ticket_id)
        return ticket

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
        ticket = self._parse_ticket(data)
        await self._start_heartbeat(ticket.ticket_id)
        return ticket

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
        ticket = self._parse_ticket(data)
        await self._stop_heartbeat(ticket_id)
        return ticket

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
        ticket = self._parse_ticket(data)
        await self._stop_heartbeat(ticket_id)
        return ticket

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
        await self._stop_heartbeat(ticket_id)
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

    # ------------------------------------------------------------------
    # Cutover MCP tools (tickets.get, tickets.list, tickets.payload)
    # ------------------------------------------------------------------

    async def tickets_get(
        self,
        ticket_id: str,
    ) -> Ticket:
        """Get full ticket detail by ID.

        Calls the ``tickets.get`` MCP tool.

        Parameters:
            ticket_id: The ticket ID to retrieve (e.g. ``"FORGEOS-BE003"``).

        Returns:
            The ticket with full detail.

        Raises:
            ToolCallError: If the query fails or the ticket is not found.
        """
        data = await self._call_tool("tickets.get", {"ticket_id": ticket_id})
        return self._parse_ticket(data)

    async def tickets_list(
        self,
        *,
        stage: str | None = None,
        status: str | None = None,
        type: str | None = None,
        priority: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ListResponse:
        """List tickets with optional filtering and pagination.

        Calls the ``tickets.list`` MCP tool.

        Parameters:
            stage: Filter by SDLC stage (e.g. ``"BACKEND"``).
            status: Filter by status (e.g. ``"READY"``, ``"CLAIMED"``).
            type: Filter by ticket type (e.g. ``"backend"``, ``"frontend"``).
            priority: Filter by priority (e.g. ``"critical"``, ``"high"``).
            limit: Maximum tickets per page (default 50).
            offset: Zero-based offset into the result set.

        Returns:
            A :class:`ListResponse` containing matched tickets and pagination info.

        Raises:
            ToolCallError: If the query fails.
        """
        arguments: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
        }
        if stage is not None:
            arguments["stage"] = stage
        if status is not None:
            arguments["status"] = status
        if type is not None:
            arguments["type"] = type
        if priority is not None:
            arguments["priority"] = priority

        data = await self._call_tool("tickets.list", arguments)
        return ListResponse.model_validate(data)

    async def tickets_payload(
        self,
        ticket_id: str,
        agent_role: str,
    ) -> DelegationPayload:
        """Get the delegation payload for a ticket and agent role.

        Calls the ``tickets.payload`` MCP tool. Returns the full ticket,
        upstream summary from the previous stage agent, relevant memory
        entries, and authorized file scope.

        Parameters:
            ticket_id: The ticket ID to retrieve context for.
            agent_role: The SDLC stage or agent role (e.g. ``"BACKEND"``).

        Returns:
            A :class:`DelegationPayload` with full delegation context.

        Raises:
            ToolCallError: If the query fails or the ticket is not found.
        """
        data = await self._call_tool(
            "tickets.payload",
            {"ticket_id": ticket_id, "agent_role": agent_role},
        )
        return DelegationPayload.model_validate(data)

    # ------------------------------------------------------------------
    # Code graph tools (code.blast_radius, code.search_symbols,
    #                    code.get_imports)
    # ------------------------------------------------------------------

    async def code_blast_radius(
        self,
        file_path: str,
        *,
        max_depth: int | None = None,
    ) -> BlastRadiusResult:
        """Analyse the blast radius of a file change.

        Calls the ``code.blast_radius`` MCP tool to find all symbols
        and files transitively affected by changes to *file_path*.

        Parameters:
            file_path: Workspace-relative path to analyse.
            max_depth: Maximum traversal depth (optional).

        Returns:
            A :class:`BlastRadiusResult` with affected files and symbols.

        Raises:
            ToolCallError: If the analysis fails.
        """
        arguments: dict[str, Any] = {"file_path": file_path}
        if max_depth is not None:
            arguments["max_depth"] = max_depth

        data = await self._call_tool("code.blast_radius", arguments)
        return BlastRadiusResult.model_validate(data)

    async def code_search_symbols(
        self,
        name_pattern: str,
        *,
        kind: str | None = None,
        file_path: str | None = None,
    ) -> SymbolSearchResult:
        """Search for code symbols by name pattern.

        Calls the ``code.search_symbols`` MCP tool.

        Parameters:
            name_pattern: Glob or regex pattern to match symbol names.
            kind: Optional filter by symbol kind (e.g. ``"function"``,
                ``"class"``).
            file_path: Optional workspace-relative path to restrict
                the search scope.

        Returns:
            A :class:`SymbolSearchResult` with matching symbols.

        Raises:
            ToolCallError: If the search fails.
        """
        arguments: dict[str, Any] = {"name_pattern": name_pattern}
        if kind is not None:
            arguments["kind"] = kind
        if file_path is not None:
            arguments["file_path"] = file_path

        data = await self._call_tool("code.search_symbols", arguments)
        return SymbolSearchResult.model_validate(data)

    async def code_get_imports(
        self,
        file_path: str,
        *,
        max_depth: int | None = None,
    ) -> ImportChainResult:
        """Get the import chain for a file.

        Calls the ``code.get_imports`` MCP tool to traverse the import
        graph starting from *file_path*.

        Parameters:
            file_path: Workspace-relative path to analyse.
            max_depth: Maximum traversal depth (optional).

        Returns:
            An :class:`ImportChainResult` with import edges.

        Raises:
            ToolCallError: If the analysis fails.
        """
        arguments: dict[str, Any] = {"file_path": file_path}
        if max_depth is not None:
            arguments["max_depth"] = max_depth

        data = await self._call_tool("code.get_imports", arguments)
        return ImportChainResult.model_validate(data)

    # ------------------------------------------------------------------
    # Init tools (init.index, init.orient)
    # ------------------------------------------------------------------

    async def init_index(
        self,
        root_path: str,
        *,
        force: bool = False,
    ) -> IndexResult:
        """Index a codebase directory for symbols and imports.

        Calls the ``init.index`` MCP tool to scan and index all source
        files under *root_path*.

        Parameters:
            root_path: Workspace-relative path to the directory to index.
            force: If ``True``, re-index even if a cached index exists.

        Returns:
            An :class:`IndexResult` with indexing statistics.

        Raises:
            ToolCallError: If the indexing fails.
        """
        arguments: dict[str, Any] = {"root_path": root_path}
        if force:
            arguments["force"] = force

        data = await self._call_tool("init.index", arguments)
        return IndexResult.model_validate(data)

    async def init_orient(
        self,
        root_path: str,
    ) -> OrientationResult:
        """Scan a project directory and detect its technology stack.

        Calls the ``init.orient`` MCP tool to identify the project name,
        package manager, frameworks, languages, entry points, test
        framework, and build system.

        Parameters:
            root_path: Workspace-relative path to the project root.

        Returns:
            An :class:`OrientationResult` with detected project metadata.

        Raises:
            ToolCallError: If the orientation scan fails.
        """
        data = await self._call_tool("init.orient", {"root_path": root_path})
        return OrientationResult.model_validate(data)

    # ------------------------------------------------------------------
    # Memory tools (memory.search_lessons, memory.add_lesson,
    #               memory.get_context)
    # ------------------------------------------------------------------

    async def memory_search_lessons(
        self,
        query: str,
        *,
        category: str | None = None,
        max_results: int | None = None,
    ) -> list[Lesson]:
        """Search lessons in the memory system.

        Calls the ``memory.search_lessons`` MCP tool.

        Parameters:
            query: Free-text search query.
            category: Optional category filter (e.g. ``"bug_fix"``,
                ``"pattern"``).
            max_results: Maximum number of lessons to return.

        Returns:
            A list of :class:`Lesson` objects matching the query.

        Raises:
            ToolCallError: If the search fails.
        """
        params = MemorySearchLessonsInput(
            query=query, category=category, max_results=max_results,
        )
        arguments = params.model_dump(exclude_none=True)
        data = await self._call_tool("memory.search_lessons", arguments)
        raw_lessons = data.get("lessons", [])
        return [Lesson.model_validate(item) for item in raw_lessons]

    async def memory_add_lesson(
        self,
        ticket_id: str,
        title: str,
        content: str,
        category: str,
    ) -> OperationResult:
        """Add a lesson to the memory system.

        Calls the ``memory.add_lesson`` MCP tool.

        Parameters:
            ticket_id: The ticket that produced this lesson.
            title: Short title for the lesson.
            content: Full lesson content.
            category: Lesson category (e.g. ``"bug_fix"``, ``"pattern"``).

        Returns:
            An :class:`OperationResult` confirming the lesson was added.

        Raises:
            ToolCallError: If the operation fails.
        """
        params = MemoryAddLessonInput(
            ticket_id=ticket_id,
            title=title,
            content=content,
            category=category,
        )
        arguments = params.model_dump()
        data = await self._call_tool("memory.add_lesson", arguments)
        return OperationResult(
            success=True,
            message=data.get("message", "Lesson added successfully"),
            data=data,
        )

    async def memory_get_context(
        self,
        *,
        file_path: str | None = None,
        ticket_id: str | None = None,
        max_lessons: int | None = None,
    ) -> ContextResponse:
        """Get contextual information from the memory system.

        Calls the ``memory.get_context`` MCP tool to retrieve blast
        radius information and relevant lessons for a file or ticket.

        Parameters:
            file_path: Optional workspace-relative file path.
            ticket_id: Optional ticket ID to scope context.
            max_lessons: Maximum number of relevant lessons to include.

        Returns:
            A :class:`ContextResponse` with blast radius and lessons.

        Raises:
            ToolCallError: If the query fails.
        """
        params = MemoryGetContextInput(
            file_path=file_path,
            ticket_id=ticket_id,
            max_lessons=max_lessons,
        )
        arguments = params.model_dump(exclude_none=True)
        data = await self._call_tool("memory.get_context", arguments)
        return ContextResponse.model_validate(data)

    # ------------------------------------------------------------------
    # Heartbeat management
    # ------------------------------------------------------------------

    async def _start_heartbeat(self, ticket_id: str) -> None:
        """Start a background heartbeat for the given ticket.

        Skips if heartbeat_interval is explicitly set to ``0``.
        """
        if self._heartbeat_interval is not None and self._heartbeat_interval <= 0:
            return
        await self._stop_heartbeat(ticket_id)
        kwargs: dict[str, float] = {}
        if self._heartbeat_interval is not None:
            kwargs["interval_seconds"] = self._heartbeat_interval
        hb = LeaseHeartbeat(self._client, ticket_id, **kwargs)
        hb.start()
        self._heartbeats[ticket_id] = hb
        logger.debug("Heartbeat started for %s", ticket_id)

    async def _stop_heartbeat(self, ticket_id: str) -> None:
        """Stop and remove the heartbeat for the given ticket, if any."""
        hb = self._heartbeats.pop(ticket_id, None)
        if hb is not None:
            await hb.stop()
            logger.debug("Heartbeat stopped for %s", ticket_id)

    async def stop_all_heartbeats(self) -> None:
        """Stop all active heartbeats. Call during cleanup."""
        ticket_ids = list(self._heartbeats.keys())
        for tid in ticket_ids:
            await self._stop_heartbeat(tid)
