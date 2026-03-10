"""Tests for the ticket claim queue (FORGEOS-BE006).

Covers:
- AgentRoleMap: role-to-stage and role-to-type mappings
- ClaimResult: value object integrity
- ClaimQueue.claim_next: happy path, no-ticket, database error
- ClaimQueue.claim_by_id: happy path, not claimable, file conflict
- ClaimQueue.claim_for_role: role resolution, unknown role
- Concurrency: SKIP LOCKED semantics via mock
- _row_to_claim_result: record-to-dataclass mapping

.. meta::
   :ticket: FORGEOS-BE006
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.locking.claim_queue import (
    AgentRoleMap,
    ClaimError,
    ClaimQueue,
    ClaimResult,
    LeaseExpiredError,
    NoEligibleTicketError,
    _row_to_claim_result,
)
from mcp_server.server import DatabaseError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_AGENT_ID = str(uuid.uuid4())
_MACHINE_ID = "test-host"
_AGENT_NAME = "Backend"
_OPERATOR = "TestOperator"


def _make_ticket_row(
    *,
    ticket_id: str = "TEST-001",
    title: str = "Test ticket",
    ticket_type: str = "backend",
    priority: str = "medium",
    stage: str = "BACKEND",
    status: str = "CLAIMED",
    claimed_by: uuid.UUID | None = None,
    claimed_by_name: str = "Backend",
    machine_id: str = "test-host",
    lease_expiry: datetime | None = None,
) -> dict[str, Any]:
    """Create a mock asyncpg Record-like dict."""
    if claimed_by is None:
        claimed_by = uuid.UUID(_AGENT_ID)
    if lease_expiry is None:
        lease_expiry = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)
    return {
        "id": uuid.uuid4(),
        "ticket_id": ticket_id,
        "title": title,
        "type": ticket_type,
        "priority": priority,
        "stage": stage,
        "status": status,
        "claimed_by": claimed_by,
        "claimed_by_name": claimed_by_name,
        "machine_id": machine_id,
        "lease_expiry": lease_expiry,
        "file_paths": ["src/foo.py", "src/bar.py"],
        "acceptance_criteria": ["AC1", "AC2"],
        "depends_on": ["DEP-001"],
        "metadata": {"source": "test"},
    }


class FakeConnection:
    """Mock asyncpg connection with configurable fetchrow."""

    def __init__(self, fetchrow_result: Any = None, side_effect: Exception | None = None) -> None:
        self._result = fetchrow_result
        self._side_effect = side_effect

    async def fetchrow(self, query: str, *args: Any) -> Any:
        if self._side_effect:
            raise self._side_effect
        return self._result


class FakePool:
    """Mock connection pool that yields a FakeConnection."""

    def __init__(self, connection: FakeConnection) -> None:
        self._conn = connection

    @asynccontextmanager
    async def acquire(self):  # type: ignore[override]
        yield self._conn


# ---------------------------------------------------------------------------
# AgentRoleMap tests
# ---------------------------------------------------------------------------


class TestAgentRoleMap:
    """Tests for the AgentRoleMap utility class."""

    def test_stage_for_role_backend(self) -> None:
        assert AgentRoleMap.stage_for_role("backend") == "BACKEND"

    def test_stage_for_role_qa(self) -> None:
        assert AgentRoleMap.stage_for_role("qa") == "QA"

    def test_stage_for_role_case_insensitive(self) -> None:
        assert AgentRoleMap.stage_for_role("BACKEND") == "BACKEND"
        assert AgentRoleMap.stage_for_role("Backend") == "BACKEND"

    def test_stage_for_role_unknown(self) -> None:
        assert AgentRoleMap.stage_for_role("nonexistent") is None

    def test_stage_for_role_all_known_roles(self) -> None:
        known_roles = [
            "architect", "research", "product_manager", "ui_designer",
            "backend", "devops", "frontend", "qa", "security",
            "ci", "documentation", "validator",
        ]
        for role in known_roles:
            assert AgentRoleMap.stage_for_role(role) is not None, (
                f"Role {role!r} should have a stage mapping"
            )

    def test_ticket_types_for_role_backend(self) -> None:
        types = AgentRoleMap.ticket_types_for_role("backend")
        assert "backend" in types
        assert "fullstack" in types
        assert "infra" in types

    def test_ticket_types_for_role_frontend(self) -> None:
        types = AgentRoleMap.ticket_types_for_role("frontend")
        assert "frontend" in types
        assert "fullstack" in types

    def test_ticket_types_for_role_unknown(self) -> None:
        assert AgentRoleMap.ticket_types_for_role("unknown") == []

    def test_is_compatible_true(self) -> None:
        assert AgentRoleMap.is_compatible("backend", "backend") is True
        assert AgentRoleMap.is_compatible("backend", "infra") is True

    def test_is_compatible_false(self) -> None:
        assert AgentRoleMap.is_compatible("backend", "frontend") is False

    def test_is_compatible_unknown_role(self) -> None:
        assert AgentRoleMap.is_compatible("unknown", "backend") is False

    def test_documentation_covers_all_types(self) -> None:
        """Documentation and Validator roles should cover all ticket types."""
        all_types = {
            "backend", "frontend", "fullstack", "infra", "security",
            "docs", "research", "architecture", "product", "design",
        }
        doc_types = set(AgentRoleMap.ticket_types_for_role("documentation"))
        val_types = set(AgentRoleMap.ticket_types_for_role("validator"))
        assert all_types == doc_types
        assert all_types == val_types


# ---------------------------------------------------------------------------
# ClaimResult tests
# ---------------------------------------------------------------------------


class TestClaimResult:
    """Tests for the ClaimResult frozen dataclass."""

    def test_immutable(self) -> None:
        result = ClaimResult(
            id="abc",
            ticket_id="TEST-001",
            title="Test",
            ticket_type="backend",
            priority="medium",
            stage="BACKEND",
            status="CLAIMED",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=datetime.now(timezone.utc),
        )
        with pytest.raises(AttributeError):
            result.ticket_id = "changed"  # type: ignore[misc]

    def test_defaults(self) -> None:
        result = ClaimResult(
            id="abc",
            ticket_id="TEST-001",
            title="Test",
            ticket_type="backend",
            priority="medium",
            stage="BACKEND",
            status="CLAIMED",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=datetime.now(timezone.utc),
        )
        assert result.file_paths == []
        assert result.acceptance_criteria == []
        assert result.depends_on == []
        assert result.metadata == {}


# ---------------------------------------------------------------------------
# _row_to_claim_result tests
# ---------------------------------------------------------------------------


class TestRowToClaimResult:
    """Tests for the record-to-dataclass mapping function."""

    def test_maps_all_fields(self) -> None:
        row = _make_ticket_row()
        result = _row_to_claim_result(row)
        assert result.ticket_id == "TEST-001"
        assert result.title == "Test ticket"
        assert result.ticket_type == "backend"
        assert result.priority == "medium"
        assert result.stage == "BACKEND"
        assert result.status == "CLAIMED"
        assert result.agent_name == "Backend"
        assert result.machine_id == "test-host"
        assert result.file_paths == ["src/foo.py", "src/bar.py"]
        assert result.acceptance_criteria == ["AC1", "AC2"]
        assert result.depends_on == ["DEP-001"]
        assert result.metadata == {"source": "test"}

    def test_handles_none_arrays(self) -> None:
        row = _make_ticket_row()
        row["file_paths"] = None
        row["acceptance_criteria"] = None
        row["depends_on"] = None
        row["metadata"] = None
        result = _row_to_claim_result(row)
        assert result.file_paths == []
        assert result.acceptance_criteria == []
        assert result.depends_on == []
        assert result.metadata == {}

    def test_handles_none_strings(self) -> None:
        row = _make_ticket_row()
        row["claimed_by_name"] = None
        row["machine_id"] = None
        result = _row_to_claim_result(row)
        assert result.agent_name == ""
        assert result.machine_id == ""


# ---------------------------------------------------------------------------
# ClaimQueue.claim_next tests
# ---------------------------------------------------------------------------


class TestClaimNext:
    """Tests for ClaimQueue.claim_next()."""

    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        """claim_next returns a ClaimResult when a ticket is available."""
        row = _make_ticket_row()
        pool = FakePool(FakeConnection(fetchrow_result=row))
        queue = ClaimQueue(pool)

        result = await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
        )

        assert result is not None
        assert result.ticket_id == "TEST-001"
        assert result.status == "CLAIMED"

    @pytest.mark.asyncio
    async def test_no_ticket_available(self) -> None:
        """claim_next returns None when no eligible ticket exists."""
        pool = FakePool(FakeConnection(fetchrow_result=None))
        queue = ClaimQueue(pool)

        result = await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_database_error(self) -> None:
        """claim_next raises DatabaseError on connection failure."""
        pool = FakePool(
            FakeConnection(side_effect=ConnectionError("DB down"))
        )
        queue = ClaimQueue(pool)

        with pytest.raises(DatabaseError, match="Failed to claim ticket"):
            await queue.claim_next(
                stage="BACKEND",
                agent_id=_AGENT_ID,
                agent_name=_AGENT_NAME,
                machine_id=_MACHINE_ID,
            )

    @pytest.mark.asyncio
    async def test_custom_lease_minutes(self) -> None:
        """claim_next passes lease_minutes to the stored function."""
        conn = FakeConnection(fetchrow_result=_make_ticket_row())
        pool = FakePool(conn)
        queue = ClaimQueue(pool)

        # Spy on fetchrow to verify arguments
        original_fetchrow = conn.fetchrow
        call_args: list[tuple[Any, ...]] = []

        async def spy_fetchrow(query: str, *args: Any) -> Any:
            call_args.append(args)
            return await original_fetchrow(query, *args)

        conn.fetchrow = spy_fetchrow  # type: ignore[assignment]

        await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
            lease_minutes=60,
        )

        assert len(call_args) == 1
        assert call_args[0][5] == 60  # lease_minutes is the 6th arg

    @pytest.mark.asyncio
    async def test_operator_passed(self) -> None:
        """claim_next passes operator to the stored function."""
        conn = FakeConnection(fetchrow_result=_make_ticket_row())
        pool = FakePool(conn)
        queue = ClaimQueue(pool)

        call_args: list[tuple[Any, ...]] = []
        original = conn.fetchrow

        async def spy(query: str, *args: Any) -> Any:
            call_args.append(args)
            return await original(query, *args)

        conn.fetchrow = spy  # type: ignore[assignment]

        await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
            operator="MyOperator",
        )

        assert call_args[0][4] == "MyOperator"


# ---------------------------------------------------------------------------
# ClaimQueue.claim_by_id tests
# ---------------------------------------------------------------------------


class TestClaimById:
    """Tests for ClaimQueue.claim_by_id()."""

    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        """claim_by_id returns a ClaimResult for a claimable ticket."""
        row = _make_ticket_row(ticket_id="FORGEOS-BE006")
        pool = FakePool(FakeConnection(fetchrow_result=row))
        queue = ClaimQueue(pool)

        result = await queue.claim_by_id(
            ticket_id="FORGEOS-BE006",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
        )

        assert result is not None
        assert result.ticket_id == "FORGEOS-BE006"

    @pytest.mark.asyncio
    async def test_not_claimable(self) -> None:
        """claim_by_id returns None when the ticket is not claimable."""
        pool = FakePool(FakeConnection(fetchrow_result=None))
        queue = ClaimQueue(pool)

        result = await queue.claim_by_id(
            ticket_id="FORGEOS-BE006",
            agent_id=_AGENT_ID,
            agent_name=_AGENT_NAME,
            machine_id=_MACHINE_ID,
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_file_conflict(self) -> None:
        """claim_by_id raises ClaimError on file lock conflict."""
        pool = FakePool(
            FakeConnection(
                side_effect=Exception(
                    "FILE_CONFLICT: One or more files in file_paths are locked"
                )
            )
        )
        queue = ClaimQueue(pool)

        with pytest.raises(ClaimError, match="File conflict"):
            await queue.claim_by_id(
                ticket_id="FORGEOS-BE006",
                agent_id=_AGENT_ID,
                agent_name=_AGENT_NAME,
                machine_id=_MACHINE_ID,
            )

    @pytest.mark.asyncio
    async def test_database_error(self) -> None:
        """claim_by_id raises DatabaseError on non-conflict DB failure."""
        pool = FakePool(
            FakeConnection(side_effect=RuntimeError("connection lost"))
        )
        queue = ClaimQueue(pool)

        with pytest.raises(DatabaseError, match="Failed to claim ticket"):
            await queue.claim_by_id(
                ticket_id="FORGEOS-BE006",
                agent_id=_AGENT_ID,
                agent_name=_AGENT_NAME,
                machine_id=_MACHINE_ID,
            )


# ---------------------------------------------------------------------------
# ClaimQueue.claim_for_role tests
# ---------------------------------------------------------------------------


class TestClaimForRole:
    """Tests for ClaimQueue.claim_for_role()."""

    @pytest.mark.asyncio
    async def test_resolves_role_to_stage(self) -> None:
        """claim_for_role maps role to stage and delegates to claim_next."""
        row = _make_ticket_row(stage="QA")
        pool = FakePool(FakeConnection(fetchrow_result=row))
        queue = ClaimQueue(pool)

        result = await queue.claim_for_role(
            role="qa",
            agent_id=_AGENT_ID,
            agent_name="QA",
            machine_id=_MACHINE_ID,
        )

        assert result is not None
        assert result.stage == "QA"

    @pytest.mark.asyncio
    async def test_unknown_role_raises(self) -> None:
        """claim_for_role raises ClaimError for an unknown role."""
        pool = FakePool(FakeConnection())
        queue = ClaimQueue(pool)

        with pytest.raises(ClaimError, match="Unknown agent role"):
            await queue.claim_for_role(
                role="nonexistent",
                agent_id=_AGENT_ID,
                agent_name="Unknown",
                machine_id=_MACHINE_ID,
            )

    @pytest.mark.asyncio
    async def test_no_ticket_for_role(self) -> None:
        """claim_for_role returns None when no tickets match the role's stage."""
        pool = FakePool(FakeConnection(fetchrow_result=None))
        queue = ClaimQueue(pool)

        result = await queue.claim_for_role(
            role="frontend",
            agent_id=_AGENT_ID,
            agent_name="Frontend",
            machine_id=_MACHINE_ID,
        )

        assert result is None

    @pytest.mark.asyncio
    async def test_devops_maps_to_backend(self) -> None:
        """DevOps role should map to BACKEND stage."""
        row = _make_ticket_row(stage="BACKEND")
        conn = FakeConnection(fetchrow_result=row)
        pool = FakePool(conn)
        queue = ClaimQueue(pool)

        call_args: list[tuple[Any, ...]] = []
        original = conn.fetchrow

        async def spy(query: str, *args: Any) -> Any:
            call_args.append(args)
            return await original(query, *args)

        conn.fetchrow = spy  # type: ignore[assignment]

        await queue.claim_for_role(
            role="devops",
            agent_id=_AGENT_ID,
            agent_name="DevOps",
            machine_id=_MACHINE_ID,
        )

        # First argument to claim_ticket is the stage
        assert call_args[0][0] == "BACKEND"


