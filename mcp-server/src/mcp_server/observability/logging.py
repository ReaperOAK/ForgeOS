"""Structured JSON logging for the ForgeOS MCP Server.

This module provides a production-grade structured logging facility that
outputs machine-parseable JSON to stderr.  Every log line includes:

- ``timestamp`` — ISO 8601 with timezone
- ``level`` — Python log level name (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- ``message`` — human-readable log message
- ``logger`` — dotted logger name (e.g. ``forgeos.mcp``, ``forgeos.db``)
- ``correlation_id`` — request-scoped correlation ID from contextvars

Additional ``extra`` fields passed to logger calls are merged into the
JSON output automatically.

Public API
----------
* :class:`StructuredJsonFormatter` — JSON log formatter.
* :class:`SensitiveDataFilter` — redacts PII, secrets, and credentials.
* :func:`configure_logging` — one-shot logging configuration.
* :func:`get_logger` — factory returning a named ``forgeos.*`` logger.
* :func:`set_correlation_id` / :func:`get_correlation_id` — correlation context.

Security
--------
* :class:`SensitiveDataFilter` scrubs ``password``, ``token``, ``secret``,
  ``api_key``, ``authorization`` fields and masks credential patterns in
  message strings (DSN passwords, ``password=...``).

Design decisions
----------------
* Built on stdlib ``logging`` — no external dependency required.
* Single formatter configuration — all modules share the same JSON schema.
* ``contextvars``-based correlation ID — works with asyncio natively.
* Filter-based redaction — runs before formatters, covering all handlers.

.. meta::
   :last_reviewed: 2026-03-10T10:00:00Z
"""

from __future__ import annotations

import json
import logging
import re
import sys
import traceback
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Correlation ID — request-scoped via contextvars
# ---------------------------------------------------------------------------

_correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="-")
"""Context variable holding the current request's correlation ID.

Default is ``"-"`` when no correlation ID has been set for the current
async context (e.g. during startup or background tasks).
"""


def set_correlation_id(correlation_id: str) -> Token[str]:
    """Set the correlation ID for the current context.

    Parameters
    ----------
    correlation_id : str
        Unique identifier for the current request or operation.

    Returns
    -------
    Token[str]
        A token that can be used to reset the correlation ID via
        ``_correlation_id_var.reset(token)``.
    """
    return _correlation_id_var.set(correlation_id)


def get_correlation_id() -> str:
    """Return the correlation ID for the current context.

    Returns
    -------
    str
        The current correlation ID, or ``"-"`` if none has been set.
    """
    return _correlation_id_var.get()


# ---------------------------------------------------------------------------
# Sensitive data filter — PII / secret redaction
# ---------------------------------------------------------------------------

# Attribute names that must be redacted when found on LogRecord
_SENSITIVE_ATTRS: frozenset[str] = frozenset({
    "password",
    "passwd",
    "token",
    "secret",
    "api_key",
    "apikey",
    "authorization",
    "auth_token",
    "access_token",
    "refresh_token",
    "private_key",
    "credentials",
})

_REDACTED = "[REDACTED]"

# Regex patterns for credential-like strings in log messages
_PASSWORD_PATTERN = re.compile(
    r"(password|passwd|pwd)\s*[=:]\s*\S+",
    re.IGNORECASE,
)
_DSN_CRED_PATTERN = re.compile(
    r"(://[^:]+):([^@]+)@",
)


