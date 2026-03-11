"""Tests for RunnerHooks — agent-runner.py integration hooks.

Covers all acceptance criteria:
  AC1: Pre-run hook validates ticket claim before agent execution starts
  AC2: Post-run hook advances ticket or sends to rework based on agent result
  AC3: Hooks integrate with ForgeOSClient for MCP operations
  AC4: Hook lifecycle: pre_claim_check -> agent_work -> post_advance_or_rework
  AC5: Error in hooks logs and surfaces error without crashing the runner
  AC6: Hooks configurable via environment variables (enable/disable individual hooks)

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import pytest

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.models import Evidence, Ticket
from forgeos_sdk.runner_hooks import HookConfig, HookResult, RunnerHooks

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_TICKET = {
    "ticket_id": "FORGEOS-BE050",
    "title": "Test Ticket",
    "type": "backend",
    "priority": "medium",
    "status": "CLAIMED",
    "stage": "BACKEND",
    "claimed_by": "backend-agent",
    "claimed_by_name": "Backend",
    "machine_id": "pop-os",
    "operator": "ReaperOAK",
    "rework_count": 0,
}

SAMPLE_EVIDENCE = Evidence(
    artifacts=["src/file.py"],
    test_results="All 10 tests pass",
    confidence="HIGH",
)


def _text_content(data: dict[str, Any] | str) -> MagicMock:
    content = MagicMock()
    content.text = data if isinstance(data, str) else json.dumps(data)
    return content


def _call_result(
    data: dict[str, Any] | str,
    *,
    is_error: bool = False,
) -> MagicMock:
    result = MagicMock()
    result.content = [_text_content(data)]
    result.isError = is_error
    return result


@pytest.fixture()
def mock_session() -> AsyncMock:
    return AsyncMock()


@pytest.fixture()
def mock_client(mock_session: AsyncMock) -> MagicMock:
    client = MagicMock(spec=ForgeOSClient)
    client.agent_id = "backend-agent"
    type(client).session = PropertyMock(return_value=mock_session)
    return client


@pytest.fixture()
def hooks(mock_client: MagicMock) -> RunnerHooks:
    config = HookConfig()
    return RunnerHooks(mock_client, config=config)


# ---------------------------------------------------------------------------
# AC1: Pre-run hook validates ticket claim before agent execution starts
# ---------------------------------------------------------------------------


class TestPreClaimCheck:
    """AC1 — pre_claim_check validates the claim is active."""

    async def test_returns_hook_result_with_ticket(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": SAMPLE_TICKET}
        )

        result = await hooks.pre_claim_check("FORGEOS-BE050", agent_name="backend-agent")

        assert isinstance(result, HookResult)
        assert result.success is True
        assert result.ticket is not None
        assert result.ticket.ticket_id == "FORGEOS-BE050"

    async def test_validates_claimed_by_matches_agent(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        wrong_claim = {**SAMPLE_TICKET, "claimed_by": "other-agent"}
        mock_session.call_tool.return_value = _call_result(
            {"ticket": wrong_claim}
        )

        result = await hooks.pre_claim_check(
            "FORGEOS-BE050", agent_name="backend-agent"
        )

        assert result.success is False
        assert result.error is not None
        assert "claimed by another agent" in result.error.lower()

    async def test_validates_ticket_not_unclaimed(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        unclaimed = {**SAMPLE_TICKET, "claimed_by": None, "status": "READY"}
        mock_session.call_tool.return_value = _call_result(
            {"ticket": unclaimed}
        )

        result = await hooks.pre_claim_check(
            "FORGEOS-BE050", agent_name="backend-agent"
        )

        assert result.success is False
        assert "not claimed" in result.error.lower()

    async def test_mcp_error_returns_failure_without_raising(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        """AC5 — errors log and surface without crashing."""
        mock_session.call_tool.return_value = _call_result(
            "Server error", is_error=True
        )

        result = await hooks.pre_claim_check("FORGEOS-BE050")

        assert result.success is False
        assert result.error is not None
        assert result.ticket is None


# ---------------------------------------------------------------------------
# AC2: Post-run hook advances or sends to rework based on agent result
# ---------------------------------------------------------------------------


class TestPostAdvanceOrRework:
    """AC2 — post_advance_or_rework routes based on success/failure."""

    async def test_advance_on_success(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        advanced_ticket = {**SAMPLE_TICKET, "stage": "QA"}
        mock_session.call_tool.return_value = _call_result(
            {"ticket": advanced_ticket}
        )

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )

        assert result.success is True
        assert result.ticket is not None
        assert result.ticket.stage == "QA"

    async def test_rework_on_failure(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        reworked_ticket = {**SAMPLE_TICKET, "stage": "BACKEND", "rework_count": 1}
        mock_session.call_tool.return_value = _call_result(
            {"ticket": reworked_ticket}
        )

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Tests failed with 2 errors",
        )

        assert result.success is True
        assert result.ticket is not None
        assert result.ticket.rework_count == 1

    async def test_advance_requires_evidence(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=None,
        )

        assert result.success is False
        assert "evidence" in result.error.lower()

    async def test_rework_requires_reason(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="",
        )

        assert result.success is False
        assert "reason" in result.error.lower()

    async def test_advance_mcp_error_does_not_crash(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        """AC5 — errors surface without crashing."""
        mock_session.call_tool.return_value = _call_result(
            "advance failed", is_error=True
        )

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )

        assert result.success is False
        assert result.error is not None

    async def test_rework_mcp_error_does_not_crash(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            "rework failed", is_error=True
        )

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Tests failed",
        )

        assert result.success is False
        assert result.error is not None


# ---------------------------------------------------------------------------
# AC3: Hooks integrate with ForgeOSClient for MCP operations
# ---------------------------------------------------------------------------


class TestClientIntegration:
    """AC3 — RunnerHooks uses ForgeOSClient via TicketOperations."""

    async def test_pre_claim_calls_tickets_status(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": SAMPLE_TICKET}
        )

        await hooks.pre_claim_check("FORGEOS-BE050", agent_name="Backend")

        mock_session.call_tool.assert_called_once_with(
            "tickets.status", {"ticket_id": "FORGEOS-BE050"}
        )

    async def test_advance_calls_tickets_complete(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {**SAMPLE_TICKET, "stage": "QA"}}
        )

        await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )

        mock_session.call_tool.assert_called_once_with(
            "tickets.complete",
            {
                "ticket_id": "FORGEOS-BE050",
                "evidence": SAMPLE_EVIDENCE.model_dump(exclude_none=True),
            },
        )

    async def test_rework_calls_tickets_reject(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": SAMPLE_TICKET}
        )

        await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Coverage below 80%",
        )

        mock_session.call_tool.assert_called_once_with(
            "tickets.reject",
            {
                "ticket_id": "FORGEOS-BE050",
                "reason": "Coverage below 80%",
            },
        )


# ---------------------------------------------------------------------------
# AC4: Hook lifecycle: pre_claim_check -> agent_work -> post_advance_or_rework
# ---------------------------------------------------------------------------


class TestHookLifecycle:
    """AC4 — hooks execute in the correct lifecycle order."""

    async def test_full_success_lifecycle(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        """pre_claim_check -> (agent work) -> post_advance_or_rework(success)."""
        mock_session.call_tool.side_effect = [
            _call_result({"ticket": SAMPLE_TICKET}),
            _call_result({"ticket": {**SAMPLE_TICKET, "stage": "QA"}}),
        ]

        pre = await hooks.pre_claim_check("FORGEOS-BE050", agent_name="backend-agent")
        assert pre.success is True

        # Agent does work here...

        post = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )
        assert post.success is True
        assert post.ticket.stage == "QA"

    async def test_full_rework_lifecycle(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        """pre_claim_check -> (agent work fails) -> post_advance_or_rework(failure)."""
        mock_session.call_tool.side_effect = [
            _call_result({"ticket": SAMPLE_TICKET}),
            _call_result(
                {"ticket": {**SAMPLE_TICKET, "rework_count": 1}}
            ),
        ]

        pre = await hooks.pre_claim_check("FORGEOS-BE050", agent_name="backend-agent")
        assert pre.success is True

        post = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Build errors found",
        )
        assert post.success is True

    async def test_pre_claim_failure_prevents_lifecycle(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        """If pre_claim_check fails, caller can skip the rest."""
        mock_session.call_tool.return_value = _call_result(
            "not found", is_error=True
        )

        pre = await hooks.pre_claim_check("FORGEOS-BE050")
        assert pre.success is False
        # Caller checks pre.success and aborts — no advance/rework needed.


# ---------------------------------------------------------------------------
# AC5: Error in hooks logs and surfaces error without crashing the runner
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """AC5 — all errors are caught, logged, and returned in HookResult."""

    async def test_connection_error_caught(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.side_effect = Exception("Connection lost")

        result = await hooks.pre_claim_check("FORGEOS-BE050")

        assert result.success is False
        assert "Connection lost" in result.error

    async def test_advance_exception_caught(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.side_effect = Exception("Network timeout")

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )

        assert result.success is False
        assert "Network timeout" in result.error

    async def test_rework_exception_caught(
        self, hooks: RunnerHooks, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.side_effect = Exception("DB down")

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Lint failed",
        )

        assert result.success is False
        assert "DB down" in result.error


# ---------------------------------------------------------------------------
# AC6: Hooks configurable via environment variables
# ---------------------------------------------------------------------------


class TestHookConfig:
    """AC6 — hooks can be enabled/disabled via env vars."""

    def test_default_config_all_enabled(self) -> None:
        config = HookConfig()
        assert config.pre_claim_enabled is True
        assert config.post_advance_enabled is True
        assert config.post_rework_enabled is True

    def test_from_env_reads_variables(self) -> None:
        env = {
            "FORGEOS_HOOK_PRE_CLAIM": "false",
            "FORGEOS_HOOK_POST_ADVANCE": "0",
            "FORGEOS_HOOK_POST_REWORK": "true",
        }
        with patch.dict("os.environ", env, clear=False):
            config = HookConfig.from_env()

        assert config.pre_claim_enabled is False
        assert config.post_advance_enabled is False
        assert config.post_rework_enabled is True

    def test_from_env_defaults_when_unset(self) -> None:
        env: dict[str, str] = {}
        with patch.dict("os.environ", env, clear=True):
            config = HookConfig.from_env()

        assert config.pre_claim_enabled is True
        assert config.post_advance_enabled is True
        assert config.post_rework_enabled is True

    async def test_disabled_pre_claim_skips(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        config = HookConfig(pre_claim_enabled=False)
        hooks = RunnerHooks(mock_client, config=config)

        result = await hooks.pre_claim_check("FORGEOS-BE050")

        assert result.success is True
        assert result.data.get("skipped") is True
        mock_session.call_tool.assert_not_called()

    async def test_disabled_advance_skips(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        config = HookConfig(post_advance_enabled=False)
        hooks = RunnerHooks(mock_client, config=config)

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=True,
            evidence=SAMPLE_EVIDENCE,
        )

        assert result.success is True
        assert result.data.get("skipped") is True
        mock_session.call_tool.assert_not_called()

    async def test_disabled_rework_skips(
        self, mock_client: MagicMock, mock_session: AsyncMock
    ) -> None:
        config = HookConfig(post_rework_enabled=False)
        hooks = RunnerHooks(mock_client, config=config)

        result = await hooks.post_advance_or_rework(
            "FORGEOS-BE050",
            success=False,
            rework_reason="Failed lint",
        )

        assert result.success is True
        assert result.data.get("skipped") is True
        mock_session.call_tool.assert_not_called()


# ---------------------------------------------------------------------------
# HookResult model tests
# ---------------------------------------------------------------------------


class TestHookResult:
    """HookResult dataclass tests."""

    def test_defaults(self) -> None:
        r = HookResult(success=True)
        assert r.success is True
        assert r.ticket is None
        assert r.error is None
        assert r.data == {}

    def test_with_ticket(self) -> None:
        ticket = Ticket(ticket_id="T-1", title="Test")
        r = HookResult(success=True, ticket=ticket)
        assert r.ticket.ticket_id == "T-1"

    def test_with_error(self) -> None:
        r = HookResult(success=False, error="something broke")
        assert r.error == "something broke"
