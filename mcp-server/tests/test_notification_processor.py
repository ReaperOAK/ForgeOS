"""Tests for notification processor — FORGEOS-BE067.

Covers all 6 acceptance criteria:
 1. Background processor dequeues and delivers on configurable interval
 2. Successful delivery updates status to delivered with delivery timestamp
 3. Failed delivery increments retry_count with exponential backoff
 4. Configurable backoff schedule: 1 min, 5 min, 15 min, 1 hour
 5. Notifications exceeding max retries move to dead_letter status
 6. Dead-letter notifications queryable for inspection and replay
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

import pytest

from mcp_server.notifications.channels import (
    DeliveryResult,
    NotificationChannel,
)
from mcp_server.notifications.processor import (
    _DEFAULT_BACKOFF_SCHEDULE,
    _DEFAULT_BATCH_SIZE,
    _DEFAULT_POLL_INTERVAL,
    NotificationProcessor,
    ProcessorConfig,
)
from mcp_server.notifications.queue import (
    _DEFAULT_BACKOFF_SCHEDULE as QUEUE_BACKOFF_SCHEDULE,
)
from mcp_server.notifications.queue import (
    NotificationQueue,
    NotificationStatus,
    compute_backoff_seconds,
)

# ---------------------------------------------------------------------------
# Helpers / Mocks
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
    """Lightweight mock that satisfies AsyncPGPool protocol."""

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

            # Replay dead letter
            if "status = 'pending'" in q and "retry_count = 0" in q:
                row["status"] = "pending"
                row["retry_count"] = 0
                row["next_retry_at"] = None
                row["error_message"] = None
                return row

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


class InMemoryChannelPool:
    """Mock pool simulating notification_channels with configurable responses."""

    def __init__(self, channels: list[MockRecord] | None = None) -> None:
        self.channels = channels or []

    async def execute(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> str:
        return "OK"

    async def fetchrow(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> MockRecord | None:
        return None

    async def fetch(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> list[MockRecord]:
        return self.channels


class FakeDelivery:
    """Configurable delivery mock for testing dispatch outcomes."""

    def __init__(self, *, success: bool = True, error: str | None = None) -> None:
        self._success = success
        self._error = error
        self.call_count = 0

    async def deliver(
        self,
        channel: NotificationChannel,
        event_type: str,
        payload: dict[str, Any],
    ) -> DeliveryResult:
        self.call_count += 1
        return DeliveryResult(
            success=self._success,
            channel_id=channel.channel_id,
            error_message=self._error,
        )


class FakeDispatcher:
    """Dispatcher substitute that returns configurable results."""

    def __init__(
        self,
        *,
        results: list[DeliveryResult] | None = None,
        raise_on_dispatch: bool = False,
    ) -> None:
        self._results = results if results is not None else []
        self._raise = raise_on_dispatch
        self.dispatch_calls: list[tuple[str, dict[str, Any]]] = []

    async def dispatch(
        self, event_type: str, payload: dict[str, Any]
    ) -> list[DeliveryResult]:
        self.dispatch_calls.append((event_type, payload))
        if self._raise:
            raise RuntimeError("dispatch boom")
        return self._results


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def pool() -> InMemoryPool:
    return InMemoryPool()


@pytest.fixture()
def queue(pool: InMemoryPool) -> NotificationQueue:
    return NotificationQueue(pool)


@pytest.fixture()
def success_dispatcher() -> FakeDispatcher:
    return FakeDispatcher(
        results=[DeliveryResult(success=True, channel_id="ch-1")]
    )


@pytest.fixture()
def fail_dispatcher() -> FakeDispatcher:
    return FakeDispatcher(
        results=[
            DeliveryResult(
                success=False, channel_id="ch-1", error_message="timeout"
            )
        ]
    )


@pytest.fixture()
def empty_dispatcher() -> FakeDispatcher:
    return FakeDispatcher(results=[])


# ---------------------------------------------------------------------------
# AC1: Background processor dequeues on configurable interval
# ---------------------------------------------------------------------------


class TestProcessorLifecycle:
    async def test_start_sets_running(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        await proc.start()
        assert proc.is_running is True
        await proc.stop()

    async def test_stop_clears_running(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        await proc.start()
        await proc.stop()
        assert proc.is_running is False

    async def test_double_start_is_idempotent(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        await proc.start()
        await proc.start()  # should not raise
        assert proc.is_running is True
        await proc.stop()

    async def test_stop_without_start_is_noop(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        await proc.stop()  # should not raise
        assert proc.is_running is False

    async def test_configurable_poll_interval(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        cfg = ProcessorConfig(poll_interval_seconds=0.5)
        proc = NotificationProcessor(queue, success_dispatcher, config=cfg)  # type: ignore[arg-type]
        assert proc.config.poll_interval_seconds == 0.5

    async def test_default_config_values(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        assert proc.config.poll_interval_seconds == _DEFAULT_POLL_INTERVAL
        assert proc.config.batch_size == _DEFAULT_BATCH_SIZE
        assert proc.config.backoff_schedule == list(_DEFAULT_BACKOFF_SCHEDULE)
        assert proc.config.max_retries == 5

    async def test_poll_loop_processes_queued_items(
        self, queue: NotificationQueue, success_dispatcher: FakeDispatcher
    ) -> None:
        await queue.enqueue("test.event", {"key": "val"})
        cfg = ProcessorConfig(poll_interval_seconds=0.01)
        proc = NotificationProcessor(queue, success_dispatcher, config=cfg)  # type: ignore[arg-type]
        await proc.start()
        await asyncio.sleep(0.1)
        await proc.stop()
        assert proc.processed_count >= 1


# ---------------------------------------------------------------------------
# AC2: Successful delivery updates status to delivered
# ---------------------------------------------------------------------------


class TestSuccessfulDelivery:
    async def test_process_one_marks_delivered(
        self,
        queue: NotificationQueue,
        success_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("ticket.created", {"ticket_id": "T-1"})
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        result = await proc.process_one(notification)
        assert result is True
        stored = pool.rows[nid]
        assert stored["status"] == "delivered"

    async def test_process_one_dispatches_to_channels(
        self,
        queue: NotificationQueue,
        success_dispatcher: FakeDispatcher,
    ) -> None:
        await queue.enqueue("stage_changed", {"ticket_id": "T-2"})
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        await proc.process_one(notification)
        assert len(success_dispatcher.dispatch_calls) == 1
        event_type, _payload = success_dispatcher.dispatch_calls[0]
        assert event_type == "stage_changed"

    async def test_no_matching_channels_marks_delivered(
        self,
        queue: NotificationQueue,
        empty_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("obscure.event")
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, empty_dispatcher)  # type: ignore[arg-type]
        result = await proc.process_one(notification)
        assert result is True
        assert pool.rows[nid]["status"] == "delivered"


# ---------------------------------------------------------------------------
# AC3: Failed delivery increments retry_count with exponential backoff
# ---------------------------------------------------------------------------


class TestFailedDelivery:
    async def test_failed_delivery_marks_failed(
        self,
        queue: NotificationQueue,
        fail_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, fail_dispatcher)  # type: ignore[arg-type]
        result = await proc.process_one(notification)
        assert result is False
        row = pool.rows[nid]
        assert row["status"] in ("failed", "dead_letter")

    async def test_failed_delivery_increments_retry_count(
        self,
        queue: NotificationQueue,
        fail_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, fail_dispatcher)  # type: ignore[arg-type]
        await proc.process_one(notification)
        assert pool.rows[nid]["retry_count"] == 1

    async def test_failed_delivery_schedules_retry(
        self,
        queue: NotificationQueue,
        fail_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, fail_dispatcher)  # type: ignore[arg-type]
        await proc.process_one(notification)
        assert pool.rows[nid]["next_retry_at"] is not None

    async def test_error_message_captured(
        self,
        queue: NotificationQueue,
        fail_dispatcher: FakeDispatcher,
        pool: InMemoryPool,
    ) -> None:
        nid = await queue.enqueue("ev", max_retries=5)
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, fail_dispatcher)  # type: ignore[arg-type]
        await proc.process_one(notification)
        assert pool.rows[nid]["error_message"] is not None
        assert "timeout" in pool.rows[nid]["error_message"]

    async def test_partial_channel_failure_marks_failed(
        self,
        queue: NotificationQueue,
        pool: InMemoryPool,
    ) -> None:
        mixed = FakeDispatcher(
            results=[
                DeliveryResult(success=True, channel_id="ch-1"),
                DeliveryResult(
                    success=False, channel_id="ch-2", error_message="500"
                ),
            ]
        )
        nid = await queue.enqueue("ev", max_retries=5)  # noqa: F841
        notification = await queue.dequeue()
        assert notification is not None
        proc = NotificationProcessor(queue, mixed)  # type: ignore[arg-type]
        result = await proc.process_one(notification)
        assert result is False


# ---------------------------------------------------------------------------
# AC4: Configurable backoff schedule: 1 min, 5 min, 15 min, 1 hour
# ---------------------------------------------------------------------------


class TestBackoffSchedule:
    def test_default_schedule_values(self) -> None:
        assert _DEFAULT_BACKOFF_SCHEDULE == [60.0, 300.0, 900.0, 3600.0]

    def test_queue_module_exports_same_schedule(self) -> None:
        assert QUEUE_BACKOFF_SCHEDULE == [60.0, 300.0, 900.0, 3600.0]

    def test_compute_backoff_with_schedule_retry1(self) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        assert compute_backoff_seconds(1, schedule) == 60.0

    def test_compute_backoff_with_schedule_retry2(self) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        assert compute_backoff_seconds(2, schedule) == 300.0

    def test_compute_backoff_with_schedule_retry3(self) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        assert compute_backoff_seconds(3, schedule) == 900.0

    def test_compute_backoff_with_schedule_retry4(self) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        assert compute_backoff_seconds(4, schedule) == 3600.0

    def test_compute_backoff_clamped_beyond_schedule(self) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        assert compute_backoff_seconds(10, schedule) == 3600.0

    def test_compute_backoff_without_schedule_legacy(self) -> None:
        # Legacy behavior preserved when no schedule provided
        assert compute_backoff_seconds(1) == 10 * 2**1  # 20
        assert compute_backoff_seconds(2) == 10 * 2**2  # 40

    def test_custom_schedule(self) -> None:
        custom = [30.0, 120.0, 600.0]
        assert compute_backoff_seconds(1, custom) == 30.0
        assert compute_backoff_seconds(2, custom) == 120.0
        assert compute_backoff_seconds(3, custom) == 600.0
        assert compute_backoff_seconds(5, custom) == 600.0  # clamped

    def test_processor_applies_schedule_to_queue(
        self, pool: InMemoryPool
    ) -> None:
        q = NotificationQueue(pool)
        schedule = [10.0, 20.0, 30.0]
        cfg = ProcessorConfig(backoff_schedule=schedule)
        disp = FakeDispatcher()
        _proc = NotificationProcessor(q, disp, config=cfg)  # type: ignore[arg-type]
        assert q.backoff_schedule == schedule

    async def test_failed_delivery_uses_configured_schedule(
        self,
        pool: InMemoryPool,
    ) -> None:
        schedule = [60.0, 300.0, 900.0, 3600.0]
        q = NotificationQueue(pool, backoff_schedule=schedule)
        fail_disp = FakeDispatcher(
            results=[
                DeliveryResult(
                    success=False, channel_id="ch-1", error_message="err"
                )
            ]
        )
        proc = NotificationProcessor(
            q, fail_disp, config=ProcessorConfig(backoff_schedule=schedule),
        )  # type: ignore[arg-type]

        nid = await q.enqueue("ev", max_retries=5)
        notification = await q.dequeue()
        assert notification is not None
        await proc.process_one(notification)

        row = pool.rows[nid]
        assert row["status"] == "failed"
        assert row["next_retry_at"] is not None


# ---------------------------------------------------------------------------
# AC5: Notifications exceeding max retries move to dead_letter
# ---------------------------------------------------------------------------


class TestDeadLetter:
    async def test_max_retries_sends_to_dead_letter(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool, backoff_schedule=[60.0])
        fail_disp = FakeDispatcher(
            results=[
                DeliveryResult(
                    success=False, channel_id="ch-1", error_message="err"
                )
            ]
        )
        proc = NotificationProcessor(q, fail_disp)  # type: ignore[arg-type]

        nid = await q.enqueue("ev", max_retries=1)
        notification = await q.dequeue()
        assert notification is not None
        await proc.process_one(notification)

        assert pool.rows[nid]["status"] == "dead_letter"

    async def test_dead_letter_preserves_error(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool, backoff_schedule=[60.0])
        fail_disp = FakeDispatcher(
            results=[
                DeliveryResult(
                    success=False,
                    channel_id="ch-1",
                    error_message="permanent failure",
                )
            ]
        )
        proc = NotificationProcessor(q, fail_disp)  # type: ignore[arg-type]

        nid = await q.enqueue("ev", max_retries=1)
        notification = await q.dequeue()
        assert notification is not None
        await proc.process_one(notification)

        assert pool.rows[nid]["error_message"] == "permanent failure"

    async def test_below_max_retries_stays_failed(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool, backoff_schedule=[60.0, 300.0])
        fail_disp = FakeDispatcher(
            results=[
                DeliveryResult(
                    success=False, channel_id="ch-1", error_message="err"
                )
            ]
        )
        proc = NotificationProcessor(q, fail_disp)  # type: ignore[arg-type]

        nid = await q.enqueue("ev", max_retries=3)
        notification = await q.dequeue()
        assert notification is not None
        await proc.process_one(notification)

        assert pool.rows[nid]["status"] == "failed"
        assert pool.rows[nid]["retry_count"] == 1


# ---------------------------------------------------------------------------
# AC6: Dead-letter queryable for inspection and replay
# ---------------------------------------------------------------------------


class TestDeadLetterQueryAndReplay:
    async def test_dead_letters_queryable(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool)
        fail_disp = FakeDispatcher(
            results=[
                DeliveryResult(
                    success=False, channel_id="ch-1", error_message="err"
                )
            ]
        )
        proc = NotificationProcessor(q, fail_disp)  # type: ignore[arg-type]

        nid = await q.enqueue("ev", max_retries=1)
        notification = await q.dequeue()
        assert notification is not None
        await proc.process_one(notification)

        dead = await q.get_dead_letters()
        assert len(dead) == 1
        assert dead[0].id == nid

    async def test_replay_dead_letter_resets_to_pending(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool)
        nid = await q.enqueue("ev", max_retries=1)
        await q.dequeue()
        await q.mark_failed(nid, "permanent")

        assert pool.rows[nid]["status"] == "dead_letter"

        replayed = await q.replay_dead_letter(nid)
        assert replayed.status == NotificationStatus.PENDING
        assert replayed.retry_count == 0
        assert replayed.error_message is None

    async def test_replay_dead_letter_resets_retry_count(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool)
        nid = await q.enqueue("ev", max_retries=1)
        await q.dequeue()
        await q.mark_failed(nid, "err")

        replayed = await q.replay_dead_letter(nid)
        assert replayed.retry_count == 0
        assert replayed.next_retry_at is None

    async def test_replay_non_dead_letter_raises(
        self,
        queue: NotificationQueue,
    ) -> None:
        nid = await queue.enqueue("ev")
        with pytest.raises(ValueError, match="dead_letter"):
            await queue.replay_dead_letter(nid)

    async def test_replay_nonexistent_raises(
        self,
        queue: NotificationQueue,
    ) -> None:
        with pytest.raises(ValueError, match="not found"):
            await queue.replay_dead_letter(str(uuid.uuid4()))

    async def test_replayed_notification_reprocessable(
        self,
        pool: InMemoryPool,
    ) -> None:
        q = NotificationQueue(pool)
        success_disp = FakeDispatcher(
            results=[DeliveryResult(success=True, channel_id="ch-1")]
        )
        proc = NotificationProcessor(q, success_disp)  # type: ignore[arg-type]

        # Manually put into dead_letter state
        nid = await q.enqueue("ev", max_retries=1)
        await q.dequeue()
        await q.mark_failed(nid, "err")
        assert pool.rows[nid]["status"] == "dead_letter"

        # Replay
        await q.replay_dead_letter(nid)
        assert pool.rows[nid]["status"] == "pending"

        # Re-process
        notification = await q.dequeue()
        assert notification is not None
        result = await proc.process_one(notification)
        assert result is True
        assert pool.rows[nid]["status"] == "delivered"


# ---------------------------------------------------------------------------
# ProcessorConfig tests
# ---------------------------------------------------------------------------


class TestProcessorConfig:
    def test_default_values(self) -> None:
        cfg = ProcessorConfig()
        assert cfg.poll_interval_seconds == 5.0
        assert cfg.batch_size == 10
        assert cfg.backoff_schedule == [60.0, 300.0, 900.0, 3600.0]
        assert cfg.max_retries == 5

    def test_custom_values(self) -> None:
        cfg = ProcessorConfig(
            poll_interval_seconds=1.0,
            batch_size=5,
            backoff_schedule=[30.0, 120.0],
            max_retries=3,
        )
        assert cfg.poll_interval_seconds == 1.0
        assert cfg.batch_size == 5
        assert cfg.backoff_schedule == [30.0, 120.0]
        assert cfg.max_retries == 3

    def test_config_is_frozen(self) -> None:
        cfg = ProcessorConfig()
        with pytest.raises(AttributeError):
            cfg.poll_interval_seconds = 10.0  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Batch processing tests
# ---------------------------------------------------------------------------


class TestBatchProcessing:
    async def test_processes_up_to_batch_size(
        self,
        pool: InMemoryPool,
        success_dispatcher: FakeDispatcher,
    ) -> None:
        q = NotificationQueue(pool)
        proc = NotificationProcessor(
            q,
            success_dispatcher,  # type: ignore[arg-type]
            config=ProcessorConfig(batch_size=3),
        )

        for _ in range(5):
            await q.enqueue("ev")

        count = await proc._poll_once()
        assert count == 3

    async def test_empty_queue_returns_zero(
        self,
        queue: NotificationQueue,
        success_dispatcher: FakeDispatcher,
    ) -> None:
        proc = NotificationProcessor(queue, success_dispatcher)  # type: ignore[arg-type]
        count = await proc._poll_once()
        assert count == 0

    async def test_processed_count_accumulates(
        self,
        pool: InMemoryPool,
        success_dispatcher: FakeDispatcher,
    ) -> None:
        q = NotificationQueue(pool)
        proc = NotificationProcessor(q, success_dispatcher)  # type: ignore[arg-type]

        await q.enqueue("ev1")
        await q.enqueue("ev2")

        await proc._poll_once()
        assert proc.processed_count == 2

        await q.enqueue("ev3")
        await proc._poll_once()
        assert proc.processed_count == 3


# ---------------------------------------------------------------------------
# Queue backoff_schedule integration
# ---------------------------------------------------------------------------


class TestQueueBackoffScheduleIntegration:
    def test_queue_default_no_schedule(self, pool: InMemoryPool) -> None:
        q = NotificationQueue(pool)
        assert q.backoff_schedule is None

    def test_queue_accepts_schedule(self, pool: InMemoryPool) -> None:
        schedule = [60.0, 300.0]
        q = NotificationQueue(pool, backoff_schedule=schedule)
        assert q.backoff_schedule == schedule

    def test_queue_schedule_mutable_via_property(
        self, pool: InMemoryPool
    ) -> None:
        q = NotificationQueue(pool)
        q.backoff_schedule = [10.0, 20.0]
        assert q.backoff_schedule == [10.0, 20.0]
