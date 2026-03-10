"""Tests for comprehensive audit logging (FORGEOS-BE058).

Covers:
- AuditRepository: append, query with filters, count, append-only enforcement
- AuditService: log_operation, query_logs, count_logs
- AuditMiddleware: authenticated request logging, skip unauthenticated
- Admin audit endpoint: query params, auth enforcement, error handling
- Migration: upgrade/downgrade

TDD Evidence
------------
- RED: Tests written first to define expected audit logging behavior.
- GREEN: Implementation created to satisfy these tests.
- REFACTOR: Code cleaned up, naming standardized.

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.middleware.auth_middleware import AuthContext, IdentityType
from mcp_server.repositories.audit_repo import AuditLogRow, AuditRepository
from mcp_server.services.audit_service import AuditService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_audit_row(
    *,
    identity_type: str = "agent",
    identity_id: str = "agent-001",
    operation: str = "mcp.claim_next",
    target: str = "/mcp",
    result: str = "success",
    metadata: dict[str, Any] | None = None,
    source_machine: str = "pop-os",
) -> dict[str, Any]:
    """Create a mock asyncpg Record dict for an audit_log row."""
    return {
        "audit_id": uuid.uuid4(),
        "identity_type": identity_type,
        "identity_id": identity_id,
        "operation": operation,
        "target": target,
        "result": result,
        "timestamp": datetime.now(tz=timezone.utc),
        "metadata": metadata or {},
        "source_machine": source_machine,
    }


def _make_mock_pool(
    *,
    fetchrow_result: dict[str, Any] | None = None,
    fetch_result: list[dict[str, Any]] | None = None,
    fetchval_result: int = 0,
) -> tuple[MagicMock, AsyncMock]:
    """Create a mock asyncpg Pool with acquire context manager.

    Returns the pool mock and the connection mock.
    """
    mock_conn = AsyncMock()
    mock_conn.fetchrow.return_value = fetchrow_result
    mock_conn.fetch.return_value = fetch_result or []
    mock_conn.fetchval.return_value = fetchval_result

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=mock_ctx)

    return pool, mock_conn


def _make_auth_context(
    *,
    identity_type: IdentityType = IdentityType.AGENT,
    identity_id: str = "agent-001",
    role: str = "backend",
    machine_id: str = "pop-os",
) -> AuthContext:
    """Create a sample AuthContext."""
    return AuthContext(
        identity_type=identity_type,
        identity_id=identity_id,
        role=role,
        machine_id=machine_id,
    )


# ===========================================================================
# AuditRepository tests
# ===========================================================================


class TestAuditRepositoryAppend:
    """Tests for AuditRepository.append — audit entry creation."""

    @pytest.mark.asyncio()
    async def test_append_creates_entry_with_all_fields(self) -> None:
        """Appending returns a fully populated AuditLogRow."""
        row_data = _make_audit_row(
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
            target="FORGEOS-BE058",
            result="success",
            source_machine="pop-os",
        )
        pool, conn = _make_mock_pool(fetchrow_result=row_data)

        repo = AuditRepository(pool)
        entry = await repo.append(
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
            target="FORGEOS-BE058",
            result="success",
            source_machine="pop-os",
        )

        assert isinstance(entry, AuditLogRow)
        assert entry.identity_type == "agent"
        assert entry.identity_id == "agent-001"
        assert entry.operation == "mcp.claim_next"
        assert entry.target == "FORGEOS-BE058"
        assert entry.result == "success"
        assert entry.source_machine == "pop-os"

    @pytest.mark.asyncio()
    async def test_append_uses_parameterized_query(self) -> None:
        """Verify INSERT uses parameterized query (SQL injection prevention)."""
        row_data = _make_audit_row()
        pool, conn = _make_mock_pool(fetchrow_result=row_data)

        repo = AuditRepository(pool)
        await repo.append(
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
        )

        call_args = conn.fetchrow.call_args
        sql = call_args.args[0]
        assert "$1" in sql
        assert "$2" in sql
        assert "$3" in sql

    @pytest.mark.asyncio()
    async def test_append_serializes_metadata_as_jsonb(self) -> None:
        """Metadata dict is serialized to JSON string for JSONB column."""
        row_data = _make_audit_row(metadata={"key": "value"})
        pool, conn = _make_mock_pool(fetchrow_result=row_data)

        repo = AuditRepository(pool)
        await repo.append(
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            metadata={"key": "value"},
        )

        call_args = conn.fetchrow.call_args
        # The metadata param should be a JSON string
        metadata_arg = call_args.args[6]
        parsed = json.loads(metadata_arg)
        assert parsed == {"key": "value"}

    @pytest.mark.asyncio()
    async def test_append_defaults_metadata_to_empty_json(self) -> None:
        """When metadata is None, it defaults to empty JSON object."""
        row_data = _make_audit_row()
        pool, conn = _make_mock_pool(fetchrow_result=row_data)

        repo = AuditRepository(pool)
        await repo.append(
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            metadata=None,
        )

        call_args = conn.fetchrow.call_args
        metadata_arg = call_args.args[6]
        assert metadata_arg == "{}"

    @pytest.mark.asyncio()
    async def test_append_defaults_optional_fields(self) -> None:
        """Optional fields default to empty strings when not provided."""
        row_data = _make_audit_row(target="", result="success", source_machine="")
        pool, _ = _make_mock_pool(fetchrow_result=row_data)

        repo = AuditRepository(pool)
        entry = await repo.append(
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
        )

        assert entry.target == ""
        assert entry.result == "success"
        assert entry.source_machine == ""


class TestAuditRepositoryQuery:
    """Tests for AuditRepository.query — filtered audit log retrieval."""

    @pytest.mark.asyncio()
    async def test_query_no_filters(self) -> None:
        """Query with no filters returns all entries up to limit."""
        rows = [_make_audit_row(), _make_audit_row()]
        pool, conn = _make_mock_pool(fetch_result=rows)

        repo = AuditRepository(pool)
        result = await repo.query()

        assert len(result) == 2
        assert all(isinstance(r, AuditLogRow) for r in result)

    @pytest.mark.asyncio()
    async def test_query_with_identity_filter(self) -> None:
        """Query filters by identity_id when provided."""
        rows = [_make_audit_row(identity_id="specific-agent")]
        pool, conn = _make_mock_pool(fetch_result=rows)

        repo = AuditRepository(pool)
        result = await repo.query(identity_id="specific-agent")

        call_args = conn.fetch.call_args
        sql = call_args.args[0]
        assert "identity_id = $1" in sql
        assert call_args.args[1] == "specific-agent"
        assert len(result) == 1

    @pytest.mark.asyncio()
    async def test_query_with_operation_filter(self) -> None:
        """Query filters by operation when provided."""
        pool, conn = _make_mock_pool()

        repo = AuditRepository(pool)
        await repo.query(operation="mcp.claim_next")

        call_args = conn.fetch.call_args
        sql = call_args.args[0]
        assert "operation = $1" in sql

    @pytest.mark.asyncio()
    async def test_query_with_time_range(self) -> None:
        """Query filters by since and until timestamps."""
        pool, conn = _make_mock_pool()

        now = datetime.now(tz=timezone.utc)
        since = now - timedelta(hours=1)
        until = now

        repo = AuditRepository(pool)
        await repo.query(since=since, until=until)

        call_args = conn.fetch.call_args
        sql = call_args.args[0]
        assert "timestamp >=" in sql
        assert "timestamp <" in sql

    @pytest.mark.asyncio()
    async def test_query_with_all_filters_combined(self) -> None:
        """Query combines all filters correctly."""
        pool, conn = _make_mock_pool()

        now = datetime.now(tz=timezone.utc)
        repo = AuditRepository(pool)
        await repo.query(
            identity_id="agent-001",
            identity_type="agent",
            operation="mcp.claim",
            since=now - timedelta(hours=2),
            until=now,
            limit=50,
            offset=10,
        )

        call_args = conn.fetch.call_args
        sql = call_args.args[0]
        assert "identity_id = $1" in sql
        assert "identity_type = $2" in sql
        assert "operation = $3" in sql
        assert "timestamp >= $4" in sql
        assert "timestamp < $5" in sql
        # limit and offset are $6 and $7
        assert call_args.args[6] == 50
        assert call_args.args[7] == 10

    @pytest.mark.asyncio()
    async def test_query_caps_limit_at_1000(self) -> None:
        """Limit is capped at 1000 to prevent unbounded queries."""
        pool, conn = _make_mock_pool()

        repo = AuditRepository(pool)
        await repo.query(limit=5000)

        call_args = conn.fetch.call_args
        # limit param is the second-to-last arg
        limit_arg = call_args.args[1]
        assert limit_arg == 1000

    @pytest.mark.asyncio()
    async def test_query_orders_by_timestamp_desc(self) -> None:
        """Results are ordered by timestamp DESC (newest first)."""
        pool, conn = _make_mock_pool()

        repo = AuditRepository(pool)
        await repo.query()

        call_args = conn.fetch.call_args
        sql = call_args.args[0]
        assert "ORDER BY timestamp DESC" in sql


class TestAuditRepositoryCount:
    """Tests for AuditRepository.count — counting with filters."""

    @pytest.mark.asyncio()
    async def test_count_no_filters(self) -> None:
        """Count with no filters returns total count."""
        pool, conn = _make_mock_pool(fetchval_result=42)

        repo = AuditRepository(pool)
        result = await repo.count()

        assert result == 42

    @pytest.mark.asyncio()
    async def test_count_with_filters(self) -> None:
        """Count applies the same filters as query."""
        pool, conn = _make_mock_pool(fetchval_result=5)

        repo = AuditRepository(pool)
        result = await repo.count(
            identity_id="agent-001",
            operation="mcp.claim",
        )

        assert result == 5
        call_args = conn.fetchval.call_args
        sql = call_args.args[0]
        assert "identity_id = $1" in sql
        assert "operation = $2" in sql


class TestAuditRepositoryAppendOnly:
    """Verify append-only semantics — no update or delete methods exist."""

    def test_no_update_method(self) -> None:
        """AuditRepository has no update method."""
        pool, _ = _make_mock_pool()
        repo = AuditRepository(pool)
        assert not hasattr(repo, "update")

    def test_no_delete_method(self) -> None:
        """AuditRepository has no delete method."""
        pool, _ = _make_mock_pool()
        repo = AuditRepository(pool)
        assert not hasattr(repo, "delete")

    def test_no_delete_by_id_method(self) -> None:
        """AuditRepository has no delete_by_id method."""
        pool, _ = _make_mock_pool()
        repo = AuditRepository(pool)
        assert not hasattr(repo, "delete_by_id")

    def test_no_remove_method(self) -> None:
        """AuditRepository has no remove method."""
        pool, _ = _make_mock_pool()
        repo = AuditRepository(pool)
        assert not hasattr(repo, "remove")


# ===========================================================================
# AuditService tests
# ===========================================================================


class TestAuditServiceLogOperation:
    """Tests for AuditService.log_operation."""

    @pytest.mark.asyncio()
    async def test_log_operation_delegates_to_repo(self) -> None:
        """log_operation passes auth context fields to repo.append."""
        mock_repo = AsyncMock(spec=AuditRepository)
        expected_row = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
            target="FORGEOS-BE058",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={},
            source_machine="pop-os",
        )
        mock_repo.append.return_value = expected_row

        service = AuditService(mock_repo)
        auth_ctx = _make_auth_context()

        result = await service.log_operation(
            auth_ctx=auth_ctx,
            operation="mcp.claim_next",
            target="FORGEOS-BE058",
        )

        assert result == expected_row
        mock_repo.append.assert_called_once_with(
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
            target="FORGEOS-BE058",
            result="success",
            metadata=None,
            source_machine="pop-os",
        )

    @pytest.mark.asyncio()
    async def test_log_operation_uses_auth_context_machine_id(self) -> None:
        """When no source_machine provided, uses auth_ctx.machine_id."""
        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.append.return_value = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="operator",
            identity_id="op-123",
            operation="GET /api/tickets",
            target="/api/tickets",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={},
            source_machine="workstation-1",
        )

        auth_ctx = _make_auth_context(
            identity_type=IdentityType.OPERATOR,
            identity_id="op-123",
            machine_id="workstation-1",
        )

        service = AuditService(mock_repo)
        await service.log_operation(
            auth_ctx=auth_ctx,
            operation="GET /api/tickets",
            target="/api/tickets",
        )

        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["source_machine"] == "workstation-1"

    @pytest.mark.asyncio()
    async def test_log_operation_overrides_source_machine(self) -> None:
        """Explicit source_machine overrides auth_ctx.machine_id."""
        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.append.return_value = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            target="",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={},
            source_machine="explicit-machine",
        )

        auth_ctx = _make_auth_context(machine_id="from-auth")
        service = AuditService(mock_repo)

        await service.log_operation(
            auth_ctx=auth_ctx,
            operation="test",
            source_machine="explicit-machine",
        )

        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["source_machine"] == "explicit-machine"

    @pytest.mark.asyncio()
    async def test_log_operation_with_metadata(self) -> None:
        """Metadata dict is passed through to repo."""
        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.append.return_value = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            target="",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={"http_status": 200},
            source_machine="pop-os",
        )

        auth_ctx = _make_auth_context()
        service = AuditService(mock_repo)

        await service.log_operation(
            auth_ctx=auth_ctx,
            operation="test",
            metadata={"http_status": 200},
        )

        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["metadata"] == {"http_status": 200}

    @pytest.mark.asyncio()
    async def test_log_operation_with_failure_result(self) -> None:
        """Result field can indicate failure."""
        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.append.return_value = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            target="",
            result="failure",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={},
            source_machine="pop-os",
        )

        auth_ctx = _make_auth_context()
        service = AuditService(mock_repo)

        await service.log_operation(
            auth_ctx=auth_ctx,
            operation="test",
            result="failure",
        )

        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["result"] == "failure"


class TestAuditServiceQueryLogs:
    """Tests for AuditService.query_logs and count_logs."""

    @pytest.mark.asyncio()
    async def test_query_logs_delegates_to_repo(self) -> None:
        """query_logs passes all filters through to repo.query."""
        mock_repo = AsyncMock(spec=AuditRepository)
        expected_rows = [
            AuditLogRow(
                audit_id=uuid.uuid4(),
                identity_type="agent",
                identity_id="agent-001",
                operation="test",
                target="",
                result="success",
                timestamp=datetime.now(tz=timezone.utc),
                metadata={},
                source_machine="pop-os",
            )
        ]
        mock_repo.query.return_value = expected_rows

        service = AuditService(mock_repo)
        now = datetime.now(tz=timezone.utc)

        result = await service.query_logs(
            identity_id="agent-001",
            operation="test",
            since=now - timedelta(hours=1),
            until=now,
            limit=50,
            offset=5,
        )

        assert result == expected_rows
        mock_repo.query.assert_called_once()

    @pytest.mark.asyncio()
    async def test_count_logs_delegates_to_repo(self) -> None:
        """count_logs passes filters through to repo.count."""
        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.count.return_value = 42

        service = AuditService(mock_repo)
        result = await service.count_logs(identity_id="agent-001")

        assert result == 42
        mock_repo.count.assert_called_once()


# ===========================================================================
# AuditMiddleware tests
# ===========================================================================


class TestAuditMiddleware:
    """Tests for AuditMiddleware — automatic audit logging of requests."""

    @pytest.mark.asyncio()
    async def test_skips_health_endpoints(self) -> None:
        """Health/readiness endpoints are not audit-logged."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/health"
        call_next = AsyncMock(return_value=mock_response)

        response = await middleware.dispatch(request, call_next)

        assert response == mock_response
        mock_repo.append.assert_not_called()

    @pytest.mark.asyncio()
    async def test_skips_when_no_auth_context(self) -> None:
        """Unauthenticated requests are not audit-logged."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/mcp"
        request.method = "POST"
        request.headers = {}
        request.client = MagicMock()
        request.client.host = "127.0.0.1"
        call_next = AsyncMock(return_value=mock_response)

        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=None,
        ):
            response = await middleware.dispatch(request, call_next)

        assert response == mock_response
        mock_repo.append.assert_not_called()

    @pytest.mark.asyncio()
    async def test_skips_when_no_audit_repo(self) -> None:
        """When audit_repo is None, requests pass through without logging."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=None)

        request = MagicMock()
        request.url.path = "/mcp"
        request.method = "POST"
        call_next = AsyncMock(return_value=mock_response)

        auth_ctx = _make_auth_context()
        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await middleware.dispatch(request, call_next)

        assert response == mock_response

    @pytest.mark.asyncio()
    async def test_logs_authenticated_request(self) -> None:
        """Authenticated requests produce an audit log entry."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/mcp"
        request.method = "POST"
        request.headers = {"x-machine-id": "test-machine"}
        request.client = MagicMock()
        request.client.host = "127.0.0.1"
        call_next = AsyncMock(return_value=mock_response)

        auth_ctx = _make_auth_context()
        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=auth_ctx,
        ):
            await middleware.dispatch(request, call_next)

        mock_repo.append.assert_called_once()
        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["identity_type"] == "agent"
        assert call_kwargs["identity_id"] == "agent-001"
        assert call_kwargs["operation"] == "POST /mcp"
        assert call_kwargs["result"] == "success"

    @pytest.mark.asyncio()
    async def test_logs_failure_result_for_4xx(self) -> None:
        """4xx responses are logged with result='failure'."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 403

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/api/tickets"
        request.method = "GET"
        request.headers = {}
        request.client = MagicMock()
        request.client.host = "127.0.0.1"
        call_next = AsyncMock(return_value=mock_response)

        auth_ctx = _make_auth_context()
        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=auth_ctx,
        ):
            await middleware.dispatch(request, call_next)

        call_kwargs = mock_repo.append.call_args.kwargs
        assert call_kwargs["result"] == "failure"

    @pytest.mark.asyncio()
    async def test_logs_include_duration_metadata(self) -> None:
        """Audit entries include HTTP method, status, and duration."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/mcp"
        request.method = "POST"
        request.headers = {}
        request.client = MagicMock()
        request.client.host = "127.0.0.1"
        call_next = AsyncMock(return_value=mock_response)

        auth_ctx = _make_auth_context()
        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=auth_ctx,
        ):
            await middleware.dispatch(request, call_next)

        call_kwargs = mock_repo.append.call_args.kwargs
        metadata = call_kwargs["metadata"]
        assert "http_method" in metadata
        assert "http_status" in metadata
        assert "duration_ms" in metadata
        assert metadata["http_method"] == "POST"
        assert metadata["http_status"] == 200

    @pytest.mark.asyncio()
    async def test_audit_write_failure_does_not_break_response(self) -> None:
        """If audit repo.append raises, the response still returns."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.append.side_effect = RuntimeError("DB down")
        mock_app = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200

        middleware = AuditMiddleware(mock_app, audit_repo=mock_repo)

        request = MagicMock()
        request.url.path = "/mcp"
        request.method = "POST"
        request.headers = {}
        request.client = MagicMock()
        request.client.host = "127.0.0.1"
        call_next = AsyncMock(return_value=mock_response)

        auth_ctx = _make_auth_context()
        with patch(
            "mcp_server.middleware.audit_middleware.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await middleware.dispatch(request, call_next)

        assert response == mock_response

    @pytest.mark.asyncio()
    async def test_audit_repo_property_setter(self) -> None:
        """audit_repo can be set after construction (late binding)."""
        from mcp_server.middleware.audit_middleware import AuditMiddleware

        mock_app = AsyncMock()
        middleware = AuditMiddleware(mock_app, audit_repo=None)
        assert middleware.audit_repo is None

        new_repo = AsyncMock(spec=AuditRepository)
        middleware.audit_repo = new_repo
        assert middleware.audit_repo is new_repo


# ===========================================================================
# Admin audit endpoint tests
# ===========================================================================


class TestAdminAuditEndpoint:
    """Tests for GET /api/admin/audit endpoint."""

    @pytest.mark.asyncio()
    async def test_returns_401_when_no_auth(self) -> None:
        """Unauthenticated requests get 401."""
        from mcp_server.api import create_audit_endpoint

        mock_repo = AsyncMock(spec=AuditRepository)
        handler = create_audit_endpoint(lambda: mock_repo)

        request = MagicMock()
        request.query_params = {}

        with patch(
            "mcp_server.api.get_auth_context",
            return_value=None,
        ):
            response = await handler(request)

        assert response.status_code == 401

    @pytest.mark.asyncio()
    async def test_returns_403_for_non_admin(self) -> None:
        """Non-admin identities get 403."""
        from mcp_server.api import create_audit_endpoint

        mock_repo = AsyncMock(spec=AuditRepository)
        handler = create_audit_endpoint(lambda: mock_repo)

        request = MagicMock()
        request.query_params = {}

        auth_ctx = _make_auth_context(identity_type=IdentityType.AGENT)
        with patch(
            "mcp_server.api.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await handler(request)

        assert response.status_code == 403

    @pytest.mark.asyncio()
    async def test_returns_503_when_db_unavailable(self) -> None:
        """Returns 503 when audit_repo is None."""
        from mcp_server.api import create_audit_endpoint

        handler = create_audit_endpoint(lambda: None)

        request = MagicMock()
        request.query_params = {}

        auth_ctx = _make_auth_context(identity_type=IdentityType.ADMIN)
        with patch(
            "mcp_server.api.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await handler(request)

        assert response.status_code == 503

    @pytest.mark.asyncio()
    async def test_returns_entries_for_admin(self) -> None:
        """Admin gets audit log entries."""
        from mcp_server.api import create_audit_endpoint

        row = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="mcp.claim_next",
            target="/mcp",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={"key": "val"},
            source_machine="pop-os",
        )

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.query.return_value = [row]
        mock_repo.count.return_value = 1

        handler = create_audit_endpoint(lambda: mock_repo)

        request = MagicMock()
        request.query_params = {}

        auth_ctx = _make_auth_context(identity_type=IdentityType.ADMIN)
        with patch(
            "mcp_server.api.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await handler(request)

        assert response.status_code == 200
        body = json.loads(response.body.decode())
        assert body["total"] == 1
        assert len(body["entries"]) == 1
        assert body["entries"][0]["operation"] == "mcp.claim_next"

    @pytest.mark.asyncio()
    async def test_passes_query_params_as_filters(self) -> None:
        """Query params are forwarded as filters to repo.query."""
        from mcp_server.api import create_audit_endpoint

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.query.return_value = []
        mock_repo.count.return_value = 0

        handler = create_audit_endpoint(lambda: mock_repo)

        request = MagicMock()
        request.query_params = {
            "identity": "agent-001",
            "identity_type": "agent",
            "operation": "mcp.claim_next",
            "since": "2026-03-10T00:00:00",
            "until": "2026-03-11T00:00:00",
            "limit": "50",
            "offset": "10",
        }

        auth_ctx = _make_auth_context(identity_type=IdentityType.ADMIN)
        with patch(
            "mcp_server.api.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await handler(request)

        assert response.status_code == 200
        call_kwargs = mock_repo.query.call_args.kwargs
        assert call_kwargs["identity_id"] == "agent-001"
        assert call_kwargs["identity_type"] == "agent"
        assert call_kwargs["operation"] == "mcp.claim_next"
        assert call_kwargs["limit"] == 50
        assert call_kwargs["offset"] == 10
        assert call_kwargs["since"] is not None
        assert call_kwargs["until"] is not None

    @pytest.mark.asyncio()
    async def test_handles_db_error_gracefully(self) -> None:
        """Database errors return 500, not a crash."""
        from mcp_server.api import create_audit_endpoint

        mock_repo = AsyncMock(spec=AuditRepository)
        mock_repo.query.side_effect = RuntimeError("DB error")

        handler = create_audit_endpoint(lambda: mock_repo)

        request = MagicMock()
        request.query_params = {}

        auth_ctx = _make_auth_context(identity_type=IdentityType.ADMIN)
        with patch(
            "mcp_server.api.get_auth_context",
            return_value=auth_ctx,
        ):
            response = await handler(request)

        assert response.status_code == 500


# ===========================================================================
# Migration structure tests
# ===========================================================================


class TestAuditLogMigration:
    """Tests for the audit_log Alembic migration structure."""

    def _load_migration(self) -> Any:
        """Dynamically import the migration module."""
        import importlib.util
        import pathlib

        path = pathlib.Path(__file__).resolve().parent.parent / (
            "alembic/versions/20260311_000000_006_audit_log.py"
        )
        spec = importlib.util.spec_from_file_location("migration_006", path)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_migration_revision_chain(self) -> None:
        """Verify the migration revision is 006 depending on 005."""
        mod = self._load_migration()

        assert mod.revision == "006"
        assert mod.down_revision == "005"

    def test_upgrade_creates_table(self) -> None:
        """upgrade() calls op.execute with CREATE TABLE audit_log."""
        with patch("alembic.op.execute") as mock_execute:
            mod = self._load_migration()
            mod.upgrade()

            calls = [str(c) for c in mock_execute.call_args_list]
            sql_calls = " ".join(calls)
            assert "CREATE TABLE audit_log" in sql_calls
            assert "audit_id" in sql_calls
            assert "identity_type" in sql_calls
            assert "identity_id" in sql_calls
            assert "operation" in sql_calls
            assert "target" in sql_calls
            assert "result" in sql_calls
            assert "timestamp" in sql_calls
            assert "metadata" in sql_calls
            assert "source_machine" in sql_calls

    def test_upgrade_creates_indexes(self) -> None:
        """upgrade() creates indexes on key columns."""
        with patch("alembic.op.execute") as mock_execute:
            mod = self._load_migration()
            mod.upgrade()

            calls = " ".join(str(c) for c in mock_execute.call_args_list)
            assert "idx_audit_log_identity_id" in calls
            assert "idx_audit_log_operation" in calls
            assert "idx_audit_log_timestamp" in calls
            assert "idx_audit_log_identity_type" in calls

    def test_downgrade_drops_table(self) -> None:
        """downgrade() drops the audit_log table."""
        with patch("alembic.op.execute") as mock_execute:
            mod = self._load_migration()
            mod.downgrade()

            calls = " ".join(str(c) for c in mock_execute.call_args_list)
            assert "DROP TABLE IF EXISTS audit_log" in calls


# ===========================================================================
# AuditLogRow dataclass tests
# ===========================================================================


class TestAuditLogRow:
    """Tests for AuditLogRow dataclass behavior."""

    def test_frozen_immutability(self) -> None:
        """AuditLogRow is frozen — no attribute mutation."""
        row = AuditLogRow(
            audit_id=uuid.uuid4(),
            identity_type="agent",
            identity_id="agent-001",
            operation="test",
            target="",
            result="success",
            timestamp=datetime.now(tz=timezone.utc),
            metadata={},
            source_machine="pop-os",
        )
        with pytest.raises(AttributeError):
            row.operation = "mutated"  # type: ignore[misc]

    def test_slots(self) -> None:
        """AuditLogRow uses __slots__ for memory efficiency."""
        assert hasattr(AuditLogRow, "__slots__")


# ===========================================================================
# Integration: Dependencies wiring
# ===========================================================================


class TestDependenciesWiring:
    """Verify audit_repo is accessible via Dependencies."""

    def test_dependencies_has_audit_repo_field(self) -> None:
        """Dependencies dataclass includes audit_repo."""
        from mcp_server.dependencies import Dependencies

        import dataclasses

        field_names = [f.name for f in dataclasses.fields(Dependencies)]
        assert "audit_repo" in field_names

    def test_repositories_package_exports_audit(self) -> None:
        """repositories __init__.py re-exports AuditRepository."""
        from mcp_server.repositories import AuditRepository as ImportedRepo
        from mcp_server.repositories.audit_repo import (
            AuditRepository as DirectRepo,
        )

        assert ImportedRepo is DirectRepo

    def test_services_package_exports_audit(self) -> None:
        """services __init__.py re-exports AuditService."""
        from mcp_server.services import AuditService as ImportedService
        from mcp_server.services.audit_service import (
            AuditService as DirectService,
        )

        assert ImportedService is DirectService

    def test_middleware_package_exports_audit(self) -> None:
        """middleware __init__.py re-exports AuditMiddleware."""
        from mcp_server.middleware import AuditMiddleware as ImportedMW
        from mcp_server.middleware.audit_middleware import (
            AuditMiddleware as DirectMW,
        )

        assert ImportedMW is DirectMW
