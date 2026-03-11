"""Notification event queue and channel delivery for ForgeOS MCP Server.

Provides an in-database notification queue backed by PostgreSQL,
supporting enqueue/dequeue with ``FOR UPDATE SKIP LOCKED``, status
transition enforcement, and exponential-backoff retries.

Also provides configurable notification channels (webhook, Slack) that
route notifications to external endpoints with event-type filtering.

Background processor handles dequeue, dispatch, retry, and dead-letter
lifecycle as an asyncio task.

.. meta::
   :ticket: FORGEOS-BE064, FORGEOS-BE066, FORGEOS-BE067
"""

from mcp_server.notifications.channels import (
    ChannelDispatcher,
    ChannelStore,
    ChannelType,
    DeliveryResult,
    NotificationChannel,
    SlackDelivery,
    WebhookDelivery,
)
from mcp_server.notifications.config import (
    ChannelEnvConfig,
    build_channel_config,
    load_channels_from_env,
)
from mcp_server.notifications.emitter import (
    EventType,
    StateChangeEmitter,
)
from mcp_server.notifications.processor import (
    NotificationProcessor,
    ProcessorConfig,
)
from mcp_server.notifications.queue import (
    InvalidTransitionError,
    Notification,
    NotificationQueue,
    NotificationStatus,
)

__all__ = [
    "ChannelDispatcher",
    "ChannelEnvConfig",
    "ChannelStore",
    "ChannelType",
    "DeliveryResult",
    "EventType",
    "InvalidTransitionError",
    "Notification",
    "NotificationChannel",
    "NotificationProcessor",
    "NotificationQueue",
    "NotificationStatus",
    "ProcessorConfig",
    "SlackDelivery",
    "StateChangeEmitter",
    "WebhookDelivery",
    "build_channel_config",
    "load_channels_from_env",
]
