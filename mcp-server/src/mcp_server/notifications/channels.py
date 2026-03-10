"""Notification channel types, delivery, and dispatch.

Supports configurable notification channels (webhook, Slack) with
event-type filtering. Channel delivery failures are isolated so they
never block queue processing.

.. meta::
   :ticket: FORGEOS-BE066
   :last_reviewed: 2026-03-11
"""

from __future__ import annotations

import asyncio
import json
import ssl
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, Protocol

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    import asyncpg

logger = get_logger("notifications.channels")

_DEFAULT_TIMEOUT_SECONDS = 10


class ChannelType(str, Enum):
    """Supported notification delivery channel types."""

    WEBHOOK = "webhook"
    SLACK = "slack"


@dataclass(frozen=True, slots=True)
class NotificationChannel:
    """Immutable representation of a notification channel configuration."""

    channel_id: str
    name: str
    type: ChannelType
    config: dict[str, Any] = field(default_factory=dict)
    event_filter: list[str] = field(default_factory=list)
    enabled: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class DeliveryResult:
    """Result of a channel delivery attempt."""

    __slots__ = ("channel_id", "error_message", "success")

    def __init__(
        self,
        *,
        success: bool,
        channel_id: str,
        error_message: str | None = None,
    ) -> None:
        self.success = success
        self.channel_id = channel_id
        self.error_message = error_message


class ChannelDelivery(Protocol):
    """Protocol for channel delivery implementations."""

    async def deliver(
        self,
        channel: NotificationChannel,
        event_type: str,
        payload: dict[str, Any],
    ) -> DeliveryResult: ...


def _build_ssl_context() -> ssl.SSLContext:
    """Build a default SSL context for outbound HTTPS."""
    ctx = ssl.create_default_context()
    return ctx


async def _http_post(
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout: int,
) -> tuple[int, str]:
    """Send an HTTP POST request in a thread to avoid blocking the event loop."""

    def _do_post() -> tuple[int, str]:
        req = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method="POST",
        )
        ctx = _build_ssl_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")

    return await asyncio.to_thread(_do_post)


class WebhookDelivery:
    """Delivers notifications via generic HTTP POST to a configured URL.

    Expected channel config keys:
        - ``url`` (str): The target webhook URL.
        - ``timeout`` (int, optional): Request timeout in seconds.
        - ``headers`` (dict, optional): Extra headers to include.
    """

    async def deliver(
        self,
        channel: NotificationChannel,
        event_type: str,
        payload: dict[str, Any],
    ) -> DeliveryResult:
        url = channel.config.get("url")
        if not url:
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message="Missing 'url' in channel config",
            )

        timeout = int(channel.config.get("timeout", _DEFAULT_TIMEOUT_SECONDS))
        extra_headers: dict[str, str] = channel.config.get("headers", {})

        body_dict = {
            "event_type": event_type,
            "payload": payload,
            "channel_id": channel.channel_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        body = json.dumps(body_dict).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ForgeOS-Notification/1.0",
        }
        headers.update(extra_headers)

        try:
            status_code, _response_body = await _http_post(url, body, headers, timeout)
            if 200 <= status_code < 300:
                logger.info(
                    "Webhook delivered",
                    extra={
                        "channel_id": channel.channel_id,
                        "event_type": event_type,
                        "status_code": status_code,
                    },
                )
                return DeliveryResult(success=True, channel_id=channel.channel_id)

            error_msg = f"Webhook returned HTTP {status_code}"
            logger.warning(
                "Webhook delivery failed",
                extra={
                    "channel_id": channel.channel_id,
                    "event_type": event_type,
                    "status_code": status_code,
                },
            )
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message=error_msg,
            )
        except Exception as exc:
            error_msg = f"Webhook delivery error: {exc}"
            logger.warning(
                "Webhook delivery exception",
                extra={
                    "channel_id": channel.channel_id,
                    "event_type": event_type,
                    "error": str(exc),
                },
            )
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message=error_msg,
            )


def _format_slack_blocks(
    event_type: str,
    payload: dict[str, Any],
    channel_name: str,
) -> dict[str, Any]:
    """Format a notification as a Slack Block Kit message."""
    ticket_id = payload.get("ticket_id", "unknown")
    details = payload.get("details", "")

    header_text = f":bell: *{event_type}* — `{ticket_id}`"
    detail_text = details if details else json.dumps(payload, indent=2)

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"ForgeOS: {event_type}",
                "emoji": True,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": header_text,
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"```{detail_text}```" if len(detail_text) < 2900 else detail_text[:2900],
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"Channel: {channel_name} | {datetime.now(timezone.utc).isoformat()}",
                },
            ],
        },
    ]

    return {"blocks": blocks, "text": header_text}


