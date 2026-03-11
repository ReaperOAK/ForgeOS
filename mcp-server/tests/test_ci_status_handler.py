"""Tests for the CI status event handler (check_run and status events).

.. meta::
   :ticket: FORGEOS-BE062
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.services.webhook_service import WebhookEvent, _HandlerRegistry
from mcp_server.webhooks.github_handler import (
    CI_AGENT_ID,
    CIStatusHandler,
    CITicketOps,
    extract_ticket_id_from_branch,
)

# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #


def _make_event(
    event_type: str,
    payload: dict[str, Any],
    event_id: str = "evt-001",
) -> WebhookEvent:
    """Build a :class:`WebhookEvent` for testing."""
    return WebhookEvent(
        event_id=event_id,
        source="github",
        event_type=event_type,
        payload=payload,
        received_at=datetime.now(timezone.utc),
    )


def _mock_ticket_ops(stage: str | None = "CI") -> MagicMock:
    """Build a mock implementing the :class:`CITicketOps` protocol."""
    ops = MagicMock(spec=CITicketOps)
    ops.get_ticket_stage = AsyncMock(return_value=stage)
    ops.advance_ci = AsyncMock()
    ops.fail_ci = AsyncMock()
    return ops


def _check_run_payload(
    *,
    action: str = "completed",
    conclusion: str = "success",
    branch: str = "FORGEOS-BE042-feature",
    check_name: str = "CI / build",
    output_summary: str = "All tests passed",
) -> dict[str, Any]:
    """Build a GitHub ``check_run`` event payload."""
    return {
        "action": action,
        "check_run": {
            "name": check_name,
            "conclusion": conclusion,
            "output": {
                "title": "Build Results",
                "summary": output_summary,
            },
            "check_suite": {
                "head_branch": branch,
            },
        },
    }


def _status_payload(
    *,
    state: str = "success",
    branch: str = "FORGEOS-BE042-feature",
    context: str = "ci/github-actions",
    description: str = "Build passed",
) -> dict[str, Any]:
    """Build a GitHub ``status`` event payload."""
    return {
        "action": state,
        "state": state,
        "context": context,
        "description": description,
        "branches": [{"name": branch}],
    }


# ------------------------------------------------------------------ #
# extract_ticket_id_from_branch
# ------------------------------------------------------------------ #


class TestExtractTicketIdFromBranch:
    """Tests for :func:`extract_ticket_id_from_branch`."""

    def test_standard_branch_name(self) -> None:
        assert extract_ticket_id_from_branch("FORGEOS-BE042-feature") == "FORGEOS-BE042"

    def test_ticket_id_only(self) -> None:
        assert extract_ticket_id_from_branch("FORGEOS-FE010") == "FORGEOS-FE010"

    def test_lowercase_input(self) -> None:
        assert extract_ticket_id_from_branch("forgeos-be042-fix") == "FORGEOS-BE042"

    def test_mixed_case(self) -> None:
        assert extract_ticket_id_from_branch("ForgeOS-Be042-hotfix") == "FORGEOS-BE042"

    def test_prefix_branch(self) -> None:
        assert extract_ticket_id_from_branch("feature/FORGEOS-BE042") == "FORGEOS-BE042"

    def test_no_match_returns_none(self) -> None:
        assert extract_ticket_id_from_branch("main") is None

    def test_empty_string(self) -> None:
        assert extract_ticket_id_from_branch("") is None

    def test_unrelated_prefix(self) -> None:
        assert extract_ticket_id_from_branch("hotfix-urgent-123") is None


# ------------------------------------------------------------------ #
# CIStatusHandler — check_run
# ------------------------------------------------------------------ #


class TestCIStatusHandlerCheckRun:
    """Tests for ``CIStatusHandler.handle_check_run``."""

    @pytest.mark.asyncio
    async def test_success_advances_ticket(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", _check_run_payload(conclusion="success"))

        await handler.handle_check_run(event)

        ops.advance_ci.assert_awaited_once()
        call_args = ops.advance_ci.call_args
        assert call_args[0][0] == "FORGEOS-BE042"
        assert call_args[0][1]["conclusion"] == "success"

    @pytest.mark.asyncio
    async def test_failure_records_rework(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(
                conclusion="failure",
                check_name="lint",
                output_summary="3 errors found",
            ),
        )

        await handler.handle_check_run(event)

        ops.fail_ci.assert_awaited_once()
        call_args = ops.fail_ci.call_args
        assert call_args[0][0] == "FORGEOS-BE042"
        assert "lint" in call_args[0][1]
        assert "3 errors found" in call_args[0][1]

    @pytest.mark.asyncio
    async def test_timed_out_records_rework(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(conclusion="timed_out", check_name="e2e-tests"),
        )

        await handler.handle_check_run(event)

        ops.fail_ci.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_pending_action_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(action="created"),
        )

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()
        ops.fail_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_neutral_conclusion_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(conclusion="neutral"),
        )

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()
        ops.fail_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ticket_not_in_ci_stage_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="BACKEND")
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", _check_run_payload(conclusion="success"))

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()
        ops.fail_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ticket_not_found_ignored(self) -> None:
        ops = _mock_ticket_ops(stage=None)
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", _check_run_payload(conclusion="success"))

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()
        ops.fail_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unrecognized_branch_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(branch="main"),
        )

        await handler.handle_check_run(event)

        ops.get_ticket_stage.assert_not_awaited()
        ops.advance_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_check_run_payload(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", {"action": "completed"})

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_missing_branch_in_check_suite(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        payload = _check_run_payload()
        payload["check_run"]["check_suite"] = {}
        event = _make_event("check_run", payload)

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_duplicate_success_idempotent(self) -> None:
        """Second event for same ticket already past CI is ignored."""
        ops = _mock_ticket_ops(stage="DOCS")
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", _check_run_payload(conclusion="success"))

        await handler.handle_check_run(event)

        ops.advance_ci.assert_not_awaited()


# ------------------------------------------------------------------ #
# CIStatusHandler — status
# ------------------------------------------------------------------ #


class TestCIStatusHandlerStatus:
    """Tests for ``CIStatusHandler.handle_status``."""

    @pytest.mark.asyncio
    async def test_success_state_advances_ticket(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event("status", _status_payload(state="success"))

        await handler.handle_status(event)

        ops.advance_ci.assert_awaited_once()
        call_args = ops.advance_ci.call_args
        assert call_args[0][0] == "FORGEOS-BE042"

    @pytest.mark.asyncio
    async def test_failure_state_records_rework(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "status",
            _status_payload(state="failure", description="Tests failed"),
        )

        await handler.handle_status(event)

        ops.fail_ci.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_error_state_records_rework(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "status",
            _status_payload(state="error", description="Infra error"),
        )

        await handler.handle_status(event)

        ops.fail_ci.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_pending_state_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event("status", _status_payload(state="pending"))

        await handler.handle_status(event)

        ops.advance_ci.assert_not_awaited()
        ops.fail_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_branches_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        payload = _status_payload()
        payload["branches"] = []
        event = _make_event("status", payload)

        await handler.handle_status(event)

        ops.get_ticket_stage.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unrecognized_branch_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "status",
            _status_payload(branch="main"),
        )

        await handler.handle_status(event)

        ops.get_ticket_stage.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ticket_not_in_ci_stage_ignored(self) -> None:
        ops = _mock_ticket_ops(stage="QA")
        handler = CIStatusHandler(ops)
        event = _make_event("status", _status_payload(state="success"))

        await handler.handle_status(event)

        ops.advance_ci.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_duplicate_status_idempotent(self) -> None:
        ops = _mock_ticket_ops(stage="DONE")
        handler = CIStatusHandler(ops)
        event = _make_event("status", _status_payload(state="success"))

        await handler.handle_status(event)

        ops.advance_ci.assert_not_awaited()


# ------------------------------------------------------------------ #
# CIStatusHandler — registration
# ------------------------------------------------------------------ #


class TestCIStatusHandlerRegistration:
    """Tests for handler registration with the registry."""

    def test_registers_check_run_and_status(self) -> None:
        ops = _mock_ticket_ops()
        handler = CIStatusHandler(ops)
        registry = _HandlerRegistry()

        handler.register(registry)

        # Bound methods are recreated on attribute access, so compare
        # the underlying function and bound instance instead of identity.
        check_run_handler = registry.get("github", "check_run")
        status_handler = registry.get("github", "status")
        assert check_run_handler is not None
        assert status_handler is not None
        assert check_run_handler.__func__ is CIStatusHandler.handle_check_run
        assert status_handler.__func__ is CIStatusHandler.handle_status
        assert check_run_handler.__self__ is handler
        assert status_handler.__self__ is handler

    def test_does_not_clobber_other_handlers(self) -> None:
        ops = _mock_ticket_ops()
        handler = CIStatusHandler(ops)
        registry = _HandlerRegistry()
        push_handler = AsyncMock()
        registry.register("github", "push", push_handler)

        handler.register(registry)

        assert registry.get("github", "push") is push_handler
        registered = registry.get("github", "check_run")
        assert registered is not None
        assert registered.__func__ is CIStatusHandler.handle_check_run


# ------------------------------------------------------------------ #
# Evidence structure
# ------------------------------------------------------------------ #


class TestCIEvidence:
    """Tests verifying evidence structure passed to ticket ops."""

    @pytest.mark.asyncio
    async def test_advance_evidence_includes_agent(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event("check_run", _check_run_payload())

        await handler.handle_check_run(event)

        evidence = ops.advance_ci.call_args[0][1]
        assert evidence["agent"] == CI_AGENT_ID
        assert evidence["check_name"] == "CI / build"
        assert evidence["conclusion"] == "success"
        assert "output_summary" in evidence

    @pytest.mark.asyncio
    async def test_failure_evidence_includes_details(self) -> None:
        ops = _mock_ticket_ops(stage="CI")
        handler = CIStatusHandler(ops)
        event = _make_event(
            "check_run",
            _check_run_payload(
                conclusion="failure",
                check_name="ruff",
                output_summary="5 violations",
            ),
        )

        await handler.handle_check_run(event)

        reason = ops.fail_ci.call_args[0][1]
        assert "ruff" in reason
        assert "5 violations" in reason
        evidence = ops.fail_ci.call_args[0][2]
        assert evidence["check_name"] == "ruff"
        assert evidence["conclusion"] == "failure"
