"""Expired lease detection and automatic release.

Provides :class:`LeaseCleanupTask`, a background asyncio task that
periodically scans for expired ticket leases and releases them,
making the associated tickets available for reclaim.  Each automatic
release is recorded in the ``event_history`` table for audit.

Design decisions
----------------
* **Periodic scan** — a configurable interval (default: 30 seconds)
  controls how often the background task checks for expired leases.
  This balances responsiveness with database load.
* **Atomic release** — each expired lease release happens within a
  single database transaction: the ticket's claim fields are cleared,
  status and stage reset to READY, and an event_history record is
  inserted.  This ensures consistency.
* **Structured logging** — every release logs ``ticket_id``,
  ``agent_id``, and time since last heartbeat for operational
  observability.
* **Graceful lifecycle** — :class:`LeaseCleanupTask` uses ``asyncio``
  for the background loop and supports clean start/stop via async
  context manager.

.. meta::
   :ticket: FORGEOS-BE009
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, DatabaseError, ForgeOSError

logger = get_logger("locking.lease_cleanup")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LeaseCleanupConfig:
    """Configuration for expired lease cleanup behaviour.

    Attributes
    ----------
    scan_interval_seconds : float
        How often the cleanup task scans for expired leases
        (default: 30 seconds).
    batch_size : int
        Maximum number of expired leases to process per scan cycle
        (default: 100).
    """

    scan_interval_seconds: float = 30.0
    batch_size: int = 100

    def __post_init__(self) -> None:
        if self.scan_interval_seconds <= 0:
            raise ValueError("scan_interval_seconds must be positive")
        if self.batch_size <= 0:
            raise ValueError("batch_size must be positive")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class LeaseCleanupError(ForgeOSError):
    """Base error for lease cleanup failures."""

    error_code: int = INVALID_PARAMS
    status_code: int = 500


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ExpiredLease:
    """An expired lease detected during a cleanup scan.

    Attributes
    ----------
    ticket_id : str
        Human-readable ticket identifier.
    agent_id : str
        UUID of the agent that held the expired lease.
    agent_name : str
        Name of the agent that held the expired lease.
    machine_id : str
        Hostname of the machine that held the lease.
    lease_expiry : datetime
        When the lease expired.
    last_heartbeat : datetime | None
        Last heartbeat timestamp, or None if no heartbeats were recorded.
    previous_stage : str
        The stage the ticket was in before release.
    """

    ticket_id: str
    agent_id: str
    agent_name: str
    machine_id: str
    lease_expiry: datetime
    last_heartbeat: datetime | None
    previous_stage: str


@dataclass(frozen=True, slots=True)
class LeaseRelease:
    """Record of a successfully released expired lease.

    Attributes
    ----------
    ticket_id : str
        Human-readable ticket identifier.
    agent_id : str
        UUID of the agent whose lease was released.
    agent_name : str
        Name of the agent whose lease was released.
    machine_id : str
        Hostname of the machine that held the lease.
    released_at : datetime
        When the release occurred.
    time_since_expiry_seconds : float
        Seconds between lease expiry and release.
    time_since_last_heartbeat_seconds : float | None
        Seconds since last heartbeat, or None if no heartbeats.
    """

    ticket_id: str
    agent_id: str
    agent_name: str
    machine_id: str
    released_at: datetime
    time_since_expiry_seconds: float
    time_since_last_heartbeat_seconds: float | None


# ---------------------------------------------------------------------------
# Connection protocol (for dependency injection)
# ---------------------------------------------------------------------------


class PoolLike(Protocol):
    """Minimal async pool interface for cleanup operations."""

    def acquire(self) -> Any:
        """Return an async context manager yielding a connection."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Core cleanup operations
# ---------------------------------------------------------------------------


