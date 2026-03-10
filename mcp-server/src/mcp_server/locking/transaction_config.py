"""Per-operation transaction isolation configuration for ForgeOS.

Maps ForgeOS operations to appropriate PostgreSQL transaction isolation
levels and provides an async context manager that sets the isolation level
on a per-transaction basis.  Includes automatic retry logic for
serialization failures (``40001`` — ``serialization_failure``).

Design decisions
----------------
* **Enum-based isolation levels** — :class:`IsolationLevel` wraps the three
  PostgreSQL isolation levels used in ForgeOS.  ``READ UNCOMMITTED`` and
  raw ``REPEATABLE READ`` are deliberately excluded — ForgeOS uses
  ``READ COMMITTED`` for claims (with ``SKIP LOCKED``) and
  ``SERIALIZABLE`` for state transitions.
* **Operation-to-isolation mapping** — :class:`OperationIsolation` is a
  frozen dataclass that pairs an :class:`OperationType` with its
  required :class:`IsolationLevel` and a human-readable justification.
* **Context manager** — :func:`transactional` is an async context manager
  that acquires a connection from the pool, starts a transaction at the
  configured isolation level, and yields the connection.  On
  ``serialization_failure`` (SQLSTATE ``40001``), it retries up to
  *max_retries* times with exponential back-off.
* **No business logic** — this module is purely infrastructure.  Business
  operations import :func:`transactional` and pass it a pool + operation
  type.  The module never imports domain-specific code.

.. meta::
   :ticket: FORGEOS-BE010
   :last_reviewed: 2026-03-11T12:00:00Z
"""

from __future__ import annotations

import asyncio
import enum
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger("locking.transaction_config")

# Serialization failure SQLSTATE code
_SERIALIZATION_FAILURE = "40001"

# Default retry parameters
DEFAULT_MAX_RETRIES: int = 3
DEFAULT_BASE_DELAY: float = 0.05  # 50ms


# ---------------------------------------------------------------------------
# Isolation levels
# ---------------------------------------------------------------------------


class IsolationLevel(enum.Enum):
    """PostgreSQL transaction isolation levels used in ForgeOS.

    Only three levels are exposed — ``READ UNCOMMITTED`` is not used
    because PostgreSQL treats it identically to ``READ COMMITTED``.

    Each value is the exact string accepted by asyncpg's
    ``Connection.transaction(isolation=...)`` parameter.
    """

    READ_COMMITTED = "read_committed"
    REPEATABLE_READ = "repeatable_read"
    SERIALIZABLE = "serializable"


# ---------------------------------------------------------------------------
# Operation types
# ---------------------------------------------------------------------------


class OperationType(enum.Enum):
    """ForgeOS operation categories that require distinct isolation semantics.

    Each operation type is mapped to an :class:`IsolationLevel` with a
    documented justification.
    """

    CLAIM = "claim"
    ADVANCE = "advance"
    REWORK = "rework"
    RELEASE = "release"
    SPAWN = "spawn"
    READ = "read"


# ---------------------------------------------------------------------------
# Operation → isolation mapping (value object)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class OperationIsolation:
    """Maps an operation type to its required isolation level.

    Attributes
    ----------
    operation : OperationType
        The ForgeOS operation.
    isolation : IsolationLevel
        Required transaction isolation level.
    justification : str
        Human-readable reason for the chosen isolation level.
    """

    operation: OperationType
    isolation: IsolationLevel
    justification: str


# ---------------------------------------------------------------------------
# Canonical mapping — the single source of truth
# ---------------------------------------------------------------------------


OPERATION_ISOLATION_MAP: dict[OperationType, OperationIsolation] = {
    OperationType.CLAIM: OperationIsolation(
        operation=OperationType.CLAIM,
        isolation=IsolationLevel.READ_COMMITTED,
        justification=(
            "Claims use SELECT FOR UPDATE SKIP LOCKED under READ COMMITTED. "
            "Non-blocking semantics mean concurrent claims skip already-locked "
            "rows rather than waiting, so SERIALIZABLE is unnecessary."
        ),
    ),
    OperationType.ADVANCE: OperationIsolation(
        operation=OperationType.ADVANCE,
        isolation=IsolationLevel.SERIALIZABLE,
        justification=(
            "State transitions must see a consistent snapshot to prevent "
            "concurrent advance/rework from corrupting the ticket lifecycle. "
            "SERIALIZABLE guarantees that if two transactions attempt "
            "conflicting state changes, one will be rolled back."
        ),
    ),
    OperationType.REWORK: OperationIsolation(
        operation=OperationType.REWORK,
        isolation=IsolationLevel.SERIALIZABLE,
        justification=(
            "Rework is a state transition with the same consistency "
            "requirements as advance — a ticket must not be simultaneously "
            "advanced and reworked."
        ),
    ),
    OperationType.RELEASE: OperationIsolation(
        operation=OperationType.RELEASE,
        isolation=IsolationLevel.READ_COMMITTED,
        justification=(
            "Releasing a claim is idempotent and does not conflict with "
            "other operations. READ COMMITTED is sufficient."
        ),
    ),
    OperationType.SPAWN: OperationIsolation(
        operation=OperationType.SPAWN,
        isolation=IsolationLevel.READ_COMMITTED,
        justification=(
            "Spawning a new ticket inserts a new row. There is no "
            "conflicting state to protect, so READ COMMITTED suffices."
        ),
    ),
    OperationType.READ: OperationIsolation(
        operation=OperationType.READ,
        isolation=IsolationLevel.READ_COMMITTED,
        justification=(
            "Read-only queries do not modify state. READ COMMITTED "
            "provides adequate consistency for dashboard and status queries."
        ),
    ),
}


