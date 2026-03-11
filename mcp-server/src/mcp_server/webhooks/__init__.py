"""ForgeOS Webhooks — GitHub signature verification and event handling.

.. meta::
   :ticket: FORGEOS-BE060, FORGEOS-BE061, FORGEOS-BE062, FORGEOS-BE063
"""

# Eagerly register the PR handler in the module-level webhook registry.
from mcp_server.services.webhook_service import handler_registry as _handler_registry
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
    handle_pull_request_event,
    parse_push_event,
    register_pr_handler,
    verify_github_request,
)
from mcp_server.webhooks.signature import (
    compute_signature,
    get_webhook_secret,
    verify_signature,
)

register_pr_handler(_handler_registry)

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
    "handle_pull_request_event",
    "parse_push_event",
    "register_pr_handler",
    "verify_github_request",
    "verify_signature",
]
