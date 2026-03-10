"""Webhook HTTP receiver — ``POST /api/webhooks/{source}`` endpoint.

Provides Starlette route handlers for receiving inbound webhooks from
external systems (GitHub, custom integrations, etc.). The endpoint
validates the payload, acknowledges with 202 Accepted, and dispatches
processing asynchronously via :class:`~mcp_server.services.webhook_service.WebhookService`.

Usage
-----
Mount the routes into a Starlette application::

    from mcp_server.transport.webhooks import webhook_routes
    app = Starlette(routes=webhook_routes)

.. meta::
   :ticket: FORGEOS-BE059
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse
from starlette.routing import Route

if TYPE_CHECKING:
    from starlette.requests import Request

from mcp_server.observability import get_logger
from mcp_server.services.webhook_service import (
    UnknownSourceError,
    WebhookService,
    WebhookValidationError,
)
from mcp_server.webhooks.github_handler import (
    GitHubSignatureError,
    GitHubSignatureMissingError,
    verify_github_request,
)
from mcp_server.webhooks.signature import get_webhook_secret

logger = get_logger("transport.webhooks")

# Module-level service instance; can be replaced for testing.
_webhook_service = WebhookService()


def get_webhook_service() -> WebhookService:
    """Return the module-level :class:`WebhookService` instance."""
    return _webhook_service


def set_webhook_service(service: WebhookService) -> None:
    """Replace the module-level service (useful for testing)."""
    global _webhook_service
    _webhook_service = service


# ---------------------------------------------------------------------------
# Route handler
# ---------------------------------------------------------------------------


async def receive_webhook(request: Request) -> JSONResponse:
    """Handle ``POST /api/webhooks/{source}``.

    1. Parse the JSON body.
    2. Validate against the source-specific schema.
    3. Acknowledge with 202 Accepted.
    4. Schedule async processing.

    Path Parameters
    ----------------
    source : str
        Webhook origin identifier (e.g. ``"github"``, ``"custom"``).

    Headers
    -------
    X-GitHub-Event : str, optional
        GitHub event type header, used when *source* is ``"github"``.
    Content-Type : str
        Must be ``application/json``.

    Returns
    -------
    JSONResponse
        202 Accepted on success, 400 Bad Request on validation failure.
    """
    source: str = request.path_params.get("source", "")
    if not source:
        return JSONResponse(
            status_code=400,
            content={"error": "Missing source parameter"},
        )

    # --- Parse body --------------------------------------------------------
    content_type = request.headers.get("content-type", "")
    if "application/json" not in content_type:
        return JSONResponse(
            status_code=400,
            content={"error": "Content-Type must be application/json"},
        )

    try:
        body = await request.body()
        payload: dict[str, Any] = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.warning(
            "webhook_invalid_json",
            extra={"source": source, "error": str(exc)},
        )
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid JSON payload"},
        )

    if not isinstance(payload, dict):
        return JSONResponse(
            status_code=400,
            content={"error": "Payload must be a JSON object"},
        )

    # --- GitHub signature verification ------------------------------------
    if source.lower() == "github":
        webhook_secret = get_webhook_secret()
        if webhook_secret is not None:
            try:
                verify_github_request(body, request.headers, webhook_secret)
            except GitHubSignatureMissingError as exc:
                return JSONResponse(
                    status_code=401,
                    content={"error": exc.message},
                )
            except GitHubSignatureError as exc:
                return JSONResponse(
                    status_code=403,
                    content={"error": exc.message},
                )

    # --- Validate ----------------------------------------------------------
    event_type_header = request.headers.get("x-github-event")

    service = get_webhook_service()
    try:
        event = service.validate_payload(
            source=source,
            payload=payload,
            event_type_header=event_type_header,
        )
    except UnknownSourceError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": exc.message, "details": exc.details},
        )
    except WebhookValidationError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": exc.message, "details": exc.details},
        )

    # --- Acknowledge and dispatch asynchronously ---------------------------
    service.process_async(event)

    logger.info(
        "webhook_accepted",
        extra={
            "event_id": event.event_id,
            "source": event.source,
            "event_type": event.event_type,
        },
    )

    return JSONResponse(
        status_code=202,
        content={
            "status": "accepted",
            "event_id": event.event_id,
            "source": event.source,
            "event_type": event.event_type,
        },
    )


# ---------------------------------------------------------------------------
# Route table
# ---------------------------------------------------------------------------

webhook_routes: list[Route] = [
    Route(
        "/api/webhooks/{source}",
        receive_webhook,
        methods=["POST"],
        name="receive_webhook",
    ),
]
