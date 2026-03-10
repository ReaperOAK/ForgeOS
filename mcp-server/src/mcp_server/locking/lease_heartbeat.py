"""Lease heartbeat mechanism for claimed ticket leases.

Provides :class:`LeaseHeartbeat` which periodically extends the
``lease_expiry`` for an active ticket claim, preventing the claim from
being reclaimed by other agents while work is in progress.  When the
heartbeat stops (crash, disconnect, completion), the lease expires
naturally and the ticket becomes reclaimable.

Design decisions
----------------
* **Database-driven extension** — each heartbeat issues an UPDATE
  against the ``tickets`` table, extending ``lease_expiry`` by the
  configured duration.  The update is conditional: it only succeeds
  if the ticket is still claimed by the same agent (``claimed_by``
  matches), preventing extensions on released or reassigned tickets.
* **lease_heartbeats audit table** — every successful heartbeat
  writes a record to ``lease_heartbeats`` for observability and
  debugging.  This is append-only; heartbeat records are never
  deleted during normal operation.
* **Async context manager** — :class:`LeaseHeartbeat` implements
  ``__aenter__`` / ``__aexit__`` for clean lifecycle management.
  The background heartbeat task is started on enter and cancelled
  on exit, ensuring no leaked tasks.
* **Configurable intervals** — heartbeat interval (how often to
  extend) and extension duration (how much time to add) are both
  configurable via :class:`HeartbeatConfig`.
* **Stale detection** — :func:`find_stale_claims` queries tickets
  whose ``lease_expiry`` has passed without a recent heartbeat,
  indicating the claiming agent has stopped working.
* **No retry loops** — if a heartbeat extension fails because the
  claim was released or reassigned, the heartbeat stops gracefully.
  Callers handle reconnection.

.. meta::
   :ticket: FORGEOS-BE008
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from mcp_server.observability import get_logger
from mcp_server.server import DatabaseError, ForgeOSError, INVALID_PARAMS

logger = get_logger("locking.lease_heartbeat")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class HeartbeatConfig:
    """Configuration for lease heartbeat behaviour.

    Attributes
    ----------
    interval_seconds : float
        How often the heartbeat fires (default: 60 seconds).
    extension_seconds : float
        How many seconds to add to lease_expiry on each heartbeat
        (default: 120 seconds = 2 minutes).
    max_lease_seconds : float
        Maximum total lease duration from the original claim time
        (default: 7200 seconds = 2 hours).
    """

    interval_seconds: float = 60.0
    extension_seconds: float = 120.0
    max_lease_seconds: float = 7200.0

    def __post_init__(self) -> None:
        if self.interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        if self.extension_seconds <= 0:
            raise ValueError("extension_seconds must be positive")
        if self.max_lease_seconds <= 0:
            raise ValueError("max_lease_seconds must be positive")
        if self.interval_seconds >= self.extension_seconds:
            raise ValueError(
                "interval_seconds must be less than extension_seconds "
                "to prevent lease gaps"
            )


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class HeartbeatError(ForgeOSError):
    """Base error for heartbeat failures."""

    error_code: int = INVALID_PARAMS
    status_code: int = 409


class LeaseNotActiveError(HeartbeatError):
    """The lease is no longer active (released, reassigned, or expired)."""

    status_code: int = 410


class MaxLeaseDurationExceededError(HeartbeatError):
    """The maximum lease duration has been exceeded."""

    status_code: int = 409


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class HeartbeatRecord:
    """Immutable record of a single heartbeat event.

    Attributes
    ----------
    ticket_id : str
        Human-readable ticket identifier.
    agent_id : str
        UUID of the agent that sent the heartbeat.
    previous_expiry : datetime
        The lease_expiry before this heartbeat.
    new_expiry : datetime
        The lease_expiry after this heartbeat.
    heartbeat_at : datetime
        Timestamp when the heartbeat was recorded.
    """

    ticket_id: str
    agent_id: str
    previous_expiry: datetime
    new_expiry: datetime
    heartbeat_at: datetime


@dataclass(frozen=True, slots=True)
class StaleClaim:
    """A claim that has not received a heartbeat within the expected window.

    Attributes
    ----------
    ticket_id : str
        Human-readable ticket identifier.
    agent_id : str
        UUID of the claiming agent.
    agent_name : str
        Name of the claiming agent.
    machine_id : str
        Hostname of the claiming machine.
    lease_expiry : datetime
        When the lease expired.
    last_heartbeat : datetime | None
        Last heartbeat timestamp, or None if no heartbeats were recorded.
    """

    ticket_id: str
    agent_id: str
    agent_name: str
    machine_id: str
    lease_expiry: datetime
    last_heartbeat: datetime | None


# ---------------------------------------------------------------------------
# Connection protocol (for dependency injection)
# ---------------------------------------------------------------------------


class PoolLike(Protocol):
    """Minimal async pool interface for heartbeat operations."""

    def acquire(self) -> Any:
        """Return an async context manager yielding a connection."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Core heartbeat operations
