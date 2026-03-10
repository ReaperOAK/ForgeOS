"""Tests for FORGEOS-BE033: tickets.sync and tickets.validate MCP tools.

Covers all 8 acceptance criteria:
  AC1: tickets.sync tool registered and callable
  AC2: Sync releases all expired leases
  AC3: Sync evaluates dependency graph for all non-DONE tickets
  AC4: Tickets with all dependencies in DONE are moved to READY
  AC5: Sync returns a summary of changes made
  AC6: tickets.validate tool registered and callable
  AC7: Validate checks stage integrity, stage field matches, SDLC flow validity
  AC8: Validate returns a list of integrity errors (empty = clean)

.. meta::
   :ticket: FORGEOS-BE033
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.services.sync_engine import (
    SDLC_FLOWS,
    VALID_STAGES,
    IntegrityError,
    SyncEngine,
    SyncResult,
    ValidateResult,
)
from mcp_server.tools.ticket_tools import (
    SYNC_TOOL_NAME,
    TICKETS_SYNC_SCHEMA,
    TICKETS_VALIDATE_SCHEMA,
    VALIDATE_TOOL_NAME,
    handle_tickets_sync,
    handle_tickets_validate,
    register_ticket_tools,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_pool() -> MagicMock:
    """Create a mock pool with async context manager on acquire."""
    pool = MagicMock()
    conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire.return_value = ctx
    return pool


def _mock_ticket_service(
    sync_result: SyncResult | None = None,
    validate_result: ValidateResult | None = None,
) -> MagicMock:
    """Create a mock TicketService with sync/validate methods."""
    svc = MagicMock()
    if sync_result is not None:
        svc.sync = AsyncMock(return_value=sync_result)
    else:
        svc.sync = AsyncMock(return_value=SyncResult())
    if validate_result is not None:
        svc.validate = AsyncMock(return_value=validate_result)
    else:
        svc.validate = AsyncMock(return_value=ValidateResult())
    return svc


# ===================================================================
# AC1: tickets.sync tool registered and callable
# ===================================================================


class TestSyncToolRegistration:
    """AC1: ``tickets.sync`` MCP tool registered and callable."""

    def test_tool_name_constant(self) -> None:
        assert SYNC_TOOL_NAME == "tickets.sync"

    def test_schema_is_valid_json_schema(self) -> None:
        assert TICKETS_SYNC_SCHEMA["type"] == "object"
        assert TICKETS_SYNC_SCHEMA["additionalProperties"] is False

    def test_register_includes_sync(self) -> None:
        registry = MagicMock()
        svc = _mock_ticket_service()
        register_ticket_tools(registry, svc)
        names = [call.kwargs["name"] for call in registry.register.call_args_list]
        assert "tickets.sync" in names

    @pytest.mark.asyncio
    async def test_handler_callable(self) -> None:
        svc = _mock_ticket_service()
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert isinstance(result, dict)
        svc.sync.assert_awaited_once()


# ===================================================================
# AC2: Sync releases all expired leases
# ===================================================================


class TestSyncReleasesExpiredLeases:
    """AC2: Sync releases expired leases via lease cleanup module."""

    @pytest.mark.asyncio
    async def test_released_tickets_in_result(self) -> None:
        sync_result = SyncResult(
            released_count=2,
            released_tickets=["FORGEOS-BE001", "FORGEOS-BE002"],
        )
        svc = _mock_ticket_service(sync_result=sync_result)
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert result["released_count"] == 2
        assert "FORGEOS-BE001" in result["released_tickets"]

    @pytest.mark.asyncio
    async def test_zero_released_when_none_expired(self) -> None:
        svc = _mock_ticket_service(sync_result=SyncResult())
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert result["released_count"] == 0
        assert result["released_tickets"] == []


# ===================================================================
# AC3: Sync evaluates dependency graph for all non-DONE tickets
# ===================================================================


class TestSyncDependencyGraph:
    """AC3: Sync evaluates dependency graph."""

    @pytest.mark.asyncio
    async def test_sync_engine_queries_blocked_tickets(self) -> None:
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()

        # _resolve_dependencies fetches BLOCKED tickets then DONE tickets
        conn.fetch = AsyncMock(side_effect=[
            # First fetch: BLOCKED tickets with dependencies
            [
                {
                    "ticket_id": "T-001",
                    "depends_on": ["T-000"],
                },
            ],
            # Second fetch: all DONE ticket IDs
            [{"ticket_id": "T-000"}],
        ])
        conn.execute = AsyncMock()
        # conn.transaction() returns an async context manager
        tx_ctx = AsyncMock()
        tx_ctx.__aenter__ = AsyncMock()
        tx_ctx.__aexit__ = AsyncMock(return_value=False)
        conn.transaction = MagicMock(return_value=tx_ctx)

        with patch(
            "mcp_server.locking.lease_cleanup.scan_and_release_expired",
            new_callable=AsyncMock,
            return_value=[],
        ):
            engine = SyncEngine(pool)
            result = await engine.sync()

        assert result.unblocked_count == 1
        assert "T-001" in result.unblocked_tickets


# ===================================================================
# AC4: Tickets with all deps in DONE are moved to READY
# ===================================================================


class TestSyncUnblocking:
    """AC4: Tickets with all deps in DONE move to READY."""

    @pytest.mark.asyncio
    async def test_unblocked_ticket_ids_in_result(self) -> None:
        sync_result = SyncResult(
            unblocked_count=1,
            unblocked_tickets=["T-001"],
        )
        svc = _mock_ticket_service(sync_result=sync_result)
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert "T-001" in result["unblocked_tickets"]
        assert result["unblocked_count"] == 1


# ===================================================================
# AC5: Sync returns a summary of changes made
# ===================================================================


class TestSyncSummary:
    """AC5: Summary dict has released, unblocked, errors."""

    @pytest.mark.asyncio
    async def test_summary_keys(self) -> None:
        sync_result = SyncResult(
            released_count=1,
            released_tickets=["T-010"],
            unblocked_count=2,
            unblocked_tickets=["T-011", "T-012"],
            errors=["Some error"],
        )
        svc = _mock_ticket_service(sync_result=sync_result)
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert set(result.keys()) == {
            "released_count",
            "released_tickets",
            "unblocked_count",
            "unblocked_tickets",
            "errors",
        }
        assert result["errors"] == ["Some error"]

    def test_sync_result_to_dict(self) -> None:
        sr = SyncResult(
            released_count=3,
            released_tickets=["A", "B", "C"],
            unblocked_count=0,
            unblocked_tickets=[],
            errors=[],
        )
        d = sr.to_dict()
        assert d["released_count"] == 3
        assert len(d["released_tickets"]) == 3


# ===================================================================
# AC6: tickets.validate tool registered and callable
# ===================================================================


class TestValidateToolRegistration:
    """AC6: ``tickets.validate`` MCP tool registered and callable."""

    def test_tool_name_constant(self) -> None:
        assert VALIDATE_TOOL_NAME == "tickets.validate"

    def test_schema_is_valid_json_schema(self) -> None:
        assert TICKETS_VALIDATE_SCHEMA["type"] == "object"
        assert TICKETS_VALIDATE_SCHEMA["additionalProperties"] is False

    def test_register_includes_validate(self) -> None:
        registry = MagicMock()
        svc = _mock_ticket_service()
        register_ticket_tools(registry, svc)
        names = [call.kwargs["name"] for call in registry.register.call_args_list]
        assert "tickets.validate" in names

    @pytest.mark.asyncio
    async def test_handler_callable(self) -> None:
        svc = _mock_ticket_service()
        result = await handle_tickets_validate({}, ticket_service=svc)
        assert isinstance(result, dict)
        svc.validate.assert_awaited_once()


# ===================================================================
# AC7: Validate checks stage integrity and SDLC flow validity
# ===================================================================


class TestValidateIntegrity:
    """AC7: Validate checks each ticket's stage and flow."""

    @pytest.mark.asyncio
    async def test_invalid_stage_detected(self) -> None:
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-100",
                "ticket_type": "backend",
                "stage": "NONEXISTENT",
                "status": "IN_PROGRESS",
                "sdlc_flow": ["READY", "BACKEND", "DONE"],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        assert not result.is_clean
        assert any(e.error_type == "invalid_stage" for e in result.errors)
        assert any("T-100" in e.ticket_id for e in result.errors)

    @pytest.mark.asyncio
    async def test_stage_not_in_flow(self) -> None:
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-101",
                "ticket_type": "backend",
                "stage": "SECURITY",
                "status": "IN_PROGRESS",
                "sdlc_flow": ["READY", "BACKEND", "DONE"],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        assert not result.is_clean
        assert any(e.error_type == "stage_not_in_flow" for e in result.errors)

    @pytest.mark.asyncio
    async def test_clean_ticket_passes(self) -> None:
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-102",
                "ticket_type": "backend",
                "stage": "BACKEND",
                "status": "IN_PROGRESS",
                "sdlc_flow": [
                    "READY", "BACKEND", "QA", "SECURITY",
                    "CI", "DOCUMENTATION", "VALIDATOR", "DONE",
                ],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        assert result.is_clean


