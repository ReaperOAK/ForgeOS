"""Tests for mcp_server.observability.metrics — Metrics Collection Points.

Covers all six acceptance criteria for FORGEOS-BE027:
1. Request counter by tool name and status
2. Request latency histogram (p50, p95, p99)
3. Active session gauge
4. Claim metrics (success/failure/expired)
5. Database query duration per operation type
6. Metrics snapshot and structured log emission

TDD discipline: each test class targets one component.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any
from unittest.mock import patch

import pytest

from mcp_server.observability.metrics import (
    DbQueryTimer,
    MetricsRegistry,
    RequestTimer,
    _Counter,
    _Gauge,
    _Histogram,
    _MAX_HISTOGRAM_SAMPLES,
    emit_metrics_log,
    get_metrics_snapshot,
    get_registry,
    record_claim_expired,
    record_claim_failure,
    record_claim_success,
    record_db_query_duration,
    record_request,
    record_request_latency,
    session_closed,
    session_opened,
)


# ── Fixtures ───────────────────────────────────────────────────────────


@pytest.fixture()
def registry() -> MetricsRegistry:
    """Return a fresh MetricsRegistry for each test."""
    return MetricsRegistry()


@pytest.fixture(autouse=True)
def _reset_global_registry() -> None:
    """Reset the global singleton registry before each test."""
    get_registry().reset()


# ── _Counter ───────────────────────────────────────────────────────────


class TestCounter:
    """Tests for the internal _Counter data structure."""

    def test_initial_value_is_zero(self) -> None:
        c = _Counter()
        assert c.value == 0

    def test_increment_by_one(self) -> None:
        c = _Counter()
        c.increment()
        assert c.value == 1

    def test_increment_by_amount(self) -> None:
        c = _Counter()
        c.increment(5)
        assert c.value == 5

    def test_multiple_increments(self) -> None:
        c = _Counter()
        c.increment(3)
        c.increment(7)
        assert c.value == 10

    def test_thread_safety(self) -> None:
        c = _Counter()
        threads = [
            threading.Thread(target=lambda: [c.increment() for _ in range(1000)])
            for _ in range(10)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert c.value == 10_000


# ── _Gauge ─────────────────────────────────────────────────────────────


class TestGauge:
    """Tests for the internal _Gauge data structure."""

    def test_initial_value_is_zero(self) -> None:
        g = _Gauge()
        assert g.value == 0

    def test_increment(self) -> None:
        g = _Gauge()
        g.increment()
        assert g.value == 1

    def test_decrement(self) -> None:
        g = _Gauge()
        g.increment(5)
        g.decrement(2)
        assert g.value == 3

    def test_decrement_floor_at_zero(self) -> None:
        g = _Gauge()
        g.decrement(10)
        assert g.value == 0

    def test_set(self) -> None:
        g = _Gauge()
        g.set(42)
        assert g.value == 42

    def test_set_overrides_previous(self) -> None:
        g = _Gauge()
        g.increment(100)
        g.set(5)
        assert g.value == 5


# ── _Histogram ─────────────────────────────────────────────────────────


class TestHistogram:
    """Tests for the internal _Histogram data structure."""

    def test_empty_percentile_returns_zero(self) -> None:
        h = _Histogram()
        assert h.percentile(50) == 0.0
        assert h.percentile(95) == 0.0
        assert h.percentile(99) == 0.0

    def test_single_observation(self) -> None:
        h = _Histogram()
        h.observe(0.5)
        assert h.percentile(50) == 0.5
        assert h.percentile(99) == 0.5

    def test_multiple_observations_p50(self) -> None:
        h = _Histogram()
        for v in range(1, 101):
            h.observe(float(v))
        p50 = h.percentile(50)
        # p50 of 1..100 should be around 50
        assert 49.0 <= p50 <= 51.0

    def test_multiple_observations_p95(self) -> None:
        h = _Histogram()
        for v in range(1, 101):
            h.observe(float(v))
        p95 = h.percentile(95)
        assert 94.0 <= p95 <= 96.0

    def test_multiple_observations_p99(self) -> None:
        h = _Histogram()
        for v in range(1, 101):
            h.observe(float(v))
        p99 = h.percentile(99)
        assert 98.0 <= p99 <= 100.0

    def test_snapshot_structure(self) -> None:
        h = _Histogram()
        h.observe(0.1)
        h.observe(0.2)
        snap = h.snapshot()
        assert "count" in snap
        assert "total_seconds" in snap
        assert "p50" in snap
        assert "p95" in snap
        assert "p99" in snap
        assert snap["count"] == 2

    def test_snapshot_empty(self) -> None:
        h = _Histogram()
        snap = h.snapshot()
        assert snap["count"] == 0
        assert snap["p50"] == 0.0
        assert snap["p95"] == 0.0
        assert snap["p99"] == 0.0

    def test_bounded_sample_size(self) -> None:
        h = _Histogram()
        for i in range(_MAX_HISTOGRAM_SAMPLES + 500):
            h.observe(float(i))
        # After trimming, samples should be <= max
        assert len(h._samples) <= _MAX_HISTOGRAM_SAMPLES


# ── MetricsRegistry — Request Counters ─────────────────────────────────


class TestRegistryRequestCounters:
    """AC-1: Request counter tracks total requests by tool name and status."""

    def test_record_success(self, registry: MetricsRegistry) -> None:
        registry.record_request("tickets.claim", "success")
        snap = registry.snapshot()
        assert snap["requests"]["counters"]["tickets.claim.success"] == 1

    def test_record_error(self, registry: MetricsRegistry) -> None:
        registry.record_request("tickets.claim", "error")
        snap = registry.snapshot()
        assert snap["requests"]["counters"]["tickets.claim.error"] == 1

    def test_multiple_tools(self, registry: MetricsRegistry) -> None:
        registry.record_request("tickets.claim", "success")
        registry.record_request("tickets.next", "success")
        registry.record_request("tickets.claim", "error")
        snap = registry.snapshot()
        assert snap["requests"]["counters"]["tickets.claim.success"] == 1
        assert snap["requests"]["counters"]["tickets.next.success"] == 1
        assert snap["requests"]["counters"]["tickets.claim.error"] == 1

    def test_incremental_counting(self, registry: MetricsRegistry) -> None:
        for _ in range(10):
            registry.record_request("health_check", "success")
        snap = registry.snapshot()
        assert snap["requests"]["counters"]["health_check.success"] == 10


# ── MetricsRegistry — Request Latency ──────────────────────────────────


class TestRegistryRequestLatency:
    """AC-2: Request latency histogram tracks p50, p95, p99 per tool name."""

    def test_latency_recorded(self, registry: MetricsRegistry) -> None:
        registry.record_request_latency("tickets.claim", 0.05)
        snap = registry.snapshot()
        assert "tickets.claim" in snap["requests"]["latency"]
        lat = snap["requests"]["latency"]["tickets.claim"]
        assert lat["count"] == 1
        assert lat["p50"] > 0

    def test_multiple_tools_latency(self, registry: MetricsRegistry) -> None:
        registry.record_request_latency("tickets.claim", 0.1)
        registry.record_request_latency("tickets.next", 0.02)
        snap = registry.snapshot()
        assert "tickets.claim" in snap["requests"]["latency"]
        assert "tickets.next" in snap["requests"]["latency"]

    def test_percentile_accuracy(self, registry: MetricsRegistry) -> None:
        for i in range(1, 101):
            registry.record_request_latency("perf_test", float(i) / 1000.0)
        snap = registry.snapshot()
        lat = snap["requests"]["latency"]["perf_test"]
        assert lat["count"] == 100
        # p50 should be around 0.050
        assert 0.045 <= lat["p50"] <= 0.055
        # p95 should be around 0.095
        assert 0.090 <= lat["p95"] <= 0.100


# ── MetricsRegistry — Active Sessions ─────────────────────────────────


class TestRegistryActiveSessions:
    """AC-3: Active session gauge tracks current connected agent count."""

    def test_initial_zero(self, registry: MetricsRegistry) -> None:
        snap = registry.snapshot()
        assert snap["active_sessions"] == 0

    def test_session_opened(self, registry: MetricsRegistry) -> None:
        registry.session_opened()
        snap = registry.snapshot()
        assert snap["active_sessions"] == 1

    def test_session_closed(self, registry: MetricsRegistry) -> None:
        registry.session_opened()
        registry.session_opened()
        registry.session_closed()
        snap = registry.snapshot()
        assert snap["active_sessions"] == 1

    def test_set_absolute(self, registry: MetricsRegistry) -> None:
        registry.set_active_sessions(42)
        snap = registry.snapshot()
        assert snap["active_sessions"] == 42

    def test_close_below_zero(self, registry: MetricsRegistry) -> None:
        registry.session_closed()
        snap = registry.snapshot()
        assert snap["active_sessions"] == 0


# ── MetricsRegistry — Claim Metrics ───────────────────────────────────


class TestRegistryClaimMetrics:
    """AC-4: Claim metrics track success, failure, and expired counts."""

    def test_initial_zero(self, registry: MetricsRegistry) -> None:
        snap = registry.snapshot()
        assert snap["claims"]["success"] == 0
        assert snap["claims"]["failed"] == 0
        assert snap["claims"]["expired"] == 0

    def test_record_success(self, registry: MetricsRegistry) -> None:
        registry.record_claim_success()
        snap = registry.snapshot()
        assert snap["claims"]["success"] == 1

    def test_record_failure(self, registry: MetricsRegistry) -> None:
        registry.record_claim_failure()
        snap = registry.snapshot()
        assert snap["claims"]["failed"] == 1

    def test_record_expired(self, registry: MetricsRegistry) -> None:
        registry.record_claim_expired()
        snap = registry.snapshot()
        assert snap["claims"]["expired"] == 1

    def test_mixed_counts(self, registry: MetricsRegistry) -> None:
        for _ in range(5):
            registry.record_claim_success()
        for _ in range(3):
            registry.record_claim_failure()
        registry.record_claim_expired()
        snap = registry.snapshot()
        assert snap["claims"]["success"] == 5
        assert snap["claims"]["failed"] == 3
        assert snap["claims"]["expired"] == 1


# ── MetricsRegistry — Database Query Duration ────────────────────────


class TestRegistryDbDuration:
    """AC-5: Database query duration tracked per operation type."""

    def test_read_duration(self, registry: MetricsRegistry) -> None:
        registry.record_db_query_duration("read", 0.005)
        snap = registry.snapshot()
        assert "read" in snap["database"]["query_duration"]
        assert snap["database"]["query_duration"]["read"]["count"] == 1

    def test_write_duration(self, registry: MetricsRegistry) -> None:
        registry.record_db_query_duration("write", 0.01)
        snap = registry.snapshot()
        assert "write" in snap["database"]["query_duration"]
        assert snap["database"]["query_duration"]["write"]["count"] == 1

    def test_multiple_operations(self, registry: MetricsRegistry) -> None:
        registry.record_db_query_duration("read", 0.005)
        registry.record_db_query_duration("read", 0.010)
        registry.record_db_query_duration("write", 0.020)
        snap = registry.snapshot()
        assert snap["database"]["query_duration"]["read"]["count"] == 2
        assert snap["database"]["query_duration"]["write"]["count"] == 1

    def test_percentiles_in_snapshot(self, registry: MetricsRegistry) -> None:
        for i in range(1, 51):
            registry.record_db_query_duration("read", float(i) / 1000.0)
        snap = registry.snapshot()
        db_read = snap["database"]["query_duration"]["read"]
        assert db_read["p50"] > 0
        assert db_read["p95"] > 0
        assert db_read["p99"] > 0


# ── MetricsRegistry — Snapshot ────────────────────────────────────────


class TestRegistrySnapshot:
    """AC-6: Metrics exposed via snapshot dict."""

    def test_snapshot_structure(self, registry: MetricsRegistry) -> None:
        snap = registry.snapshot()
        assert "timestamp" in snap
        assert "requests" in snap
        assert "counters" in snap["requests"]
        assert "latency" in snap["requests"]
        assert "active_sessions" in snap
        assert "claims" in snap
        assert "database" in snap
        assert "query_duration" in snap["database"]

    def test_snapshot_is_json_serializable(self, registry: MetricsRegistry) -> None:
        registry.record_request("test_tool", "success")
        registry.record_request_latency("test_tool", 0.123)
        registry.session_opened()
        registry.record_claim_success()
        registry.record_db_query_duration("read", 0.005)
        snap = registry.snapshot()
        # Must not raise
        serialized = json.dumps(snap)
        assert isinstance(serialized, str)

    def test_snapshot_timestamp_format(self, registry: MetricsRegistry) -> None:
        snap = registry.snapshot()
        ts = snap["timestamp"]
        # ISO 8601 format with timezone
        assert "T" in ts
        assert "+" in ts or "Z" in ts

    def test_reset_clears_all(self, registry: MetricsRegistry) -> None:
        registry.record_request("tool", "success")
        registry.session_opened()
        registry.record_claim_success()
        registry.record_db_query_duration("read", 0.01)
        registry.reset()
        snap = registry.snapshot()
        assert snap["requests"]["counters"] == {}
        assert snap["requests"]["latency"] == {}
        assert snap["active_sessions"] == 0
        assert snap["claims"]["success"] == 0
        assert snap["database"]["query_duration"] == {}


# ── RequestTimer ──────────────────────────────────────────────────────


class TestRequestTimer:
    """Tests for the RequestTimer context manager."""

    def test_records_success(self) -> None:
        with RequestTimer("test_tool"):
            time.sleep(0.001)
        snap = get_metrics_snapshot()
        assert snap["requests"]["counters"]["test_tool.success"] == 1
        assert snap["requests"]["latency"]["test_tool"]["count"] == 1

    def test_records_error_on_exception(self) -> None:
        with pytest.raises(ValueError, match="boom"):
            with RequestTimer("fail_tool"):
                raise ValueError("boom")
        snap = get_metrics_snapshot()
        assert snap["requests"]["counters"]["fail_tool.error"] == 1

    def test_records_error_when_flag_set(self) -> None:
        with RequestTimer("manual_error") as timer:
            timer.error = True
        snap = get_metrics_snapshot()
        assert snap["requests"]["counters"]["manual_error.error"] == 1

    def test_latency_recorded(self) -> None:
        with RequestTimer("latency_test"):
            time.sleep(0.01)
        snap = get_metrics_snapshot()
        lat = snap["requests"]["latency"]["latency_test"]
        assert lat["p50"] >= 0.005  # At least 5ms


# ── DbQueryTimer ─────────────────────────────────────────────────────


class TestDbQueryTimer:
    """Tests for the DbQueryTimer context manager."""

    def test_records_read_duration(self) -> None:
        with DbQueryTimer("read"):
            time.sleep(0.001)
        snap = get_metrics_snapshot()
        assert "read" in snap["database"]["query_duration"]
        assert snap["database"]["query_duration"]["read"]["count"] == 1

    def test_records_write_duration(self) -> None:
        with DbQueryTimer("write"):
            time.sleep(0.001)
        snap = get_metrics_snapshot()
        assert "write" in snap["database"]["query_duration"]
        assert snap["database"]["query_duration"]["write"]["count"] == 1

    def test_duration_positive(self) -> None:
        with DbQueryTimer("read"):
            time.sleep(0.01)
        snap = get_metrics_snapshot()
        assert snap["database"]["query_duration"]["read"]["p50"] > 0


# ── Module-level convenience functions ────────────────────────────────


class TestModuleFunctions:
    """Tests for module-level convenience wrappers."""

    def test_record_request_delegates(self) -> None:
        record_request("mod_tool", "success")
        snap = get_metrics_snapshot()
        assert snap["requests"]["counters"]["mod_tool.success"] == 1

    def test_record_request_latency_delegates(self) -> None:
        record_request_latency("mod_tool", 0.05)
        snap = get_metrics_snapshot()
        assert snap["requests"]["latency"]["mod_tool"]["count"] == 1

    def test_session_opened_delegates(self) -> None:
        session_opened()
        snap = get_metrics_snapshot()
        assert snap["active_sessions"] == 1

    def test_session_closed_delegates(self) -> None:
        session_opened()
        session_closed()
        snap = get_metrics_snapshot()
        assert snap["active_sessions"] == 0

    def test_claim_success_delegates(self) -> None:
        record_claim_success()
        snap = get_metrics_snapshot()
        assert snap["claims"]["success"] == 1

    def test_claim_failure_delegates(self) -> None:
        record_claim_failure()
        snap = get_metrics_snapshot()
        assert snap["claims"]["failed"] == 1

    def test_claim_expired_delegates(self) -> None:
        record_claim_expired()
        snap = get_metrics_snapshot()
        assert snap["claims"]["expired"] == 1

    def test_db_query_duration_delegates(self) -> None:
        record_db_query_duration("read", 0.01)
        snap = get_metrics_snapshot()
        assert snap["database"]["query_duration"]["read"]["count"] == 1

    def test_get_registry_returns_singleton(self) -> None:
        r1 = get_registry()
        r2 = get_registry()
        assert r1 is r2


# ── emit_metrics_log ──────────────────────────────────────────────────


class TestEmitMetricsLog:
    """AC-6: Metrics exposed via structured JSON log line."""

    def test_emits_log_with_snapshot(self, caplog: pytest.LogCaptureFixture) -> None:
        record_request("log_tool", "success")
        record_claim_success()
        with caplog.at_level(logging.INFO, logger="forgeos.metrics"):
            emit_metrics_log()
        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.getMessage() == "metrics_snapshot"
        assert hasattr(record, "metrics")
        metrics: dict[str, Any] = record.metrics  # type: ignore[attr-defined]
        assert "timestamp" in metrics
        assert "requests" in metrics
        assert "claims" in metrics

    def test_log_contains_request_data(self, caplog: pytest.LogCaptureFixture) -> None:
        record_request("emit_test", "success")
        record_request("emit_test", "error")
        with caplog.at_level(logging.INFO, logger="forgeos.metrics"):
            emit_metrics_log()
        metrics = caplog.records[0].metrics  # type: ignore[attr-defined]
        assert "emit_test.success" in metrics["requests"]["counters"]
        assert "emit_test.error" in metrics["requests"]["counters"]


# ── __init__.py re-exports ────────────────────────────────────────────


class TestObservabilityExports:
    """Verify that metrics symbols are re-exported from observability package."""

    def test_metrics_registry_exported(self) -> None:
        from mcp_server.observability import MetricsRegistry
        assert MetricsRegistry is not None

    def test_request_timer_exported(self) -> None:
        from mcp_server.observability import RequestTimer
        assert RequestTimer is not None

    def test_db_query_timer_exported(self) -> None:
        from mcp_server.observability import DbQueryTimer
        assert DbQueryTimer is not None

    def test_record_request_exported(self) -> None:
        from mcp_server.observability import record_request
        assert callable(record_request)

    def test_get_metrics_snapshot_exported(self) -> None:
        from mcp_server.observability import get_metrics_snapshot
        assert callable(get_metrics_snapshot)

    def test_emit_metrics_log_exported(self) -> None:
        from mcp_server.observability import emit_metrics_log
        assert callable(emit_metrics_log)

    def test_session_functions_exported(self) -> None:
        from mcp_server.observability import session_closed, session_opened
        assert callable(session_opened)
        assert callable(session_closed)

    def test_claim_functions_exported(self) -> None:
        from mcp_server.observability import (
            record_claim_expired,
            record_claim_failure,
            record_claim_success,
        )
        assert callable(record_claim_success)
        assert callable(record_claim_failure)
        assert callable(record_claim_expired)

    def test_db_duration_exported(self) -> None:
        from mcp_server.observability import record_db_query_duration
        assert callable(record_db_query_duration)

    def test_get_registry_exported(self) -> None:
        from mcp_server.observability import get_registry
        assert callable(get_registry)
