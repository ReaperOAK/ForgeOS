"""ForgeOS MCP Server middleware package.

Provides request lifecycle middleware including correlation ID tracking,
logging integration, error enrichment, and database metadata propagation.

.. meta::
   :ticket: FORGEOS-BE019
   :last_reviewed: 2025-07-18T10:30:00Z
"""

from mcp_server.middleware.correlation import (
    CorrelationIdFilter,
    build_correlated_tool_error,
    configure_correlation_logging,
    correlation_context,
    enrich_error_details,
    generate_correlation_id,
    get_correlation_id,
    get_db_correlation_metadata,
    set_correlation_id,
)

__all__ = [
    "CorrelationIdFilter",
    "build_correlated_tool_error",
    "configure_correlation_logging",
    "correlation_context",
    "enrich_error_details",
    "generate_correlation_id",
    "get_correlation_id",
    "get_db_correlation_metadata",
    "set_correlation_id",
]
