"""ForgeOS Webhooks — GitHub signature verification and event handling.

.. meta::
   :ticket: FORGEOS-BE060, FORGEOS-BE061, FORGEOS-BE062
"""

from mcp_server.webhooks.github_handler import (
    CI_AGENT_ID,
    CIStatusHandler,
    CITicketOps,
    GitHubSignatureError,
    GitHubSignatureMissingError,
    PushEventPayload,
    PushEventValidationError,
    create_push_handler,
    extract_ticket_id_from_branch,
    parse_push_event,
    verify_github_request,
)
from mcp_server.webhooks.signature import (
    compute_signature,
    get_webhook_secret,
    verify_signature,
)

__all__ = [
    "CI_AGENT_ID",
    "CIStatusHandler",
    "CITicketOps",
    "GitHubSignatureError",
    "GitHubSignatureMissingError",
    "PushEventPayload",
    "PushEventValidationError",
    "compute_signature",
    "create_push_handler",
    "extract_ticket_id_from_branch",
    "get_webhook_secret",
    "parse_push_event",
    "verify_github_request",
    "verify_signature",
]
