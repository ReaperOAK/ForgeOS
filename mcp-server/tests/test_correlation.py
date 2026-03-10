"""Tests for request lifecycle correlation ID middleware.

Covers all 6 acceptance criteria from FORGEOS-BE019:
  AC1: UUID v4 correlation ID generation
  AC2: Context variable storage with async isolation
  AC3: Correlation ID in log records via CorrelationIdFilter
  AC4: Correlation ID in MCP tool error responses
  AC5: Correlation ID enrichment in error detail dicts
  AC6: Database correlation metadata propagation

TDD Methodology: RED phase -- all tests written before implementation.
"""

from __future__ import annotations

import asyncio
import logging
import re
from unittest.mock import patch

import pytest

from mcp_server.middleware.correlation import (
    CorrelationIdFilter,
    _correlation_id_var,
    build_correlated_tool_error,
    configure_correlation_logging,
    correlation_context,
    enrich_error_details,
    generate_correlation_id,
    get_correlation_id,
    get_db_correlation_metadata,
    set_correlation_id,
)

UUID4_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


@pytest.fixture(autouse=True)
def _reset_correlation_id() -> None:  # type: ignore[misc]
    """Ensure each test starts with a clean correlation context."""
    token = _correlation_id_var.set(None)
    yield  # type: ignore[misc]
    _correlation_id_var.reset(token)


# =========================================================================
# AC1: UUID v4 correlation ID generation
# =========================================================================


class TestCorrelationIdGeneration:
    """AC1: Every MCP request gets a unique UUID v4 correlation ID."""

    def test_generates_uuid4_format(self) -> None:
        cid = generate_correlation_id()
        assert UUID4_PATTERN.match(cid), f"Not a valid UUID v4: {cid}"

    def test_generates_unique_ids(self) -> None:
        ids = {generate_correlation_id() for _ in range(100)}
        assert len(ids) == 100

    def test_returns_lowercase_string(self) -> None:
        cid = generate_correlation_id()
        assert cid == cid.lower()
        assert isinstance(cid, str)


# =========================================================================
# AC2: Context variable storage with async isolation
# =========================================================================


class TestCorrelationContext:
    """AC2: Correlation ID stored in contextvars, isolated per-request."""

    def test_set_and_get(self) -> None:
        set_correlation_id("test-123")
        assert get_correlation_id() == "test-123"

    def test_default_is_none(self) -> None:
        assert get_correlation_id() is None

    @pytest.mark.asyncio
    async def test_async_task_isolation(self) -> None:
        results: dict[str, str | None] = {}

        async def worker(name: str, cid: str) -> None:
            set_correlation_id(cid)
            await asyncio.sleep(0.01)
            results[name] = get_correlation_id()

        await asyncio.gather(
            asyncio.create_task(worker("a", "cid-a")),
            asyncio.create_task(worker("b", "cid-b")),
        )
        assert results["a"] == "cid-a"
        assert results["b"] == "cid-b"


# =========================================================================
# AC3: Correlation ID in log records
# =========================================================================


class TestCorrelationLoggingFilter:
    """AC3: Correlation ID included in all log messages."""

    def test_filter_adds_correlation_id(self) -> None:
        set_correlation_id("log-cid-1")
        f = CorrelationIdFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)
        assert f.filter(record) is True
        assert record.correlation_id == "log-cid-1"  # type: ignore[attr-defined]

    def test_filter_uses_dash_when_no_context(self) -> None:
        f = CorrelationIdFilter()
        record = logging.LogRecord("test", logging.INFO, "", 0, "msg", (), None)
        f.filter(record)
        assert record.correlation_id == "-"  # type: ignore[attr-defined]

    def test_configure_is_idempotent(self) -> None:
        logger = logging.getLogger("test.idempotent")
        configure_correlation_logging(logger)
        configure_correlation_logging(logger)
        count = sum(1 for f in logger.filters if isinstance(f, CorrelationIdFilter))
        assert count == 1


# =========================================================================
# AC4 + AC5: Error response enrichment
# =========================================================================


