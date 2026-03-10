"""QA-augmented tests for repository pattern data access layer.

Targets mutation resistance, edge cases, boundary conditions, and
converter logic not covered by the existing test_repositories.py.
"""

from __future__ import annotations

import json
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from contextlib import asynccontextmanager
from uuid import UUID, uuid4

import pytest

from mcp_server.repositories import ClaimRepository, EventRepository, TicketRepository
from mcp_server.repositories.claim_repo import ClaimInfo, _row_to_claim
from mcp_server.repositories.event_repo import EventRow, _row_to_event
from mcp_server.repositories.ticket_repo import TicketRow, _row_to_ticket


# ---------------------------------------------------------------------------
# Helpers (shared with existing test file, kept DRY within this file)
# ---------------------------------------------------------------------------

class _FakeRecord(dict):
    """Dict subclass that supports attribute-style access like asyncpg.Record."""

    def __getitem__(self, key: str) -> Any:
        return super().__getitem__(key)


def _make_mock_pool(
    *,
    fetchrow_return: Any = None,
    fetch_return: Any = None,
    execute_return: str = "UPDATE 0",
) -> MagicMock:
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    conn.fetch = AsyncMock(return_value=fetch_return if fetch_return is not None else [])
    conn.execute = AsyncMock(return_value=execute_return)

    pool = MagicMock()

    @asynccontextmanager
    async def _acquire():
        yield conn

    pool.acquire = _acquire
    pool._conn = conn
    return pool


_NOW = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)
_UUID1 = UUID("00000000-0000-0000-0000-000000000001")
_UUID2 = UUID("00000000-0000-0000-0000-000000000002")


def _ticket_record(**overrides: Any) -> _FakeRecord:
    base: dict[str, Any] = {
        "id": _UUID1,
        "ticket_id": "FORGEOS-TEST-001",
        "project_id": None,
        "title": "Test ticket",
        "description": "A test ticket",
        "type": "backend",
        "priority": "medium",
        "status": "READY",
        "stage": "BACKEND",
        "sdlc_flow": ["READY", "BACKEND", "QA", "DONE"],
        "claimed_by": None,
        "claimed_by_name": None,
        "machine_id": None,
        "operator": None,
        "lease_expiry": None,
        "lease_duration_minutes": None,
        "depends_on": [],
        "file_paths": ["src/foo.py"],
        "acceptance_criteria": ["criterion 1"],
        "tags": ["backend"],
        "rework_count": 0,
        "max_reworks": 3,
        "metadata": {},
        "parent_id": None,
        "source_task_file": None,
        "created_at": _NOW,
        "updated_at": _NOW,
        "completed_at": None,
    }
    base.update(overrides)
    return _FakeRecord(base)


def _claim_record(**overrides: Any) -> _FakeRecord:
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-TEST-001",
        "claimed_by": _UUID2,
        "claimed_by_name": "Backend",
        "machine_id": "pop-os",
        "operator": "reaperoak",
        "lease_expiry": _NOW,
        "lease_duration_minutes": 30,
    }
    base.update(overrides)
    return _FakeRecord(base)


def _event_record(**overrides: Any) -> _FakeRecord:
    base: dict[str, Any] = {
        "id": _UUID1,
        "ticket_id": "FORGEOS-TEST-001",
        "event_type": "CLAIMED",
        "agent_id": _UUID2,
        "agent_name": "Backend",
        "machine_id": "pop-os",
        "operator": "reaperoak",
        "previous_stage": "READY",
        "new_stage": "BACKEND",
        "previous_status": "READY",
        "new_status": "CLAIMED",
        "payload": {"reason": "test"},
        "created_at": _NOW,
    }
    base.update(overrides)
    return _FakeRecord(base)


# =====================================================================
# Section 1: Row converter edge cases (None / empty array handling)
# =====================================================================


