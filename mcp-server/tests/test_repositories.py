"""Tests for the repository pattern data access layer.

Covers TicketRepository, ClaimRepository, EventRepository — 41 test cases.
Uses mock asyncpg pool via _make_mock_pool helper (same pattern as test_pool.py).
"""

from __future__ import annotations

import inspect
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from mcp_server.repositories import ClaimRepository, EventRepository, TicketRepository
from mcp_server.repositories.claim_repo import ClaimInfo
from mcp_server.repositories.event_repo import EventRow
from mcp_server.repositories.ticket_repo import TicketRow


# ---------------------------------------------------------------------------
# Helpers
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
    """Build a mock asyncpg pool with an async context-managed ``acquire``."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    conn.fetch = AsyncMock(return_value=fetch_return if fetch_return is not None else [])
    conn.execute = AsyncMock(return_value=execute_return)

    pool = MagicMock()

    @asynccontextmanager
    async def _acquire():
        yield conn

    pool.acquire = _acquire
    pool._conn = conn  # expose for assertions
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


# ---------------------------------------------------------------------------
# TicketRepository
# ---------------------------------------------------------------------------


class TestTicketRepository:
    """Tests for TicketRepository (13 cases)."""

    async def test_get_by_id_found(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        result = await repo.get_by_id("FORGEOS-TEST-001")
        assert result is not None
        assert isinstance(result, TicketRow)
        assert result.ticket_id == "FORGEOS-TEST-001"

    async def test_get_by_id_not_found(self) -> None:
        pool = _make_mock_pool(fetchrow_return=None)
        repo = TicketRepository(pool)
        result = await repo.get_by_id("NONEXISTENT")
        assert result is None

    async def test_get_by_id_parameterised(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.get_by_id("FORGEOS-TEST-001")
        pool._conn.fetchrow.assert_awaited_once()
        args = pool._conn.fetchrow.call_args
        assert "$1" in args[0][0]
        assert args[0][1] == "FORGEOS-TEST-001"

    async def test_list_by_stage_returns_list(self) -> None:
        pool = _make_mock_pool(fetch_return=[_ticket_record(), _ticket_record(ticket_id="T2")])
        repo = TicketRepository(pool)
        result = await repo.list_by_stage("BACKEND")
        assert len(result) == 2
        assert all(isinstance(r, TicketRow) for r in result)

    async def test_list_by_stage_empty(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        result = await repo.list_by_stage("QA")
        assert result == []

    async def test_list_by_stage_uses_enum_cast(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_stage("BACKEND", limit=10, offset=0)
        sql = pool._conn.fetch.call_args[0][0]
        assert "::ticket_stage" in sql

    async def test_list_by_type(self) -> None:
        pool = _make_mock_pool(fetch_return=[_ticket_record()])
        repo = TicketRepository(pool)
        result = await repo.list_by_type("backend")
        assert len(result) == 1

    async def test_list_by_type_uses_enum_cast(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = TicketRepository(pool)
        await repo.list_by_type("backend")
        sql = pool._conn.fetch.call_args[0][0]
        assert "::ticket_type" in sql

    async def test_create_returns_ticket(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        result = await repo.create(
            ticket_id="FORGEOS-TEST-001",
            title="Test",
            description="Desc",
            ticket_type="backend",
            priority="medium",
            stage="READY",
            sdlc_flow=["READY", "BACKEND"],
        )
        assert isinstance(result, TicketRow)

    async def test_create_uses_parameterised_insert(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record())
        repo = TicketRepository(pool)
        await repo.create(
            ticket_id="T", title="T", description="D",
            ticket_type="backend", priority="low", stage="READY",
            sdlc_flow=["READY"],
        )
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "INSERT INTO tickets" in sql
        assert "$1" in sql

    async def test_update_stage_found(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_ticket_record(stage="QA", status="IN_PROGRESS"))
        repo = TicketRepository(pool)
        result = await repo.update_stage("FORGEOS-TEST-001", "QA", "IN_PROGRESS")
        assert result is not None
        assert result.stage == "QA"

    async def test_update_stage_not_found(self) -> None:
        pool = _make_mock_pool(fetchrow_return=None)
        repo = TicketRepository(pool)
        result = await repo.update_stage("NONEXISTENT", "QA", "IN_PROGRESS")
        assert result is None

    async def test_count_by_stage(self) -> None:
        pool = _make_mock_pool(fetch_return=[
            _FakeRecord({"stage_name": "READY", "cnt": 5}),
            _FakeRecord({"stage_name": "BACKEND", "cnt": 3}),
        ])
        repo = TicketRepository(pool)
        result = await repo.count_by_stage()
        assert result == {"READY": 5, "BACKEND": 3}


# ---------------------------------------------------------------------------
# ClaimRepository
# ---------------------------------------------------------------------------


class TestClaimRepository:
    """Tests for ClaimRepository (8 cases)."""

    async def test_create_claim_success(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        result = await repo.create_claim(
            "FORGEOS-TEST-001", _UUID2, "Backend", "pop-os", "reaperoak",
        )
        assert result is not None
        assert isinstance(result, ClaimInfo)
        assert result.claimed_by_name == "Backend"

    async def test_create_claim_already_claimed(self) -> None:
        pool = _make_mock_pool(fetchrow_return=None)
        repo = ClaimRepository(pool)
        result = await repo.create_claim(
            "FORGEOS-TEST-001", _UUID2, "Backend", "pop-os", "reaperoak",
        )
        assert result is None

    async def test_create_claim_atomic_where(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        await repo.create_claim("T", _UUID2, "B", "m", "o")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "claimed_by IS NULL" in sql
        assert "status = 'READY'" in sql

    async def test_release_claim_success(self) -> None:
        pool = _make_mock_pool(execute_return="UPDATE 1")
        repo = ClaimRepository(pool)
        result = await repo.release_claim("FORGEOS-TEST-001")
        assert result is True

    async def test_release_claim_no_match(self) -> None:
        pool = _make_mock_pool(execute_return="UPDATE 0")
        repo = ClaimRepository(pool)
        result = await repo.release_claim("FORGEOS-TEST-001")
        assert result is False

    async def test_get_active_claim_found(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_claim_record())
        repo = ClaimRepository(pool)
        result = await repo.get_active_claim("FORGEOS-TEST-001")
        assert result is not None
        assert result.ticket_id == "FORGEOS-TEST-001"

    async def test_get_active_claim_expired(self) -> None:
        pool = _make_mock_pool(fetchrow_return=None)
        repo = ClaimRepository(pool)
        result = await repo.get_active_claim("FORGEOS-TEST-001")
        assert result is None

    async def test_list_expired_claims(self) -> None:
        pool = _make_mock_pool(fetch_return=[_claim_record(), _claim_record(ticket_id="T2")])
        repo = ClaimRepository(pool)
        result = await repo.list_expired_claims()
        assert len(result) == 2
        assert all(isinstance(c, ClaimInfo) for c in result)


# ---------------------------------------------------------------------------
# EventRepository
# ---------------------------------------------------------------------------


class TestEventRepository:
    """Tests for EventRepository (9 cases)."""

    async def test_append_event(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        result = await repo.append_event(
            ticket_id="FORGEOS-TEST-001",
            event_type="CLAIMED",
            agent_name="Backend",
        )
        assert isinstance(result, EventRow)
        assert result.event_type == "CLAIMED"

    async def test_append_event_uses_enum_cast(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        await repo.append_event(ticket_id="T", event_type="CLAIMED")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "::event_type" in sql

    async def test_append_event_parameterised(self) -> None:
        pool = _make_mock_pool(fetchrow_return=_event_record())
        repo = EventRepository(pool)
        await repo.append_event(ticket_id="T", event_type="CLAIMED")
        sql = pool._conn.fetchrow.call_args[0][0]
        assert "$1" in sql
        assert "INSERT INTO events" in sql

    async def test_get_events_by_ticket(self) -> None:
        pool = _make_mock_pool(fetch_return=[_event_record(), _event_record(event_type="RELEASED")])
        repo = EventRepository(pool)
        result = await repo.get_events_by_ticket("FORGEOS-TEST-001")
        assert len(result) == 2

    async def test_get_events_by_ticket_empty(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        result = await repo.get_events_by_ticket("NONEXISTENT")
        assert result == []

    async def test_get_events_by_agent(self) -> None:
        pool = _make_mock_pool(fetch_return=[_event_record()])
        repo = EventRepository(pool)
        result = await repo.get_events_by_agent("Backend")
        assert len(result) == 1

    async def test_get_events_by_agent_empty(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        result = await repo.get_events_by_agent("Nobody")
        assert result == []

    async def test_get_events_by_timerange(self) -> None:
        pool = _make_mock_pool(fetch_return=[_event_record()])
        repo = EventRepository(pool)
        since = datetime(2026, 1, 1, tzinfo=timezone.utc)
        until = datetime(2026, 12, 31, tzinfo=timezone.utc)
        result = await repo.get_events_by_timerange(since, until)
        assert len(result) == 1

    async def test_get_events_by_timerange_empty(self) -> None:
        pool = _make_mock_pool(fetch_return=[])
        repo = EventRepository(pool)
        since = datetime(2026, 1, 1, tzinfo=timezone.utc)
        until = datetime(2026, 1, 2, tzinfo=timezone.utc)
        result = await repo.get_events_by_timerange(since, until)
        assert result == []


# ---------------------------------------------------------------------------
# Cross-cutting concerns
# ---------------------------------------------------------------------------


class TestConstructorInjection:
    """Verify all repositories accept pool via constructor (3 cases)."""

    def test_ticket_repo_stores_pool(self) -> None:
        pool = MagicMock()
        repo = TicketRepository(pool)
        assert repo._pool is pool

    def test_claim_repo_stores_pool(self) -> None:
        pool = MagicMock()
        repo = ClaimRepository(pool)
        assert repo._pool is pool

    def test_event_repo_stores_pool(self) -> None:
        pool = MagicMock()
        repo = EventRepository(pool)
        assert repo._pool is pool


class TestTypeHintsAndDocstrings:
    """Verify type hints and docstrings exist (6 cases)."""

    def test_ticket_repo_has_type_hints(self) -> None:
        sig = inspect.signature(TicketRepository.get_by_id)
        assert sig.return_annotation is not inspect.Parameter.empty

    def test_claim_repo_has_type_hints(self) -> None:
        sig = inspect.signature(ClaimRepository.create_claim)
        assert sig.return_annotation is not inspect.Parameter.empty

    def test_event_repo_has_type_hints(self) -> None:
        sig = inspect.signature(EventRepository.append_event)
        assert sig.return_annotation is not inspect.Parameter.empty

    def test_ticket_repo_has_docstrings(self) -> None:
        assert TicketRepository.get_by_id.__doc__
        assert TicketRepository.list_by_stage.__doc__

    def test_claim_repo_has_docstrings(self) -> None:
        assert ClaimRepository.create_claim.__doc__
        assert ClaimRepository.release_claim.__doc__

    def test_event_repo_has_docstrings(self) -> None:
        assert EventRepository.append_event.__doc__
        assert EventRepository.get_events_by_ticket.__doc__


class TestPackageExports:
    """Verify __init__.py re-exports (1 case)."""

    def test_all_exports(self) -> None:
        from mcp_server import repositories
        assert hasattr(repositories, "TicketRepository")
        assert hasattr(repositories, "ClaimRepository")
        assert hasattr(repositories, "EventRepository")
