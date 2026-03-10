"""Tests for the webhook service — validation, routing, and dispatch.

.. meta::
   :ticket: FORGEOS-BE059
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from mcp_server.services.webhook_service import (
    UnknownSourceError,
    WebhookEvent,
    WebhookService,
    WebhookValidationError,
    _HandlerRegistry,
    _validate_custom_payload,
    _validate_github_payload,
    handler_registry,
)

# ------------------------------------------------------------------ #
# GitHub payload validator
# ------------------------------------------------------------------ #


class TestValidateGitHubPayload:
    """Tests for _validate_github_payload."""

    def test_valid_payload_returns_action(self) -> None:
        result = _validate_github_payload({"action": "opened", "number": 42})
        assert result == "opened"

    def test_missing_action_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="missing required fields"):
            _validate_github_payload({"number": 42})

    def test_empty_action_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_github_payload({"action": ""})

    def test_whitespace_action_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_github_payload({"action": "   "})

    def test_non_string_action_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_github_payload({"action": 123})


# ------------------------------------------------------------------ #
# Custom payload validator
# ------------------------------------------------------------------ #


class TestValidateCustomPayload:
    """Tests for _validate_custom_payload."""

    def test_valid_payload_returns_event_type(self) -> None:
        result = _validate_custom_payload({"event_type": "deploy", "data": {}})
        assert result == "deploy"

    def test_missing_event_type_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="missing required fields"):
            _validate_custom_payload({"data": {}})

    def test_empty_event_type_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_custom_payload({"event_type": ""})

    def test_whitespace_event_type_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_custom_payload({"event_type": "   "})

    def test_non_string_event_type_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_custom_payload({"event_type": True})


# ------------------------------------------------------------------ #
# Handler registry
# ------------------------------------------------------------------ #


class TestHandlerRegistry:
    """Tests for _HandlerRegistry."""

    def test_register_and_get(self) -> None:
        reg = _HandlerRegistry()
        handler = AsyncMock()
        reg.register("github", "push", handler)
        assert reg.get("github", "push") is handler

    def test_get_returns_none_for_unknown(self) -> None:
        reg = _HandlerRegistry()
        assert reg.get("unknown", "foo") is None

    def test_default_handler_fallback(self) -> None:
        reg = _HandlerRegistry()
        default = AsyncMock()
        reg.register_default("github", default)
        assert reg.get("github", "any_event") is default

    def test_specific_overrides_default(self) -> None:
        reg = _HandlerRegistry()
        default = AsyncMock()
        specific = AsyncMock()
        reg.register_default("github", default)
        reg.register("github", "push", specific)
        assert reg.get("github", "push") is specific
        assert reg.get("github", "other") is default


# ------------------------------------------------------------------ #
# WebhookService.validate_payload
# ------------------------------------------------------------------ #


class TestWebhookServiceValidation:
    """Tests for WebhookService.validate_payload."""

    def setup_method(self) -> None:
        self.service = WebhookService()

    def test_github_valid(self) -> None:
        event = self.service.validate_payload(
            source="github",
            payload={"action": "opened"},
        )
        assert isinstance(event, WebhookEvent)
        assert event.source == "github"
        assert event.event_type == "opened"
        assert event.payload == {"action": "opened"}
        assert event.event_id  # non-empty

    def test_github_with_header_event_type(self) -> None:
        event = self.service.validate_payload(
            source="github",
            payload={"action": "completed"},
            event_type_header="push",
        )
        assert event.event_type == "push"

    def test_custom_valid(self) -> None:
        event = self.service.validate_payload(
            source="custom",
            payload={"event_type": "deploy", "env": "staging"},
        )
        assert event.source == "custom"
        assert event.event_type == "deploy"

    def test_unknown_source_raises(self) -> None:
        with pytest.raises(UnknownSourceError, match="Unknown webhook source"):
            self.service.validate_payload(
                source="unknown_origin",
                payload={"action": "test"},
            )

    def test_unknown_source_error_has_details(self) -> None:
        with pytest.raises(UnknownSourceError) as exc_info:
            self.service.validate_payload(
                source="slack",
                payload={},
            )
        assert "slack" in exc_info.value.details["source"]
        assert "known_sources" in exc_info.value.details

    def test_invalid_github_payload_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="missing required"):
            self.service.validate_payload(
                source="github",
                payload={"number": 1},
            )

    def test_invalid_custom_payload_raises(self) -> None:
        with pytest.raises(WebhookValidationError, match="missing required"):
            self.service.validate_payload(
                source="custom",
                payload={"data": "hello"},
            )

    def test_source_case_insensitive(self) -> None:
        event = self.service.validate_payload(
            source="GitHub",
            payload={"action": "opened"},
        )
        assert event.source == "github"

    def test_source_case_insensitive_custom(self) -> None:
        event = self.service.validate_payload(
            source="CUSTOM",
            payload={"event_type": "notify"},
        )
        assert event.source == "custom"


# ------------------------------------------------------------------ #
# WebhookService.dispatch
# ------------------------------------------------------------------ #


class TestWebhookServiceDispatch:
    """Tests for WebhookService.dispatch."""

    @pytest.mark.asyncio
    async def test_dispatch_calls_handler(self) -> None:
        handler = AsyncMock()
        reg = _HandlerRegistry()
        reg.register("github", "push", handler)
        service = WebhookService(registry=reg)

        event = WebhookEvent(
            event_id="abc123",
            source="github",
            event_type="push",
            payload={"ref": "refs/heads/main"},
        )
        await service.dispatch(event)
        handler.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_dispatch_no_handler_logs_warning(self) -> None:
        reg = _HandlerRegistry()
        service = WebhookService(registry=reg)

        event = WebhookEvent(
            event_id="abc",
            source="unknown",
            event_type="x",
            payload={},
        )
        # Should not raise
        await service.dispatch(event)

    @pytest.mark.asyncio
    async def test_dispatch_handler_exception_is_caught(self) -> None:
        handler = AsyncMock(side_effect=RuntimeError("boom"))
        reg = _HandlerRegistry()
        reg.register("custom", "deploy", handler)
        service = WebhookService(registry=reg)

        event = WebhookEvent(
            event_id="xyz",
            source="custom",
            event_type="deploy",
            payload={},
        )
        # Should not propagate
        await service.dispatch(event)
        handler.assert_awaited_once()


# ------------------------------------------------------------------ #
# WebhookService.process_async
# ------------------------------------------------------------------ #


class TestWebhookServiceProcessAsync:
    """Tests for async processing."""

    @pytest.mark.asyncio
    async def test_process_async_creates_task(self) -> None:
        handler = AsyncMock()
        reg = _HandlerRegistry()
        reg.register("github", "push", handler)
        service = WebhookService(registry=reg)

        event = WebhookEvent(
            event_id="task1",
            source="github",
            event_type="push",
            payload={},
        )
        service.process_async(event)
        # Allow the task to run
        await asyncio.sleep(0.05)
        handler.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_process_async_handles_failure(self) -> None:
        handler = AsyncMock(side_effect=RuntimeError("fail"))
        reg = _HandlerRegistry()
        reg.register("custom", "test", handler)
        service = WebhookService(registry=reg)

        event = WebhookEvent(
            event_id="fail1",
            source="custom",
            event_type="test",
            payload={},
        )
        service.process_async(event)
        await asyncio.sleep(0.05)
        handler.assert_awaited_once()


# ------------------------------------------------------------------ #
# WebhookEvent value object
# ------------------------------------------------------------------ #


class TestWebhookEvent:
    """Tests for the WebhookEvent dataclass."""

    def test_frozen(self) -> None:
        event = WebhookEvent(
            event_id="e1",
            source="github",
            event_type="push",
            payload={"ref": "main"},
        )
        with pytest.raises(AttributeError):
            event.source = "custom"  # type: ignore[misc]

    def test_received_at_default(self) -> None:
        event = WebhookEvent(
            event_id="e2",
            source="custom",
            event_type="deploy",
            payload={},
        )
        assert event.received_at is not None


# ------------------------------------------------------------------ #
# Module-level registry has default handlers
# ------------------------------------------------------------------ #


class TestDefaultHandlers:
    """Verify module-level registry has default handlers wired."""

    def test_github_default_registered(self) -> None:
        assert handler_registry.get("github", "any") is not None

    def test_custom_default_registered(self) -> None:
        assert handler_registry.get("custom", "any") is not None

    def test_unknown_source_has_no_default(self) -> None:
        assert handler_registry.get("unknown", "any") is None