async def find_expired_leases(
    pool: PoolLike,
    *,
    batch_size: int = 100,
    _now: datetime | None = None,
) -> list[ExpiredLease]:
    """Find claims whose lease has expired.

    Returns tickets where ``claimed_by IS NOT NULL`` and
    ``lease_expiry < NOW()``, ordered by lease_expiry ascending
    (oldest expired first).

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    batch_size : int
        Maximum number of expired leases to return.

    Returns
    -------
    list[ExpiredLease]
        List of expired leases, ordered by lease_expiry ascending.
    """
    now = _now or datetime.now(timezone.utc)

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT t.ticket_id, t.claimed_by, t.claimed_by_name, "
                "  t.machine_id, t.lease_expiry, t.stage::text AS stage, "
                "  (SELECT MAX(lh.heartbeat_at) "
                "   FROM lease_heartbeats lh "
                "   WHERE lh.ticket_id = t.ticket_id "
                "     AND lh.agent_id = t.claimed_by) AS last_heartbeat "
                "FROM tickets t "
                "WHERE t.claimed_by IS NOT NULL "
                "  AND t.lease_expiry < $1 "
                "ORDER BY t.lease_expiry ASC "
                "LIMIT $2",
                now,
                batch_size,
            )
    except Exception as exc:
        logger.error(
            "Database error scanning for expired leases",
            extra={"error": str(exc)},
        )
        raise DatabaseError(f"Failed to scan expired leases: {exc}") from exc

    expired: list[ExpiredLease] = []
    for row in rows:
        expired.append(
            ExpiredLease(
                ticket_id=row["ticket_id"],
                agent_id=str(row["claimed_by"]),
                agent_name=row["claimed_by_name"] or "",
                machine_id=row["machine_id"] or "",
                lease_expiry=row["lease_expiry"],
                last_heartbeat=row["last_heartbeat"],
                previous_stage=row["stage"] or "READY",
            )
        )

    if expired:
        logger.info(
            "Expired leases detected",
            extra={"count": len(expired)},
        )

    return expired


