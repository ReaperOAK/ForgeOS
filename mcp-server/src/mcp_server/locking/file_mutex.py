"""File-level advisory lock mutex using PostgreSQL advisory locks.

Provides :class:`FileMutex` for transaction-scoped file locking that prevents
two agents from modifying the same workspace file concurrently.  Uses
``pg_advisory_xact_lock`` / ``pg_try_advisory_xact_lock`` keyed on a
deterministic int64 hash of the file path.

Design decisions
----------------
* **Advisory locks, not row locks** --- advisory locks are lightweight,
  application-defined, and automatically released when the transaction
  ends (commit or rollback).  No cleanup required.
* **Deterministic hashing** --- file paths are hashed to int64 using a
  two-part CRC32-based scheme for reproducibility across sessions.
* **Observability via file_locks table** --- after advisory lock
  acquisition, a row is inserted into ``file_locks`` so operators can
  query active locks.  This is purely informational; the advisory lock
  is the authoritative mutex.
* **Dual locking modes** --- :meth:`FileMutex.acquire` blocks until the
  lock is available; :meth:`FileMutex.try_acquire` returns immediately
  with a success/failure indicator.

.. meta::
   :ticket: FORGEOS-BE007
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from datetime import datetime

from mcp_server.observability import get_logger

logger = get_logger("locking.file_mutex")


# ---------------------------------------------------------------------------
# Hash function: file path -> int64 advisory lock key
# ---------------------------------------------------------------------------


def file_path_to_lock_key(file_path: str) -> int:
    """Convert a file path to a deterministic int64 advisory lock key.

    Uses CRC32 on the UTF-8 bytes of the normalized path to produce a
    32-bit hash, then packs it into a signed 64-bit integer.  The upper
    32 bits use a fixed namespace (``0x464F5247`` = "FORG") to avoid
    collisions with advisory locks used by other subsystems.

    Parameters
    ----------
    file_path : str
        Workspace-relative file path (e.g. ``"src/db/pool.py"``).

    Returns
    -------
    int
        Signed 64-bit integer suitable for ``pg_advisory_xact_lock``.

    Raises
    ------
    ValueError
        If *file_path* is empty.
    """
    if not file_path:
        raise ValueError("file_path must not be empty")

    # Normalize: strip leading/trailing whitespace and slashes.
    normalized = file_path.strip().strip("/")

    if not normalized:
        raise ValueError("file_path must not be empty")

    # CRC32 produces an unsigned 32-bit integer.
    path_hash = zlib.crc32(normalized.encode("utf-8")) & 0xFFFFFFFF

    # Pack namespace (upper 32 bits) + path hash (lower 32 bits) into
    # a signed int64, which is what PostgreSQL advisory locks expect.
    namespace = 0x464F5247  # ASCII "FORG"
    combined = (namespace << 32) | path_hash

    # Convert to signed int64 (PostgreSQL bigint is signed).
    return struct.unpack(">q", struct.pack(">Q", combined))[0]


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class FileLockRecord:
    """Observability record for an active file lock.

    Attributes
    ----------
    file_path : str
        Workspace-relative path that is locked.
    ticket_id : str
        Ticket that holds the lock.
    locked_by : str | None
        Agent UUID holding the lock, if known.
    machine_id : str | None
        Hostname of the machine holding the lock.
    locked_at : datetime
        Timestamp when the lock was acquired.
    """

    file_path: str
    ticket_id: str
    locked_by: str | None
    machine_id: str | None
    locked_at: datetime


@dataclass(frozen=True, slots=True)
class LockAcquireResult:
    """Result of a lock acquisition attempt.

    Attributes
    ----------
    acquired : bool
        ``True`` if the lock was successfully acquired.
    file_path : str
        The file path that was locked (or attempted).
    lock_key : int
        The int64 advisory lock key derived from the file path.
    ticket_id : str
        The ticket that requested the lock.
    """

    acquired: bool
    file_path: str
    lock_key: int
    ticket_id: str


class FileConflictError(Exception):
    """Raised when a file lock cannot be acquired due to an existing lock.

    Attributes
    ----------
    file_path : str
        The conflicting file path.
    ticket_id : str
        The ticket that attempted the lock.
    held_by_ticket : str | None
        The ticket currently holding the lock, if known.
    """

    def __init__(
        self,
        file_path: str,
        ticket_id: str,
        held_by_ticket: str | None = None,
    ) -> None:
        held = f" (held by {held_by_ticket})" if held_by_ticket else ""
        super().__init__(
            f"File lock conflict on '{file_path}' for ticket {ticket_id}{held}"
        )
        self.file_path = file_path
        self.ticket_id = ticket_id
        self.held_by_ticket = held_by_ticket


# ---------------------------------------------------------------------------
# Connection protocol (for dependency injection)
# ---------------------------------------------------------------------------


class ConnectionLike(Protocol):
    """Minimal async connection interface for advisory lock operations."""

    async def fetchval(self, query: str, *args: Any) -> Any: ...
    async def fetchrow(self, query: str, *args: Any) -> Any: ...
    async def execute(self, query: str, *args: Any) -> str: ...
    async def fetch(self, query: str, *args: Any) -> list[Any]: ...


# ---------------------------------------------------------------------------
# FileMutex -- core advisory lock operations
# ---------------------------------------------------------------------------


class FileMutex:
    """File-level mutual exclusion using PostgreSQL advisory locks.

    All operations require an active database connection that is inside
    a transaction.  The advisory lock is transaction-scoped -- it is
    automatically released when the transaction ends (commit or rollback).

    Parameters
    ----------
    conn : ConnectionLike
        An asyncpg connection (or compatible) inside an active transaction.
    """

    def __init__(self, conn: ConnectionLike) -> None:
        self._conn = conn

    async def acquire(
        self,
        file_path: str,
        ticket_id: str,
        agent_id: str | None = None,
        machine_id: str | None = None,
    ) -> LockAcquireResult:
        """Acquire a blocking advisory lock for a file path.

        Calls ``pg_advisory_xact_lock(key)`` which blocks until the lock
        is available.  After acquisition, inserts an observability record
        into the ``file_locks`` table.

        Parameters
        ----------
        file_path : str
            Workspace-relative file path to lock.
        ticket_id : str
            Ticket requesting the lock.
        agent_id : str | None
            Agent UUID, for observability tracking.
        machine_id : str | None
            Hostname, for observability tracking.

        Returns
        -------
        LockAcquireResult
            Result with ``acquired=True`` and the lock key.
        """
        lock_key = file_path_to_lock_key(file_path)

        logger.info(
            "Acquiring advisory lock",
            extra={
                "file_path": file_path,
                "lock_key": lock_key,
                "ticket_id": ticket_id,
            },
        )

        # pg_advisory_xact_lock blocks until acquired; returns void.
        await self._conn.execute(
            "SELECT pg_advisory_xact_lock($1)", lock_key
        )

        # Record in file_locks table for observability.
        await self._record_lock(file_path, ticket_id, agent_id, machine_id)

        logger.info(
            "Advisory lock acquired",
            extra={
                "file_path": file_path,
                "lock_key": lock_key,
                "ticket_id": ticket_id,
            },
        )

        return LockAcquireResult(
            acquired=True,
            file_path=file_path,
            lock_key=lock_key,
            ticket_id=ticket_id,
        )

    async def try_acquire(
        self,
        file_path: str,
        ticket_id: str,
        agent_id: str | None = None,
        machine_id: str | None = None,
    ) -> LockAcquireResult:
        """Attempt to acquire an advisory lock without blocking.

        Calls ``pg_try_advisory_xact_lock(key)`` which returns ``true``
        if the lock was acquired, ``false`` if it is held by another
        session.

        Parameters
        ----------
        file_path : str
            Workspace-relative file path to lock.
        ticket_id : str
            Ticket requesting the lock.
        agent_id : str | None
            Agent UUID, for observability tracking.
        machine_id : str | None
            Hostname, for observability tracking.

        Returns
        -------
        LockAcquireResult
            Result with ``acquired`` indicating success or failure.
        """
        lock_key = file_path_to_lock_key(file_path)

        logger.info(
            "Attempting non-blocking advisory lock",
            extra={
                "file_path": file_path,
                "lock_key": lock_key,
                "ticket_id": ticket_id,
            },
        )

        acquired: bool = await self._conn.fetchval(
            "SELECT pg_try_advisory_xact_lock($1)", lock_key
        )

        if acquired:
            await self._record_lock(file_path, ticket_id, agent_id, machine_id)
            logger.info(
                "Advisory lock acquired (try)",
                extra={
                    "file_path": file_path,
                    "lock_key": lock_key,
                    "ticket_id": ticket_id,
                },
            )
        else:
            logger.info(
                "Advisory lock not available (try)",
                extra={
                    "file_path": file_path,
                    "lock_key": lock_key,
                    "ticket_id": ticket_id,
                },
            )

        return LockAcquireResult(
            acquired=acquired,
            file_path=file_path,
            lock_key=lock_key,
            ticket_id=ticket_id,
        )

    async def release_ticket_locks(self, ticket_id: str) -> list[str]:
        """Release observability records for a ticket's file locks.

        Sets ``released_at = NOW()`` on all active ``file_locks`` rows
        for the given ticket.  The advisory locks themselves are released
        automatically when the transaction ends.

        Parameters
        ----------
        ticket_id : str
            Ticket whose lock records should be released.

        Returns
        -------
        list[str]
            File paths whose lock records were released.
        """
        rows = await self._conn.fetch(
            """UPDATE file_locks
               SET released_at = NOW()
               WHERE ticket_id = $1
                 AND released_at IS NULL
               RETURNING file_path""",
            ticket_id,
        )
        released = [row["file_path"] for row in rows]

        if released:
            logger.info(
                "Released file lock records",
                extra={
                    "ticket_id": ticket_id,
                    "released_files": released,
                    "count": len(released),
                },
            )
        else:
            logger.debug(
                "No active file lock records to release",
                extra={"ticket_id": ticket_id},
            )

        return released

    async def get_active_locks(self, ticket_id: str) -> list[FileLockRecord]:
        """Query active file lock records for a ticket.

        Parameters
        ----------
        ticket_id : str
            Ticket to query.

        Returns
        -------
        list[FileLockRecord]
            Active lock records for the ticket.
        """
        rows = await self._conn.fetch(
            """SELECT file_path, ticket_id, locked_by, machine_id, locked_at
               FROM file_locks
               WHERE ticket_id = $1
                 AND released_at IS NULL""",
            ticket_id,
        )
        return [
            FileLockRecord(
                file_path=row["file_path"],
                ticket_id=row["ticket_id"],
                locked_by=row["locked_by"],
                machine_id=row["machine_id"],
                locked_at=row["locked_at"],
            )
            for row in rows
        ]

    async def check_conflicts(
        self, file_paths: list[str], ticket_id: str
    ) -> list[FileLockRecord]:
        """Check for existing locks on file paths held by other tickets.

        Parameters
        ----------
        file_paths : list[str]
            File paths to check.
        ticket_id : str
            The requesting ticket (excluded from conflict results).

        Returns
        -------
        list[FileLockRecord]
            Lock records for files locked by other tickets.
        """
        if not file_paths:
            return []

        rows = await self._conn.fetch(
            """SELECT file_path, ticket_id, locked_by, machine_id, locked_at
               FROM file_locks
               WHERE file_path = ANY($1)
                 AND released_at IS NULL
                 AND ticket_id <> $2""",
            file_paths,
            ticket_id,
        )
        return [
            FileLockRecord(
                file_path=row["file_path"],
                ticket_id=row["ticket_id"],
                locked_by=row["locked_by"],
                machine_id=row["machine_id"],
                locked_at=row["locked_at"],
            )
            for row in rows
        ]

    # -- Private helpers ---------------------------------------------------

    async def _record_lock(
        self,
        file_path: str,
        ticket_id: str,
        agent_id: str | None,
        machine_id: str | None,
    ) -> None:
        """Insert an observability record into file_locks.

        Uses ``ON CONFLICT DO NOTHING`` on the partial unique index
        ``(file_path) WHERE released_at IS NULL`` to avoid duplicates
        when re-acquiring a lock the same ticket already holds.
        """
        await self._conn.execute(
            """INSERT INTO file_locks (file_path, ticket_id, locked_by, machine_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (file_path) WHERE released_at IS NULL
               DO NOTHING""",
            file_path,
            ticket_id,
            agent_id,
            machine_id,
        )
