"""Tests for PR event handler service — ticket correlation & metadata extraction.

.. meta::
   :ticket: FORGEOS-BE063
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

import pytest

from mcp_server.services.pr_service import (
    PRAction,
    PRService,
    extract_pr_metadata,
    extract_ticket_ids,
)
from mcp_server.services.webhook_service import WebhookEvent

# ------------------------------------------------------------------ #
# Ticket ID extraction
# ------------------------------------------------------------------ #


class TestExtractTicketIds:
    """Tests for extract_ticket_ids from PR title and branch name."""

    def test_ticket_in_title_brackets(self) -> None:
        ids = extract_ticket_ids("[FORGEOS-BE028] Add claim endpoint", "feature/stuff")
        assert ids == ["FORGEOS-BE028"]

    def test_ticket_in_title_no_brackets(self) -> None:
        ids = extract_ticket_ids("FORGEOS-FE012 Fix button", "dev")
        assert ids == ["FORGEOS-FE012"]

    def test_ticket_in_branch(self) -> None:
        ids = extract_ticket_ids("Some unrelated title", "FORGEOS-BE028/add-claim")
        assert ids == ["FORGEOS-BE028"]

    def test_ticket_in_both_deduplicates(self) -> None:
        ids = extract_ticket_ids("[FORGEOS-BE028] fix", "FORGEOS-BE028/fix")
        assert ids == ["FORGEOS-BE028"]

    def test_multiple_tickets_in_title(self) -> None:
        ids = extract_ticket_ids("[FORGEOS-BE028] [FORGEOS-BE029] batch", "dev")
        assert "FORGEOS-BE028" in ids
        assert "FORGEOS-BE029" in ids
        assert len(ids) == 2

    def test_no_ticket_found(self) -> None:
        ids = extract_ticket_ids("Fix typo in readme", "main")
        assert ids == []

    def test_empty_strings(self) -> None:
        ids = extract_ticket_ids("", "")
        assert ids == []

    def test_various_ticket_types(self) -> None:
        ids = extract_ticket_ids("FORGEOS-QA003 test", "FORGEOS-SEC001/scan")
        assert "FORGEOS-QA003" in ids
        assert "FORGEOS-SEC001" in ids

    def test_ticket_in_branch_with_slash(self) -> None:
        ids = extract_ticket_ids("title", "feature/FORGEOS-BE063/pr-handler")
        assert ids == ["FORGEOS-BE063"]


# ------------------------------------------------------------------ #
# PR metadata extraction
# ------------------------------------------------------------------ #


def _make_pr_payload(
    *,
    action: str = "opened",
    number: int = 42,
    title: str = "[FORGEOS-BE028] Add feature",
    branch: str = "FORGEOS-BE028/feature",
    base_branch: str = "main",
    author: str = "dev-user",
    url: str = "https://github.com/org/repo/pull/42",
    reviewers: list[dict[str, str]] | None = None,
    labels: list[dict[str, str]] | None = None,
    merged: bool = False,
) -> dict:
    return {
        "action": action,
        "number": number,
        "pull_request": {
            "title": title,
            "html_url": url,
            "number": number,
            "user": {"login": author},
            "head": {"ref": branch},
            "base": {"ref": base_branch},
            "requested_reviewers": reviewers or [],
            "labels": labels or [],
            "merged": merged,
        },
    }


class TestExtractPRMetadata:
    """Tests for extract_pr_metadata from GitHub payload."""

    def test_basic_metadata(self) -> None:
        payload = _make_pr_payload()
        meta = extract_pr_metadata(payload)
        assert meta.number == 42
        assert meta.title == "[FORGEOS-BE028] Add feature"
        assert meta.url == "https://github.com/org/repo/pull/42"
        assert meta.author == "dev-user"
        assert meta.branch == "FORGEOS-BE028/feature"
        assert meta.base_branch == "main"
        assert meta.merged is False

    def test_with_reviewers(self) -> None:
        payload = _make_pr_payload(
            reviewers=[{"login": "reviewer1"}, {"login": "reviewer2"}],
        )
        meta = extract_pr_metadata(payload)
        assert meta.reviewers == ["reviewer1", "reviewer2"]

    def test_with_labels(self) -> None:
        payload = _make_pr_payload(
            labels=[{"name": "bug"}, {"name": "priority:high"}],
        )
        meta = extract_pr_metadata(payload)
        assert meta.labels == ["bug", "priority:high"]

    def test_merged_flag(self) -> None:
        payload = _make_pr_payload(merged=True, action="closed")
        meta = extract_pr_metadata(payload)
        assert meta.merged is True

    def test_missing_optional_fields(self) -> None:
        payload = {
            "action": "opened",
            "number": 1,
            "pull_request": {
                "title": "title",
                "html_url": "https://example.com/pull/1",
                "number": 1,
                "user": {"login": "u"},
                "head": {"ref": "branch"},
                "base": {"ref": "main"},
            },
        }
        meta = extract_pr_metadata(payload)
        assert meta.reviewers == []
        assert meta.labels == []
        assert meta.merged is False


# ------------------------------------------------------------------ #
# PRAction enum
# ------------------------------------------------------------------ #


class TestPRAction:
    """Tests for PRAction enum."""

    def test_from_string_opened(self) -> None:
        assert PRAction.from_string("opened") is PRAction.OPENED

    def test_from_string_closed(self) -> None:
        assert PRAction.from_string("closed") is PRAction.CLOSED

    def test_from_string_synchronize(self) -> None:
        assert PRAction.from_string("synchronize") is PRAction.SYNCHRONIZE

    def test_from_string_unknown(self) -> None:
        assert PRAction.from_string("labeled") is PRAction.OTHER

    def test_merged_detected(self) -> None:
        assert PRAction.from_string("closed", merged=True) is PRAction.MERGED


# ------------------------------------------------------------------ #
# PRService — event processing
# ------------------------------------------------------------------ #


def _make_webhook_event(
    payload: dict,
    event_type: str = "pull_request",
) -> WebhookEvent:
    return WebhookEvent(
        event_id="evt-test-001",
        source="github",
        event_type=event_type,
        payload=payload,
    )


class TestPRService:
    """Tests for PRService.handle_pr_event."""

    def setup_method(self) -> None:
        self.service = PRService()

    @pytest.mark.asyncio
    async def test_opened_extracts_ticket_and_metadata(self) -> None:
        payload = _make_pr_payload(action="opened")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        pr_event = results[0]
        assert pr_event.ticket_id == "FORGEOS-BE028"
        assert pr_event.action is PRAction.OPENED
        assert pr_event.metadata.number == 42
        assert pr_event.metadata.author == "dev-user"

    @pytest.mark.asyncio
    async def test_closed_without_merge(self) -> None:
        payload = _make_pr_payload(action="closed", merged=False)
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].action is PRAction.CLOSED

    @pytest.mark.asyncio
    async def test_closed_with_merge(self) -> None:
        payload = _make_pr_payload(action="closed", merged=True, base_branch="main")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].action is PRAction.MERGED
        assert results[0].merge_target == "main"

    @pytest.mark.asyncio
    async def test_synchronize_action(self) -> None:
        payload = _make_pr_payload(action="synchronize")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].action is PRAction.SYNCHRONIZE

    @pytest.mark.asyncio
    async def test_no_ticket_id_returns_empty(self) -> None:
        payload = _make_pr_payload(
            title="Fix typo in readme",
            branch="fix/typo",
        )
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert results == []

    @pytest.mark.asyncio
    async def test_no_ticket_id_logs_warning(self) -> None:
        payload = _make_pr_payload(
            title="Fix typo in readme",
            branch="fix/typo",
        )
        event = _make_webhook_event(payload)
        with patch("mcp_server.services.pr_service.logger") as mock_logger:
            await self.service.handle_pr_event(event)
            mock_logger.warning.assert_called_once()
            call_args = mock_logger.warning.call_args
            assert "pr_no_ticket_correlation" in str(call_args)

    @pytest.mark.asyncio
    async def test_multiple_tickets_produce_multiple_events(self) -> None:
        payload = _make_pr_payload(
            title="[FORGEOS-BE028] [FORGEOS-BE029] batch update",
            branch="feature/batch",
        )
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 2
        ticket_ids = {r.ticket_id for r in results}
        assert ticket_ids == {"FORGEOS-BE028", "FORGEOS-BE029"}

    @pytest.mark.asyncio
    async def test_merge_to_main_sets_advancement_flag(self) -> None:
        payload = _make_pr_payload(
            action="closed",
            merged=True,
            base_branch="main",
        )
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].triggers_advancement is True
        assert results[0].merge_target == "main"

    @pytest.mark.asyncio
    async def test_merge_to_non_main_no_advancement(self) -> None:
        payload = _make_pr_payload(
            action="closed",
            merged=True,
            base_branch="develop",
        )
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].triggers_advancement is False

    @pytest.mark.asyncio
    async def test_reviewers_and_labels_preserved(self) -> None:
        payload = _make_pr_payload(
            reviewers=[{"login": "alice"}, {"login": "bob"}],
            labels=[{"name": "approved"}, {"name": "backend"}],
        )
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].metadata.reviewers == ["alice", "bob"]
        assert results[0].metadata.labels == ["approved", "backend"]

    @pytest.mark.asyncio
    async def test_other_action_skipped_gracefully(self) -> None:
        payload = _make_pr_payload(action="labeled")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert results[0].action is PRAction.OTHER

    @pytest.mark.asyncio
    async def test_pr_event_has_timestamp(self) -> None:
        payload = _make_pr_payload(action="opened")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        assert len(results) == 1
        assert isinstance(results[0].timestamp, datetime)

    @pytest.mark.asyncio
    async def test_pr_event_to_dict(self) -> None:
        payload = _make_pr_payload(action="opened")
        event = _make_webhook_event(payload)
        results = await self.service.handle_pr_event(event)

        d = results[0].to_dict()
        assert d["ticket_id"] == "FORGEOS-BE028"
        assert d["action"] == "opened"
        assert d["pr_number"] == 42
        assert d["pr_url"] == "https://github.com/org/repo/pull/42"
        assert d["author"] == "dev-user"


# ------------------------------------------------------------------ #
# Handler registration integration
# ------------------------------------------------------------------ #


class TestPRHandlerRegistration:
    """Tests for pull_request handler registration in the webhook registry."""

    def test_handler_registered(self) -> None:
        import mcp_server.webhooks  # noqa: F401 — triggers eager registration
        from mcp_server.services.webhook_service import handler_registry

        handler = handler_registry.get("github", "pull_request")
        assert handler is not None

    @pytest.mark.asyncio
    async def test_handler_dispatches_to_pr_service(self) -> None:
        import mcp_server.webhooks  # noqa: F401 — triggers eager registration
        from mcp_server.services.webhook_service import handler_registry

        handler = handler_registry.get("github", "pull_request")
        assert handler is not None

        payload = _make_pr_payload(action="opened")
        event = _make_webhook_event(payload)
        # Should not raise
        await handler(event)