# ===================================================================
# AC8: Validate returns a list of integrity errors (empty = clean)
# ===================================================================


class TestValidateResult:
    """AC8: Validate result structure and clean state."""

    def test_empty_errors_is_clean(self) -> None:
        vr = ValidateResult(errors=[])
        assert vr.is_clean
        d = vr.to_dict()
        assert d["is_clean"] is True
        assert d["error_count"] == 0
        assert d["errors"] == []

    def test_errors_not_clean(self) -> None:
        vr = ValidateResult(errors=[
            IntegrityError(
                ticket_id="T-200",
                error_type="invalid_stage",
                message="Stage 'FOO' is not valid",
            ),
        ])
        assert not vr.is_clean
        d = vr.to_dict()
        assert d["is_clean"] is False
        assert d["error_count"] == 1

    @pytest.mark.asyncio
    async def test_handler_returns_structured_result(self) -> None:
        validate_result = ValidateResult(errors=[
            IntegrityError("T-300", "stage_not_in_flow", "SECURITY not in flow"),
        ])
        svc = _mock_ticket_service(validate_result=validate_result)
        result = await handle_tickets_validate({}, ticket_service=svc)
        assert result["is_clean"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["ticket_id"] == "T-300"

    @pytest.mark.asyncio
    async def test_clean_handler_result(self) -> None:
        svc = _mock_ticket_service(validate_result=ValidateResult())
        result = await handle_tickets_validate({}, ticket_service=svc)
        assert result["is_clean"] is True
        assert result["errors"] == []


# ===================================================================
# Additional coverage: error handling, SDLC flows, tool count
# ===================================================================


class TestSyncErrorHandling:
    """Edge cases and error handling in sync tool."""

    @pytest.mark.asyncio
    async def test_sync_failure_returns_error_response(self) -> None:
        svc = _mock_ticket_service()
        svc.sync = AsyncMock(side_effect=RuntimeError("Pool not configured"))
        result = await handle_tickets_sync({}, ticket_service=svc)
        assert result["isError"] is True
        assert "Pool not configured" in result["message"]

    @pytest.mark.asyncio
    async def test_validate_failure_returns_error_response(self) -> None:
        svc = _mock_ticket_service()
        svc.validate = AsyncMock(side_effect=RuntimeError("Pool not configured"))
        result = await handle_tickets_validate({}, ticket_service=svc)
        assert result["isError"] is True
        assert "Pool not configured" in result["message"]


class TestIntegrityErrorDataclass:
    """IntegrityError data class unit tests."""

    def test_to_dict_structure(self) -> None:
        ie = IntegrityError("T-400", "invalid_stage", "Stage FOO invalid")
        d = ie.to_dict()
        assert d == {
            "ticket_id": "T-400",
            "error_type": "invalid_stage",
            "message": "Stage FOO invalid",
        }


class TestSdlcFlowConstants:
    """Verify SDLC flow constants are internally consistent."""

    def test_all_flows_start_with_ready_end_with_done(self) -> None:
        for ticket_type, flow in SDLC_FLOWS.items():
            assert flow[0] == "READY", f"{ticket_type} flow doesn't start with READY"
            assert flow[-1] == "DONE", f"{ticket_type} flow doesn't end with DONE"

    def test_all_flow_stages_are_valid(self) -> None:
        for ticket_type, flow in SDLC_FLOWS.items():
            for stage in flow:
                assert stage in VALID_STAGES, (
                    f"{ticket_type} flow has invalid stage: {stage}"
                )

    def test_expected_types_present(self) -> None:
        expected = {
            "backend", "frontend", "fullstack", "infra",
            "security", "docs", "research", "architecture",
        }
        assert expected.issubset(set(SDLC_FLOWS.keys()))


class TestToolRegistrationCount:
    """Verify register_ticket_tools registers the expected number of tools."""

    def test_registers_all_tools(self) -> None:
        registry = MagicMock()
        svc = _mock_ticket_service()
        register_ticket_tools(registry, svc)
        # next, claim, release, status, sync, validate, advance = 7
        assert registry.register.call_count >= 6


# ===================================================================
# Gap tests: SyncEngine direct paths (QA coverage additions)
# ===================================================================


class TestSyncEngineLeaseRelease:
    """Cover SyncEngine.sync() when scan_and_release_expired returns releases."""

    @pytest.mark.asyncio
    async def test_sync_logs_released_tickets(self) -> None:
        """Covers lines 232-242: released_tickets non-empty path."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        # No blocked tickets — skip dependency resolution
        conn.fetch = AsyncMock(return_value=[])

        release_mock = MagicMock()
        release_mock.ticket_id = "T-EXPIRED-001"
        release_mock2 = MagicMock()
        release_mock2.ticket_id = "T-EXPIRED-002"

        with patch(
            "mcp_server.locking.lease_cleanup.scan_and_release_expired",
            new_callable=AsyncMock,
            return_value=[release_mock, release_mock2],
        ):
            engine = SyncEngine(pool)
            result = await engine.sync()

        assert result.released_count == 2
        assert "T-EXPIRED-001" in result.released_tickets
        assert "T-EXPIRED-002" in result.released_tickets
        assert result.errors == []


class TestSyncEngineDependencyError:
    """Cover SyncEngine.sync() when _resolve_dependencies raises."""

    @pytest.mark.asyncio
    async def test_dependency_resolution_error_captured(self) -> None:
        """Covers lines 255-258: exception in _resolve_dependencies."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        # Make fetch raise on the dependency query
        conn.fetch = AsyncMock(side_effect=RuntimeError("DB connection lost"))

        with patch(
            "mcp_server.locking.lease_cleanup.scan_and_release_expired",
            new_callable=AsyncMock,
            return_value=[],
        ):
            engine = SyncEngine(pool)
            result = await engine.sync()

        assert result.unblocked_count == 0
        assert len(result.errors) == 1
        assert "Failed to resolve dependencies" in result.errors[0]


class TestSyncEngineNoBlockedTickets:
    """Cover _resolve_dependencies early return when no BLOCKED tickets."""

    @pytest.mark.asyncio
    async def test_no_blocked_tickets_returns_empty(self) -> None:
        """Covers lines 304-305: empty blocked_rows early return."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        # First fetch (BLOCKED tickets) returns empty
        conn.fetch = AsyncMock(return_value=[])

        with patch(
            "mcp_server.locking.lease_cleanup.scan_and_release_expired",
            new_callable=AsyncMock,
            return_value=[],
        ):
            engine = SyncEngine(pool)
            result = await engine.sync()

        assert result.unblocked_count == 0
        assert result.unblocked_tickets == []


class TestValidateUnknownTicketType:
    """Cover validate() unknown_ticket_type and flow_mismatch checks."""

    @pytest.mark.asyncio
    async def test_unknown_ticket_type_detected(self) -> None:
        """Covers line 408: unknown ticket type check."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-UNK",
                "ticket_type": "nonexistent_type",
                "stage": "READY",
                "status": "READY",
                "sdlc_flow": ["READY", "DONE"],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        assert not result.is_clean
        assert any(e.error_type == "unknown_ticket_type" for e in result.errors)
        assert any("T-UNK" in e.ticket_id for e in result.errors)

    @pytest.mark.asyncio
    async def test_flow_mismatch_detected(self) -> None:
        """Covers lines 414-420: sdlc_flow doesn't match expected for type."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-MISMATCH",
                "ticket_type": "backend",
                "stage": "READY",
                "status": "READY",
                # Wrong flow for backend type
                "sdlc_flow": ["READY", "DONE"],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        assert not result.is_clean
        assert any(e.error_type == "flow_mismatch" for e in result.errors)

    @pytest.mark.asyncio
    async def test_multiple_errors_same_ticket(self) -> None:
        """A ticket can have multiple integrity errors simultaneously."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[
            {
                "ticket_id": "T-MULTI",
                "ticket_type": "backend",
                "stage": "NONEXISTENT",
                "status": "IN_PROGRESS",
                "sdlc_flow": ["READY", "DONE"],
            },
        ])

        engine = SyncEngine(pool)
        result = await engine.validate()
        # Should have invalid_stage + stage_not_in_flow + flow_mismatch
        assert len(result.errors) >= 3
        error_types = {e.error_type for e in result.errors}
        assert "invalid_stage" in error_types
        assert "stage_not_in_flow" in error_types
        assert "flow_mismatch" in error_types