class TestCorrelationInErrorResponses:
    """AC4+AC5: MCP error responses include correlation ID for debugging."""

    def test_build_correlated_tool_error_with_cid(self) -> None:
        set_correlation_id("err-cid-1")
        result = build_correlated_tool_error("Something failed")
        assert len(result) == 1
        assert "err-cid-1" in result[0].text
        assert "Something failed" in result[0].text

    def test_build_correlated_tool_error_without_cid(self) -> None:
        result = build_correlated_tool_error("No context")
        assert result[0].text == "No context"

    def test_enrich_error_details_with_existing_dict(self) -> None:
        set_correlation_id("enrich-1")
        enriched = enrich_error_details({"code": 500})
        assert enriched["correlation_id"] == "enrich-1"
        assert enriched["code"] == 500

    def test_enrich_error_details_with_none(self) -> None:
        set_correlation_id("enrich-2")
        enriched = enrich_error_details(None)
        assert enriched["correlation_id"] == "enrich-2"


# =========================================================================
# AC6: Database correlation metadata
# =========================================================================


class TestCorrelationDbPropagation:
    """AC6: Correlation ID propagated to database event records."""

    def test_db_metadata_with_active_context(self) -> None:
        set_correlation_id("db-cid-1")
        meta = get_db_correlation_metadata()
        assert meta == {"correlation_id": "db-cid-1"}

    def test_db_metadata_without_context(self) -> None:
        meta = get_db_correlation_metadata()
        assert meta == {"correlation_id": None}


# =========================================================================
# Context manager tests
# =========================================================================


class TestCorrelationContextManager:
    """Correlation context manager lifecycle tests."""

    def test_auto_generates_id(self) -> None:
        with correlation_context() as cid:
            assert UUID4_PATTERN.match(cid)
            assert get_correlation_id() == cid
        assert get_correlation_id() is None

    def test_accepts_explicit_id(self) -> None:
        with correlation_context("explicit-123") as cid:
            assert cid == "explicit-123"
            assert get_correlation_id() == "explicit-123"
        assert get_correlation_id() is None

    def test_resets_on_exception(self) -> None:
        with pytest.raises(RuntimeError):
            with correlation_context("will-fail"):
                raise RuntimeError("boom")
        assert get_correlation_id() is None


# =========================================================================
# Module export test
# =========================================================================


class TestModuleExports:
    """Verify middleware package exports are accessible."""

    def test_all_public_symbols_exported(self) -> None:
        from mcp_server.middleware import __all__

        expected = {
            "CorrelationIdFilter",
            "build_correlated_tool_error",
            "configure_correlation_logging",
            "correlation_context",
            "enrich_error_details",
            "generate_correlation_id",
            "get_correlation_id",
            "get_db_correlation_metadata",
            "set_correlation_id",
        }
        assert set(__all__) == expected


# =========================================================================
# Observability bridge tests
# =========================================================================


class TestObservabilityBridge:
    """Verify correlation IDs sync to the observability module."""

    def test_set_syncs_to_observability(self) -> None:
        """set_correlation_id() should call observability set_correlation_id."""
        with patch(
            "mcp_server.middleware.correlation._sync_to_observability"
        ) as mock_sync:
            set_correlation_id("sync-test")
            mock_sync.assert_called_once_with("sync-test")

    def test_context_manager_syncs_on_entry_and_exit(self) -> None:
        """correlation_context() should sync on entry and reset on exit."""
        with patch(
            "mcp_server.middleware.correlation._sync_to_observability"
        ) as mock_sync:
            with correlation_context("ctx-sync") as cid:
                assert cid == "ctx-sync"
            # Called on entry with the cid, and on exit with None
            assert mock_sync.call_count == 2
            mock_sync.assert_any_call("ctx-sync")
            mock_sync.assert_any_call(None)

    def test_sync_handles_import_error_gracefully(self) -> None:
        """_sync_to_observability should not raise if observability is missing."""
        from mcp_server.middleware.correlation import _sync_to_observability

        with patch.dict("sys.modules", {"mcp_server.observability.logging": None}):
            # Should not raise
            _sync_to_observability("test-id")
