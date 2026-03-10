"""ForgeOS Observability — structured logging, correlation, redaction, and metrics.

Re-exports the public API from :mod:`mcp_server.observability.logging`
and :mod:`mcp_server.observability.metrics`.

Quick start::

    from mcp_server.observability import configure_logging, get_logger

    configure_logging(level="DEBUG")
    logger = get_logger("my_module")
    logger.info("hello", extra={"request_id": "abc"})

Metrics::

    from mcp_server.observability import record_request, get_metrics_snapshot

    record_request("tickets.claim", "success")
    snapshot = get_metrics_snapshot()
"""

from mcp_server.observability.logging import (
    SensitiveDataFilter,
    StructuredJsonFormatter,
    configure_logging,
    get_correlation_id,
    get_logger,
    set_correlation_id,
)
from mcp_server.observability.metrics import (
    DbQueryTimer,
    MetricsRegistry,
    RequestTimer,
    emit_metrics_log,
    get_metrics_snapshot,
    get_registry,
    record_claim_expired,
    record_claim_failure,
    record_claim_success,
    record_db_query_duration,
    record_request,
    record_request_latency,
    session_closed,
    session_opened,
)

__all__ = [
    "DbQueryTimer",
    "HealthChecker",
    "HealthStatus",
    "MetricsRegistry",
    "ReadinessState",
    "RequestTimer",
    "SensitiveDataFilter",
    "StructuredJsonFormatter",
    "configure_logging",
    "emit_metrics_log",
    "get_correlation_id",
    "get_logger",
    "get_metrics_snapshot",
    "get_registry",
    "record_claim_expired",
    "record_claim_failure",
    "record_claim_success",
    "record_db_query_duration",
    "record_request",
    "record_request_latency",
    "session_closed",
    "session_opened",
    "set_correlation_id",
]


# Lazy imports for health module to avoid circular dependencies
# (health.py imports from observability.logging, which is eagerly loaded above).
_HEALTH_NAMES = {"HealthChecker", "HealthStatus", "ReadinessState"}


def __getattr__(name: str) -> object:
    if name in _HEALTH_NAMES:
        from mcp_server.observability.health import (
            HealthChecker,
            HealthStatus,
            ReadinessState,
        )

        _map = {
            "HealthChecker": HealthChecker,
            "HealthStatus": HealthStatus,
            "ReadinessState": ReadinessState,
        }
        return _map[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
