"""REST API route handlers.

.. meta::
   :ticket: FORGEOS-BE034, FORGEOS-BE035, FORGEOS-BE036, FORGEOS-BE038, FORGEOS-BE039
"""

from mcp_server.api.routes.health import create_health_endpoint
from mcp_server.api.routes.pipeline import create_pipeline_endpoint
from mcp_server.api.routes.tickets import (
    create_claim_endpoint,
    create_ticket_detail_endpoint,
    create_ticket_history_endpoint,
    create_tickets_endpoint,
)
from mcp_server.api.routes.websocket import create_websocket_endpoint

__all__ = [
    "create_claim_endpoint",
    "create_health_endpoint",
    "create_pipeline_endpoint",
    "create_ticket_detail_endpoint",
    "create_ticket_history_endpoint",
    "create_tickets_endpoint",
    "create_websocket_endpoint",
]