class SlackDelivery:
    """Delivers notifications to Slack via incoming webhook URL.

    Formats the message using Slack Block Kit for rich display.

    Expected channel config keys:
        - ``url`` (str): The Slack incoming webhook URL.
        - ``timeout`` (int, optional): Request timeout in seconds.
    """

    async def deliver(
        self,
        channel: NotificationChannel,
        event_type: str,
        payload: dict[str, Any],
    ) -> DeliveryResult:
        url = channel.config.get("url")
        if not url:
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message="Missing 'url' in channel config",
            )

        timeout = int(channel.config.get("timeout", _DEFAULT_TIMEOUT_SECONDS))

        slack_message = _format_slack_blocks(event_type, payload, channel.name)
        body = json.dumps(slack_message).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "ForgeOS-Notification/1.0",
        }

        try:
            status_code, _response_body = await _http_post(url, body, headers, timeout)
            if 200 <= status_code < 300:
                logger.info(
                    "Slack notification delivered",
                    extra={
                        "channel_id": channel.channel_id,
                        "event_type": event_type,
                        "status_code": status_code,
                    },
                )
                return DeliveryResult(success=True, channel_id=channel.channel_id)

            error_msg = f"Slack webhook returned HTTP {status_code}"
            logger.warning(
                "Slack delivery failed",
                extra={
                    "channel_id": channel.channel_id,
                    "event_type": event_type,
                    "status_code": status_code,
                },
            )
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message=error_msg,
            )
        except Exception as exc:
            error_msg = f"Slack delivery error: {exc}"
            logger.warning(
                "Slack delivery exception",
                extra={
                    "channel_id": channel.channel_id,
                    "event_type": event_type,
                    "error": str(exc),
                },
            )
            return DeliveryResult(
                success=False,
                channel_id=channel.channel_id,
                error_message=error_msg,
            )


def _get_delivery(channel_type: ChannelType) -> ChannelDelivery:
    """Return the appropriate delivery implementation for a channel type."""
    _delivery_registry: dict[ChannelType, ChannelDelivery] = {
        ChannelType.WEBHOOK: WebhookDelivery(),
        ChannelType.SLACK: SlackDelivery(),
    }
    delivery = _delivery_registry.get(channel_type)
    if delivery is None:
        raise ValueError(f"Unsupported channel type: {channel_type}")
    return delivery


def _record_to_channel(record: asyncpg.Record) -> NotificationChannel:
    """Convert an asyncpg Record to a NotificationChannel."""
    config = record["config"]
    if isinstance(config, str):
        config = json.loads(config)

    event_filter = record["event_filter"]
    if event_filter is None:
        event_filter = []
    elif isinstance(event_filter, str):
        event_filter = [event_filter]
    else:
        event_filter = list(event_filter)

    return NotificationChannel(
        channel_id=str(record["channel_id"]),
        name=record["name"],
        type=ChannelType(record["type"]),
        config=config if isinstance(config, dict) else {},
        event_filter=event_filter,
        enabled=record["enabled"],
        created_at=record["created_at"],
        updated_at=record["updated_at"],
    )


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


