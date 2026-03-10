"""Repository pattern data access layer.

Provides typed repository classes for tickets, claims, and events.
All repositories accept an asyncpg pool via constructor injection.
"""

from mcp_server.repositories.audit_repo import AuditRepository
from mcp_server.repositories.claim_repo import ClaimRepository
from mcp_server.repositories.event_repo import EventRepository
from mcp_server.repositories.ticket_repo import TicketRepository

__all__ = [
    "AuditRepository",
    "ClaimRepository",
    "EventRepository",
    "TicketRepository",
]
