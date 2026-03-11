"""Webhook service — business logic for inbound webhook processing.

Provides :class:`WebhookService`, which validates incoming webhook
payloads, routes events to internal handlers based on source and
event type, and processes them asynchronously.

Supported sources:
* ``github`` — GitHub push/PR/issue events.
* ``custom`` — generic JSON payloads with an ``event_type`` field.

.. meta::
   :ticket: FORGEOS-BE059
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from mcp_server.observability import get_logger

logger = get_logger("services.webhook")


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class WebhookSource(str, Enum):
    """Known webhook origin identifiers."""

    GITHUB = "github"
    CUSTOM = "custom"


@dataclass(frozen=True, slots=True)
class WebhookEvent:
    """Validated inbound webhook event.

    Attributes
    ----------
    event_id : str
        Unique ID assigned on receipt.
    source : str
        Origin identifier (e.g. ``"github"``, ``"custom"``).
    event_type : str
        Classification of the event (e.g. ``"push"``, ``"pull_request"``).
    payload : dict[str, Any]
        The validated payload body.
    received_at : datetime
        UTC timestamp of receipt.
    """

    event_id: str
    source: str
    event_type: str
    payload: dict[str, Any]
    received_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Validation errors
# ---------------------------------------------------------------------------


class WebhookValidationError(Exception):
    """Raised when a webhook payload fails validation."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class UnknownSourceError(WebhookValidationError):
    """Raised when the webhook source is not recognised."""


# ---------------------------------------------------------------------------
# Payload validators (per source)
# ---------------------------------------------------------------------------

_GITHUB_REQUIRED_FIELDS: frozenset[str] = frozenset({"action"})
_GITHUB_PUSH_REQUIRED_FIELDS: frozenset[str] = frozenset({"ref", "commits", "repository"})
_CUSTOM_REQUIRED_FIELDS: frozenset[str] = frozenset({"event_type"})


def _validate_github_payload(payload: dict[str, Any]) -> str:
    """Validate a GitHub webhook payload and return the event type.

    GitHub sends the event type in the ``X-GitHub-Event`` header,
    which the caller passes via *event_type_header*. The payload
    itself must contain an ``action`` field for most event types.

    Returns the action as the event_type.
    """
    missing = _GITHUB_REQUIRED_FIELDS - set(payload.keys())
    if missing:
        raise WebhookValidationError(
            f"GitHub payload missing required fields: {sorted(missing)}",
            details={"missing_fields": sorted(missing)},
        )
    action = payload.get("action", "")
    if not isinstance(action, str) or not action.strip():
        raise WebhookValidationError(
            "GitHub payload 'action' must be a non-empty string",
        )
    return action.strip()


def _validate_github_push_payload(payload: dict[str, Any]) -> str:
    """Validate a GitHub push event payload.

    Push events carry ``ref``, ``commits``, and ``repository`` fields
    instead of ``action``.

    Returns
    -------
    str
        ``"push"`` — the event type for push events.
    """
    missing = _GITHUB_PUSH_REQUIRED_FIELDS - set(payload.keys())
    if missing:
        raise WebhookValidationError(
            f"GitHub push payload missing required fields: {sorted(missing)}",
            details={"missing_fields": sorted(missing)},
        )
    ref = payload.get("ref")
    if not isinstance(ref, str) or not ref.strip():
        raise WebhookValidationError(
            "GitHub push payload 'ref' must be a non-empty string",
        )
    commits = payload.get("commits")
    if not isinstance(commits, list):
        raise WebhookValidationError(
            "GitHub push payload 'commits' must be a list",
        )
    return "push"


def _validate_custom_payload(payload: dict[str, Any]) -> str:
    """Validate a custom webhook payload and return the event type.

    Custom payloads must include an ``event_type`` string field.
    """
    missing = _CUSTOM_REQUIRED_FIELDS - set(payload.keys())
    if missing:
        raise WebhookValidationError(
            f"Custom payload missing required fields: {sorted(missing)}",
            details={"missing_fields": sorted(missing)},
        )
    event_type = payload.get("event_type", "")
    if not isinstance(event_type, str) or not event_type.strip():
        raise WebhookValidationError(
            "Custom payload 'event_type' must be a non-empty string",
        )
    return event_type.strip()


_SOURCE_VALIDATORS: dict[
    str,
    Callable[[dict[str, Any]], str],
] = {
    WebhookSource.GITHUB.value: _validate_github_payload,
    WebhookSource.CUSTOM.value: _validate_custom_payload,
}


# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------

WebhookHandler = Callable[[WebhookEvent], Coroutine[Any, Any, None]]


