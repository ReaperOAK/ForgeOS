"""Notification event queue and channel delivery for ForgeOS MCP Server.

Provides an in-database notification queue backed by PostgreSQL,
supporting enqueue/dequeue with ``FOR UPDATE SKIP LOCKED``, status
transition enforcement, and exponential-backoff retries.

Also provides configurable notification channels (webhook, Slack) that
route notifications to external endpoints with event-type filtering.

.. meta::
   :ticket: FORGEOS-BE064, FORGEOS-BE066
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
    "InvalidTransitionError",
    "Notification",
    "NotificationChannel",
    "NotificationQueue",
    "NotificationStatus",
    "SlackDelivery",
    "WebhookDelivery",
    "build_channel_config",
    "load_channels_from_env",
]
