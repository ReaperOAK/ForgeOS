"""Tests for Pydantic models — Ticket, Evidence, Claim, OperationResult.

Covers:
- Ticket field types and defaults
- Evidence validation (required fields, confidence pattern)
- Claim composition
- OperationResult structure
- Extra field tolerance
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from forgeos_sdk.models import Claim, Evidence, OperationResult, Ticket


class TestTicketModel:
    """Ticket model construction and validation."""

    def test_minimal_ticket(self) -> None:
        ticket = Ticket(ticket_id="T-001")
        assert ticket.ticket_id == "T-001"
        assert ticket.title == ""
        assert ticket.status == ""
        assert ticket.file_paths == []
        assert ticket.rework_count == 0

    def test_full_ticket(self) -> None:
        ticket = Ticket(
            ticket_id="FORGEOS-BE003",
            title="Implement Connection Pool",
            type="backend",
            priority="high",
            status="CLAIMED",
            stage="BACKEND",
            claimed_by="550e8400-uuid",
            claimed_by_name="Backend Engineer",
            machine_id="dev-01",
            operator="Owais",
            lease_expiry=datetime(2026, 3, 7, 9, 30, tzinfo=timezone.utc),
            file_paths=["src/db/pool.ts"],
            acceptance_criteria=["AC1: Pool"],
            depends_on=["FORGEOS-BE001"],
            rework_count=1,
        )
        assert ticket.ticket_id == "FORGEOS-BE003"
        assert ticket.type == "backend"
        assert ticket.claimed_by_name == "Backend Engineer"
        assert ticket.rework_count == 1
        assert len(ticket.file_paths) == 1

    def test_ticket_allows_extra_fields(self) -> None:
        ticket = Ticket(ticket_id="T-001", unknown_field="value")
        assert ticket.ticket_id == "T-001"
        assert ticket.model_extra is not None
        assert ticket.model_extra.get("unknown_field") == "value"

    def test_ticket_from_dict(self) -> None:
        data = {
            "ticket_id": "T-002",
            "title": "Test",
            "status": "READY",
            "stage": "QA",
        }
        ticket = Ticket.model_validate(data)
        assert ticket.ticket_id == "T-002"
        assert ticket.stage == "QA"

    def test_ticket_nullable_fields(self) -> None:
        ticket = Ticket(ticket_id="T-003", claimed_by=None, lease_expiry=None)
        assert ticket.claimed_by is None
        assert ticket.lease_expiry is None


class TestEvidenceModel:
    """Evidence model construction and validation."""

    def test_valid_evidence(self) -> None:
        ev = Evidence(
            artifacts=["src/main.py"],
            test_results="10 tests pass, 0 fail",
            confidence="HIGH",
        )
        assert ev.confidence == "HIGH"
        assert ev.notes is None

    def test_evidence_with_notes(self) -> None:
        ev = Evidence(
            artifacts=["a.py", "b.py"],
            test_results="All pass",
            confidence="MEDIUM",
            notes="Refactored module",
        )
        assert ev.notes == "Refactored module"
        assert len(ev.artifacts) == 2

    def test_evidence_invalid_confidence(self) -> None:
        with pytest.raises(ValidationError):
            Evidence(
                artifacts=["a.py"],
                test_results="pass",
                confidence="VERY_HIGH",
            )

    def test_evidence_empty_artifacts_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Evidence(
                artifacts=[],
                test_results="pass",
                confidence="HIGH",
            )

    def test_evidence_empty_test_results_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Evidence(
                artifacts=["a.py"],
                test_results="",
                confidence="LOW",
            )

    def test_evidence_model_dump_excludes_none(self) -> None:
        ev = Evidence(
            artifacts=["a.py"],
            test_results="pass",
            confidence="HIGH",
        )
        dumped = ev.model_dump(exclude_none=True)
        assert "notes" not in dumped
        assert dumped["confidence"] == "HIGH"

    def test_evidence_all_confidence_levels(self) -> None:
        for level in ("HIGH", "MEDIUM", "LOW"):
            ev = Evidence(
                artifacts=["a.py"],
                test_results="ok",
                confidence=level,
            )
            assert ev.confidence == level


class TestClaimModel:
    """Claim model composition."""

    def test_claim_with_ticket(self) -> None:
        ticket = Ticket(ticket_id="T-001", status="CLAIMED")
        claim = Claim(
            ticket=ticket,
            lease_expiry=datetime(2026, 3, 7, 9, 30, tzinfo=timezone.utc),
            file_locks=["src/main.py", "src/config.py"],
        )
        assert claim.ticket.ticket_id == "T-001"
        assert len(claim.file_locks) == 2

    def test_claim_empty_file_locks(self) -> None:
        ticket = Ticket(ticket_id="T-001")
        claim = Claim(
            ticket=ticket,
            lease_expiry=datetime(2026, 3, 7, 9, 30, tzinfo=timezone.utc),
        )
        assert claim.file_locks == []

    def test_claim_requires_lease_expiry(self) -> None:
        with pytest.raises(ValidationError):
            Claim(ticket=Ticket(ticket_id="T-001"))  # type: ignore[call-arg]


class TestOperationResultModel:
    """OperationResult model construction."""

    def test_success_result(self) -> None:
        result = OperationResult(
            success=True,
            message="Ticket released successfully",
        )
        assert result.success is True
        assert result.ticket is None
        assert result.data == {}

    def test_result_with_ticket(self) -> None:
        ticket = Ticket(ticket_id="T-001")
        result = OperationResult(
            success=True,
            message="OK",
            ticket=ticket,
            data={"released_file_locks": ["a.py"]},
        )
        assert result.ticket is not None
        assert result.ticket.ticket_id == "T-001"
        assert result.data["released_file_locks"] == ["a.py"]

    def test_failure_result(self) -> None:
        result = OperationResult(success=False, message="Not found")
        assert result.success is False
