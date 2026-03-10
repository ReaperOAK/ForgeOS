"""Tests for the SDLC stage engine (FORGEOS-BE030).

Covers:
  - Next stage resolution for valid flows
  - Invalid transition detection (stage not in flow, already at final stage, empty flow)
  - validate_advance returns next stage on success
  - validate_advance raises InvalidTransitionError on failure

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import pytest

from mcp_server.services.stage_engine import (
    InvalidTransitionError,
    get_next_stage,
    validate_advance,
)

# ---------------------------------------------------------------------------
# Fixtures / constants
# ---------------------------------------------------------------------------

BACKEND_FLOW = ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
FRONTEND_FLOW = ["READY", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
DOCS_FLOW = ["READY", "DOCS", "VALIDATION", "DONE"]
RESEARCH_FLOW = ["READY", "RESEARCH", "DOCS", "VALIDATION", "DONE"]
FULLSTACK_FLOW = [
    "READY", "BACKEND", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
]


# ---------------------------------------------------------------------------
# get_next_stage tests
# ---------------------------------------------------------------------------


class TestGetNextStage:
    """Tests for get_next_stage()."""

    def test_returns_next_stage_from_ready(self) -> None:
        assert get_next_stage(BACKEND_FLOW, "READY") == "BACKEND"

    def test_returns_next_stage_mid_flow(self) -> None:
        assert get_next_stage(BACKEND_FLOW, "QA") == "SECURITY"

    def test_returns_next_stage_before_done(self) -> None:
        assert get_next_stage(BACKEND_FLOW, "VALIDATION") == "DONE"

    def test_returns_none_at_final_stage(self) -> None:
        assert get_next_stage(BACKEND_FLOW, "DONE") is None

    def test_returns_none_for_unknown_stage(self) -> None:
        assert get_next_stage(BACKEND_FLOW, "NONEXISTENT") is None

    def test_returns_none_for_empty_flow(self) -> None:
        assert get_next_stage([], "BACKEND") is None

    def test_frontend_flow(self) -> None:
        assert get_next_stage(FRONTEND_FLOW, "READY") == "FRONTEND"

    def test_fullstack_flow_backend_to_frontend(self) -> None:
        assert get_next_stage(FULLSTACK_FLOW, "BACKEND") == "FRONTEND"

    def test_docs_flow(self) -> None:
        assert get_next_stage(DOCS_FLOW, "DOCS") == "VALIDATION"


# ---------------------------------------------------------------------------
# validate_advance tests — success cases
# ---------------------------------------------------------------------------


class TestValidateAdvanceSuccess:
    """Tests for validate_advance() — valid transitions."""

    def test_advance_from_ready_to_backend(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "READY")
        assert result == "BACKEND"

    def test_advance_from_backend_to_qa(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "BACKEND")
        assert result == "QA"

    def test_advance_from_qa_to_security(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "QA")
        assert result == "SECURITY"

    def test_advance_from_security_to_ci(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "SECURITY")
        assert result == "CI"

    def test_advance_from_ci_to_docs(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "CI")
        assert result == "DOCS"

    def test_advance_from_docs_to_validation(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "DOCS")
        assert result == "VALIDATION"

    def test_advance_from_validation_to_done(self) -> None:
        result = validate_advance("FORGEOS-BE001", BACKEND_FLOW, "VALIDATION")
        assert result == "DONE"

    def test_advance_fullstack_backend_to_frontend(self) -> None:
        result = validate_advance("FORGEOS-FS001", FULLSTACK_FLOW, "BACKEND")
        assert result == "FRONTEND"

    def test_advance_docs_ticket(self) -> None:
        result = validate_advance("FORGEOS-DOC001", DOCS_FLOW, "READY")
        assert result == "DOCS"

    def test_advance_research_ticket(self) -> None:
        result = validate_advance("FORGEOS-RES001", RESEARCH_FLOW, "RESEARCH")
        assert result == "DOCS"


# ---------------------------------------------------------------------------
# validate_advance tests — error cases
# ---------------------------------------------------------------------------


class TestValidateAdvanceErrors:
    """Tests for validate_advance() — invalid transitions."""

    def test_raises_on_empty_flow(self) -> None:
        with pytest.raises(InvalidTransitionError, match="no SDLC flow defined"):
            validate_advance("FORGEOS-BE001", [], "BACKEND")

    def test_raises_on_unknown_stage(self) -> None:
        with pytest.raises(InvalidTransitionError, match="not in the ticket's SDLC flow"):
            validate_advance("FORGEOS-BE001", BACKEND_FLOW, "NONEXISTENT")

    def test_raises_at_final_stage(self) -> None:
        with pytest.raises(InvalidTransitionError, match="already at the final stage"):
            validate_advance("FORGEOS-BE001", BACKEND_FLOW, "DONE")

    def test_error_contains_ticket_id(self) -> None:
        with pytest.raises(InvalidTransitionError) as exc_info:
            validate_advance("FORGEOS-BE099", BACKEND_FLOW, "DONE")
        assert exc_info.value.ticket_id == "FORGEOS-BE099"

    def test_error_contains_current_stage(self) -> None:
        with pytest.raises(InvalidTransitionError) as exc_info:
            validate_advance("FORGEOS-BE099", BACKEND_FLOW, "DONE")
        assert exc_info.value.current_stage == "DONE"

    def test_error_contains_reason(self) -> None:
        with pytest.raises(InvalidTransitionError) as exc_info:
            validate_advance("FORGEOS-BE099", BACKEND_FLOW, "DONE")
        assert exc_info.value.reason != ""

    def test_stage_not_in_flow_for_frontend_ticket(self) -> None:
        """A frontend ticket should not have BACKEND in its flow."""
        with pytest.raises(InvalidTransitionError, match="not in the ticket's SDLC flow"):
            validate_advance("FORGEOS-FE001", FRONTEND_FLOW, "BACKEND")


# ---------------------------------------------------------------------------
# InvalidTransitionError tests
# ---------------------------------------------------------------------------


class TestInvalidTransitionError:
    """Tests for the InvalidTransitionError exception class."""

    def test_str_representation(self) -> None:
        err = InvalidTransitionError("T-001", "QA", "test reason")
        assert "T-001" in str(err)
        assert "QA" in str(err)
        assert "test reason" in str(err)

    def test_attributes(self) -> None:
        err = InvalidTransitionError("T-001", "QA", "test reason")
        assert err.ticket_id == "T-001"
        assert err.current_stage == "QA"
        assert err.reason == "test reason"
