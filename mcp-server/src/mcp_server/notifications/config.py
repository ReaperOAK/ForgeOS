"""Notification channel configuration from environment variables.

Provides a loader that creates channels from ``FORGEOS_CHANNEL_*``
environment variables, enabling channel setup without database access
during bootstrap.

.. meta::
   :ticket: FORGEOS-BE066
   :last_reviewed: 2026-03-11
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from mcp_server.notifications.channels import ChannelType
from mcp_server.observability import get_logger

logger = get_logger("notifications.config")

_ENV_PREFIX = "FORGEOS_CHANNEL_"


@dataclass(frozen=True, slots=True)
class ChannelEnvConfig:
    """Parsed channel configuration from an environment variable."""

    name: str
    channel_type: ChannelType
    url: str
    event_filter: list[str]
    enabled: bool
    extra: dict[str, Any]


def _parse_channel_env(name: str, value: str) -> ChannelEnvConfig | None:
    """Parse a single ``FORGEOS_CHANNEL_*`` environment variable.

    Expected format (JSON)::

        {
            "type": "webhook" | "slack",
            "url": "https://...",
            "event_filter": ["stage_changed", "ticket_reworked"],
            "enabled": true,
            "headers": {"X-Custom": "value"}
        }
    """
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        logger.warning(
            "Invalid JSON in channel env var",
            extra={"env_var": name},
        )
        return None

    if not isinstance(data, dict):
        logger.warning(
            "Channel env var must be a JSON object",
            extra={"env_var": name},
        )
        return None

    raw_type = data.get("type", "")
    try:
        channel_type = ChannelType(raw_type)
    except ValueError:
        logger.warning(
            "Unknown channel type in env var",
            extra={"env_var": name, "type": raw_type},
        )
        return None

    url = data.get("url", "")
    if not url:
        logger.warning(
            "Missing 'url' in channel env var",
            extra={"env_var": name},
        )
        return None

    event_filter_raw = data.get("event_filter", [])
    if isinstance(event_filter_raw, str):
        event_filter = [event_filter_raw]
    elif isinstance(event_filter_raw, list):
        event_filter = [str(e) for e in event_filter_raw]
    else:
        event_filter = []

    enabled = bool(data.get("enabled", True))

    known_keys = {"type", "url", "event_filter", "enabled"}
    extra = {k: v for k, v in data.items() if k not in known_keys}

    suffix = name[len(_ENV_PREFIX):]
    channel_name = suffix.lower().replace("_", "-")

    return ChannelEnvConfig(
        name=channel_name,
        channel_type=channel_type,
        url=url,
        event_filter=event_filter,
        enabled=enabled,
        extra=extra,
    )


def load_channels_from_env() -> list[ChannelEnvConfig]:
    """Scan environment for ``FORGEOS_CHANNEL_*`` variables and parse them.

    Returns a list of successfully parsed channel configurations.
    Invalid entries are logged as warnings and skipped.
    """
    channels: list[ChannelEnvConfig] = []

    for key in sorted(os.environ):
        if not key.startswith(_ENV_PREFIX):
            continue
        value = os.environ[key]
        parsed = _parse_channel_env(key, value)
        if parsed is not None:
            channels.append(parsed)
            logger.info(
                "Channel config loaded from env",
                extra={
                    "env_var": key,
                    "channel_name": parsed.name,
                    "type": parsed.channel_type.value,
                },
            )

    logger.info(
        "Environment channel scan complete",
        extra={"loaded_count": len(channels)},
    )
    return channels


def build_channel_config(env_cfg: ChannelEnvConfig) -> dict[str, Any]:
    """Convert an environment channel config to a config dict for ChannelStore.

    Merges the URL and any extra fields into a single config dict.
    """
    config: dict[str, Any] = {"url": env_cfg.url}
    config.update(env_cfg.extra)
    return config
