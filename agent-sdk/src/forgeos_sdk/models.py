"""Pydantic models for ForgeOS ticket operations.

Defines :class:`Ticket`, :class:`Claim`, :class:`Evidence`, and
:class:`OperationResult` — the data types returned by
:class:`~forgeos_sdk.operations.TicketOperations`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class Ticket(BaseModel):
    """A ForgeOS ticket as returned by the MCP server.

    Attributes:
        ticket_id: Human-readable ticket identifier (e.g. ``FORGEOS-BE003``).
        title: Short description of the ticket.
        type: Ticket type (``backend``, ``frontend``, ``fullstack``, etc.).
        priority: Priority level (``critical``, ``high``, ``medium``, ``low``).
        status: Operational status (``READY``, ``CLAIMED``, ``DONE``, etc.).
        stage: Current SDLC stage.
        claimed_by: UUID of the agent holding the claim, if any.
        claimed_by_name: Human-readable name of the claiming agent.
        machine_id: Hostname of the machine running the claiming agent.
        operator: Human operator who initiated the claim.
        lease_expiry: When the claim lease expires.
        file_paths: Workspace-relative paths in the ticket's scope.
        acceptance_criteria: List of acceptance criteria strings.
        depends_on: Ticket IDs this ticket depends on.
        rework_count: Number of times this ticket has been reworked.
    """

    ticket_id: str
    title: str = ""
    type: str = ""
    priority: str = ""
    status: str = ""
    stage: str = ""
    claimed_by: str | None = None
    claimed_by_name: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    lease_expiry: datetime | None = None
    file_paths: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)
    rework_count: int = 0

    model_config = {"extra": "allow"}


class Evidence(BaseModel):
    """Structured evidence for ticket stage completion.

    Attributes:
        artifacts: Workspace-relative paths of files created or modified.
        test_results: Summary of test results, or ``'N/A'`` with justification.
        confidence: Agent's self-assessed confidence (``HIGH``, ``MEDIUM``, ``LOW``).
        notes: Optional free-text notes about the work performed.
    """

    artifacts: list[str] = Field(min_length=1)
    test_results: str = Field(min_length=1)
    confidence: str = Field(pattern=r"^(HIGH|MEDIUM|LOW)$")
    notes: str | None = None


class Claim(BaseModel):
    """Result of a ticket claim operation.

    Attributes:
        ticket: The claimed ticket with updated status.
        lease_expiry: When the claim lease expires.
        file_locks: Workspace-relative file paths locked for this ticket.
    """

    ticket: Ticket
    lease_expiry: datetime
    file_locks: list[str] = Field(default_factory=list)


class OperationResult(BaseModel):
    """Generic result for operations that return a confirmation.

    Attributes:
        success: Whether the operation succeeded.
        message: Human-readable status message.
        ticket: The ticket affected by the operation, if applicable.
        data: Additional structured data from the server response.
    """

    success: bool
    message: str = ""
    ticket: Ticket | None = None
    data: dict[str, Any] = Field(default_factory=dict)
