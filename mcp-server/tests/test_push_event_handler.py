"""Tests for the GitHub push event handler — parsing, validation, and sync trigger.

.. meta::
   :ticket: FORGEOS-BE061
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from mcp_server.services.webhook_service import (
    WebhookEvent,
    WebhookService,
    WebhookValidationError,
    _HandlerRegistry,
    _validate_github_push_payload,
)
from mcp_server.webhooks.github_handler import (
    PushEventPayload,
    PushEventValidationError,
    _has_ticket_file_changes,
    create_push_handler,
    parse_push_event,
)

# ---------------------------------------------------------------------------
# Fixtures — reusable push payload builders
# ---------------------------------------------------------------------------

def _make_push_payload(
    *,
    ref: str = "refs/heads/main",
    commits: list[dict] | None = None,
    repo_name: str = "ForgeOS",
    repo_full_name: str = "reaperoak/ForgeOS",
    sender_login: str = "reaperoak",
) -> dict:
    """Build a minimal valid GitHub push event payload."""
    if commits is None:
        commits = [
            {
                "id": "abc123",
                "message": "update tickets",
                "added": [],
                "removed": [],
                "modified": [".github/tickets/FORGEOS-BE001.json"],
            },
        ]
    return {
        "ref": ref,
        "before": "0000000000000000000000000000000000000000",
        "after": "abc123def456",
        "commits": commits,
        "repository": {
            "name": repo_name,
            "full_name": repo_full_name,
        },
        "sender": {"login": sender_login},
    }


def _make_webhook_event(
    payload: dict | None = None,
    event_type: str = "push",
    event_id: str = "corr-001",
) -> WebhookEvent:
    """Build a WebhookEvent wrapping a push payload."""
    return WebhookEvent(
        event_id=event_id,
        source="github",
        event_type=event_type,
        payload=payload or _make_push_payload(),
    )


# ================================================================== #
# parse_push_event — payload parsing and validation
# ================================================================== #


class TestParsePushEvent:
    """Tests for parse_push_event."""

    def test_valid_main_branch(self) -> None:
        payload = _make_push_payload(ref="refs/heads/main")
        result = parse_push_event(payload)

        assert isinstance(result, PushEventPayload)
        assert result.ref == "refs/heads/main"
        assert result.branch == "main"
        assert result.is_main_branch is True
        assert result.repository_name == "ForgeOS"
        assert result.repository_full_name == "reaperoak/ForgeOS"
        assert result.sender == "reaperoak"
        assert len(result.commits) == 1

    def test_valid_feature_branch(self) -> None:
        payload = _make_push_payload(ref="refs/heads/feature/webhooks")
        result = parse_push_event(payload)

        assert result.branch == "feature/webhooks"
        assert result.is_main_branch is False

    def test_master_branch_is_main(self) -> None:
        payload = _make_push_payload(ref="refs/heads/master")
        result = parse_push_event(payload)

        assert result.branch == "master"
        assert result.is_main_branch is True

    def test_empty_commits_list(self) -> None:
        payload = _make_push_payload(commits=[])
        result = parse_push_event(payload)

        assert result.commits == []
        assert result.is_main_branch is True

    def test_missing_sender_defaults_empty(self) -> None:
        payload = _make_push_payload()
        del payload["sender"]
        result = parse_push_event(payload)

        assert result.sender == ""

    def test_missing_ref_raises(self) -> None:
        payload = _make_push_payload()
        del payload["ref"]

        with pytest.raises(PushEventValidationError, match="'ref'"):
            parse_push_event(payload)

    def test_empty_ref_raises(self) -> None:
        payload = _make_push_payload(ref="")

        with pytest.raises(PushEventValidationError, match="'ref'"):
            parse_push_event(payload)

    def test_non_string_ref_raises(self) -> None:
        payload = _make_push_payload()
        payload["ref"] = 123

        with pytest.raises(PushEventValidationError, match="'ref'"):
            parse_push_event(payload)

    def test_missing_commits_raises(self) -> None:
        payload = _make_push_payload()
        del payload["commits"]

        with pytest.raises(PushEventValidationError, match="'commits'"):
            parse_push_event(payload)

    def test_non_list_commits_raises(self) -> None:
        payload = _make_push_payload()
        payload["commits"] = "not-a-list"

        with pytest.raises(PushEventValidationError, match="'commits'"):
            parse_push_event(payload)

    def test_missing_repository_raises(self) -> None:
        payload = _make_push_payload()
        del payload["repository"]

        with pytest.raises(PushEventValidationError, match="'repository'"):
            parse_push_event(payload)

    def test_non_dict_repository_raises(self) -> None:
        payload = _make_push_payload()
        payload["repository"] = "not-a-dict"

        with pytest.raises(PushEventValidationError, match="'repository'"):
            parse_push_event(payload)

    def test_validation_error_has_details(self) -> None:
        payload = _make_push_payload()
        del payload["ref"]

        with pytest.raises(PushEventValidationError) as exc_info:
            parse_push_event(payload)

        assert exc_info.value.details["field"] == "ref"


# ================================================================== #
# _validate_github_push_payload — webhook service validation
# ================================================================== #


class TestValidateGitHubPushPayload:
    """Tests for _validate_github_push_payload in webhook_service."""

    def test_valid_push_payload_returns_push(self) -> None:
        payload = _make_push_payload()
        result = _validate_github_push_payload(payload)
        assert result == "push"

    def test_missing_ref_raises(self) -> None:
        payload = _make_push_payload()
        del payload["ref"]

        with pytest.raises(WebhookValidationError, match="missing required fields"):
            _validate_github_push_payload(payload)

    def test_missing_commits_raises(self) -> None:
        payload = _make_push_payload()
        del payload["commits"]

        with pytest.raises(WebhookValidationError, match="missing required fields"):
            _validate_github_push_payload(payload)

    def test_missing_repository_raises(self) -> None:
        payload = _make_push_payload()
        del payload["repository"]

        with pytest.raises(WebhookValidationError, match="missing required fields"):
            _validate_github_push_payload(payload)

    def test_empty_ref_raises(self) -> None:
        payload = _make_push_payload(ref="")

        with pytest.raises(WebhookValidationError, match="non-empty string"):
            _validate_github_push_payload(payload)

    def test_non_list_commits_raises(self) -> None:
        payload = _make_push_payload()
        payload["commits"] = "abc"

        with pytest.raises(WebhookValidationError, match="must be a list"):
            _validate_github_push_payload(payload)


# ================================================================== #
# WebhookService.validate_payload — push event type routing
# ================================================================== #


class TestWebhookServicePushValidation:
    """Tests that WebhookService.validate_payload handles push events."""

    def setup_method(self) -> None:
        self.service = WebhookService()

    def test_push_event_with_header(self) -> None:
        payload = _make_push_payload()
        event = self.service.validate_payload(
            source="github",
            payload=payload,
            event_type_header="push",
        )

        assert event.event_type == "push"
        assert event.source == "github"
        assert event.payload is payload

    def test_push_event_rejects_missing_ref(self) -> None:
        payload = _make_push_payload()
        del payload["ref"]

        with pytest.raises(WebhookValidationError, match="missing required fields"):
            self.service.validate_payload(
                source="github",
                payload=payload,
                event_type_header="push",
            )

    def test_non_push_github_event_still_requires_action(self) -> None:
        with pytest.raises(WebhookValidationError, match="missing required fields"):
            self.service.validate_payload(
                source="github",
                payload={"number": 1},
                event_type_header="pull_request",
            )


# ================================================================== #
# create_push_handler — push event handler factory
# ================================================================== #


class TestCreatePushHandler:
    """Tests for the push event handler created by create_push_handler."""

    async def test_main_branch_triggers_sync(self) -> None:
        sync_fn = AsyncMock(return_value={"released_count": 0, "unblocked_count": 2})
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        await handler(event)

        sync_fn.assert_awaited_once()

    async def test_master_branch_triggers_sync(self) -> None:
        sync_fn = AsyncMock(return_value={"released_count": 1, "unblocked_count": 0})
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/master"),
        )

        await handler(event)

        sync_fn.assert_awaited_once()

    async def test_feature_branch_does_not_trigger_sync(self) -> None:
        sync_fn = AsyncMock()
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(
                ref="refs/heads/feature/new-api",
                commits=[
                    {
                        "id": "c1",
                        "message": "update readme",
                        "added": [],
                        "modified": ["README.md"],
                        "removed": [],
                    },
                ],
            ),
        )

        await handler(event)

        sync_fn.assert_not_awaited()

    async def test_no_sync_fn_skips_gracefully(self) -> None:
        handler = create_push_handler(sync_fn=None)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        # Should not raise
        await handler(event)

    async def test_sync_exception_does_not_propagate(self) -> None:
        sync_fn = AsyncMock(side_effect=RuntimeError("db down"))
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        # Should not raise — exception is caught and logged
        result = await handler(event)

        sync_fn.assert_awaited_once()
        assert result is not None
        assert result["error"] == "sync_failed"

    async def test_invalid_payload_does_not_raise(self) -> None:
        sync_fn = AsyncMock()
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(payload={"bad": "data"})

        # Should not propagate — validation failure is logged
        result = await handler(event)

        assert result is None
        sync_fn.assert_not_awaited()

    async def test_handler_uses_event_id_as_correlation(self) -> None:
        sync_fn = AsyncMock(return_value={})
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
            event_id="unique-corr-id",
        )

        await handler(event)

        sync_fn.assert_awaited_once()

    async def test_main_branch_returns_sync_result(self) -> None:
        sync_result = {"released_count": 1, "unblocked_count": 3}
        sync_fn = AsyncMock(return_value=sync_result)
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        result = await handler(event)

        assert result is not None
        assert result["acknowledged"] is True
        assert result["sync_triggered"] is True
        assert result["sync_result"] == sync_result

    async def test_feature_branch_without_ticket_files_returns_ack(self) -> None:
        sync_fn = AsyncMock()
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(
                ref="refs/heads/feature/ui-fix",
                commits=[
                    {
                        "id": "c1",
                        "message": "fix",
                        "added": [],
                        "modified": ["src/app.py"],
                        "removed": [],
                    },
                ],
            ),
        )

        result = await handler(event)

        assert result is not None
        assert result["acknowledged"] is True
        assert result["sync_triggered"] is False
        assert result["branch"] == "feature/ui-fix"
        sync_fn.assert_not_awaited()

    async def test_feature_branch_with_ticket_files_triggers_sync(self) -> None:
        sync_result = {"released_count": 2, "unblocked_count": 0}
        sync_fn = AsyncMock(return_value=sync_result)
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(
                ref="refs/heads/feature/ticket-update",
                commits=[
                    {
                        "id": "c1",
                        "message": "update ticket",
                        "added": [],
                        "modified": [".github/tickets/FORGEOS-BE001.json"],
                        "removed": [],
                    },
                ],
            ),
        )

        result = await handler(event)

        sync_fn.assert_awaited_once()
        assert result is not None
        assert result["sync_triggered"] is True
        assert result["sync_result"] == sync_result

    async def test_feature_branch_ticket_state_files_triggers_sync(self) -> None:
        sync_fn = AsyncMock(return_value={"released_count": 0})
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(
                ref="refs/heads/dev",
                commits=[
                    {
                        "id": "c1",
                        "message": "advance ticket",
                        "added": [".github/ticket-state/QA/FORGEOS-X1.json"],
                        "modified": [],
                        "removed": [".github/ticket-state/BACKEND/FORGEOS-X1.json"],
                    },
                ],
            ),
        )

        result = await handler(event)

        sync_fn.assert_awaited_once()
        assert result is not None
        assert result["sync_triggered"] is True

    async def test_sync_failure_returns_error_response(self) -> None:
        sync_fn = AsyncMock(side_effect=RuntimeError("db down"))
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        result = await handler(event)

        assert result is not None
        assert result["acknowledged"] is True
        assert result["sync_triggered"] is False
        assert result["error"] == "sync_failed"

    async def test_invalid_payload_returns_none(self) -> None:
        sync_fn = AsyncMock()
        handler = create_push_handler(sync_fn=sync_fn)
        event = _make_webhook_event(payload={"bad": "data"})

        result = await handler(event)

        assert result is None
        sync_fn.assert_not_awaited()


# ================================================================== #
# Handler registration in registry
# ================================================================== #


class TestPushHandlerRegistration:
    """Tests that the push handler integrates with _HandlerRegistry."""

    async def test_register_and_dispatch_push(self) -> None:
        sync_fn = AsyncMock(return_value={"released_count": 0, "unblocked_count": 1})
        handler = create_push_handler(sync_fn=sync_fn)
        registry = _HandlerRegistry()
        registry.register("github", "push", handler)
        service = WebhookService(registry=registry)

        event = _make_webhook_event(
            payload=_make_push_payload(ref="refs/heads/main"),
        )

        await service.dispatch(event)

        sync_fn.assert_awaited_once()

    async def test_dispatch_non_main_push_no_sync(self) -> None:
        sync_fn = AsyncMock()
        handler = create_push_handler(sync_fn=sync_fn)
        registry = _HandlerRegistry()
        registry.register("github", "push", handler)
        service = WebhookService(registry=registry)

        event = _make_webhook_event(
            payload=_make_push_payload(
                ref="refs/heads/dev",
                commits=[
                    {
                        "id": "c1",
                        "message": "docs",
                        "added": [],
                        "modified": ["README.md"],
                        "removed": [],
                    },
                ],
            ),
        )

        await service.dispatch(event)

        sync_fn.assert_not_awaited()


# ================================================================== #
# _has_ticket_file_changes — file path filtering
# ================================================================== #


class TestHasTicketFileChanges:
    """Tests for _has_ticket_file_changes helper."""

    def test_no_commits(self) -> None:
        assert _has_ticket_file_changes([]) is False

    def test_no_ticket_files(self) -> None:
        commits = [{"added": ["src/app.py"], "modified": ["README.md"], "removed": []}]
        assert _has_ticket_file_changes(commits) is False

    def test_ticket_file_in_modified(self) -> None:
        commits = [{"modified": [".github/tickets/FORGEOS-BE001.json"]}]
        assert _has_ticket_file_changes(commits) is True

    def test_ticket_state_file_in_added(self) -> None:
        commits = [{"added": [".github/ticket-state/QA/FORGEOS-X1.json"]}]
        assert _has_ticket_file_changes(commits) is True

    def test_ticket_file_in_removed(self) -> None:
        commits = [{"removed": [".github/tickets/OLD.json"]}]
        assert _has_ticket_file_changes(commits) is True

    def test_mixed_commits_one_has_ticket(self) -> None:
        commits = [
            {"added": ["src/main.py"], "modified": [], "removed": []},
            {"added": [], "modified": [".github/tickets/T1.json"], "removed": []},
        ]
        assert _has_ticket_file_changes(commits) is True

    def test_commit_missing_file_keys(self) -> None:
        commits = [{"id": "abc", "message": "no file keys"}]
        assert _has_ticket_file_changes(commits) is False

    def test_non_string_file_path_ignored(self) -> None:
        commits = [{"added": [123, None], "modified": [], "removed": []}]
        assert _has_ticket_file_changes(commits) is False

    def test_partial_prefix_no_match(self) -> None:
        commits = [{"modified": [".github/ticket"]}]
        assert _has_ticket_file_changes(commits) is False
