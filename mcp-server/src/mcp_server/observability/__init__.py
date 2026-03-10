"""ForgeOS Observability — structured logging, correlation, and redaction.

Re-exports the public API from :mod:`mcp_server.observability.logging`.

Quick start::

    from mcp_server.observability import configure_logging, get_logger

    configure_logging(level="DEBUG")
    logger = get_logger("my_module")
    logger.info("hello", extra={"request_id": "abc"})
"""

from mcp_server.observability.logging import (
    SensitiveDataFilter,
    StructuredJsonFormatter,
    configure_logging,
    get_correlation_id,
    get_logger,
    set_correlation_id,
)

__all__ = [
    "SensitiveDataFilter",
    "StructuredJsonFormatter",
    "configure_logging",
    "get_correlation_id",
    "get_logger",
    "set_correlation_id",
]
