"""Pydantic response/request schemas for the REST API.

Defines typed models for ticket list responses, ensuring consistent
serialisation across all REST endpoints.

.. meta::
   :ticket: FORGEOS-BE034
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TicketStageEnum(str, Enum):
    """Valid SDLC stage values."""

    READY = "READY"
    RESEARCH = "RESEARCH"
    ARCHITECT = "ARCHITECT"
    PRODUCT_MANAGER = "PRODUCT_MANAGER"
    UI_DESIGN = "UI_DESIGN"
    BACKEND = "BACKEND"
    FRONTEND = "FRONTEND"
    QA = "QA"
    SECURITY = "SECURITY"
    CI = "CI"
    DOCUMENTATION = "DOCUMENTATION"
    VALIDATOR = "VALIDATOR"
    DONE = "DONE"


class TicketTypeEnum(str, Enum):
    """Valid ticket type values."""

    BACKEND = "backend"
    FRONTEND = "frontend"
    FULLSTACK = "fullstack"
    INFRA = "infra"
    SECURITY = "security"
    DOCS = "docs"
    RESEARCH = "research"
    ARCHITECTURE = "architecture"
    PRODUCT = "product"
    DESIGN = "design"


class TicketPriorityEnum(str, Enum):
    """Valid ticket priority values."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TicketSummary(BaseModel):
    """Summary representation of a ticket in list responses."""

    ticket_id: str
    title: str
    type: str
    priority: str
    stage: str
    status: str
    claimed_by_name: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    rework_count: int = 0
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PaginationMeta(BaseModel):
    """Pagination metadata included in list responses."""

    total: int
    limit: int
    offset: int


class TicketListResponse(BaseModel):
    """Response body for ``GET /api/tickets``."""

    tickets: list[TicketSummary]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Pipeline schemas (FORGEOS-BE038)
# ---------------------------------------------------------------------------


class StageCount(BaseModel):
    """Ticket count for a single SDLC stage."""

    stage: str
    count: int


class StageTypeCount(BaseModel):
    """Ticket count for a stage+type combination."""

    stage: str
    type: str
    count: int


class PipelineResponse(BaseModel):
    """Response body for ``GET /api/pipeline``."""

    stages: list[StageCount]
    total: int
    group_by_type: list[StageTypeCount] | None = None


# ---------------------------------------------------------------------------
# Health schemas (FORGEOS-BE038)
# ---------------------------------------------------------------------------


class ComponentHealth(BaseModel):
    """Health status of a single server component."""

    name: str
    status: str
    details: dict[str, object] | None = None


class HealthResponse(BaseModel):
    """Response body for ``GET /api/health``."""

    status: str
    version: str
    uptime_seconds: float
    response_time_ms: float
    components: list[ComponentHealth]


class DependencyInfo(BaseModel):
    """Resolved dependency status for a ticket's depends_on entry."""

    ticket_id: str
    title: str | None = None
    stage: str | None = None
    is_done: bool = False


class TicketDetailResponse(BaseModel):
    """Response body for ``GET /api/tickets/{ticket_id}``.

    .. meta::
       :ticket: FORGEOS-BE035
    """

    ticket_id: str
    title: str
    description: str
    type: str
    priority: str
    stage: str
    status: str
    sdlc_flow: list[str] = Field(default_factory=list)
    claimed_by_name: str | None = None
    machine_id: str | None = None
    operator: str | None = None
    lease_expiry: datetime | None = None
    depends_on: list[str] = Field(default_factory=list)
    resolved_dependencies: list[DependencyInfo] = Field(default_factory=list)
    file_paths: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    rework_count: int = 0
    source_task_file: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class HistoryEntry(BaseModel):
    """A single event in a ticket's audit history.

    .. meta::
       :ticket: FORGEOS-BE035
    """

    event_type: str
    agent_id: str
    machine_id: str
    timestamp: datetime
    previous_stage: str | None = None
    new_stage: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    sequence_number: int = 0
    aggregate_version: int = 0


class HistoryListResponse(BaseModel):
    """Response body for ``GET /api/tickets/{ticket_id}/history``.

    .. meta::
       :ticket: FORGEOS-BE035
    """

    ticket_id: str
    events: list[HistoryEntry]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# Claim/Release schemas (FORGEOS-BE036)
# ---------------------------------------------------------------------------


class ClaimRequest(BaseModel):
    """Request body for ``POST /api/tickets/{ticket_id}/claim``.

    .. meta::
       :ticket: FORGEOS-BE036
    """

    agent_id: str
    machine_id: str
    operator: str
    lease_duration_minutes: int = 30


class ClaimResponse(BaseModel):
    """Response body for a successful claim.

    .. meta::
       :ticket: FORGEOS-BE036
    """

    ticket_id: str
    title: str
    type: str
    stage: str
    file_paths: list[str] = Field(default_factory=list)
    acceptance_criteria: list[str] = Field(default_factory=list)


class ReleaseResponse(BaseModel):
    """Response body for a successful release.

    .. meta::
       :ticket: FORGEOS-BE036
    """

    ticket_id: str
    previous_stage: str
    released_by: str
    reason: str