# ---------------------------------------------------------------------------
# Error hierarchy tests
# ---------------------------------------------------------------------------


class TestErrorHierarchy:
    """Tests for the claim error hierarchy."""

    def test_claim_error_is_forgeos_error(self) -> None:
        from mcp_server.server import ForgeOSError
        assert issubclass(ClaimError, ForgeOSError)

    def test_no_eligible_ticket_is_claim_error(self) -> None:
        assert issubclass(NoEligibleTicketError, ClaimError)

    def test_lease_expired_is_claim_error(self) -> None:
        assert issubclass(LeaseExpiredError, ClaimError)

    def test_claim_error_status_code(self) -> None:
        assert ClaimError.status_code == 409

    def test_no_eligible_ticket_status_code(self) -> None:
        assert NoEligibleTicketError.status_code == 404

    def test_lease_expired_status_code(self) -> None:
        assert LeaseExpiredError.status_code == 410

    def test_claim_error_with_details(self) -> None:
        err = ClaimError("test error", details={"key": "value"})
        assert err.message == "test error"
        assert err.details == {"key": "value"}


# ---------------------------------------------------------------------------
# Concurrency simulation tests
# ---------------------------------------------------------------------------


class TestConcurrencySemantics:
    """Tests simulating SKIP LOCKED concurrency behavior."""

    @pytest.mark.asyncio
    async def test_concurrent_claims_one_wins(self) -> None:
        """When two agents try to claim, only one gets the ticket.

        The SKIP LOCKED semantics mean the second agent gets None
        (the row is already locked by the first transaction).
        """
        row = _make_ticket_row()
        claim_count = 0

        class ConcurrentConn:
            async def fetchrow(self, query: str, *args: Any) -> Any:
                nonlocal claim_count
                claim_count += 1
                if claim_count == 1:
                    return row  # First caller wins
                return None  # Second caller skips locked row

        class ConcurrentPool:
            @asynccontextmanager
            async def acquire(self):  # type: ignore[override]
                yield ConcurrentConn()

        queue = ClaimQueue(ConcurrentPool())

        # First claim succeeds
        result1 = await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name="Agent1",
            machine_id="host1",
        )
        assert result1 is not None

        # Second claim is transparently skipped
        result2 = await queue.claim_next(
            stage="BACKEND",
            agent_id=str(uuid.uuid4()),
            agent_name="Agent2",
            machine_id="host2",
        )
        assert result2 is None

    @pytest.mark.asyncio
    async def test_skip_locked_no_blocking(self) -> None:
        """SKIP LOCKED never blocks — verify no deadlock simulation."""
        # If all tickets are locked, the function returns None immediately
        pool = FakePool(FakeConnection(fetchrow_result=None))
        queue = ClaimQueue(pool)

        # This should return immediately, not block
        result = await queue.claim_next(
            stage="BACKEND",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
        )
        assert result is None


# ---------------------------------------------------------------------------
# Package import tests
# ---------------------------------------------------------------------------


class TestPackageImports:
    """Tests that the locking package re-exports correctly."""

    def test_import_from_package(self) -> None:
        from mcp_server.locking import (
            AgentRoleMap,
            ClaimError,
            ClaimQueue,
            ClaimResult,
            LeaseExpiredError,
            NoEligibleTicketError,
        )
        assert ClaimQueue is not None
        assert ClaimResult is not None
        assert AgentRoleMap is not None
        assert ClaimError is not None
        assert NoEligibleTicketError is not None
        assert LeaseExpiredError is not None
