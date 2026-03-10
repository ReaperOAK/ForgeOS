"""Pydantic response/request schemas for the REST API.

Defines typed models for ticket list responses, ensuring consistent
serialisation across all REST endpoints.

.. meta::
   :ticket: FORGEOS-BE034
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003
from enum import Enum

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