class ChannelStore:
    """CRUD operations for notification channels backed by PostgreSQL."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def create_channel(
        self,
        *,
        name: str,
        channel_type: ChannelType,
        config: dict[str, Any],
        event_filter: list[str] | None = None,
        enabled: bool = True,
    ) -> NotificationChannel:
        """Insert a new notification channel."""
        if not name or not name.strip():
            raise ValueError("Channel name must be a non-empty string")

        channel_id = str(uuid.uuid4())
        config_json = json.dumps(config)
        filter_list = event_filter or []

        record = await self._pool.fetchrow(
            "INSERT INTO notification_channels"
            " (channel_id, name, type, config, event_filter, enabled)"
            " VALUES ($1, $2, $3::channel_type, $4::jsonb, $5::text[], $6)"
            " RETURNING channel_id, name, type, config, event_filter,"
            "           enabled, created_at, updated_at",
            uuid.UUID(channel_id),
            name.strip(),
            channel_type.value,
            config_json,
            filter_list,
            enabled,
        )

        if record is None:
            raise RuntimeError("Failed to insert notification channel")

        logger.info(
            "Channel created",
            extra={"channel_id": channel_id, "name": name, "type": channel_type.value},
        )
        return _record_to_channel(record)

    async def get_channel(self, channel_id: str) -> NotificationChannel | None:
        """Retrieve a single channel by ID."""
        record = await self._pool.fetchrow(
            "SELECT channel_id, name, type, config, event_filter,"
            "       enabled, created_at, updated_at"
            " FROM notification_channels"
            " WHERE channel_id = $1",
            uuid.UUID(channel_id),
        )
        if record is None:
            return None
        return _record_to_channel(record)

    async def list_channels(self, *, enabled_only: bool = False) -> list[NotificationChannel]:
        """List all channels, optionally filtering to enabled ones only."""
        if enabled_only:
            records = await self._pool.fetch(
                "SELECT channel_id, name, type, config, event_filter,"
                "       enabled, created_at, updated_at"
                " FROM notification_channels"
                " WHERE enabled = TRUE"
                " ORDER BY created_at ASC"
            )
        else:
            records = await self._pool.fetch(
                "SELECT channel_id, name, type, config, event_filter,"
                "       enabled, created_at, updated_at"
                " FROM notification_channels"
                " ORDER BY created_at ASC"
            )
        return [_record_to_channel(r) for r in records]

    async def update_channel(
        self,
        channel_id: str,
        *,
        name: str | None = None,
        config: dict[str, Any] | None = None,
        event_filter: list[str] | None = None,
        enabled: bool | None = None,
    ) -> NotificationChannel | None:
        """Update an existing channel. Only provided fields are modified."""
        current = await self.get_channel(channel_id)
        if current is None:
            return None

        new_name = name.strip() if name else current.name
        new_config = json.dumps(config) if config is not None else json.dumps(current.config)
        new_filter = event_filter if event_filter is not None else current.event_filter
        new_enabled = enabled if enabled is not None else current.enabled

        record = await self._pool.fetchrow(
            "UPDATE notification_channels"
            " SET name = $2, config = $3::jsonb, event_filter = $4::text[],"
            "     enabled = $5"
            " WHERE channel_id = $1"
            " RETURNING channel_id, name, type, config, event_filter,"
            "           enabled, created_at, updated_at",
            uuid.UUID(channel_id),
            new_name,
            new_config,
            new_filter,
            new_enabled,
        )

        if record is None:
            return None

        logger.info(
            "Channel updated",
            extra={"channel_id": channel_id},
        )
        return _record_to_channel(record)

    async def delete_channel(self, channel_id: str) -> bool:
        """Delete a channel by ID. Returns True if deleted."""
        result = await self._pool.execute(
            "DELETE FROM notification_channels WHERE channel_id = $1",
            uuid.UUID(channel_id),
        )
        deleted = result.endswith("1")
        if deleted:
            logger.info("Channel deleted", extra={"channel_id": channel_id})
        return deleted


def _matches_event_filter(event_filter: list[str], event_type: str) -> bool:
    """Check if an event type matches a channel's filter.

    An empty filter matches all event types.
    """
    if not event_filter:
        return True
    return event_type in event_filter


class ChannelDispatcher:
    """Dispatches notifications to matching channels.

    Delivery failures on individual channels are logged but never
    propagated — they do not block queue processing.
    """

    def __init__(self, store: ChannelStore) -> None:
        self._store = store

    async def dispatch(
        self,
        event_type: str,
        payload: dict[str, Any],
    ) -> list[DeliveryResult]:
        """Send a notification to all enabled channels whose filter matches."""
        channels = await self._store.list_channels(enabled_only=True)

        matching = [
            ch for ch in channels
            if _matches_event_filter(ch.event_filter, event_type)
        ]

        if not matching:
            logger.info(
                "No matching channels for event",
                extra={"event_type": event_type},
            )
            return []

        results: list[DeliveryResult] = []
        for channel in matching:
            try:
                delivery = _get_delivery(channel.type)
                result = await delivery.deliver(channel, event_type, payload)
                results.append(result)
            except Exception as exc:
                logger.warning(
                    "Channel dispatch failed",
                    extra={
                        "channel_id": channel.channel_id,
                        "event_type": event_type,
                        "error": str(exc),
                    },
                )
                results.append(
                    DeliveryResult(
                        success=False,
                        channel_id=channel.channel_id,
                        error_message=f"Dispatch error: {exc}",
                    )
                )

        delivered = sum(1 for r in results if r.success)
        failed = len(results) - delivered
        logger.info(
            "Dispatch complete",
            extra={
                "event_type": event_type,
                "total_channels": len(matching),
                "delivered": delivered,
                "failed": failed,
            },
        )
        return results
