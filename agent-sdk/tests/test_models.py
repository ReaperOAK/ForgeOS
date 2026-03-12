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

from forgeos_sdk.models import (
    Claim,
    DelegationPayload,
    Evidence,
    ListResponse,
    OperationResult,
    Ticket,
)


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


class TestListResponseModel:
    """ListResponse model construction and validation."""

    def test_minimal_list_response(self) -> None:
        lr = ListResponse()
        assert lr.tickets == []
        assert lr.total == 0
        assert lr.limit == 50
        assert lr.offset == 0

    def test_list_response_with_tickets(self) -> None:
        lr = ListResponse(
            tickets=[
                Ticket(ticket_id="T-001", stage="BACKEND"),
                Ticket(ticket_id="T-002", stage="QA"),
            ],
            total=42,
            limit=10,
            offset=20,
        )
        assert len(lr.tickets) == 2
        assert lr.tickets[0].ticket_id == "T-001"
        assert lr.total == 42
        assert lr.limit == 10
        assert lr.offset == 20

    def test_list_response_from_dict(self) -> None:
        data = {
            "tickets": [
                {"ticket_id": "T-003", "status": "READY"},
                {"ticket_id": "T-004", "status": "CLAIMED"},
            ],
            "total": 2,
            "limit": 50,
            "offset": 0,
        }
        lr = ListResponse.model_validate(data)
        assert len(lr.tickets) == 2
        assert lr.tickets[1].status == "CLAIMED"

    def test_list_response_allows_extra_fields(self) -> None:
        lr = ListResponse(total=5, extra_field="value")
        assert lr.model_extra is not None
        assert lr.model_extra.get("extra_field") == "value"


class TestDelegationPayloadModel:
    """DelegationPayload model construction and validation."""

    def test_minimal_payload(self) -> None:
        ticket = Ticket(ticket_id="T-001", stage="BACKEND")
        payload = DelegationPayload(ticket=ticket)
        assert payload.ticket.ticket_id == "T-001"
        assert payload.upstream_summary == ""
        assert payload.memory_entries == []
        assert payload.file_scope == []

    def test_full_payload(self) -> None:
        ticket = Ticket(
            ticket_id="FORGEOS-BE003",
            title="Connection Pool",
            type="backend",
            priority="high",
            status="CLAIMED",
            stage="BACKEND",
        )
        payload = DelegationPayload(
            ticket=ticket,
            upstream_summary="## Architect summary\nDesign approved.",
            memory_entries=[
                {"key": "pool-pattern", "value": "Use pgBouncer"},
            ],
            file_scope=["src/db/pool.ts", "tests/db/pool.test.ts"],
        )
        assert payload.ticket.title == "Connection Pool"
        assert "Architect summary" in payload.upstream_summary
        assert len(payload.memory_entries) == 1
        assert len(payload.file_scope) == 2

    def test_payload_from_dict(self) -> None:
        data = {
            "ticket": {
                "ticket_id": "T-005",
                "title": "Test",
                "stage": "QA",
            },
            "upstream_summary": "All good",
            "memory_entries": [],
            "file_scope": ["src/main.py"],
        }
        payload = DelegationPayload.model_validate(data)
        assert payload.ticket.ticket_id == "T-005"
        assert payload.upstream_summary == "All good"
        assert payload.file_scope == ["src/main.py"]

    def test_payload_requires_ticket(self) -> None:
        with pytest.raises(ValidationError):
            DelegationPayload()  # type: ignore[call-arg]

    def test_payload_allows_extra_fields(self) -> None:
        ticket = Ticket(ticket_id="T-001")
        payload = DelegationPayload(ticket=ticket, agent_hints="use TDD")
        assert payload.model_extra is not None
        assert payload.model_extra.get("agent_hints") == "use TDD"
