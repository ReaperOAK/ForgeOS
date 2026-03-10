"""Background notification processor with retry and dead-letter handling.

Implements a polling loop that dequeues pending notifications from the
notification queue, delivers them through configured channels, and
handles delivery failures with configurable exponential backoff retries.

.. meta::
   :ticket: FORGEOS-BE067
   :last_reviewed: 2026-03-11
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from mcp_server.notifications.queue import (
    _DEFAULT_BACKOFF_SCHEDULE,
    _DEFAULT_MAX_RETRIES,
    NotificationQueue,
)
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from mcp_server.notifications.channels import ChannelDispatcher
    from mcp_server.notifications.queue import Notification

logger = get_logger("notifications.processor")

_DEFAULT_POLL_INTERVAL = 5.0
_DEFAULT_BATCH_SIZE = 10


@dataclass(frozen=True, slots=True)
class ProcessorConfig:
    """Configuration for the background notification processor.

    Attributes:
        poll_interval_seconds: How often (in seconds) to poll for pending
            notifications when the queue is empty.
        batch_size: Maximum notifications to dequeue per poll cycle.
        backoff_schedule: Ordered list of backoff delays (in seconds) for
            successive retry attempts.  Default: [60, 300, 900, 3600]
            (1 min, 5 min, 15 min, 1 hour).
        max_retries: Maximum delivery attempts before moving a notification
            to dead_letter status.
    """

    poll_interval_seconds: float = _DEFAULT_POLL_INTERVAL
    batch_size: int = _DEFAULT_BATCH_SIZE
    backoff_schedule: list[float] = field(
        default_factory=lambda: list(_DEFAULT_BACKOFF_SCHEDULE)
    )
    max_retries: int = _DEFAULT_MAX_RETRIES


class NotificationProcessor:
    """Background processor that dequeues and delivers notifications.

    Runs as an asyncio task, polling the notification queue on a
    configurable interval.  Delivery failures are retried with
    exponential backoff per the configured schedule.  Notifications
    exceeding max retries are moved to ``dead_letter`` status.
    """

    def __init__(
        self,
        queue: NotificationQueue,
        dispatcher: ChannelDispatcher,
        *,
        config: ProcessorConfig | None = None,
    ) -> None:
        self._config = config or ProcessorConfig()
        self._queue = queue
        self._dispatcher = dispatcher
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._processed_count = 0

        # Apply the configured backoff schedule to the queue so that
        # mark_failed computes retry delays from the same schedule.
        self._queue.backoff_schedule = self._config.backoff_schedule

    @property
    def is_running(self) -> bool:
        """Whether the background loop is currently active."""
        return self._running

    @property
    def config(self) -> ProcessorConfig:
        """Return the active processor configuration."""
        return self._config

    @property
    def processed_count(self) -> int:
        """Total notifications processed since last start."""
        return self._processed_count

    async def start(self) -> None:
        """Start the background polling loop."""
        if self._running:
            logger.warning("Processor already running")
            return
        self._running = True
        self._processed_count = 0
        self._task = asyncio.create_task(self._poll_loop())
        logger.info(
            "Notification processor started",
            extra={
                "poll_interval": self._config.poll_interval_seconds,
                "batch_size": self._config.batch_size,
                "backoff_schedule": self._config.backoff_schedule,
                "max_retries": self._config.max_retries,
            },
        )

    async def stop(self) -> None:
        """Stop the background polling loop gracefully."""
        if not self._running:
            return
        self._running = False
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        logger.info(
            "Notification processor stopped",
            extra={"total_processed": self._processed_count},
        )

    async def process_one(self, notification: Notification) -> bool:
        """Process a single notification through channel dispatch.

        Returns ``True`` if delivery succeeded on all channels (or no
        channels matched), ``False`` otherwise.
        """
        results = await self._dispatcher.dispatch(
            notification.event_type, notification.payload
        )

        if not results:
            # No matching channels — mark as delivered (nothing to deliver to)
            await self._queue.mark_delivered(notification.id)
            logger.info(
                "Notification delivered (no matching channels)",
                extra={
                    "notification_id": notification.id,
                    "event_type": notification.event_type,
                },
            )
            return True

        all_success = all(r.success for r in results)

        if all_success:
            await self._queue.mark_delivered(notification.id)
            logger.info(
                "Notification delivered",
                extra={
                    "notification_id": notification.id,
                    "event_type": notification.event_type,
                    "channel_count": len(results),
                },
            )
            return True

        errors = [
            r.error_message
            for r in results
            if not r.success and r.error_message
        ]
        error_summary = "; ".join(errors) if errors else "Delivery failed"
        await self._queue.mark_failed(notification.id, error_summary)
        logger.warning(
            "Notification delivery failed",
            extra={
                "notification_id": notification.id,
                "event_type": notification.event_type,
                "error": error_summary,
            },
        )
        return False

    async def _poll_loop(self) -> None:
        """Main polling loop — runs until stopped."""
        while self._running:
            try:
                processed = await self._poll_once()
                if processed == 0:
                    await asyncio.sleep(self._config.poll_interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Unexpected error in processor poll loop")
                await asyncio.sleep(self._config.poll_interval_seconds)

    async def _poll_once(self) -> int:
        """Dequeue and process up to ``batch_size`` notifications.

        Returns the number of notifications processed in this cycle.
        """
        count = 0
        for _ in range(self._config.batch_size):
            notification = await self._queue.dequeue()
            if notification is None:
                break
            await self.process_one(notification)
            count += 1

        self._processed_count += count

        if count > 0:
            logger.info(
                "Poll cycle complete",
                extra={"processed": count, "total": self._processed_count},
            )

        return count