class TestRowConverterEdgeCases:
    """Verify _row_to_* converters handle None fields correctly."""

    def test_ticket_row_none_arrays_become_empty_lists(self) -> None:
        """Mutant killer: if converter skips None->[] conversion, this fails."""
        rec = _ticket_record(
            sdlc_flow=None,
            depends_on=None,
            file_paths=None,
            acceptance_criteria=None,
            tags=None,
        )
        row = _row_to_ticket(rec)
        assert row.sdlc_flow == []
        assert row.depends_on == []
        assert row.file_paths == []
        assert row.acceptance_criteria == []
        assert row.tags == []

    def test_ticket_row_none_metadata_becomes_empty_dict(self) -> None:
        rec = _ticket_record(metadata=None)
        row = _row_to_ticket(rec)
        assert row.metadata == {}

    def test_event_row_none_payload_becomes_empty_dict(self) -> None:
        rec = _event_record(payload=None)
        row = _row_to_event(rec)
        assert row.payload == {}

    def test_ticket_row_preserves_populated_arrays(self) -> None:
        rec = _ticket_record(
            sdlc_flow=["A", "B"],
            depends_on=["X"],
            file_paths=["f.py"],
            acceptance_criteria=["c1", "c2"],
            tags=["t1"],
        )
        row = _row_to_ticket(rec)
        assert row.sdlc_flow == ["A", "B"]
        assert row.depends_on == ["X"]
        assert row.file_paths == ["f.py"]
        assert row.acceptance_criteria == ["c1", "c2"]
        assert row.tags == ["t1"]

    def test_ticket_row_all_fields_mapped(self) -> None:
        """Verify every field in the dataclass is populated from the record."""
        rec = _ticket_record(
            project_id=_UUID2,
            parent_id=_UUID2,
            source_task_file="task.md",
            completed_at=_NOW,
            claimed_by=_UUID2,
            claimed_by_name="QA",
            machine_id="host",
            operator="op",
            lease_expiry=_NOW,
            lease_duration_minutes=30,
        )
        row = _row_to_ticket(rec)
        assert row.project_id == _UUID2
        assert row.parent_id == _UUID2
        assert row.source_task_file == "task.md"
        assert row.completed_at == _NOW
        assert row.claimed_by == _UUID2
        assert row.claimed_by_name == "QA"
        assert row.machine_id == "host"
        assert row.operator == "op"
        assert row.lease_expiry == _NOW
        assert row.lease_duration_minutes == 30

    def test_event_row_optional_fields_none(self) -> None:
        rec = _event_record(
            agent_id=None,
            agent_name=None,
            machine_id=None,
            operator=None,
            previous_stage=None,
            new_stage=None,
            previous_status=None,
            new_status=None,
        )
        row = _row_to_event(rec)
        assert row.agent_id is None
        assert row.agent_name is None
        assert row.machine_id is None
        assert row.operator is None
        assert row.previous_stage is None
        assert row.new_stage is None

    def test_claim_row_all_fields_mapped(self) -> None:
        rec = _claim_record()
        row = _row_to_claim(rec)
        assert row.ticket_id == "FORGEOS-TEST-001"
        assert row.claimed_by == _UUID2
        assert row.claimed_by_name == "Backend"
        assert row.machine_id == "pop-os"
        assert row.operator == "reaperoak"
        assert row.lease_expiry == _NOW
        assert row.lease_duration_minutes == 30


# =====================================================================
# Section 2: Frozen dataclass immutability
# =====================================================================


class TestDataclassImmutability:
    """Verify frozen=True prevents mutation of returned data."""

    def test_ticket_row_is_frozen(self) -> None:
        row = _row_to_ticket(_ticket_record())
        with pytest.raises(FrozenInstanceError):
            row.title = "mutated"  # type: ignore[misc]

    def test_claim_info_is_frozen(self) -> None:
        row = _row_to_claim(_claim_record())
        with pytest.raises(FrozenInstanceError):
            row.operator = "hacked"  # type: ignore[misc]

    def test_event_row_is_frozen(self) -> None:
        row = _row_to_event(_event_record())
        with pytest.raises(FrozenInstanceError):
            row.event_type = "mutated"  # type: ignore[misc]