def isolation_for(operation: OperationType) -> IsolationLevel:
    """Return the isolation level required for *operation*.

    Parameters
    ----------
    operation : OperationType
        The ForgeOS operation type.

    Returns
    -------
    IsolationLevel
        The isolation level that should be used.

    Raises
    ------
    KeyError
        If *operation* has no mapping (should never happen for valid enums).
    """
    return OPERATION_ISOLATION_MAP[operation].isolation


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class SerializationError(Exception):
    """Raised when a serialization failure is not recoverable after retries.

    Attributes
    ----------
    operation : OperationType
        The operation that failed.
    attempts : int
        Number of attempts made before giving up.
    """

    def __init__(self, operation: OperationType, attempts: int) -> None:
        super().__init__(
            f"Serialization failure for {operation.value} after {attempts} attempts"
        )
        self.operation = operation
        self.attempts = attempts


class TransactionError(Exception):
    """Raised for non-serialization transaction failures."""


# ---------------------------------------------------------------------------
# Connection pool protocol (for dependency injection)
# ---------------------------------------------------------------------------


class PoolLike(Protocol):
    """Minimal async pool interface for transaction management."""

    async def acquire(self) -> Any: ...
    async def release(self, connection: Any) -> None: ...


# ---------------------------------------------------------------------------
# Transaction context manager
# ---------------------------------------------------------------------------


@asynccontextmanager
async def transactional(
    pool: PoolLike,
    operation: OperationType,
    *,
    max_retries: int = DEFAULT_MAX_RETRIES,
    base_delay: float = DEFAULT_BASE_DELAY,
) -> AsyncIterator[Any]:
    """Execute a block inside a transaction with the correct isolation level.

    Acquires a connection from *pool*, starts a transaction at the
    isolation level dictated by *operation*, and yields the connection.
    On successful completion the transaction is committed; on exception
    it is rolled back.

    If a **serialization failure** (SQLSTATE ``40001``) occurs, the
    entire block is retried up to *max_retries* times with exponential
    back-off.  After exhausting retries, :exc:`SerializationError` is
    raised.

    Parameters
    ----------
    pool : PoolLike
        asyncpg-compatible connection pool.
    operation : OperationType
        Operation type — determines isolation level.
    max_retries : int
        Maximum retry attempts for serialization failures (default: 3).
    base_delay : float
        Base delay in seconds for exponential back-off (default: 0.05).

    Yields
    ------
    connection
        An asyncpg connection inside an active transaction.

    Raises
    ------
    SerializationError
        If all retry attempts are exhausted due to serialization failures.
    TransactionError
        For non-retryable transaction errors.
    """
    isolation = isolation_for(operation)
    iso_str = isolation.value

    attempts = 0
    last_error: Exception | None = None

    while attempts <= max_retries:
        conn = await pool.acquire()
        try:
            async with conn.transaction(isolation=iso_str):
                logger.info(
                    "Transaction started",
                    extra={
                        "operation": operation.value,
                        "isolation": iso_str,
                        "attempt": attempts + 1,
                    },
                )
                yield conn
                # If we reach here, the yield block completed successfully.
                # The async with commits the transaction.
                logger.info(
                    "Transaction committed",
                    extra={
                        "operation": operation.value,
                        "isolation": iso_str,
                        "attempt": attempts + 1,
                    },
                )
                return  # Success — exit the retry loop.
        except Exception as exc:
            # Check for serialization failure (asyncpg wraps SQLSTATE
            # in the sqlstate attribute of its error classes).
            sqlstate = getattr(exc, "sqlstate", None)
            if sqlstate == _SERIALIZATION_FAILURE:
                attempts += 1
                last_error = exc
                if attempts <= max_retries:
                    delay = base_delay * (2 ** (attempts - 1))
                    logger.warning(
                        "Serialization failure, retrying",
                        extra={
                            "operation": operation.value,
                            "isolation": iso_str,
                            "attempt": attempts,
                            "max_retries": max_retries,
                            "delay_seconds": delay,
                        },
                    )
                    await asyncio.sleep(delay)
                    continue
                # Exhausted retries
                logger.error(
                    "Serialization failure, retries exhausted",
                    extra={
                        "operation": operation.value,
                        "isolation": iso_str,
                        "attempts": attempts,
                    },
                )
                raise SerializationError(operation, attempts) from last_error
            else:
                # Non-serialization error — propagate immediately.
                logger.error(
                    "Transaction failed",
                    extra={
                        "operation": operation.value,
                        "isolation": iso_str,
                        "error": str(exc),
                    },
                )
                raise
        finally:
            await pool.release(conn)

    # Should not be reachable, but satisfy type checker.
    raise SerializationError(operation, attempts)  # pragma: no cover
