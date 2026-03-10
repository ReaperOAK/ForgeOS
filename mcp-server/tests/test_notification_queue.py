"""Tests for mcp_server.notifications — FORGEOS-BE064.

Covers all 6 acceptance criteria:
 1. Alembic migration creates notification_queue table
 2. Enqueue with pending status and JSONB payload
 3. Dequeue with FOR UPDATE SKIP LOCKED
 4. Status transition enforcement
 5. Retry with exponential backoff + dead-letter
 6. Partial index on (status, next_retry_at)
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from mcp_server.notifications import Notification, NotificationQueue, NotificationStatus
from mcp_server.notifications.queue import (
    _VALID_TRANSITIONS,
    InvalidTransitionError,
    _record_to_notification,
    compute_backoff_seconds,
)

# ---------------------------------------------------------------------------
# Helpers / In-Memory Pool Mock
# ---------------------------------------------------------------------------


class MockRecord(dict):
    """Dict subclass that supports attribute-style access like asyncpg.Record."""

    def __getitem__(self, key: str) -> Any:
        return super().__getitem__(key)


def _make_record(
    notification_id: str | None = None,
    event_type: str = "test.event",
    payload: str = "{}",
    status: str = "pending",
    retry_count: int = 0,
    max_retries: int = 5,
    next_retry_at: datetime | None = None,
    error_message: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> MockRecord:
    now = datetime.now(timezone.utc)
    return MockRecord(
        id=uuid.UUID(notification_id) if notification_id else uuid.uuid4(),
        event_type=event_type,
        payload=payload,
        status=status,
        retry_count=retry_count,
        max_retries=max_retries,
        next_retry_at=next_retry_at,
        error_message=error_message,
        created_at=created_at or now,
        updated_at=updated_at or now,
    )


class InMemoryPool:
    """Lightweight mock that satisfies AsyncPGPool protocol.

    Routes queries by SQL string matching to simulate INSERT, UPDATE,
    and SELECT operations on the notification_queue table.
    """

    def __init__(self) -> None:
        self.rows: dict[str, MockRecord] = {}
        self.executed_queries: list[str] = []

    async def execute(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> str:
        self.executed_queries.append(query)
        q = query.lower()
        if "insert into notification_queue" in q:
            nid = str(args[0])
            self.rows[nid] = _make_record(
                notification_id=nid,
                event_type=args[1],
                payload=args[2],
                max_retries=args[3],
            )
        return "INSERT 0 1"

    async def fetchrow(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> MockRecord | None:
        self.executed_queries.append(query)
        q = query.lower()

        if "for update skip locked" in q:
            # Dequeue: find first pending/failed row
            for _nid, row in list(self.rows.items()):
                if row["status"] in ("pending", "failed"):
                    nra = row["next_retry_at"]
                    if nra is None or nra <= args[0]:
                        row["status"] = "processing"
                        return row
            return None

        if "update notification_queue" in q and "where id = $1" in q:
            nid = str(args[0])
            row = self.rows.get(nid)
            if row is None:
                return None

            if "status = $2" in q and "retry_count = $" not in q:
                row["status"] = args[1]
                return row

            if "dead_letter" in q:
                row["status"] = "dead_letter"
                row["retry_count"] = args[1]
                row["error_message"] = args[2]
                return row

            if "failed" in q:
                row["status"] = "failed"
                row["retry_count"] = args[1]
                row["next_retry_at"] = args[2]
                row["error_message"] = args[3]
                return row

        if "select" in q and "where id = $1" in q:
            nid = str(args[0])
            return self.rows.get(nid)

        return None

    async def fetch(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> list[MockRecord]:
        self.executed_queries.append(query)
        q = query.lower()

        if "dead_letter" in q:
            limit = args[0] if args else 100
            return [
                r for r in list(self.rows.values()) if r["status"] == "dead_letter"
            ][:limit]

        if "group by status" in q:
            counts: dict[str, int] = {}
            for r in self.rows.values():
                s = r["status"]
                counts[s] = counts.get(s, 0) + 1
            return [MockRecord(status=s, cnt=c) for s, c in counts.items()]

        return []


@pytest.fixture()
def pool() -> InMemoryPool:
    return InMemoryPool()


@pytest.fixture()
def queue(pool: InMemoryPool) -> NotificationQueue:
    return NotificationQueue(pool)


# ---------------------------------------------------------------------------
# AC1: Migration schema verification
# ---------------------------------------------------------------------------


def _load_migration():
    """Load the migration module from the filesystem."""
    import importlib.util
    import pathlib

    migration_path = (
        pathlib.Path(__file__).resolve().parent.parent
        / "alembic" / "versions" / "20260310_000000_004_notification_queue.py"
    )
    spec = importlib.util.spec_from_file_location("migration_004", migration_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestMigrationSchema:
    """Verify the Alembic migration file defines the expected table."""

    def test_migration_file_exists(self) -> None:
        mod = _load_migration()
        assert hasattr(mod, "upgrade")
        assert hasattr(mod, "downgrade")

    def test_migration_revision_chain(self) -> None:
        mod = _load_migration()
        assert mod.revision == "004"
        assert mod.down_revision == "003"

    def test_upgrade_sql_contains_table(self) -> None:
        import inspect

        mod = _load_migration()
        src = inspect.getsource(mod.upgrade)
        assert "notification_queue" in src
        assert "CREATE TABLE" in src or "create table" in src.lower()


# ---------------------------------------------------------------------------
# AC2: Enqueue
# ---------------------------------------------------------------------------


class TestEnqueue:
    async def test_enqueue_returns_uuid(self, queue: NotificationQueue) -> None:
        nid = await queue.enqueue("ticket.created", {"ticket_id": "T-1"})
        uuid.UUID(nid)  # validates format

    async def test_enqueue_inserts_pending(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ticket.created")
        row = pool.rows[nid]
        assert row["status"] == "pending"

    async def test_enqueue_stores_payload(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        payload = {"key": "value"}
        nid = await queue.enqueue("ev", payload)
        stored = json.loads(pool.rows[nid]["payload"])
        assert stored == payload

    async def test_enqueue_default_max_retries(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev")
        assert pool.rows[nid]["max_retries"] == 5

    async def test_enqueue_custom_max_retries(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=10)
        assert pool.rows[nid]["max_retries"] == 10

    async def test_enqueue_empty_event_type_raises(
        self, queue: NotificationQueue
    ) -> None:
        with pytest.raises(ValueError, match="event_type"):
            await queue.enqueue("")

    async def test_enqueue_zero_retries_raises(
        self, queue: NotificationQueue
    ) -> None:
        with pytest.raises(ValueError, match="max_retries"):
            await queue.enqueue("ev", max_retries=0)

    async def test_enqueue_none_payload_stores_empty(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev")
        stored = json.loads(pool.rows[nid]["payload"])
        assert stored == {}


# ---------------------------------------------------------------------------
# AC3: Dequeue with FOR UPDATE SKIP LOCKED
# ---------------------------------------------------------------------------


class TestDequeue:
    async def test_dequeue_returns_notification(
        self, queue: NotificationQueue
    ) -> None:
        await queue.enqueue("ev")
        n = await queue.dequeue()
        assert n is not None
        assert isinstance(n, Notification)
        assert n.status == NotificationStatus.PROCESSING

    async def test_dequeue_empty_returns_none(
        self, queue: NotificationQueue
    ) -> None:
        result = await queue.dequeue()
        assert result is None

    async def test_dequeue_skips_already_processing(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev")
        pool.rows[nid]["status"] = "processing"
        result = await queue.dequeue()
        assert result is None

    async def test_dequeue_sql_contains_skip_locked(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        await queue.enqueue("ev")
        await queue.dequeue()
        dequeue_queries = [
            q for q in pool.executed_queries if "skip locked" in q.lower()
        ]
        assert len(dequeue_queries) > 0


# ---------------------------------------------------------------------------
# AC4: Status transition enforcement
# ---------------------------------------------------------------------------


class TestStatusTransitions:
    async def test_pending_to_processing_via_dequeue(
        self, queue: NotificationQueue
    ) -> None:
        await queue.enqueue("ev")
        n = await queue.dequeue()
        assert n is not None
        assert n.status == NotificationStatus.PROCESSING

    async def test_processing_to_delivered(
        self, queue: NotificationQueue
    ) -> None:
        nid = await queue.enqueue("ev")
        await queue.dequeue()
        n = await queue.mark_delivered(nid)
        assert n.status == NotificationStatus.DELIVERED

    async def test_processing_to_failed(
        self, queue: NotificationQueue
    ) -> None:
        nid = await queue.enqueue("ev")
        await queue.dequeue()
        n = await queue.mark_failed(nid, "connection timeout")
        assert n.status in (NotificationStatus.FAILED, NotificationStatus.DEAD_LETTER)

    async def test_invalid_pending_to_delivered_raises(
        self, queue: NotificationQueue
    ) -> None:
        nid = await queue.enqueue("ev")
        with pytest.raises(InvalidTransitionError):
            await queue.mark_delivered(nid)

    async def test_delivered_is_terminal(self) -> None:
        allowed = _VALID_TRANSITIONS[NotificationStatus.DELIVERED]
        assert len(allowed) == 0

    async def test_dead_letter_is_terminal(self) -> None:
        allowed = _VALID_TRANSITIONS[NotificationStatus.DEAD_LETTER]
        assert len(allowed) == 0

    async def test_all_statuses_have_transition_entry(self) -> None:
        for s in NotificationStatus:
            assert s in _VALID_TRANSITIONS


# ---------------------------------------------------------------------------
# AC5: Retry with exponential backoff
# ---------------------------------------------------------------------------


class TestRetryBackoff:
    def test_compute_backoff_first_retry(self) -> None:
        delay = compute_backoff_seconds(1)
        assert delay == 10 * 2**1  # 20s

    def test_compute_backoff_second_retry(self) -> None:
        delay = compute_backoff_seconds(2)
        assert delay == 10 * 2**2  # 40s

    def test_compute_backoff_capped_at_max(self) -> None:
        delay = compute_backoff_seconds(100)
        assert delay == 3600

    def test_compute_backoff_zero(self) -> None:
        delay = compute_backoff_seconds(0)
        assert delay == 10  # 10 * 2^0

    async def test_mark_failed_increments_retry(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        await queue.dequeue()
        n = await queue.mark_failed(nid, "err")
        assert n.retry_count == 1

    async def test_mark_failed_sets_next_retry(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        await queue.dequeue()
        n = await queue.mark_failed(nid, "err")
        assert n.status == NotificationStatus.FAILED
        assert n.next_retry_at is not None

    async def test_max_retries_sends_to_dead_letter(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=1)
        await queue.dequeue()
        n = await queue.mark_failed(nid, "permanent failure")
        assert n.status == NotificationStatus.DEAD_LETTER

    async def test_dead_letter_retrievable(
        self, queue: NotificationQueue, pool: InMemoryPool
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=1)
        await queue.dequeue()
        await queue.mark_failed(nid, "err")
        dead = await queue.get_dead_letters()
        assert len(dead) == 1
        assert dead[0].id == nid


# ---------------------------------------------------------------------------
# AC6: Index verification
# ---------------------------------------------------------------------------


class TestIndexDefinition:
    def test_migration_contains_index(self) -> None:
        import inspect

        mod = _load_migration()
        src = inspect.getsource(mod.upgrade)
        assert "idx_notification_queue_dequeue" in src
        assert "status" in src
        assert "next_retry_at" in src


# ---------------------------------------------------------------------------
# Model & helpers
# ---------------------------------------------------------------------------


class TestNotificationModel:
    def test_notification_is_frozen(self) -> None:
        n = Notification(id="abc", event_type="ev")
        with pytest.raises(AttributeError):
            n.id = "xyz"  # type: ignore[misc]

    def test_default_status_is_pending(self) -> None:
        n = Notification(id="abc", event_type="ev")
        assert n.status == NotificationStatus.PENDING

    def test_default_retry_count(self) -> None:
        n = Notification(id="abc", event_type="ev")
        assert n.retry_count == 0


class TestNotificationStatus:
    def test_enum_values(self) -> None:
        assert NotificationStatus.PENDING.value == "pending"
        assert NotificationStatus.PROCESSING.value == "processing"
        assert NotificationStatus.DELIVERED.value == "delivered"
        assert NotificationStatus.FAILED.value == "failed"
        assert NotificationStatus.DEAD_LETTER.value == "dead_letter"

    def test_status_is_string(self) -> None:
        for s in NotificationStatus:
            assert isinstance(s, str)


class TestQueryOperations:
    async def test_get_by_id_existing(
        self, queue: NotificationQueue
    ) -> None:
        nid = await queue.enqueue("ev")
        n = await queue.get_by_id(nid)
        assert n is not None
        assert n.id == nid

    async def test_get_by_id_nonexistent(
        self, queue: NotificationQueue
    ) -> None:
        result = await queue.get_by_id(str(uuid.uuid4()))
        assert result is None

    async def test_count_by_status(
        self, queue: NotificationQueue
    ) -> None:
        await queue.enqueue("ev1")
        await queue.enqueue("ev2")
        counts = await queue.count_by_status()
        assert counts.get("pending", 0) == 2


class TestRecordToNotification:
    def test_converts_string_payload(self) -> None:
        rec = _make_record(payload=json.dumps({"k": "v"}))
        n = _record_to_notification(rec)
        assert n.payload == {"k": "v"}

    def test_converts_dict_payload(self) -> None:
        rec = _make_record()
        rec["payload"] = {"direct": True}
        n = _record_to_notification(rec)
        assert n.payload == {"direct": True}


class TestInvalidTransitionError:
    def test_is_exception(self) -> None:
        assert issubclass(InvalidTransitionError, Exception)

    def test_message(self) -> None:
        err = InvalidTransitionError("bad transition")
        assert str(err) == "bad transition"


class TestPackageImports:
    def test_public_api(self) -> None:
        from mcp_server.notifications import Notification, NotificationQueue, NotificationStatus
        assert Notification is not None
        assert NotificationQueue is not None
        assert NotificationStatus is not None