async def release_expired_lease(
    pool: PoolLike,
    *,
    expired: ExpiredLease,
    _now: datetime | None = None,
) -> LeaseRelease:
    """Release a single expired lease atomically.

    Within a single transaction:
    1. Clears the ticket's claim fields (claimed_by, claimed_by_name, etc.)
    2. Sets ``status`` to READY and ``stage`` to READY
    3. Records the release in ``event_history``

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    expired : ExpiredLease
        The expired lease to release.

    Returns
    -------
    LeaseRelease
        Record of the successful release.

    Raises
    ------
    LeaseCleanupError
        If the release fails (ticket already released by another process).
    DatabaseError
        If a database communication error occurs.
    """
    now = _now or datetime.now(timezone.utc)
    time_since_expiry = (now - expired.lease_expiry).total_seconds()

    time_since_hb: float | None = None
    if expired.last_heartbeat is not None:
        time_since_hb = (now - expired.last_heartbeat).total_seconds()

    logger.info(
        "Releasing expired lease",
        extra={
            "ticket_id": expired.ticket_id,
            "agent_id": expired.agent_id,
            "agent_name": expired.agent_name,
            "machine_id": expired.machine_id,
            "time_since_expiry_seconds": round(time_since_expiry, 1),
            "time_since_last_heartbeat_seconds": (
                round(time_since_hb, 1) if time_since_hb is not None else None
            ),
        },
    )

    try:
        async with pool.acquire() as conn, conn.transaction():
            # Clear claim fields and move ticket back to READY.
            result = await conn.execute(
                "UPDATE tickets "
                "SET claimed_by = NULL, "
                "    claimed_by_name = NULL, "
                "    machine_id = NULL, "
                "    operator = NULL, "
                "    lease_expiry = NULL, "
                "    lease_duration_minutes = NULL, "
                "    status = 'READY'::ticket_status, "
                "    stage = 'READY'::ticket_stage, "
                "    updated_at = $1 "
                "WHERE ticket_id = $2 "
                "  AND claimed_by = $3::uuid",
                now,
                expired.ticket_id,
                expired.agent_id,
            )

            if result != "UPDATE 1":
                logger.warning(
                    "Expired lease already released by another process",
                    extra={
                        "ticket_id": expired.ticket_id,
                        "agent_id": expired.agent_id,
                    },
                )
                raise LeaseCleanupError(
                    f"Ticket {expired.ticket_id} was already released"
                )

            # Record release in event_history.
            await conn.execute(
                "INSERT INTO event_history "
                "(ticket_id, event_type, previous_state, new_state, "
                " agent_id, machine_id, metadata) "
                "VALUES ($1, 'RELEASED'::event_type, $2::jsonb, $3::jsonb, "
                "        $4::uuid, $5, $6::jsonb)",
                expired.ticket_id,
                json.dumps({
                    "status": "CLAIMED",
                    "stage": expired.previous_stage,
                    "claimed_by": expired.agent_id,
                    "claimed_by_name": expired.agent_name,
                    "machine_id": expired.machine_id,
                    "lease_expiry": expired.lease_expiry.isoformat(),
                }),
                json.dumps({
                    "status": "READY",
                    "stage": "READY",
                    "claimed_by": None,
                }),
                expired.agent_id,
                expired.machine_id,
                json.dumps({
                    "reason": "lease_expired",
                    "time_since_expiry_seconds": round(time_since_expiry, 1),
                    "time_since_last_heartbeat_seconds": (
                        round(time_since_hb, 1) if time_since_hb is not None else None
                    ),
                    "last_heartbeat": (
                        expired.last_heartbeat.isoformat()
                        if expired.last_heartbeat
                        else None
                    ),
                }),
            )

    except LeaseCleanupError:
        raise
    except Exception as exc:
        logger.error(
            "Database error releasing expired lease",
            extra={
                "ticket_id": expired.ticket_id,
                "agent_id": expired.agent_id,
                "error": str(exc),
            },
        )
        raise DatabaseError(
            f"Failed to release expired lease for {expired.ticket_id}: {exc}",
            details={
                "ticket_id": expired.ticket_id,
                "agent_id": expired.agent_id,
            },
        ) from exc

    release = LeaseRelease(
        ticket_id=expired.ticket_id,
        agent_id=expired.agent_id,
        agent_name=expired.agent_name,
        machine_id=expired.machine_id,
        released_at=now,
        time_since_expiry_seconds=time_since_expiry,
        time_since_last_heartbeat_seconds=time_since_hb,
    )

    logger.info(
        "Expired lease released",
        extra={
            "ticket_id": expired.ticket_id,
            "agent_id": expired.agent_id,
            "time_since_last_heartbeat_seconds": (
                round(time_since_hb, 1) if time_since_hb is not None else None
            ),
        },
    )

    return release


async def scan_and_release_expired(
    pool: PoolLike,
    *,
    batch_size: int = 100,
    _now: datetime | None = None,
) -> list[LeaseRelease]:
    """Scan for expired leases and release them.

    This is the main entry point for a single cleanup cycle.  It
    finds all expired leases (up to ``batch_size``) and releases
    each one atomically.

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    batch_size : int
        Maximum number of expired leases to process.

    Returns
    -------
    list[LeaseRelease]
        Records of successfully released leases.
    """
    now = _now or datetime.now(timezone.utc)

    expired_leases = await find_expired_leases(pool, batch_size=batch_size, _now=now)

    if not expired_leases:
        logger.debug("No expired leases found during scan")
        return []

    releases: list[LeaseRelease] = []
    for expired in expired_leases:
        try:
            release = await release_expired_lease(pool, expired=expired, _now=now)
            releases.append(release)
        except LeaseCleanupError:
            # Already released by another process — skip silently.
            logger.debug(
                "Skipping already-released lease",
                extra={"ticket_id": expired.ticket_id},
            )
        except DatabaseError:
            # Log and continue; don't let one failure block others.
            logger.warning(
                "Failed to release expired lease, will retry next scan",
                extra={"ticket_id": expired.ticket_id},
            )

    if releases:
        logger.info(
            "Cleanup scan completed",
            extra={
                "released_count": len(releases),
                "scanned_count": len(expired_leases),
            },
        )

    return releases