# =====================================================================
# Section 3: Pagination parameter verification
# =====================================================================


class TestPaginationParams:
    """Verify limit/offset parameters are forwarded correctly to SQL."""

    async def test_list_by_stage_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_stage("BACKEND", limit=25, offset=10)
        args = pool._conn.fetch.call_args[0]
        assert args[1] == "BACKEND"
        assert args[2] == 25  # limit
        assert args[3] == 10  # offset

    async def test_list_by_stage_default_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_stage("QA")
        args = pool._conn.fetch.call_args[0]
        assert args[2] == 50  # default limit
        assert args[3] == 0   # default offset

    async def test_list_by_type_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_type("frontend", limit=5, offset=20)
        args = pool._conn.fetch.call_args[0]
        assert args[1] == "frontend"
        assert args[2] == 5
        assert args[3] == 20

    async def test_get_events_by_ticket_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        await repo.get_events_by_ticket("T1", limit=10, offset=5)
        args = pool._conn.fetch.call_args[0]
        assert args[1] == "T1"
        assert args[2] == 10
        assert args[3] == 5

    async def test_get_events_by_agent_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        await repo.get_events_by_agent("QA", limit=20, offset=3)
        args = pool._conn.fetch.call_args[0]
        assert args[1] == "QA"
        assert args[2] == 20
        assert args[3] == 3

    async def test_get_events_by_timerange_pagination(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        since = datetime(2026, 1, 1, tzinfo=timezone.utc)
        until = datetime(2026, 12, 31, tzinfo=timezone.utc)
        await repo.get_events_by_timerange(since, until, limit=15, offset=2)
        args = pool._conn.fetch.call_args[0]
        assert args[1] == since
        assert args[2] == until
        assert args[3] == 15
        assert args[4] == 2


# =====================================================================
# Section 4: SQL WHERE clause verification (mutation killers)
# =====================================================================


class TestSQLWhereClauseVerification:
    """Ensure critical SQL WHERE conditions cannot be mutated away."""

    async def test_release_claim_requires_claimed_by_not_null(self) -> None:
        pool = _make_mock_pool(execute_return="UPDATE 0")
        repo = ClaimRepository(pool)
        await repo.release_claim("T1")
        sql = pool._conn.execute.call_args[0][0]
        assert "claimed_by IS NOT NULL" in sql

    async def test_get_active_claim_requires_lease_not_expired(self) -> None:
        pool = _make_mock_pool(fetchrow_return=None)
        repo = ClaimRepository(pool)
        await repo.get_active_claim("T1")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "lease_expiry > NOW()" in sql

    async def test_list_expired_claims_requires_lease_expired(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = ClaimRepository(pool)
        await repo.list_expired_claims()
        sql = pool._conn.fetch.call_args[0][0]
        assert "lease_expiry < NOW()" in sql
        assert "claimed_by IS NOT NULL" in sql

    async def test_update_stage_uses_returning(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.update_stage("T1", "QA", "IN_PROGRESS")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "RETURNING" in sql
        assert "UPDATE tickets" in sql

    async def test_update_stage_params_order(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.update_stage("T1", "QA", "IN_PROGRESS")
        args = pool._conn.fetchrow.call_args[0]
        assert args[1] == "T1"      # ticket_id
        assert args[2] == "QA"      # new_stage
        assert args[3] == "IN_PROGRESS"  # new_status

    async def test_count_by_stage_groups_by_stage(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        result = await repo.count_by_stage()
        sql = pool._conn.fetch.call_args[0][0]
        assert "GROUP BY" in sql
        assert result == {}

    async def test_list_by_stage_has_priority_ordering(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_stage("BACKEND")
        sql = pool._conn.fetch.call_args[0][0]
        assert "CASE priority" in sql
        assert "'critical'" in sql
        assert "'low'" in sql

    async def test_events_by_ticket_ordered_desc(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        await repo.get_events_by_ticket("T1")
        sql = pool._conn.fetch.call_args[0][0]
        assert "ORDER BY created_at DESC" in sql

    async def test_events_by_agent_ordered_desc(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        await repo.get_events_by_agent("Backend")
        sql = pool._conn.fetch.call_args[0][0]
        assert "ORDER BY created_at DESC" in sql

    async def test_events_by_timerange_ordered_desc(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        since = datetime(2026, 1, 1, tzinfo=timezone.utc)
        until = datetime(2026, 12, 31, tzinfo=timezone.utc)
        await repo.get_events_by_timerange(since, until)
        sql = pool._conn.fetch.call_args[0][0]
        assert "ORDER BY created_at DESC" in sql


# =====================================================================
# Section 5: Create method optional parameter handling
# =====================================================================


class TestCreateMethodOptionalParams:
    """Verify TicketRepository.create() handles optional params + json.dumps."""

    async def test_create_with_all_optional_params(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.create(
            ticket_id="T1",
            title="Title",
            description="Desc",
            ticket_type="backend",
            priority="high",
            stage="READY",
            sdlc_flow=["READY", "BACKEND"],
            depends_on=["X1", "X2"],
            file_paths=["a.py", "b.py"],
            acceptance_criteria=["c1"],
            tags=["tag1"],
            source_task_file="task.md",
            metadata={"key": "value"},
            parent_id=_UUID1,
        )
        args = pool._conn.fetchrow.call_args[0]
        assert args[8] == ["X1", "X2"]       # depends_on
        assert args[9] == ["a.py", "b.py"]   # file_paths
        assert args[10] == ["c1"]             # acceptance_criteria
        assert args[11] == ["tag1"]           # tags
        assert args[12] == "task.md"          # source_task_file
        assert args[13] == '{"key": "value"}' # metadata json.dumps'd
        assert args[14] == _UUID1             # parent_id

    async def test_create_defaults_none_to_empty(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.create(
            ticket_id="T1",
            title="T",
            description="D",
            ticket_type="backend",
            priority="low",
            stage="READY",
            sdlc_flow=["READY"],
        )
        args = pool._conn.fetchrow.call_args[0]
        assert args[8] == []   # depends_on default
        assert args[9] == []   # file_paths default
        assert args[10] == []  # acceptance_criteria default
        assert args[11] == []  # tags default
        assert args[13] == "{}" # metadata default json

    async def test_create_sql_has_jsonb_cast(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.create(
            ticket_id="T1", title="T", description="D",
            ticket_type="backend", priority="low", stage="READY",
            sdlc_flow=["READY"],
        )
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "::jsonb" in sql


# =====================================================================
# Section 6: Append event optional parameters + json.dumps
# =====================================================================


class TestAppendEventOptionalParams:
    """Verify EventRepository.append_event() handles all optional params."""

    async def test_append_event_with_all_params(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        payload = {"detail": "info"}
        await repo.append_event(
            ticket_id="T1",
            event_type="STAGE_ADVANCED",
            agent_id=_UUID2,
            agent_name="Backend",
            machine_id="pop-os",
            operator="reaperoak",
            previous_stage="READY",
            new_stage="BACKEND",
            previous_status="READY",
            new_status="CLAIMED",
            payload=payload,
        )
        args = pool._conn.fetchrow.call_args[0]
        assert args[1] == "T1"
        assert args[2] == "STAGE_ADVANCED"
        assert args[11] == json.dumps(payload)

    async def test_append_event_defaults_payload_to_empty_json(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        await repo.append_event(ticket_id="T1", event_type="CLAIMED")
        args = pool._conn.fetchrow.call_args[0]
        assert args[11] == "{}"

    async def test_append_event_sql_has_jsonb_cast(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        await repo.append_event(ticket_id="T1", event_type="CLAIMED")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "$11::jsonb" in sql

    async def test_append_event_has_enum_cast_for_stages(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        await repo.append_event(ticket_id="T1", event_type="CLAIMED")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "::ticket_stage" in sql
        assert "::ticket_status" in sql
        assert "::event_type" in sql


# =====================================================================
# Section 7: Create claim parameter forwarding
# =====================================================================


class TestClaimParamForwarding:
    """Verify ClaimRepository.create_claim() passes all params to SQL."""

    async def test_create_claim_params_order(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        await repo.create_claim("T1", _UUID2, "QA", "myhost", "myop", 45)
        args = pool._conn.fetchrow.call_args[0]
        assert args[1] == "T1"      # ticket_id
        assert args[2] == _UUID2     # agent_id
        assert args[3] == "QA"       # agent_name
        assert args[4] == "myhost"   # machine_id
        assert args[5] == "myop"     # operator
        assert args[6] == 45         # lease_duration_minutes

    async def test_create_claim_default_lease_duration(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        await repo.create_claim("T1", _UUID2, "QA", "host", "op")
        args = pool._conn.fetchrow.call_args[0]
        assert args[6] == 30  # default lease_duration_minutes

    async def test_create_claim_sets_status_claimed(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        await repo.create_claim("T1", _UUID2, "QA", "host", "op")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "'CLAIMED'" in sql

    async def test_release_claim_sets_status_ready(self) -> None:
        pool = _make_mock_pool(execute_return="UPDATE 1")
        repo = ClaimRepository(pool)
        await repo.release_claim("T1")
        sql = pool._conn.execute.call_args[0][0]
        assert "'READY'" in sql

    async def test_release_claim_clears_all_claim_fields(self) -> None:
        pool = _make_mock_pool(execute_return="UPDATE 1")
        repo = ClaimRepository(pool)
        await repo.release_claim("T1")
        sql = pool._conn.execute.call_args[0][0]
        assert "claimed_by = NULL" in sql
        assert "claimed_by_name = NULL" in sql
        assert "machine_id = NULL" in sql
        assert "operator = NULL" in sql
        assert "lease_expiry = NULL" in sql
        assert "lease_duration_minutes = NULL" in sql


# =====================================================================
# Section 8: Metadata/Payload pass-through via repository (mutant killers)
# =====================================================================


class TestMetadataPayloadPassthrough:
    """Ensure metadata/payload values survive through repo → converter chain."""

    async def test_get_by_id_preserves_metadata(self) -> None:
        """Kill mutant: metadata=row['metadata'] if row['metadata'] else {} → {}"""
        meta = {"key": "value", "nested": {"a": 1}}
        pool = _make_mock_pool(fetchrow_return=_ticket_record(metadata=meta))
        repo = TicketRepository(pool)
        result = await repo.get_by_id("T1")
        assert result is not None
        assert result.metadata == meta
        assert result.metadata["key"] == "value"
        assert result.metadata["nested"]["a"] == 1

    async def test_list_by_stage_preserves_metadata(self) -> None:
        meta = {"env": "prod"}
        pool = _make_mock_pool(fetch_return=[_ticket_record(metadata=meta)])
        repo = TicketRepository(pool)
        results = await repo.list_by_stage("BACKEND")
        assert results[0].metadata == meta

    async def test_append_event_preserves_payload(self) -> None:
        """Kill mutant: payload=row['payload'] if row['payload'] else {} → {}"""
        payload = {"detail": "important", "count": 42}
        pool = _make_mock_pool(fetchrow_return=_event_record(payload=payload))
        repo = EventRepository(pool)
        result = await repo.append_event(ticket_id="T1", event_type="CLAIMED")
        assert result.payload == payload
        assert result.payload["detail"] == "important"
        assert result.payload["count"] == 42

    async def test_get_events_by_ticket_preserves_payload(self) -> None:
        payload = {"action": "test"}
        pool = _make_mock_pool(fetch_return=[_event_record(payload=payload)])
        repo = EventRepository(pool)
        results = await repo.get_events_by_ticket("T1")
        assert results[0].payload == payload