class TestSyncEngineLeaseReleaseError:
    """Cover SyncEngine.sync() when scan_and_release_expired raises."""

    @pytest.mark.asyncio
    async def test_lease_release_error_captured(self) -> None:
        """Covers lines 240-242: exception in scan_and_release_expired."""
        pool = _mock_pool()
        conn = await pool.acquire().__aenter__()
        conn.fetch = AsyncMock(return_value=[])

        with patch(
            "mcp_server.locking.lease_cleanup.scan_and_release_expired",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Lease cleanup failed"),
        ):
            engine = SyncEngine(pool)
            result = await engine.sync()

        assert result.released_count == 0
        assert len(result.errors) == 1
        assert "Failed to release expired leases" in result.errors[0]


class TestTicketServiceDelegation:
    """Cover TicketService.sync() and validate() delegation methods."""

    @pytest.mark.asyncio
    async def test_sync_requires_pool(self) -> None:
        """TicketService.sync() raises RuntimeError without pool."""
        from mcp_server.services.ticket_service import TicketService

        svc = TicketService(claim_queue=MagicMock(), pool=None)
        with pytest.raises(RuntimeError, match="Pool not configured"):
            await svc.sync()

    @pytest.mark.asyncio
    async def test_validate_requires_pool(self) -> None:
        """TicketService.validate() raises RuntimeError without pool."""
        from mcp_server.services.ticket_service import TicketService

        svc = TicketService(claim_queue=MagicMock(), pool=None)
        with pytest.raises(RuntimeError, match="Pool not configured"):
            await svc.validate()
