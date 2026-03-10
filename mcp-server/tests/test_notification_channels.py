"""Tests for notification channels — FORGEOS-BE066.

Covers all 6 acceptance criteria:
 1. notification_channels table created via Alembic migration
 2. Webhook channel sends POST requests with JSON payload
 3. Slack channel formats as Block Kit message
 4. Channels can filter by event_type
 5. Channel configuration manageable via env vars
 6. Channel delivery failure does not block queue processing
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from mcp_server.notifications.channels import (
    ChannelDispatcher,
    ChannelStore,
    ChannelType,
    DeliveryResult,
    NotificationChannel,
    SlackDelivery,
    WebhookDelivery,
    _format_slack_blocks,
    _get_delivery,
    _matches_event_filter,
    _record_to_channel,
)
from mcp_server.notifications.config import (
    ChannelEnvConfig,
    _parse_channel_env,
    build_channel_config,
    load_channels_from_env,
)

# ---------------------------------------------------------------------------
# Helpers / In-Memory Store Mock
# ---------------------------------------------------------------------------


class MockRecord(dict):
    """Dict subclass that supports attribute-style access like asyncpg.Record."""

    def __getitem__(self, key: str) -> Any:
        return super().__getitem__(key)


def _make_channel_record(
    channel_id: str | None = None,
    name: str = "test-channel",
    channel_type: str = "webhook",
    config: str = '{"url":"https://example.com/hook"}',
    event_filter: list[str] | None = None,
    enabled: bool = True,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> MockRecord:
    now = datetime.now(timezone.utc)
    return MockRecord(
        channel_id=uuid.UUID(channel_id) if channel_id else uuid.uuid4(),
        name=name,
        type=channel_type,
        config=config,
        event_filter=event_filter if event_filter is not None else [],
        enabled=enabled,
        created_at=created_at or now,
        updated_at=updated_at or now,
    )


class InMemoryChannelPool:
    """Mock pool that simulates notification_channels table operations."""

    def __init__(self) -> None:
        self.rows: dict[str, MockRecord] = {}
        self.executed_queries: list[str] = []

    async def execute(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> str:
        self.executed_queries.append(query)
        q = query.lower()
        if "delete from notification_channels" in q:
            nid = str(args[0])
            if nid in self.rows:
                del self.rows[nid]
                return "DELETE 1"
            return "DELETE 0"
        return "OK"

    async def fetchrow(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> MockRecord | None:
        self.executed_queries.append(query)
        q = query.lower()

        if "insert into notification_channels" in q:
            nid = str(args[0])
            record = MockRecord(
                channel_id=args[0],
                name=args[1],
                type=args[2],
                config=args[3],
                event_filter=args[4],
                enabled=args[5],
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            self.rows[nid] = record
            return record

        if "update notification_channels" in q:
            nid = str(args[0])
            row = self.rows.get(nid)
            if row is None:
                return None
            row["name"] = args[1]
            row["config"] = args[2]
            row["event_filter"] = args[3]
            row["enabled"] = args[4]
            return row

        if "select" in q and "where channel_id" in q:
            nid = str(args[0])
            return self.rows.get(nid)

        return None

    async def fetch(
        self, query: str, *args: Any, timeout: float | None = None
    ) -> list[MockRecord]:
        self.executed_queries.append(query)
        q = query.lower()

        if "where enabled = true" in q:
            return [r for r in self.rows.values() if r["enabled"]]

        return list(self.rows.values())


@pytest.fixture()
def channel_pool() -> InMemoryChannelPool:
    return InMemoryChannelPool()


@pytest.fixture()
def store(channel_pool: InMemoryChannelPool) -> ChannelStore:
    return ChannelStore(channel_pool)


# ---------------------------------------------------------------------------
# AC1: Migration schema verification
# ---------------------------------------------------------------------------


def _load_migration():
    """Load the notification_channels migration module."""
    import importlib.util
    import pathlib

    migration_path = (
        pathlib.Path(__file__).resolve().parent.parent
        / "alembic"
        / "versions"
        / "20260311_000000_006_notification_channels.py"
    )
    spec = importlib.util.spec_from_file_location("migration_006", migration_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestMigrationSchema:
    """Verify the Alembic migration creates notification_channels correctly."""

    def test_migration_file_exists(self) -> None:
        mod = _load_migration()
        assert hasattr(mod, "upgrade")
        assert hasattr(mod, "downgrade")

    def test_migration_revision_chain(self) -> None:
        mod = _load_migration()
        assert mod.revision == "006"
        assert mod.down_revision == "005"

    def test_upgrade_creates_channel_type_enum(self) -> None:
        mod = _load_migration()
        import inspect

        source = inspect.getsource(mod.upgrade)
        assert "channel_type" in source
        assert "'webhook'" in source
        assert "'slack'" in source

    def test_upgrade_creates_table_columns(self) -> None:
        mod = _load_migration()
        import inspect

        source = inspect.getsource(mod.upgrade)
        for col in [
            "channel_id",
            "name",
            "type",
            "config",
            "event_filter",
            "enabled",
            "created_at",
            "updated_at",
        ]:
            assert col in source, f"Column '{col}' missing from migration"

    def test_upgrade_creates_index(self) -> None:
        mod = _load_migration()
        import inspect

        source = inspect.getsource(mod.upgrade)
        assert "idx_notification_channels_enabled" in source

    def test_upgrade_creates_trigger(self) -> None:
        mod = _load_migration()
        import inspect

        source = inspect.getsource(mod.upgrade)
        assert "trg_notification_channels_updated_at" in source

    def test_downgrade_drops_all_objects(self) -> None:
        mod = _load_migration()
        import inspect

        source = inspect.getsource(mod.downgrade)
        assert "DROP TRIGGER" in source
        assert "DROP FUNCTION" in source
        assert "DROP INDEX" in source
        assert "DROP TABLE" in source
        assert "DROP TYPE" in source


# ---------------------------------------------------------------------------
# AC2: Webhook channel sends POST with JSON payload
# ---------------------------------------------------------------------------


class TestWebhookDelivery:
    """Tests for WebhookDelivery."""

    async def test_deliver_success(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="test-webhook",
            type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(200, "ok"),
        ):
            delivery = WebhookDelivery()
            result = await delivery.deliver(
                channel, "stage_changed", {"ticket_id": "T-001"}
            )
            assert result.success is True
            assert result.channel_id == "abc-123"

    async def test_deliver_missing_url(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="no-url",
            type=ChannelType.WEBHOOK,
            config={},
        )
        delivery = WebhookDelivery()
        result = await delivery.deliver(channel, "test", {})
        assert result.success is False
        assert "Missing 'url'" in (result.error_message or "")

    async def test_deliver_http_error_status(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="test-webhook",
            type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(500, "Internal Server Error"),
        ):
            delivery = WebhookDelivery()
            result = await delivery.deliver(channel, "test", {})
            assert result.success is False
            assert "HTTP 500" in (result.error_message or "")

    async def test_deliver_network_exception(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="test-webhook",
            type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            side_effect=ConnectionError("refused"),
        ):
            delivery = WebhookDelivery()
            result = await delivery.deliver(channel, "test", {})
            assert result.success is False
            assert "refused" in (result.error_message or "")

    async def test_deliver_sends_json_payload(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="test-webhook",
            type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook", "headers": {"X-Custom": "val"}},
        )
        captured_args: dict[str, Any] = {}

        async def mock_post(
            url: str, body: bytes, headers: dict[str, str], timeout: int
        ) -> tuple[int, str]:
            captured_args["url"] = url
            captured_args["body"] = json.loads(body)
            captured_args["headers"] = headers
            return 200, "ok"

        with patch("mcp_server.notifications.channels._http_post", side_effect=mock_post):
            delivery = WebhookDelivery()
            await delivery.deliver(channel, "ticket_created", {"ticket_id": "T-002"})

        assert captured_args["url"] == "https://example.com/hook"
        assert captured_args["body"]["event_type"] == "ticket_created"
        assert captured_args["body"]["payload"]["ticket_id"] == "T-002"
        assert captured_args["headers"]["Content-Type"] == "application/json"
        assert captured_args["headers"]["X-Custom"] == "val"

    async def test_deliver_custom_timeout(self) -> None:
        channel = NotificationChannel(
            channel_id="abc-123",
            name="test",
            type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook", "timeout": 30},
        )
        captured_timeout: list[int] = []

        async def mock_post(
            url: str, body: bytes, headers: dict[str, str], timeout: int
        ) -> tuple[int, str]:
            captured_timeout.append(timeout)
            return 200, "ok"

        with patch("mcp_server.notifications.channels._http_post", side_effect=mock_post):
            delivery = WebhookDelivery()
            await delivery.deliver(channel, "test", {})

        assert captured_timeout[0] == 30


# ---------------------------------------------------------------------------
# AC3: Slack channel formats as Block Kit message
# ---------------------------------------------------------------------------


class TestSlackDelivery:
    """Tests for SlackDelivery."""

    async def test_deliver_success(self) -> None:
        channel = NotificationChannel(
            channel_id="slack-123",
            name="test-slack",
            type=ChannelType.SLACK,
            config={"url": "https://hooks.slack.com/services/XXX"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(200, "ok"),
        ):
            delivery = SlackDelivery()
            result = await delivery.deliver(
                channel, "stage_changed", {"ticket_id": "T-001"}
            )
            assert result.success is True

    async def test_deliver_missing_url(self) -> None:
        channel = NotificationChannel(
            channel_id="slack-123",
            name="no-url",
            type=ChannelType.SLACK,
            config={},
        )
        delivery = SlackDelivery()
        result = await delivery.deliver(channel, "test", {})
        assert result.success is False

    async def test_deliver_sends_block_kit_format(self) -> None:
        channel = NotificationChannel(
            channel_id="slack-123",
            name="dev-alerts",
            type=ChannelType.SLACK,
            config={"url": "https://hooks.slack.com/services/XXX"},
        )
        captured_body: dict[str, Any] = {}

        async def mock_post(
            url: str, body: bytes, headers: dict[str, str], timeout: int
        ) -> tuple[int, str]:
            captured_body.update(json.loads(body))
            return 200, "ok"

        with patch("mcp_server.notifications.channels._http_post", side_effect=mock_post):
            delivery = SlackDelivery()
            await delivery.deliver(
                channel, "ticket_reworked", {"ticket_id": "T-003", "details": "QA failed"}
            )

        assert "blocks" in captured_body
        blocks = captured_body["blocks"]
        assert len(blocks) >= 3
        assert blocks[0]["type"] == "header"
        assert "ticket_reworked" in blocks[0]["text"]["text"]
        assert blocks[1]["type"] == "section"
        assert "T-003" in blocks[1]["text"]["text"]

    async def test_deliver_http_failure(self) -> None:
        channel = NotificationChannel(
            channel_id="slack-123",
            name="test-slack",
            type=ChannelType.SLACK,
            config={"url": "https://hooks.slack.com/services/XXX"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(403, "invalid_token"),
        ):
            delivery = SlackDelivery()
            result = await delivery.deliver(channel, "test", {})
            assert result.success is False
            assert "HTTP 403" in (result.error_message or "")

    async def test_deliver_exception(self) -> None:
        channel = NotificationChannel(
            channel_id="slack-123",
            name="test-slack",
            type=ChannelType.SLACK,
            config={"url": "https://hooks.slack.com/services/XXX"},
        )
        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            side_effect=TimeoutError("timed out"),
        ):
            delivery = SlackDelivery()
            result = await delivery.deliver(channel, "test", {})
            assert result.success is False
            assert "timed out" in (result.error_message or "")


class TestFormatSlackBlocks:
    """Tests for _format_slack_blocks helper."""

    def test_basic_formatting(self) -> None:
        result = _format_slack_blocks(
            "stage_changed", {"ticket_id": "T-001", "details": "Moved to QA"}, "dev-alerts"
        )
        assert "blocks" in result
        assert "text" in result
        assert len(result["blocks"]) == 4
        assert result["blocks"][0]["type"] == "header"
        assert result["blocks"][3]["type"] == "context"
        assert "dev-alerts" in result["blocks"][3]["elements"][0]["text"]

    def test_empty_details_uses_json_dump(self) -> None:
        result = _format_slack_blocks("test", {"key": "val"}, "ch")
        section = result["blocks"][2]["text"]["text"]
        assert "key" in section

    def test_long_details_truncated(self) -> None:
        long_text = "x" * 3000
        result = _format_slack_blocks("test", {"details": long_text}, "ch")
        section = result["blocks"][2]["text"]["text"]
        assert len(section) <= 2900


# ---------------------------------------------------------------------------
# AC4: Event-type filtering
# ---------------------------------------------------------------------------


class TestEventFilter:
    """Tests for _matches_event_filter."""

    def test_empty_filter_matches_all(self) -> None:
        assert _matches_event_filter([], "any_event") is True

    def test_matching_event(self) -> None:
        assert _matches_event_filter(["stage_changed", "ticket_reworked"], "stage_changed") is True

    def test_non_matching_event(self) -> None:
        assert _matches_event_filter(["stage_changed"], "ticket_created") is False

    def test_exact_match_required(self) -> None:
        assert _matches_event_filter(["stage"], "stage_changed") is False


# ---------------------------------------------------------------------------
# AC5: Channel configuration via env variables
# ---------------------------------------------------------------------------


class TestChannelEnvConfig:
    """Tests for environment-based channel configuration."""

    def test_parse_valid_webhook(self) -> None:
        value = json.dumps({
            "type": "webhook",
            "url": "https://example.com/hook",
            "event_filter": ["stage_changed"],
        })
        result = _parse_channel_env("FORGEOS_CHANNEL_DEPLOY", value)
        assert result is not None
        assert result.channel_type == ChannelType.WEBHOOK
        assert result.url == "https://example.com/hook"
        assert result.event_filter == ["stage_changed"]
        assert result.name == "deploy"

    def test_parse_valid_slack(self) -> None:
        value = json.dumps({
            "type": "slack",
            "url": "https://hooks.slack.com/services/XXX",
        })
        result = _parse_channel_env("FORGEOS_CHANNEL_ALERTS", value)
        assert result is not None
        assert result.channel_type == ChannelType.SLACK
        assert result.event_filter == []

    def test_parse_invalid_json(self) -> None:
        result = _parse_channel_env("FORGEOS_CHANNEL_BAD", "not-json")
        assert result is None

    def test_parse_non_object_json(self) -> None:
        result = _parse_channel_env("FORGEOS_CHANNEL_BAD", '"string"')
        assert result is None

    def test_parse_unknown_type(self) -> None:
        value = json.dumps({"type": "email", "url": "https://x.com"})
        result = _parse_channel_env("FORGEOS_CHANNEL_X", value)
        assert result is None

    def test_parse_missing_url(self) -> None:
        value = json.dumps({"type": "webhook"})
        result = _parse_channel_env("FORGEOS_CHANNEL_X", value)
        assert result is None

    def test_parse_extra_fields(self) -> None:
        value = json.dumps({
            "type": "webhook",
            "url": "https://example.com",
            "headers": {"X-Key": "val"},
            "timeout": 30,
        })
        result = _parse_channel_env("FORGEOS_CHANNEL_CUSTOM", value)
        assert result is not None
        assert result.extra["headers"] == {"X-Key": "val"}
        assert result.extra["timeout"] == 30

    def test_parse_disabled_channel(self) -> None:
        value = json.dumps({
            "type": "webhook",
            "url": "https://example.com",
            "enabled": False,
        })
        result = _parse_channel_env("FORGEOS_CHANNEL_OFF", value)
        assert result is not None
        assert result.enabled is False

    def test_parse_string_event_filter(self) -> None:
        value = json.dumps({
            "type": "webhook",
            "url": "https://example.com",
            "event_filter": "stage_changed",
        })
        result = _parse_channel_env("FORGEOS_CHANNEL_X", value)
        assert result is not None
        assert result.event_filter == ["stage_changed"]

    def test_load_channels_from_env(self) -> None:
        env_vars = {
            "FORGEOS_CHANNEL_HOOK1": json.dumps({
                "type": "webhook",
                "url": "https://example.com/1",
            }),
            "FORGEOS_CHANNEL_SLACK1": json.dumps({
                "type": "slack",
                "url": "https://hooks.slack.com/XXX",
            }),
            "FORGEOS_CHANNEL_BAD": "not-json",
            "UNRELATED_VAR": "ignored",
        }
        with patch.dict(os.environ, env_vars, clear=False):
            channels = load_channels_from_env()
        assert len(channels) == 2
        names = {c.name for c in channels}
        assert "hook1" in names
        assert "slack1" in names

    def test_build_channel_config(self) -> None:
        cfg = ChannelEnvConfig(
            name="test",
            channel_type=ChannelType.WEBHOOK,
            url="https://example.com",
            event_filter=[],
            enabled=True,
            extra={"headers": {"X-Key": "val"}, "timeout": 15},
        )
        result = build_channel_config(cfg)
        assert result["url"] == "https://example.com"
        assert result["headers"] == {"X-Key": "val"}
        assert result["timeout"] == 15


# ---------------------------------------------------------------------------
# ChannelStore CRUD tests
# ---------------------------------------------------------------------------


class TestChannelStore:
    """Tests for ChannelStore CRUD operations."""

    async def test_create_channel(self, store: ChannelStore) -> None:
        channel = await store.create_channel(
            name="prod-webhook",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
            event_filter=["stage_changed"],
        )
        assert channel.name == "prod-webhook"
        assert channel.type == ChannelType.WEBHOOK
        assert channel.enabled is True

    async def test_create_channel_empty_name_raises(self, store: ChannelStore) -> None:
        with pytest.raises(ValueError, match="non-empty"):
            await store.create_channel(
                name="",
                channel_type=ChannelType.WEBHOOK,
                config={"url": "https://example.com"},
            )

    async def test_get_channel(self, store: ChannelStore) -> None:
        created = await store.create_channel(
            name="test",
            channel_type=ChannelType.SLACK,
            config={"url": "https://slack.com/hook"},
        )
        found = await store.get_channel(created.channel_id)
        assert found is not None
        assert found.channel_id == created.channel_id

    async def test_get_channel_not_found(self, store: ChannelStore) -> None:
        result = await store.get_channel(str(uuid.uuid4()))
        assert result is None

    async def test_list_channels_all(
        self, store: ChannelStore, channel_pool: InMemoryChannelPool
    ) -> None:
        await store.create_channel(
            name="ch1", channel_type=ChannelType.WEBHOOK, config={"url": "https://a.com"}
        )
        await store.create_channel(
            name="ch2",
            channel_type=ChannelType.SLACK,
            config={"url": "https://b.com"},
            enabled=False,
        )
        channels = await store.list_channels()
        assert len(channels) == 2

    async def test_list_channels_enabled_only(self, store: ChannelStore) -> None:
        await store.create_channel(
            name="on", channel_type=ChannelType.WEBHOOK, config={"url": "https://a.com"}
        )
        await store.create_channel(
            name="off",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://b.com"},
            enabled=False,
        )
        channels = await store.list_channels(enabled_only=True)
        assert all(c.enabled for c in channels)

    async def test_update_channel(self, store: ChannelStore) -> None:
        created = await store.create_channel(
            name="original", channel_type=ChannelType.WEBHOOK, config={"url": "https://a.com"}
        )
        updated = await store.update_channel(
            created.channel_id, name="renamed", enabled=False
        )
        assert updated is not None
        assert updated.name == "renamed"
        assert updated.enabled is False

    async def test_update_nonexistent_channel(self, store: ChannelStore) -> None:
        result = await store.update_channel(str(uuid.uuid4()), name="x")
        assert result is None

    async def test_delete_channel(self, store: ChannelStore) -> None:
        created = await store.create_channel(
            name="to-delete", channel_type=ChannelType.WEBHOOK, config={"url": "https://a.com"}
        )
        deleted = await store.delete_channel(created.channel_id)
        assert deleted is True

    async def test_delete_nonexistent_channel(self, store: ChannelStore) -> None:
        deleted = await store.delete_channel(str(uuid.uuid4()))
        assert deleted is False


# ---------------------------------------------------------------------------
# record_to_channel conversion
# ---------------------------------------------------------------------------


class TestRecordToChannel:
    """Tests for _record_to_channel helper."""

    def test_converts_basic_record(self) -> None:
        record = _make_channel_record(
            channel_id=str(uuid.uuid4()),
            name="test",
            channel_type="webhook",
            config='{"url":"https://x.com"}',
        )
        channel = _record_to_channel(record)
        assert channel.type == ChannelType.WEBHOOK
        assert channel.config == {"url": "https://x.com"}

    def test_handles_dict_config(self) -> None:
        record = _make_channel_record(config={"url": "https://x.com"})  # type: ignore[arg-type]
        channel = _record_to_channel(record)
        assert channel.config == {"url": "https://x.com"}

    def test_handles_none_event_filter(self) -> None:
        record = _make_channel_record(event_filter=None)
        channel = _record_to_channel(record)
        assert channel.event_filter == []

    def test_handles_string_event_filter(self) -> None:
        record = _make_channel_record()
        record["event_filter"] = "stage_changed"
        channel = _record_to_channel(record)
        assert channel.event_filter == ["stage_changed"]


# ---------------------------------------------------------------------------
# Delivery registry
# ---------------------------------------------------------------------------


class TestGetDelivery:
    """Tests for _get_delivery registry."""

    def test_webhook_type(self) -> None:
        d = _get_delivery(ChannelType.WEBHOOK)
        assert isinstance(d, WebhookDelivery)

    def test_slack_type(self) -> None:
        d = _get_delivery(ChannelType.SLACK)
        assert isinstance(d, SlackDelivery)


# ---------------------------------------------------------------------------
# AC6: Delivery failure does not block queue processing
# ---------------------------------------------------------------------------


class TestChannelDispatcher:
    """Tests for ChannelDispatcher — failure isolation."""

    async def test_dispatch_to_matching_channels(self, store: ChannelStore) -> None:
        await store.create_channel(
            name="hook",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
            event_filter=["stage_changed"],
        )
        dispatcher = ChannelDispatcher(store)

        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(200, "ok"),
        ):
            results = await dispatcher.dispatch(
                "stage_changed", {"ticket_id": "T-001"}
            )

        assert len(results) == 1
        assert results[0].success is True

    async def test_dispatch_skips_non_matching_events(self, store: ChannelStore) -> None:
        await store.create_channel(
            name="hook",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
            event_filter=["stage_changed"],
        )
        dispatcher = ChannelDispatcher(store)
        results = await dispatcher.dispatch("ticket_created", {"ticket_id": "T-001"})
        assert len(results) == 0

    async def test_dispatch_empty_filter_matches_all(self, store: ChannelStore) -> None:
        await store.create_channel(
            name="catch-all",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
            event_filter=[],
        )
        dispatcher = ChannelDispatcher(store)

        with patch(
            "mcp_server.notifications.channels._http_post",
            new_callable=AsyncMock,
            return_value=(200, "ok"),
        ):
            results = await dispatcher.dispatch("any_event", {})

        assert len(results) == 1

    async def test_dispatch_failure_does_not_block_others(
        self, store: ChannelStore
    ) -> None:
        await store.create_channel(
            name="failing",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://fail.com/hook"},
        )
        await store.create_channel(
            name="succeeding",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://ok.com/hook"},
        )
        dispatcher = ChannelDispatcher(store)

        call_count = 0

        async def mock_post(
            url: str, body: bytes, headers: dict[str, str], timeout: int
        ) -> tuple[int, str]:
            nonlocal call_count
            call_count += 1
            if "fail.com" in url:
                raise ConnectionError("Connection refused")
            return 200, "ok"

        with patch("mcp_server.notifications.channels._http_post", side_effect=mock_post):
            results = await dispatcher.dispatch("test", {"data": "x"})

        assert len(results) == 2
        assert call_count == 2
        successes = [r for r in results if r.success]
        failures = [r for r in results if not r.success]
        assert len(successes) == 1
        assert len(failures) == 1

    async def test_dispatch_no_matching_channels(self, store: ChannelStore) -> None:
        dispatcher = ChannelDispatcher(store)
        results = await dispatcher.dispatch("no_channels", {})
        assert results == []

    async def test_dispatch_disabled_channels_excluded(
        self, store: ChannelStore
    ) -> None:
        await store.create_channel(
            name="disabled",
            channel_type=ChannelType.WEBHOOK,
            config={"url": "https://example.com/hook"},
            enabled=False,
        )
        dispatcher = ChannelDispatcher(store)
        results = await dispatcher.dispatch("test", {})
        assert results == []


# ---------------------------------------------------------------------------
# NotificationChannel dataclass
# ---------------------------------------------------------------------------


class TestNotificationChannel:
    """Tests for NotificationChannel value object."""

    def test_frozen(self) -> None:
        channel = NotificationChannel(
            channel_id="x", name="test", type=ChannelType.WEBHOOK
        )
        with pytest.raises(AttributeError):
            channel.name = "changed"  # type: ignore[misc]

    def test_defaults(self) -> None:
        channel = NotificationChannel(
            channel_id="x", name="test", type=ChannelType.WEBHOOK
        )
        assert channel.config == {}
        assert channel.event_filter == []
        assert channel.enabled is True


# ---------------------------------------------------------------------------
# DeliveryResult
# ---------------------------------------------------------------------------


class TestDeliveryResult:
    """Tests for DeliveryResult."""

    def test_success_result(self) -> None:
        r = DeliveryResult(success=True, channel_id="abc")
        assert r.success is True
        assert r.error_message is None

    def test_failure_result(self) -> None:
        r = DeliveryResult(success=False, channel_id="abc", error_message="timeout")
        assert r.success is False
        assert r.error_message == "timeout"
