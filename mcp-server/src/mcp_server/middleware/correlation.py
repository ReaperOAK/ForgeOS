"""Request lifecycle correlation ID middleware.

Provides correlation ID generation, context-variable storage, logging
integration, error enrichment, and database metadata propagation for
end-to-end request traceability in the ForgeOS MCP server.

Architecture
------------
* **Context variable** -- uses :mod:`contextvars` for async-safe, per-request
  storage that is automatically isolated across concurrent coroutines.
* **Observability bridge** -- syncs with :mod:`mcp_server.observability.logging`
  so that the :class:`StructuredJsonFormatter` automatically includes the
  correlation ID in every JSON log line.
* **Logging filter** -- :class:`CorrelationIdFilter` injects ``correlation_id``
  into every :class:`logging.LogRecord` for handlers that read record attributes.
* **Error enrichment** -- :func:`enrich_error_details` and
  :func:`build_correlated_tool_error` attach the correlation ID to error
  payloads for debugging.
* **Database propagation** -- :func:`get_db_correlation_metadata` provides a
  dict suitable for inclusion in ``event_history`` records.
* **Context manager** -- :func:`correlation_context` scopes a correlation ID
  to a ``with`` block, ensuring automatic cleanup.

.. meta::
   :ticket: FORGEOS-BE019
   :last_reviewed: 2025-07-18T10:30:00Z
"""

from __future__ import annotations

import logging
import uuid
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Generator

from mcp.types import TextContent

# ---------------------------------------------------------------------------
# Context variable -- async-safe, per-request correlation ID storage
# ---------------------------------------------------------------------------

_correlation_id_var: ContextVar[str | None] = ContextVar(
    "correlation_id", default=None
)


# ---------------------------------------------------------------------------
# Observability bridge -- keep the logging module ContextVar in sync
# ---------------------------------------------------------------------------


def _sync_to_observability(correlation_id: str | None) -> None:
    """Synchronize the correlation ID with the observability module.

    The :class:`StructuredJsonFormatter` in :mod:`mcp_server.observability`
    reads its own ``_correlation_id_var``.  This bridge keeps both vars
    in sync so log output always includes the current correlation ID.
    """
    try:
        from mcp_server.observability.logging import (
            set_correlation_id as _obs_set_cid,
        )

        _obs_set_cid(correlation_id if correlation_id is not None else "-")
    except ImportError:
        pass


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


def generate_correlation_id() -> str:
    """Generate a new UUID v4 correlation ID."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Context access
# ---------------------------------------------------------------------------


def set_correlation_id(correlation_id: str) -> Token[str | None]:
    """Set the correlation ID for the current context.

    Also synchronizes with the observability module so that the
    :class:`StructuredJsonFormatter` includes the correlation ID
    in all JSON log lines.
    """
    _sync_to_observability(correlation_id)
    return _correlation_id_var.set(correlation_id)


def get_correlation_id() -> str | None:
    """Retrieve the correlation ID from the current context."""
    return _correlation_id_var.get()


# ---------------------------------------------------------------------------
# Context manager -- scoped correlation lifecycle
# ---------------------------------------------------------------------------


@contextmanager
def correlation_context(
    correlation_id: str | None = None,
) -> Generator[str, None, None]:
    """Scope a correlation ID to a ``with`` block.

    On entry, sets the correlation ID (generating one if not provided).
    On exit, resets the context variable to its previous value.
    The observability module is also synchronized on both entry and exit.
    """
    cid = correlation_id if correlation_id is not None else generate_correlation_id()
    token = _correlation_id_var.set(cid)
    _sync_to_observability(cid)
    try:
        yield cid
    finally:
        _correlation_id_var.reset(token)
        _sync_to_observability(_correlation_id_var.get())


# ---------------------------------------------------------------------------
# Logging integration
# ---------------------------------------------------------------------------


class CorrelationIdFilter(logging.Filter):
    """Logging filter that injects ``correlation_id`` into log records.

    When no correlation context is active, the attribute is set to
    ``"-"`` so that log formatters never encounter a missing field.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        """Add ``correlation_id`` to the log record."""
        cid = _correlation_id_var.get()
        record.correlation_id = cid if cid is not None else "-"  # type: ignore[attr-defined]
        return True


def configure_correlation_logging(target_logger: logging.Logger) -> None:
    """Attach the :class:`CorrelationIdFilter` to a logger.

    Idempotent -- if the filter is already attached, this is a no-op.
    """
    if not any(isinstance(f, CorrelationIdFilter) for f in target_logger.filters):
        target_logger.addFilter(CorrelationIdFilter())


# ---------------------------------------------------------------------------
# Error enrichment
# ---------------------------------------------------------------------------


def enrich_error_details(
    details: dict[str, Any] | None,
) -> dict[str, Any]:
    """Inject the current correlation ID into an error details dict."""
    enriched = dict(details) if details else {}
    enriched["correlation_id"] = _correlation_id_var.get()
    return enriched


def build_correlated_tool_error(message: str) -> list[TextContent]:
    """Build an ``isError=True`` tool response with correlation ID.

    The correlation ID is appended to the error message text so that
    clients can reference it when reporting issues.
    """
    cid = _correlation_id_var.get()
    text = f"{message} [correlation_id={cid}]" if cid else message
    return [TextContent(type="text", text=text)]


# ---------------------------------------------------------------------------
# Database propagation
# ---------------------------------------------------------------------------


def get_db_correlation_metadata() -> dict[str, str | None]:
    """Return correlation metadata for database record injection.

    Tool handlers should call this and merge the result into
    ``event_history`` record metadata columns.
    """
    return {"correlation_id": _correlation_id_var.get()}