# ---------------------------------------------------------------------------


async def extend_lease(
    pool: PoolLike,
    *,
    ticket_id: str,
    agent_id: str,
    extension_seconds: float = 120.0,
    max_lease_seconds: float = 7200.0,
    _now: datetime | None = None,
) -> HeartbeatRecord:
    """Extend the lease for a claimed ticket by the given duration.

    The extension is conditional: it only succeeds if the ticket is
    still claimed by ``agent_id`` and the lease has not expired.

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    ticket_id : str
        Human-readable ticket ID (e.g. ``"FORGEOS-BE008"``).
    agent_id : str
        UUID string of the claiming agent.
    extension_seconds : float
        Seconds to add to the current lease_expiry.
    max_lease_seconds : float
        Maximum total lease duration from original claim time.

    Returns
    -------
    HeartbeatRecord
        Record of the successful heartbeat.

    Raises
    ------
    LeaseNotActiveError
        If the ticket is not claimed by this agent or lease has expired.
    MaxLeaseDurationExceededError
        If extending would exceed the maximum lease duration.
    DatabaseError
        If a database communication error occurs.
    """
    logger.debug(
        "Extending lease",
        extra={
            "ticket_id": ticket_id,
            "agent_id": agent_id,
            "extension_seconds": extension_seconds,
        },
    )

    now = _now or datetime.now(timezone.utc)

    try:
        async with pool.acquire() as conn:
            # Fetch current lease state atomically.
            row = await conn.fetchrow(
                "SELECT lease_expiry, claimed_by, claimed_at "
                "FROM tickets "
                "WHERE ticket_id = $1 AND claimed_by = $2::uuid "
                "  AND lease_expiry > $3 "
                "FOR UPDATE",
                ticket_id,
                agent_id,
                now,
            )

            if row is None:
                logger.warning(
                    "Lease extension rejected: claim not active",
                    extra={"ticket_id": ticket_id, "agent_id": agent_id},
                )
                raise LeaseNotActiveError(
                    f"No active lease for ticket {ticket_id} by agent {agent_id}"
                )

            previous_expiry: datetime = row["lease_expiry"]
            claimed_at: datetime = row["claimed_at"]

            # Check maximum lease duration.
            new_expiry = now + timedelta(seconds=extension_seconds)
            total_duration = (new_expiry - claimed_at).total_seconds()

            if total_duration > max_lease_seconds:
                logger.warning(
                    "Lease extension rejected: max duration exceeded",
                    extra={
                        "ticket_id": ticket_id,
                        "agent_id": agent_id,
                        "total_duration": total_duration,
                        "max_lease_seconds": max_lease_seconds,
                    },
                )
                raise MaxLeaseDurationExceededError(
                    f"Extending lease for {ticket_id} would exceed "
                    f"max duration of {max_lease_seconds}s "
                    f"(would be {total_duration:.0f}s)"
                )

            # Extend the lease.
            await conn.execute(
                "UPDATE tickets SET lease_expiry = $1 "
                "WHERE ticket_id = $2 AND claimed_by = $3::uuid",
                new_expiry,
                ticket_id,
                agent_id,
            )

            # Write heartbeat record.
            heartbeat_at = now
            await conn.execute(
                "INSERT INTO lease_heartbeats "
                "(ticket_id, agent_id, previous_expiry, new_expiry, heartbeat_at) "
                "VALUES ($1, $2::uuid, $3, $4, $5)",
                ticket_id,
                agent_id,
                previous_expiry,
                new_expiry,
                heartbeat_at,
            )

    except (LeaseNotActiveError, MaxLeaseDurationExceededError):
        raise
    except Exception as exc:
        logger.error(
            "Database error during lease extension",
            extra={
                "ticket_id": ticket_id,
                "agent_id": agent_id,
                "error": str(exc),
            },
        )
        raise DatabaseError(
            f"Failed to extend lease: {exc}",
            details={"ticket_id": ticket_id, "agent_id": agent_id},
        ) from exc

    record = HeartbeatRecord(
        ticket_id=ticket_id,
        agent_id=agent_id,
        previous_expiry=previous_expiry,
        new_expiry=new_expiry,
        heartbeat_at=heartbeat_at,
    )

    logger.info(
        "Lease extended",
        extra={
            "ticket_id": ticket_id,
            "agent_id": agent_id,
            "new_expiry": new_expiry.isoformat(),
        },
    )

    return record


