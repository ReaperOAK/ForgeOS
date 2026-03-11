"""ForgeOS services — business logic orchestration layer.

Public API
----------
* :class:`TicketService` — ticket lifecycle orchestration (claim, release, query).
* :class:`NextTicketResult` — typed claim result.
* :class:`ClaimOwnershipError` — raised when release caller is not claim owner.
* :class:`ReleaseResult` — typed release result.
* :class:`TicketDetail` — full ticket detail with history and claim.
* :class:`TicketListResult` — paginated ticket list result.
* :class:`MachineService` — machine auth orchestration.
* :class:`WebhookService` — inbound webhook validation and dispatch.
* :class:`WebhookEvent` — validated webhook event value object.
* :class:`PRService` — PR event handler (ticket correlation, metadata extraction).
* :class:`PREvent` — processed PR event value object.
"""

from mcp_server.services.audit_service import AuditService
from mcp_server.services.pr_service import PREvent, PRService
from mcp_server.services.sync_engine import (
    IntegrityError,
    SyncEngine,
    SyncResult,
    ValidateResult,
)
from mcp_server.services.ticket_service import (
    AdvanceTicketResult,
    ClaimOwnershipError,
    ClaimValidationError,
    NextTicketResult,
    ReleaseResult,
    TicketDetail,
    TicketListResult,
    TicketService,
)
from mcp_server.services.webhook_service import WebhookEvent, WebhookService

__all__ = [
    "AdvanceTicketResult",
    "AuditService",
    "ClaimOwnershipError",
    "ClaimValidationError",
    "IntegrityError",
    "NextTicketResult",
    "PREvent",
    "PRService",
    "ReleaseResult",
    "SyncEngine",
    "SyncResult",
    "TicketDetail",
    "TicketListResult",
    "TicketService",
    "ValidateResult",
    "WebhookEvent",
    "WebhookService",
]
