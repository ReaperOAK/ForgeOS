"""ForgeOS MCP Server middleware package.

Provides request lifecycle middleware including correlation ID tracking,
logging integration, error enrichment, and database metadata propagation.

.. meta::
   :ticket: FORGEOS-BE019, FORGEOS-BE054
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from mcp_server.middleware.audit_middleware import AuditMiddleware
from mcp_server.middleware.auth_middleware import (
    AuthContext,
    AuthMiddleware,
    IdentityType,
    clear_auth_context,
    get_auth_context,
    set_auth_context,
)
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
from mcp_server.middleware.rate_limiter import (
    RateLimitConfig,
    RateLimitMiddleware,
    SlidingWindowLimiter,
)

__all__ = [
    "AuditMiddleware",
    "AuthContext",
    "AuthMiddleware",
    "CorrelationIdFilter",
    "IdentityType",
    "RateLimitConfig",
    "RateLimitMiddleware",
    "SlidingWindowLimiter",
    "build_correlated_tool_error",
    "clear_auth_context",
    "configure_correlation_logging",
    "correlation_context",
    "enrich_error_details",
    "generate_correlation_id",
    "get_auth_context",
    "get_correlation_id",
    "get_db_correlation_metadata",
    "set_auth_context",
    "set_correlation_id",
]
