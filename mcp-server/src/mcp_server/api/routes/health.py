"""Server health REST endpoint.

Provides a Starlette route handler at ``GET /api/health`` that returns
server health status with component-level checks and response timing.

No authentication required — public read-only endpoint.

.. meta::
   :ticket: FORGEOS-BE038
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse

from mcp_server.api.schemas import ComponentHealth, HealthResponse
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.observability.health import HealthChecker

logger = get_logger("api.routes.health")


def create_health_endpoint(health_checker_getter: Any) -> Any:
    """Create the health check endpoint handler.

    Parameters
    ----------
    health_checker_getter : callable
        Returns the current ``HealthChecker`` instance, or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler.
    """

    async def health_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/health requests."""
        start = time.monotonic()

        checker: HealthChecker | None = health_checker_getter()
        if checker is None:
            elapsed_ms = round((time.monotonic() - start) * 1000, 3)
            response = HealthResponse(
                status="degraded",
                version="unknown",
                uptime_seconds=0.0,
                response_time_ms=elapsed_ms,
                components=[
                    ComponentHealth(
                        name="health_checker",
                        status="not_configured",
                    ),
                ],
            )
            return JSONResponse(
                status_code=503,
                content=response.model_dump(mode="json"),
            )

        try:
            report = await checker.health_check()
        except Exception:
            logger.exception("health_check_failed")
            elapsed_ms = round((time.monotonic() - start) * 1000, 3)
            response = HealthResponse(
                status="unhealthy",
                version="unknown",
                uptime_seconds=0.0,
                response_time_ms=elapsed_ms,
                components=[
                    ComponentHealth(
                        name="health_checker",
                        status="error",
                        details={"error": "Health check raised an exception"},
                    ),
                ],
            )
            return JSONResponse(
                status_code=503,
                content=response.model_dump(mode="json"),
            )

        elapsed_ms = round((time.monotonic() - start) * 1000, 3)

        # Build component list from the health report
        components: list[ComponentHealth] = []

        db_info = report.get("database", {})
        db_status = db_info.get("status", "unknown")
        db_details: dict[str, object] = {}
        if "pool" in db_info:
            db_details["pool"] = db_info["pool"]
        if "error" in db_info:
            db_details["error"] = db_info["error"]

        components.append(
            ComponentHealth(
                name="database",
                status=db_status,
                details=db_details or None,
            )
        )

        overall_status: str = report.get("status", "unknown")
        status_code = 200 if overall_status == "healthy" else 503

        response = HealthResponse(
            status=overall_status,
            version=report.get("version", "unknown"),
            uptime_seconds=report.get("uptime_seconds", 0.0),
            response_time_ms=elapsed_ms,
            components=components,
        )

        return JSONResponse(
            status_code=status_code,
            content=response.model_dump(mode="json"),
        )

    return health_endpoint