async def find_stale_claims(
    pool: PoolLike,
    *,
    heartbeat_interval_seconds: float = 60.0,
) -> list[StaleClaim]:
    """Find claims whose lease has expired without recent heartbeats.

    A claim is considered stale if:
    1. The ``lease_expiry`` is in the past, AND
    2. There is no heartbeat within the last ``heartbeat_interval_seconds * 2``.

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    heartbeat_interval_seconds : float
        Expected heartbeat interval; stale threshold is 2x this value.

    Returns
    -------
    list[StaleClaim]
        List of stale claims, ordered by lease_expiry ascending.
    """
    now = datetime.now(timezone.utc)
    stale_threshold = now - timedelta(seconds=heartbeat_interval_seconds * 2)

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT t.ticket_id, t.claimed_by, t.claimed_by_name, "
                "  t.machine_id, t.lease_expiry, "
                "  (SELECT MAX(lh.heartbeat_at) "
                "   FROM lease_heartbeats lh "
                "   WHERE lh.ticket_id = t.ticket_id "
                "     AND lh.agent_id = t.claimed_by) AS last_heartbeat "
                "FROM tickets t "
                "WHERE t.status = 'CLAIMED' "
                "  AND t.lease_expiry < $1 "
                "  AND (NOT EXISTS ("
                "    SELECT 1 FROM lease_heartbeats lh "
                "    WHERE lh.ticket_id = t.ticket_id "
                "      AND lh.agent_id = t.claimed_by "
                "      AND lh.heartbeat_at > $2"
                "  )) "
                "ORDER BY t.lease_expiry ASC",
                now,
                stale_threshold,
            )
    except Exception as exc:
        logger.error(
            "Database error during stale claim detection",
            extra={"error": str(exc)},
        )
        raise DatabaseError(
            f"Failed to find stale claims: {exc}",
        ) from exc

    stale: list[StaleClaim] = []
    for row in rows:
        stale.append(
            StaleClaim(
                ticket_id=row["ticket_id"],
                agent_id=str(row["claimed_by"]),
                agent_name=row["claimed_by_name"] or "",
                machine_id=row["machine_id"] or "",
                lease_expiry=row["lease_expiry"],
                last_heartbeat=row["last_heartbeat"],
            )
        )

    if stale:
        logger.info(
            "Stale claims detected",
            extra={"count": len(stale)},
        )

    return stale


# ---------------------------------------------------------------------------
# LeaseHeartbeat — async context manager for automatic heartbeats
# ---------------------------------------------------------------------------