class _HandlerRegistry:
    """In-process registry mapping (source, event_type) to async handlers."""

    def __init__(self) -> None:
        self._handlers: dict[tuple[str, str], WebhookHandler] = {}
        self._default_handlers: dict[str, WebhookHandler] = {}

    def register(
        self,
        source: str,
        event_type: str,
        handler: WebhookHandler,
    ) -> None:
        """Register *handler* for a specific (source, event_type) pair."""
        self._handlers[(source, event_type)] = handler

    def register_default(self, source: str, handler: WebhookHandler) -> None:
        """Register a fallback handler for *source* when no exact match exists."""
        self._default_handlers[source] = handler

    def get(self, source: str, event_type: str) -> WebhookHandler | None:
        """Look up the best matching handler."""
        return self._handlers.get(
            (source, event_type),
            self._default_handlers.get(source),
        )


# Module-level registry singleton
handler_registry = _HandlerRegistry()


# ---------------------------------------------------------------------------
# Default handlers
# ---------------------------------------------------------------------------


async def _default_github_handler(event: WebhookEvent) -> None:
    """Default handler for GitHub webhook events — logs and discards."""
    logger.info(
        "github_webhook_received",
        extra={
            "event_id": event.event_id,
            "event_type": event.event_type,
            "source": event.source,
        },
    )


async def _default_custom_handler(event: WebhookEvent) -> None:
    """Default handler for custom webhook events — logs and discards."""
    logger.info(
        "custom_webhook_received",
        extra={
            "event_id": event.event_id,
            "event_type": event.event_type,
            "source": event.source,
        },
    )


# Register defaults
handler_registry.register_default(WebhookSource.GITHUB.value, _default_github_handler)
handler_registry.register_default(WebhookSource.CUSTOM.value, _default_custom_handler)


# ---------------------------------------------------------------------------
# Webhook service
# ---------------------------------------------------------------------------


class WebhookService:
    """Orchestrates webhook validation, routing, and async processing.

    Parameters
    ----------
    registry : _HandlerRegistry | None
        Handler registry. Uses the module-level singleton if ``None``.
    """

    def __init__(self, registry: _HandlerRegistry | None = None) -> None:
        self._registry = registry or handler_registry

    def validate_payload(
        self,
        source: str,
        payload: dict[str, Any],
        event_type_header: str | None = None,
    ) -> WebhookEvent:
        """Validate an inbound payload and construct a :class:`WebhookEvent`.

        Parameters
        ----------
        source : str
            Origin identifier from the URL path (e.g. ``"github"``).
        payload : dict[str, Any]
            Raw JSON body.
        event_type_header : str | None
            Event type from a request header (e.g. ``X-GitHub-Event``).
            Falls back to extraction from the payload.

        Returns
        -------
        WebhookEvent
            Validated event ready for routing.

        Raises
        ------
        UnknownSourceError
            If *source* is not a recognised webhook origin.
        WebhookValidationError
            If the payload fails schema validation.
        """
        source_lower = source.lower()
        validator = _SOURCE_VALIDATORS.get(source_lower)
        if validator is None:
            raise UnknownSourceError(
                f"Unknown webhook source: {source!r}",
                details={"source": source, "known_sources": sorted(_SOURCE_VALIDATORS)},
            )

        # GitHub: prefer the header-provided event type, but still validate body
        if source_lower == WebhookSource.GITHUB.value and event_type_header:
            header_stripped = event_type_header.strip()
            if header_stripped == "push":
                _validate_github_push_payload(payload)
            else:
                _validate_github_payload(payload)  # validate body structure
            event_type = header_stripped
        else:
            event_type = validator(payload)

        return WebhookEvent(
            event_id=uuid.uuid4().hex,
            source=source_lower,
            event_type=event_type,
            payload=payload,
        )

    async def dispatch(self, event: WebhookEvent) -> None:
        """Route *event* to the matching handler and execute it.

        If no handler is registered, the event is logged and dropped.

        Parameters
        ----------
        event : WebhookEvent
            A validated webhook event.
        """
        handler = self._registry.get(event.source, event.event_type)
        if handler is None:
            logger.warning(
                "webhook_no_handler",
                extra={
                    "event_id": event.event_id,
                    "source": event.source,
                    "event_type": event.event_type,
                },
            )
            return

        try:
            await handler(event)
        except Exception:
            logger.exception(
                "webhook_handler_error",
                extra={
                    "event_id": event.event_id,
                    "source": event.source,
                    "event_type": event.event_type,
                },
            )

    def process_async(self, event: WebhookEvent) -> None:
        """Schedule *event* processing as a background task.

        Creates an asyncio task so the HTTP response can be returned
        immediately (202 Accepted pattern).

        Parameters
        ----------
        event : WebhookEvent
            A validated webhook event.
        """
        task = asyncio.create_task(self.dispatch(event))
        task.add_done_callback(self._task_done_callback)

    @staticmethod
    def _task_done_callback(task: asyncio.Task[None]) -> None:
        """Log unhandled exceptions from background webhook tasks."""
        exc = task.exception()
        if exc is not None:
            logger.error(
                "webhook_background_task_failed",
                extra={"error": str(exc)},
            )
