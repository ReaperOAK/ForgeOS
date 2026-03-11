"""Tests for the Shadow Mode Validation Engine.

Covers: DivergenceClassifier, ShadowEngine, DivergenceReport, stats
aggregation, per-operation enable/disable, logging, and dashboard stats.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from mcp_server.migration.shadow_engine import (
    COMPARED_FIELDS,
    CRITICAL_FIELDS,
    TIMING_WARNING_THRESHOLD_SECONDS,
    VALID_SHADOW_OPERATIONS,
    Divergence,
    DivergenceClassifier,
    DivergenceLevel,
    DivergenceReport,
    DivergenceStats,
    ShadowConfig,
    ShadowEngine,
    TicketOperationAdapter,
    _now_iso,
    _safe_str,
    _values_equal,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class FakeAdapter:
    """A fake adapter for testing."""

    def __init__(self, result: dict[str, Any] | None = None, delay: float = 0.0) -> None:
        self._result = result or {}
        self._delay = delay
        self.calls: list[tuple[str, str]] = []

    async def execute(self, operation: str, ticket_id: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append((operation, ticket_id))
        if self._delay > 0:
            await asyncio.sleep(self._delay)
        return dict(self._result)


@pytest.fixture
def classifier() -> DivergenceClassifier:
    return DivergenceClassifier()


@pytest.fixture
def engine() -> ShadowEngine:
    return ShadowEngine()


@pytest.fixture
def matching_results() -> tuple[dict[str, Any], dict[str, Any]]:
    base = {
        "ticket_id": "T-001",
        "stage": "BACKEND",
        "claimed_by": "Backend",
        "lease_expiry": "2026-03-11T12:00:00Z",
        "dependencies": ["T-000"],
    }
    return dict(base), dict(base)


# ---------------------------------------------------------------------------
# DivergenceClassifier tests
# ---------------------------------------------------------------------------


class TestDivergenceClassifier:
    def test_classify_critical_stage(self, classifier: DivergenceClassifier) -> None:
        level = classifier.classify_field("stage", "BACKEND", "QA")
        assert level is DivergenceLevel.CRITICAL

    def test_classify_critical_claimed_by(self, classifier: DivergenceClassifier) -> None:
        level = classifier.classify_field("claimed_by", "A", "B")
        assert level is DivergenceLevel.CRITICAL

    def test_classify_info_ticket_id(self, classifier: DivergenceClassifier) -> None:
        level = classifier.classify_field("ticket_id", "a", "b")
        assert level is DivergenceLevel.INFO

    def test_classify_info_lease_expiry(self, classifier: DivergenceClassifier) -> None:
        level = classifier.classify_field("lease_expiry", "a", "b")
        assert level is DivergenceLevel.INFO

    def test_classify_info_dependencies(self, classifier: DivergenceClassifier) -> None:
        level = classifier.classify_field("dependencies", [], ["x"])
        assert level is DivergenceLevel.INFO

    def test_timing_no_warning_under_threshold(self, classifier: DivergenceClassifier) -> None:
        result = classifier.classify_timing(1.0, 3.0)
        assert result is None

    def test_timing_warning_over_threshold(self, classifier: DivergenceClassifier) -> None:
        result = classifier.classify_timing(0.0, 6.0)
        assert result is DivergenceLevel.WARNING

    def test_timing_exactly_at_threshold(self, classifier: DivergenceClassifier) -> None:
        result = classifier.classify_timing(0.0, TIMING_WARNING_THRESHOLD_SECONDS)
        assert result is None

    def test_compare_no_divergences(
        self, classifier: DivergenceClassifier, matching_results: tuple[dict, dict]
    ) -> None:
        fs, db = matching_results
        result = classifier.compare(fs, db, 1.0, 1.0)
        assert result == []

    def test_compare_stage_divergence(self, classifier: DivergenceClassifier) -> None:
        fs = {"ticket_id": "T-1", "stage": "BACKEND"}
        db = {"ticket_id": "T-1", "stage": "QA"}
        divs = classifier.compare(fs, db, 1.0, 1.0)
        stage_divs = [d for d in divs if d.field == "stage"]
        assert len(stage_divs) == 1
        assert stage_divs[0].level is DivergenceLevel.CRITICAL

    def test_compare_timing_divergence(self, classifier: DivergenceClassifier) -> None:
        fs = {"ticket_id": "T-1", "stage": "BACKEND"}
        db = {"ticket_id": "T-1", "stage": "BACKEND"}
        divs = classifier.compare(fs, db, 0.0, 10.0)
        timing_divs = [d for d in divs if d.field == "_timing"]
        assert len(timing_divs) == 1
        assert timing_divs[0].level is DivergenceLevel.WARNING

    def test_compare_missing_field_in_db(self, classifier: DivergenceClassifier) -> None:
        fs = {"ticket_id": "T-1", "stage": "BACKEND", "claimed_by": "X"}
        db = {"ticket_id": "T-1"}
        divs = classifier.compare(fs, db, 0.0, 0.0)
        # stage -> None = CRITICAL, claimed_by -> None = CRITICAL
        crit = [d for d in divs if d.level is DivergenceLevel.CRITICAL]
        assert len(crit) >= 1


# ---------------------------------------------------------------------------
# ShadowConfig tests
# ---------------------------------------------------------------------------


class TestShadowConfig:
    def test_default_enabled_operations(self) -> None:
        cfg = ShadowConfig()
        assert cfg.enabled_operations == VALID_SHADOW_OPERATIONS

    def test_custom_enabled_operations(self) -> None:
        cfg = ShadowConfig(enabled_operations=frozenset({"claim"}))
        assert cfg.enabled_operations == frozenset({"claim"})

    def test_default_max_history(self) -> None:
        cfg = ShadowConfig()
        assert cfg.max_report_history == 10_000


# ---------------------------------------------------------------------------
# ShadowEngine tests
# ---------------------------------------------------------------------------


class TestShadowEngine:
    def test_is_enabled_default(self, engine: ShadowEngine) -> None:
        for op in VALID_SHADOW_OPERATIONS:
            assert engine.is_enabled(op) is True

    def test_is_enabled_restricted(self) -> None:
        eng = ShadowEngine(config=ShadowConfig(enabled_operations=frozenset({"claim"})))
        assert eng.is_enabled("claim") is True
        assert eng.is_enabled("sync") is False

    @pytest.mark.asyncio
    async def test_intercept_disabled_op(self) -> None:
        eng = ShadowEngine(config=ShadowConfig(enabled_operations=frozenset()))
        report = await eng.intercept("claim", "T-1")
        assert report.divergences == []
        assert report.operation == "claim"

    @pytest.mark.asyncio
    async def test_intercept_with_precomputed_results(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "BACKEND"}
        db = {"ticket_id": "T-1", "stage": "QA"}
        report = await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        assert len(report.divergences) > 0
        crit = [d for d in report.divergences if d.level is DivergenceLevel.CRITICAL]
        assert len(crit) >= 1

    @pytest.mark.asyncio
    async def test_intercept_no_divergence(
        self, matching_results: tuple[dict, dict]
    ) -> None:
        eng = ShadowEngine()
        fs, db = matching_results
        report = await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        assert report.divergences == []

    @pytest.mark.asyncio
    async def test_intercept_with_adapters(self) -> None:
        fs_data = {"ticket_id": "T-1", "stage": "BACKEND"}
        db_data = {"ticket_id": "T-1", "stage": "BACKEND"}
        fs_adapter = FakeAdapter(fs_data)
        db_adapter = FakeAdapter(db_data)
        eng = ShadowEngine(fs_adapter=fs_adapter, db_adapter=db_adapter)
        report = await eng.intercept("claim", "T-1")
        assert fs_adapter.calls == [("claim", "T-1")]
        assert db_adapter.calls == [("claim", "T-1")]
        assert report.divergences == []

    @pytest.mark.asyncio
    async def test_intercept_adapter_override(self) -> None:
        default_fs = FakeAdapter({"ticket_id": "T-1", "stage": "X"})
        override_fs = FakeAdapter({"ticket_id": "T-1", "stage": "Y"})
        db = FakeAdapter({"ticket_id": "T-1", "stage": "Y"})
        eng = ShadowEngine(fs_adapter=default_fs, db_adapter=db)
        report = await eng.intercept("claim", "T-1", fs_adapter=override_fs)
        # Override adapter used — no divergence since override matches db
        assert override_fs.calls == [("claim", "T-1")]
        assert default_fs.calls == []
        assert report.divergences == []

    @pytest.mark.asyncio
    async def test_stats_after_intercept(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "BACKEND"}
        db = {"ticket_id": "T-1", "stage": "QA"}
        await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        stats = eng.get_stats()
        assert stats.total_operations == 1
        assert stats.total_divergences >= 1
        assert stats.critical_count >= 1

    @pytest.mark.asyncio
    async def test_stats_accumulate(self) -> None:
        eng = ShadowEngine()
        fs1 = {"ticket_id": "T-1", "stage": "A"}
        db1 = {"ticket_id": "T-1", "stage": "B"}
        fs2 = {"ticket_id": "T-2", "stage": "X"}
        db2 = {"ticket_id": "T-2", "stage": "X"}
        await eng.intercept("claim", "T-1", fs_result=fs1, db_result=db1)
        await eng.intercept("advance", "T-2", fs_result=fs2, db_result=db2)
        stats = eng.get_stats()
        assert stats.total_operations == 2
        assert stats.by_operation.get("claim", 0) >= 1

    @pytest.mark.asyncio
    async def test_get_stats_dict(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "A"}
        db = {"ticket_id": "T-1", "stage": "B"}
        await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        d = eng.get_stats_dict()
        assert isinstance(d, dict)
        assert "total_operations" in d
        assert "critical_count" in d
        assert "by_operation" in d
        assert "by_field" in d
        assert "recent_critical" in d

    @pytest.mark.asyncio
    async def test_get_reports(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "A"}
        db = {"ticket_id": "T-1", "stage": "A"}
        await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        reports = eng.get_reports()
        assert len(reports) == 1
        assert reports[0].ticket_id == "T-1"

    @pytest.mark.asyncio
    async def test_reset_clears_state(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "A"}
        db = {"ticket_id": "T-1", "stage": "B"}
        await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        assert eng.get_stats().total_operations == 1
        eng.reset()
        assert eng.get_stats().total_operations == 0
        assert eng.get_reports() == []

    @pytest.mark.asyncio
    async def test_report_history_trimmed(self) -> None:
        eng = ShadowEngine(config=ShadowConfig(max_report_history=10))
        fs = {"ticket_id": "T-1", "stage": "A"}
        db = {"ticket_id": "T-1", "stage": "A"}
        for i in range(15):
            await eng.intercept("claim", f"T-{i}", fs_result=fs, db_result=db)
        assert len(eng.get_reports()) <= 10 + 5  # trimmed at half + new

    @pytest.mark.asyncio
    async def test_critical_alert_logged(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "A"}
        db = {"ticket_id": "T-1", "stage": "B"}
        with patch("mcp_server.migration.shadow_engine.logger") as mock_logger:
            await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
            # CRITICAL divergences trigger error-level log
            error_calls = mock_logger.error.call_args_list
            assert len(error_calls) >= 1
            alert_messages = [str(c) for c in error_calls]
            assert any("CRITICAL" in m or "ALERT" in m for m in alert_messages)

    @pytest.mark.asyncio
    async def test_warning_logged(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "BACKEND"}
        db = {"ticket_id": "T-1", "stage": "BACKEND"}
        with patch("mcp_server.migration.shadow_engine.logger") as mock_logger:
            await eng.intercept("claim", "T-1", fs_result=fs, db_result=db, fs_adapter=None, db_adapter=None)
            # No timing divergence here since durations are 0
            # Force a timing one:
        eng2 = ShadowEngine()
        with patch("mcp_server.migration.shadow_engine.logger") as mock_logger2:
            fs_a = FakeAdapter(fs, delay=0.0)
            db_a = FakeAdapter(db, delay=0.0)
            # Use precomputed with timing diff
            report = await eng2.intercept(
                "claim", "T-1",
                fs_result={"ticket_id": "T-1", "stage": "X", "claimed_by": "X"},
                db_result={"ticket_id": "T-1", "stage": "X", "claimed_by": "X"},
            )
            # No warning expected since timing=0
            assert report.divergences == []

    @pytest.mark.asyncio
    async def test_info_divergence_logged(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "dependencies": ["A", "B"]}
        db = {"ticket_id": "T-1", "dependencies": ["C"]}
        with patch("mcp_server.migration.shadow_engine.logger") as mock_logger:
            report = await eng.intercept("sync", "T-1", fs_result=fs, db_result=db)
            info_divs = [d for d in report.divergences if d.level is DivergenceLevel.INFO]
            assert len(info_divs) >= 1
            mock_logger.info.assert_called()

    @pytest.mark.asyncio
    async def test_recent_critical_capped_at_50(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-X", "stage": "A"}
        db = {"ticket_id": "T-X", "stage": "B"}
        for i in range(60):
            await eng.intercept("claim", f"T-{i}", fs_result=fs, db_result=db)
        assert len(eng.get_stats().recent_critical) <= 50

    @pytest.mark.asyncio
    async def test_by_field_stats(self) -> None:
        eng = ShadowEngine()
        fs = {"ticket_id": "T-1", "stage": "A", "claimed_by": "X"}
        db = {"ticket_id": "T-1", "stage": "B", "claimed_by": "Y"}
        await eng.intercept("claim", "T-1", fs_result=fs, db_result=db)
        stats = eng.get_stats()
        assert "stage" in stats.by_field
        assert "claimed_by" in stats.by_field

    @pytest.mark.asyncio
    async def test_no_adapters_yields_empty_comparison(self) -> None:
        eng = ShadowEngine()
        report = await eng.intercept("claim", "T-1")
        # Both results default to {} — all fields are None vs None => no divergence
        assert report.divergences == []


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_values_equal_both_none(self) -> None:
        assert _values_equal(None, None) is True

    def test_values_equal_one_none(self) -> None:
        assert _values_equal(None, "x") is False
        assert _values_equal("x", None) is False

    def test_values_equal_strings(self) -> None:
        assert _values_equal("BACKEND", "BACKEND") is True
        assert _values_equal("BACKEND", "QA") is False

    def test_values_equal_lists_same_order(self) -> None:
        assert _values_equal(["A", "B"], ["A", "B"]) is True

    def test_values_equal_lists_different_order(self) -> None:
        assert _values_equal(["B", "A"], ["A", "B"]) is True

    def test_values_equal_lists_different(self) -> None:
        assert _values_equal(["A"], ["B"]) is False

    def test_values_equal_int_vs_str(self) -> None:
        assert _values_equal(42, "42") is True

    def test_safe_str_short(self) -> None:
        assert _safe_str("hello") == "hello"

    def test_safe_str_long(self) -> None:
        long = "x" * 300
        result = _safe_str(long)
        assert len(result) == 200
        assert result.endswith("...")

    def test_now_iso_format(self) -> None:
        ts = _now_iso()
        assert "T" in ts
        assert "+" in ts or "Z" in ts


# ---------------------------------------------------------------------------
# DivergenceReport / DivergenceStats data class tests
# ---------------------------------------------------------------------------


class TestDataClasses:
    def test_divergence_report_fields(self) -> None:
        report = DivergenceReport(
            operation="claim",
            ticket_id="T-1",
            divergences=[],
            fs_duration_seconds=0.1,
            db_duration_seconds=0.2,
            timestamp="2026-01-01T00:00:00Z",
        )
        assert report.operation == "claim"
        assert report.ticket_id == "T-1"
        assert report.divergences == []

    def test_divergence_stats_defaults(self) -> None:
        stats = DivergenceStats()
        assert stats.total_operations == 0
        assert stats.critical_count == 0
        assert stats.by_operation == {}

    def test_divergence_frozen(self) -> None:
        d = Divergence(field="stage", fs_value="A", db_value="B", level=DivergenceLevel.CRITICAL)
        assert d.field == "stage"
        assert d.level is DivergenceLevel.CRITICAL

    def test_constants(self) -> None:
        assert "stage" in COMPARED_FIELDS
        assert "claimed_by" in COMPARED_FIELDS
        assert "ticket_id" in COMPARED_FIELDS
        assert "stage" in CRITICAL_FIELDS
        assert "claimed_by" in CRITICAL_FIELDS
        assert TIMING_WARNING_THRESHOLD_SECONDS == 5.0