class LeaseHeartbeat:
    """Automatic lease heartbeat using a background asyncio task.

    Use as an async context manager to start and stop the heartbeat
    loop automatically::

        config = HeartbeatConfig(interval_seconds=30, extension_seconds=90)
        async with LeaseHeartbeat(pool, ticket_id="T-1", agent_id="...", config=config):
            # ... do work ... heartbeat runs in background
            pass
        # heartbeat task is cancelled on exit

    Parameters
    ----------
    pool : PoolLike
        Database connection pool.
    ticket_id : str
        Human-readable ticket ID.
    agent_id : str
        UUID string of the claiming agent.
    config : HeartbeatConfig | None
        Heartbeat configuration; uses defaults if ``None``.
    """

    def __init__(
        self,
        pool: PoolLike,
        *,
        ticket_id: str,
        agent_id: str,
        config: HeartbeatConfig | None = None,
    ) -> None:
        self._pool = pool
        self._ticket_id = ticket_id
        self._agent_id = agent_id
        self._config = config or HeartbeatConfig()
        self._task: asyncio.Task[None] | None = None
        self._heartbeat_count: int = 0
        self._last_error: Exception | None = None
        self._stopped: bool = False

    @property
    def ticket_id(self) -> str:
        """The ticket being kept alive."""
        return self._ticket_id

    @property
    def agent_id(self) -> str:
        """The agent whose lease is being extended."""
        return self._agent_id

    @property
    def config(self) -> HeartbeatConfig:
        """The heartbeat configuration."""
        return self._config

    @property
    def heartbeat_count(self) -> int:
        """Number of successful heartbeats sent."""
        return self._heartbeat_count

    @property
    def last_error(self) -> Exception | None:
        """Last error encountered by the heartbeat loop, or None."""
        return self._last_error

    @property
    def is_running(self) -> bool:
        """Whether the background heartbeat task is currently running."""
        return self._task is not None and not self._task.done()

    async def _heartbeat_loop(self) -> None:
        """Background loop that periodically extends the lease."""
        logger.info(
            "Heartbeat loop started",
            extra={
                "ticket_id": self._ticket_id,
                "agent_id": self._agent_id,
                "interval_seconds": self._config.interval_seconds,
            },
        )

        while not self._stopped:
            try:
                await asyncio.sleep(self._config.interval_seconds)

                if self._stopped:
                    break

                record = await extend_lease(
                    self._pool,
                    ticket_id=self._ticket_id,
                    agent_id=self._agent_id,
                    extension_seconds=self._config.extension_seconds,
                    max_lease_seconds=self._config.max_lease_seconds,
                )

                self._heartbeat_count += 1
                self._last_error = None

                logger.debug(
                    "Heartbeat sent",
                    extra={
                        "ticket_id": self._ticket_id,
                        "heartbeat_count": self._heartbeat_count,
                        "new_expiry": record.new_expiry.isoformat(),
                    },
                )

            except asyncio.CancelledError:
                logger.info(
                    "Heartbeat loop cancelled",
                    extra={"ticket_id": self._ticket_id},
                )
                return

            except (LeaseNotActiveError, MaxLeaseDurationExceededError) as exc:
                self._last_error = exc
                logger.warning(
                    "Heartbeat loop stopping: lease no longer extendable",
                    extra={
                        "ticket_id": self._ticket_id,
                        "error": str(exc),
                    },
                )
                return

            except Exception as exc:
                self._last_error = exc
                logger.error(
                    "Heartbeat error (will retry)",
                    extra={
                        "ticket_id": self._ticket_id,
                        "error": str(exc),
                    },
                )
                # Continue looping; transient DB errors should not kill
                # the heartbeat permanently.

        logger.info(
            "Heartbeat loop stopped",
            extra={
                "ticket_id": self._ticket_id,
                "total_heartbeats": self._heartbeat_count,
            },
        )

    async def start(self) -> None:
        """Start the background heartbeat task.

        Raises
        ------
        RuntimeError
            If the heartbeat is already running.
        """
        if self._task is not None and not self._task.done():
            raise RuntimeError(
                f"Heartbeat already running for ticket {self._ticket_id}"
            )

        self._stopped = False
        self._task = asyncio.create_task(
            self._heartbeat_loop(),
            name=f"heartbeat-{self._ticket_id}",
        )

    async def stop(self) -> None:
        """Stop the background heartbeat task gracefully."""
        self._stopped = True

        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

        self._task = None
        logger.info(
            "Heartbeat stopped",
            extra={
                "ticket_id": self._ticket_id,
                "total_heartbeats": self._heartbeat_count,
            },
        )

    async def __aenter__(self) -> LeaseHeartbeat:
        """Start the heartbeat loop on context entry."""
        await self.start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        """Stop the heartbeat loop on context exit."""
        await self.stop()
