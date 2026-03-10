"""In-database notification event queue with retry and dead-letter support.

Implements a PostgreSQL-backed notification queue for the ForgeOS MCP server.
Uses ``FOR UPDATE SKIP LOCKED`` for safe concurrent dequeue operations and
exponential backoff for failed notification retries.

.. meta::
   :ticket: FORGEOS-BE064
   :last_reviewed: 2026-03-10
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, Protocol

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    import asyncpg

logger = get_logger("notifications.queue")

_DEFAULT_MAX_RETRIES = 5
_BASE_BACKOFF_SECONDS = 10
_MAX_BACKOFF_SECONDS = 3600


class NotificationStatus(str, Enum):
    """Lifecycle states for a notification queue item."""

    PENDING = "pending"
    PROCESSING = "processing"
    DELIVERED = "delivered"
    FAILED = "failed"
    DEAD_LETTER = "dead_letter"


_VALID_TRANSITIONS: dict[NotificationStatus, frozenset[NotificationStatus]] = {
    NotificationStatus.PENDING: frozenset({NotificationStatus.PROCESSING}),
    NotificationStatus.PROCESSING: frozenset(
        {NotificationStatus.DELIVERED, NotificationStatus.FAILED}
    ),
    NotificationStatus.FAILED: frozenset(
        {NotificationStatus.PENDING, NotificationStatus.DEAD_LETTER}
    ),
    NotificationStatus.DELIVERED: frozenset(),
    NotificationStatus.DEAD_LETTER: frozenset(),
}


class InvalidTransitionError(Exception):
    """Raised when an invalid status transition is attempted."""


@dataclass(frozen=True, slots=True)
class Notification:
    """Immutable representation of a notification queue item."""

    id: str
    event_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    status: NotificationStatus = NotificationStatus.PENDING
    retry_count: int = 0
    max_retries: int = _DEFAULT_MAX_RETRIES
    next_retry_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class AsyncPGPool(Protocol):
    """Minimal protocol for asyncpg pool-like objects."""

    async def fetchrow(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> asyncpg.Record | None: ...

    async def fetch(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> list[asyncpg.Record]: ...

    async def execute(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> str: ...


def compute_backoff_seconds(retry_count: int) -> float:
    """Compute exponential backoff delay in seconds."""
    delay = _BASE_BACKOFF_SECONDS * math.pow(2, retry_count)
    return min(delay, _MAX_BACKOFF_SECONDS)


def _record_to_notification(record: asyncpg.Record) -> Notification:
    """Convert an asyncpg Record to a Notification value object."""
    import json as _json

    payload = record["payload"]
    if isinstance(payload, str):
        payload = _json.loads(payload)

    return Notification(
        id=str(record["id"]),
        event_type=record["event_type"],
        payload=payload if isinstance(payload, dict) else {},
        status=NotificationStatus(record["status"]),
        retry_count=record["retry_count"],
        max_retries=record["max_retries"],
        next_retry_at=record["next_retry_at"],
        error_message=record["error_message"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


class NotificationQueue:
    """PostgreSQL-backed notification event queue."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def enqueue(
        self,
        event_type: str,
        payload: dict[str, Any] | None = None,
        *,
        max_retries: int = _DEFAULT_MAX_RETRIES,
    ) -> str:
        """Insert a new notification into the queue with pending status."""
        if not event_type or not event_type.strip():
            raise ValueError("event_type must be a non-empty string")
        if max_retries < 1:
            raise ValueError("max_retries must be at least 1")

        import json as _json

        notification_id = str(uuid.uuid4())
        payload_json = _json.dumps(payload or {})

        await self._pool.execute(
            "INSERT INTO notification_queue"
            " (id, event_type, payload, status, max_retries)"
            " VALUES ($1, $2, $3::jsonb, 'pending', $4)",
            uuid.UUID(notification_id),
            event_type.strip(),
            payload_json,
            max_retries,
        )

        logger.info(
            "Notification enqueued",
            extra={
                "notification_id": notification_id,
                "event_type": event_type,
            },
        )
        return notification_id

    async def dequeue(self) -> Notification | None:
        """Atomically select and lock the next eligible notification."""
        now = datetime.now(timezone.utc)

        record = await self._pool.fetchrow(
            "UPDATE notification_queue"
            " SET status = 'processing', updated_at = NOW()"
            " WHERE id = ("
            "   SELECT id FROM notification_queue"
            "   WHERE status IN ('pending', 'failed')"
            "     AND (next_retry_at IS NULL OR next_retry_at <= $1)"
            "   ORDER BY created_at ASC"
            "   FOR UPDATE SKIP LOCKED"
            "   LIMIT 1"
            " )"
            " RETURNING id, event_type, payload, status, retry_count,"
            "           max_retries, next_retry_at, error_message,"
            "           created_at, updated_at",
            now,
        )

        if record is None:
            return None

        notification = _record_to_notification(record)
        logger.info(
            "Notification dequeued",
            extra={
                "notification_id": notification.id,
                "event_type": notification.event_type,
            },
        )
        return notification

    async def mark_delivered(self, notification_id: str) -> Notification:
        """Mark a notification as successfully delivered."""
        return await self._transition(
            notification_id,
            NotificationStatus.DELIVERED,
        )

    async def mark_failed(
        self,
        notification_id: str,
        error_message: str,
    ) -> Notification:
        """Mark a notification as failed and schedule retry if eligible."""
        current = await self._get_by_id(notification_id)
        if current is None:
            raise ValueError(f"Notification {notification_id} not found")

        self._validate_transition(current.status, NotificationStatus.FAILED)

        new_retry_count = current.retry_count + 1

        if new_retry_count >= current.max_retries:
            record = await self._pool.fetchrow(
                "UPDATE notification_queue"
                " SET status = 'dead_letter',"
                "     retry_count = $2,"
                "     error_message = $3,"
                "     updated_at = NOW()"
                " WHERE id = $1"
                " RETURNING id, event_type, payload, status, retry_count,"
                "           max_retries, next_retry_at, error_message,"
                "           created_at, updated_at",
                uuid.UUID(notification_id),
                new_retry_count,
                error_message,
            )
            logger.warning(
                "Notification dead-lettered after max retries",
                extra={
                    "notification_id": notification_id,
                    "retry_count": new_retry_count,
                    "max_retries": current.max_retries,
                },
            )
        else:
            backoff = compute_backoff_seconds(new_retry_count)
            next_retry = datetime.now(timezone.utc) + timedelta(seconds=backoff)

            record = await self._pool.fetchrow(
                "UPDATE notification_queue"
                " SET status = 'failed',"
                "     retry_count = $2,"
                "     next_retry_at = $3,"
                "     error_message = $4,"
                "     updated_at = NOW()"
                " WHERE id = $1"
                " RETURNING id, event_type, payload, status, retry_count,"
                "           max_retries, next_retry_at, error_message,"
                "           created_at, updated_at",
                uuid.UUID(notification_id),
                new_retry_count,
                next_retry,
                error_message,
            )
            logger.info(
                "Notification failed, retry scheduled",
                extra={
                    "notification_id": notification_id,
                    "retry_count": new_retry_count,
                    "next_retry_at": next_retry.isoformat(),
                    "backoff_seconds": backoff,
                },
            )

        if record is None:
            raise ValueError(f"Notification {notification_id} not found")

        return _record_to_notification(record)

    async def get_by_id(self, notification_id: str) -> Notification | None:
        """Retrieve a notification by its UUID."""
        return await self._get_by_id(notification_id)

    async def get_dead_letters(self, *, limit: int = 100) -> list[Notification]:
        """Retrieve dead-lettered notifications for manual inspection."""
        records = await self._pool.fetch(
            "SELECT id, event_type, payload, status, retry_count,"
            "       max_retries, next_retry_at, error_message,"
            "       created_at, updated_at"
            " FROM notification_queue"
            " WHERE status = 'dead_letter'"
            " ORDER BY created_at ASC"
            " LIMIT $1",
            limit,
        )
        return [_record_to_notification(r) for r in records]

    async def count_by_status(self) -> dict[str, int]:
        """Return counts of notifications grouped by status."""
        records = await self._pool.fetch(
            "SELECT status::text, COUNT(*) AS cnt"
            " FROM notification_queue"
            " GROUP BY status"
        )
        return {r["status"]: r["cnt"] for r in records}

    async def _get_by_id(self, notification_id: str) -> Notification | None:
        """Fetch a single notification by UUID."""
        record = await self._pool.fetchrow(
            "SELECT id, event_type, payload, status, retry_count,"
            "       max_retries, next_retry_at, error_message,"
            "       created_at, updated_at"
            " FROM notification_queue"
            " WHERE id = $1",
            uuid.UUID(notification_id),
        )
        if record is None:
            return None
        return _record_to_notification(record)

    async def _transition(
        self,
        notification_id: str,
        target_status: NotificationStatus,
    ) -> Notification:
        """Validate and execute a status transition."""
        current = await self._get_by_id(notification_id)
        if current is None:
            raise ValueError(f"Notification {notification_id} not found")

        self._validate_transition(current.status, target_status)

        record = await self._pool.fetchrow(
            "UPDATE notification_queue"
            " SET status = $2, updated_at = NOW()"
            " WHERE id = $1"
            " RETURNING id, event_type, payload, status, retry_count,"
            "           max_retries, next_retry_at, error_message,"
            "           created_at, updated_at",
            uuid.UUID(notification_id),
            target_status.value,
        )

        if record is None:
            raise ValueError(f"Notification {notification_id} not found")

        return _record_to_notification(record)

    @staticmethod
    def _validate_transition(
        current: NotificationStatus,
        target: NotificationStatus,
    ) -> None:
        """Raise if the transition is not allowed."""
        allowed = _VALID_TRANSITIONS.get(current, frozenset())
        if target not in allowed:
            raise InvalidTransitionError(
                f"Cannot transition from {current.value} to {target.value}"
            )
