"""Server-level health check and readiness probe.

Provides a :class:`HealthChecker` that aggregates server state, database
connectivity, connection-pool saturation, and uptime into a single health
report.  A separate :class:`ReadinessState` state machine drives the
readiness probe — returning *not ready* while the server is booting or
draining.

Ticket: FORGEOS-BE025

Design rationale
~~~~~~~~~~~~~~~~
This module is **separate** from :mod:`mcp_server.db.health` which
provides *pool-level* background monitoring (``PoolHealthMonitor``,
FORGEOS-BE014).  ``HealthChecker`` is the *server-level* probe: it
combines pool health with a startup/shutdown state machine and exposes
the result to the MCP ``health_check`` tool and HTTP readiness endpoint.
"""

from __future__ import annotations

import enum
import time
from typing import TYPE_CHECKING, Any

from mcp_server.observability.logging import get_logger

try:
    from mcp_server import __version__
except ImportError:  # pragma: no cover
    __version__ = "0.0.0-dev"

if TYPE_CHECKING:
    from mcp_server.db.pool import ConnectionPool

logger = get_logger("forgeos.health")


# ---------------------------------------------------------------------------
# Public enums
# ---------------------------------------------------------------------------


class HealthStatus(str, enum.Enum):
    """Overall server health classification."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"


class ReadinessState(str, enum.Enum):
    """Server readiness lifecycle state.

    Transitions: ``STARTING`` → ``READY`` → ``DRAINING``
    """

    STARTING = "starting"
    READY = "ready"
    DRAINING = "draining"


# ---------------------------------------------------------------------------
# HealthChecker
# ---------------------------------------------------------------------------


class HealthChecker:
    """Aggregate server health and readiness probes.

    Parameters
    ----------
    pool : ConnectionPool | None
        The asyncpg connection pool wrapper.  ``None`` means the database
        is not configured (server runs in degraded DB-less mode).
    """

    def __init__(self, pool: ConnectionPool | None = None) -> None:
        self._pool = pool
        self._state: str = ReadinessState.STARTING.value
        self._start_time: float = time.monotonic()

    # -- state transitions ---------------------------------------------------

    def mark_ready(self) -> None:
        """Transition to :attr:`ReadinessState.READY`."""
        self._state = ReadinessState.READY.value
        logger.info("Server readiness state -> READY")

    def mark_draining(self) -> None:
        """Transition to :attr:`ReadinessState.DRAINING`."""
        self._state = ReadinessState.DRAINING.value
        logger.info("Server readiness state -> DRAINING")

    # -- probes --------------------------------------------------------------

    async def health_check(self) -> dict[str, Any]:
        """Return a comprehensive health report.

        Returns
        -------
        dict[str, Any]
            Keys: ``status``, ``version``, ``uptime_seconds``, ``database``.
        """
        db_info = await self._check_database()

        # Determine overall status from DB info.
        db_status = db_info.get("status", "unknown")
        if db_status == "ok":
            overall = HealthStatus.HEALTHY.value
        elif db_status == "not_configured":
            overall = HealthStatus.DEGRADED.value
        else:
            overall = HealthStatus.UNHEALTHY.value

        return {
            "status": overall,
            "version": __version__,
            "uptime_seconds": round(time.monotonic() - self._start_time, 3),
            "database": db_info,
        }

    async def readiness_check(self) -> tuple[bool, dict[str, Any]]:
        """Determine whether the server is ready to accept requests.

        Returns
        -------
        tuple[bool, dict[str, Any]]
            ``(is_ready, status_dict)`` — ``is_ready`` is ``False`` when
            the server is still starting or draining, or when the database
            is unreachable.
        """
        if self._state != ReadinessState.READY.value:
            return False, {
                "ready": False,
                "state": self._state,
                "reason": f"Server is {self._state}",
            }

        # When pool exists, verify it can reach the database.
        if self._pool is not None:
            if not self._pool.is_initialized:
                return False, {
                    "ready": False,
                    "state": self._state,
                    "reason": "Connection pool not initialized",
                }
            try:
                await self._pool.ping()
            except Exception as exc:
                return False, {
                    "ready": False,
                    "state": self._state,
                    "reason": f"Database unreachable: {exc}",
                }

        return True, {
            "ready": True,
            "state": self._state,
        }

    async def _check_database(self) -> dict[str, Any]:
        """Check database connectivity and gather pool metrics.

        Returns
        -------
        dict[str, Any]
            Database status dict with ``status``, optional ``pool`` metrics,
            and optional ``error`` message.
        """
        if self._pool is None:
            return {"status": "not_configured"}

        if not self._pool.is_initialized:
            return {"status": "not_initialized"}

        # Ping to verify connectivity (SELECT 1)
        try:
            await self._pool.ping()
        except Exception as exc:
            logger.warning("Database ping failed: %s", exc)
            return {
                "status": "error",
                "error": str(exc),
            }

        # Gather pool metrics
        try:
            stats = self._pool.stats()
            max_size = stats.max_size
            used = stats.used_size
            saturation = (used / max_size * 100.0) if max_size > 0 else 0.0

            return {
                "status": "ok",
                "pool": {
                    "size": stats.size,
                    "free_size": stats.free_size,
                    "used_size": stats.used_size,
                    "min_size": stats.min_size,
                    "max_size": stats.max_size,
                    "saturation_pct": saturation,
                },
            }
        except Exception as exc:
            logger.warning("Failed to gather pool stats: %s", exc)
            return {
                "status": "ok",
                "error": f"Stats unavailable: {exc}",
            }