# ---------------------------------------------------------------------------
# LeaseCleanupTask — async background task
# ---------------------------------------------------------------------------


class LeaseCleanupTask:
    """Background task that periodically scans for and releases expired leases.

    Use as an async context manager::

        config = LeaseCleanupConfig(scan_interval_seconds=30)
        async with LeaseCleanupTask(pool, config=config):
            # ... cleanup runs in background ...
            pass
        # task is cancelled on exit

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    config : LeaseCleanupConfig | None
        Cleanup configuration; uses defaults if ``None``.
    """

    def __init__(
        self,
        pool: PoolLike,
        *,
        config: LeaseCleanupConfig | None = None,
    ) -> None:
        self._pool = pool
        self._config = config or LeaseCleanupConfig()
        self._task: asyncio.Task[None] | None = None
        self._scan_count: int = 0
        self._total_released: int = 0
        self._last_error: Exception | None = None
        self._stopped: bool = False

    @property
    def config(self) -> LeaseCleanupConfig:
        """The cleanup configuration."""
        return self._config

    @property
    def scan_count(self) -> int:
        """Number of scan cycles completed."""
        return self._scan_count

    @property
    def total_released(self) -> int:
        """Total number of expired leases released."""
        return self._total_released

    @property
    def last_error(self) -> Exception | None:
        """Last error encountered by the cleanup loop, or None."""
        return self._last_error

    @property
    def is_running(self) -> bool:
        """Whether the background cleanup task is currently running."""
        return self._task is not None and not self._task.done()

    async def _cleanup_loop(self) -> None:
        """Background loop that periodically scans and releases expired leases."""
        logger.info(
            "Lease cleanup loop started",
            extra={
                "scan_interval_seconds": self._config.scan_interval_seconds,
                "batch_size": self._config.batch_size,
            },
        )

        while not self._stopped:
            try:
                await asyncio.sleep(self._config.scan_interval_seconds)

                if self._stopped:
                    break

                releases = await scan_and_release_expired(
                    self._pool,
                    batch_size=self._config.batch_size,
                )

                self._scan_count += 1
                self._total_released += len(releases)
                self._last_error = None

                if releases:
                    logger.info(
                        "Cleanup cycle completed",
                        extra={
                            "scan_number": self._scan_count,
                            "released_this_cycle": len(releases),
                            "total_released": self._total_released,
                        },
                    )
                else:
                    logger.debug(
                        "Cleanup cycle completed, no expired leases",
                        extra={"scan_number": self._scan_count},
                    )

            except asyncio.CancelledError:
                logger.info("Lease cleanup loop cancelled")
                return

            except Exception as exc:
                self._last_error = exc
                self._scan_count += 1
                logger.error(
                    "Lease cleanup error (will retry next cycle)",
                    extra={
                        "error": str(exc),
                        "scan_number": self._scan_count,
                    },
                )

        logger.info(
            "Lease cleanup loop stopped",
            extra={
                "total_scans": self._scan_count,
                "total_released": self._total_released,
            },
        )

    async def start(self) -> None:
        """Start the background cleanup task.

        Raises
        ------
        RuntimeError
            If the cleanup task is already running.
        """
        if self._task is not None and not self._task.done():
            raise RuntimeError("Lease cleanup task is already running")

        self._stopped = False
        self._task = asyncio.create_task(
            self._cleanup_loop(),
            name="lease-cleanup",
        )

    async def stop(self) -> None:
        """Stop the background cleanup task gracefully."""
        self._stopped = True

        if self._task is not None and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

        self._task = None
        logger.info(
            "Lease cleanup stopped",
            extra={
                "total_scans": self._scan_count,
                "total_released": self._total_released,
            },
        )

    async def __aenter__(self) -> LeaseCleanupTask:
        """Start the cleanup loop on context entry."""
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        """Stop the cleanup loop on context exit."""
        await self.stop()
