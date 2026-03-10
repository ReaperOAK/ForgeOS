"""Notification event queue for ForgeOS MCP Server.

Provides an in-database notification queue backed by PostgreSQL,
supporting enqueue/dequeue with ``FOR UPDATE SKIP LOCKED``, status
transition enforcement, and exponential-backoff retries.

.. meta::
   :ticket: FORGEOS-BE064
"""

from mcp_server.notifications.queue import (
    InvalidTransitionError,
    Notification,
    NotificationQueue,
    NotificationStatus,
)

__all__ = [
    "InvalidTransitionError",
    "Notification",
    "NotificationQueue",
    "NotificationStatus",
]