class SensitiveDataFilter(logging.Filter):
    """Logging filter that redacts sensitive data from log records.

    Inspects both record attributes (``extra`` fields) and the message
    string for credential-like patterns.  Sensitive attribute values are
    replaced with ``[REDACTED]``.  Message strings have embedded passwords
    and DSN credentials masked.

    This filter always returns ``True`` — it modifies records in-place
    rather than suppressing them.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        """Redact sensitive data from *record* in place.

        Parameters
        ----------
        record : logging.LogRecord
            The log record to inspect and sanitize.

        Returns
        -------
        bool
            Always ``True`` — the record is never suppressed.
        """
        # Redact sensitive attribute values
        for attr in _SENSITIVE_ATTRS:
            if hasattr(record, attr):
                setattr(record, attr, _REDACTED)

        # Redact credential patterns in the message
        record.msg = _PASSWORD_PATTERN.sub(
            r"\1=[REDACTED]", str(record.msg)
        )
        record.msg = _DSN_CRED_PATTERN.sub(
            r"\1:[REDACTED]@", record.msg
        )

        return True


# ---------------------------------------------------------------------------
# Structured JSON formatter
# ---------------------------------------------------------------------------

# Standard LogRecord attributes that should NOT be merged into extra
_BUILTIN_ATTRS: frozenset[str] = frozenset({
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "message",
    "module",
    "msecs",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "taskName",
    "thread",
    "threadName",
})


class StructuredJsonFormatter(logging.Formatter):
    """Format log records as single-line JSON objects.

    Output schema (per line)::

        {
            "timestamp": "2026-03-10T10:00:00.000000+00:00",
            "level": "INFO",
            "message": "Server started",
            "logger": "forgeos.mcp",
            "correlation_id": "req-abc-123",
            ...extra fields...
        }

    Extra fields passed via ``logger.info("msg", extra={...})`` are
    merged into the top-level JSON object.  Exception info is included
    as an ``"exception"`` field with the full traceback string.
    """

    def format(self, record: logging.LogRecord) -> str:
        """Format *record* as a JSON string.

        Parameters
        ----------
        record : logging.LogRecord
            The log record to format.

        Returns
        -------
        str
            Single-line JSON string.
        """
        # Build the base JSON structure
        log_entry: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "correlation_id": get_correlation_id(),
        }

        # Merge extra fields (anything not in the standard LogRecord attrs)
        for key, value in record.__dict__.items():
            if key not in _BUILTIN_ATTRS and key not in log_entry:
                try:
                    # Ensure the value is JSON-serializable
                    json.dumps(value)
                    log_entry[key] = value
                except (TypeError, ValueError):
                    log_entry[key] = str(value)

        # Include exception traceback if present
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = "".join(
                traceback.format_exception(*record.exc_info)
            )

        return json.dumps(log_entry, default=str)


# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------


def configure_logging(level: str = "INFO") -> None:
    """Configure structured JSON logging for the ``forgeos`` logger hierarchy.

    Sets up a stderr handler with :class:`StructuredJsonFormatter` and
    attaches :class:`SensitiveDataFilter` to the root ``forgeos`` logger.

    This function is idempotent with respect to filter attachment — it
    adds a new handler on each call but checks for duplicate filters.

    Parameters
    ----------
    level : str
        Python logging level name (e.g. ``"INFO"``, ``"DEBUG"``).
        Defaults to ``"INFO"`` if the provided string is not a valid level.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(StructuredJsonFormatter())

    root = logging.getLogger("forgeos")
    resolved_level = getattr(logging, level.upper(), None)
    if not isinstance(resolved_level, int):
        resolved_level = logging.INFO
    root.setLevel(resolved_level)
    root.addHandler(handler)

    # Attach sensitive data filter (avoid duplicates)
    has_filter = any(
        isinstance(f, SensitiveDataFilter) for f in root.filters
    )
    if not has_filter:
        root.addFilter(SensitiveDataFilter())


# ---------------------------------------------------------------------------
# Logger factory
# ---------------------------------------------------------------------------


def get_logger(name: str) -> logging.Logger:
    """Return a named logger under the ``forgeos`` hierarchy.

    Parameters
    ----------
    name : str
        Dotted module name (e.g. ``"mcp"``, ``"db.connection"``).
        The returned logger will be named ``forgeos.<name>``.

    Returns
    -------
    logging.Logger
        A standard library logger instance.
    """
    return logging.getLogger(f"forgeos.{name}")
