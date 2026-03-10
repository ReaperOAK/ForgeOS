"""Tests for mcp_server.observability — Structured JSON logging.

Covers every public component of the observability package:
- StructuredJsonFormatter
- SensitiveDataFilter
- Correlation ID helpers (set/get)
- configure_logging()
- get_logger()
- __init__.py re-exports

TDD discipline: each test class targets one component; methods are named
``test_<scenario>``.
"""

from __future__ import annotations

import json
import logging
from contextvars import copy_context

import pytest

from mcp_server.observability.logging import (
    SensitiveDataFilter,
    StructuredJsonFormatter,
    _BUILTIN_ATTRS,
    _SENSITIVE_ATTRS,
    _correlation_id_var,
    configure_logging,
    get_correlation_id,
    get_logger,
    set_correlation_id,
)


# ── helpers ────────────────────────────────────────────────────────────


def _make_record(
    msg: str = "hello",
    level: int = logging.INFO,
    name: str = "forgeos.test",
    **extra: object,
) -> logging.LogRecord:
    """Create a minimal LogRecord with optional extra fields."""
    record = logging.LogRecord(
        name=name,
        level=level,
        pathname="test.py",
        lineno=1,
        msg=msg,
        args=(),
        exc_info=None,
    )
    for k, v in extra.items():
        setattr(record, k, v)
    return record


# ── StructuredJsonFormatter ────────────────────────────────────────────


class TestStructuredJsonFormatter:
    """Tests for the JSON formatter."""

    def setup_method(self) -> None:
        self.formatter = StructuredJsonFormatter()

    def test_output_is_valid_json(self) -> None:
        record = _make_record()
        output = self.formatter.format(record)
        data = json.loads(output)
        assert isinstance(data, dict)

    def test_required_fields_present(self) -> None:
        record = _make_record()
        data = json.loads(self.formatter.format(record))
        for key in ("timestamp", "level", "message", "logger", "correlation_id"):
            assert key in data, f"Missing required field: {key}"

    def test_message_value(self) -> None:
        record = _make_record("boot complete")
        data = json.loads(self.formatter.format(record))
        assert data["message"] == "boot complete"

    def test_level_value(self) -> None:
        record = _make_record(level=logging.WARNING)
        data = json.loads(self.formatter.format(record))
        assert data["level"] == "WARNING"

    def test_logger_name(self) -> None:
        record = _make_record(name="forgeos.db")
        data = json.loads(self.formatter.format(record))
        assert data["logger"] == "forgeos.db"

    def test_extra_fields_merged(self) -> None:
        record = _make_record(request_id="abc-123")
        data = json.loads(self.formatter.format(record))
        assert data["request_id"] == "abc-123"

    def test_exception_included(self) -> None:
        record = _make_record()
        try:
            raise ValueError("boom")
        except ValueError:
            import sys

            record.exc_info = sys.exc_info()
        data = json.loads(self.formatter.format(record))
        assert "exception" in data
        assert "ValueError: boom" in data["exception"]

    def test_builtin_attrs_excluded(self) -> None:
        record = _make_record()
        data = json.loads(self.formatter.format(record))
        for attr in ("args", "pathname", "lineno", "funcName"):
            assert attr not in data


# ── Correlation ID ─────────────────────────────────────────────────────


class TestCorrelationId:
    """Tests for correlation ID context variable helpers."""

    def test_default_value(self) -> None:
        ctx = copy_context()
        result = ctx.run(get_correlation_id)
        assert result == "-"

    def test_set_and_get(self) -> None:
        def _inner() -> str:
            set_correlation_id("req-42")
            return get_correlation_id()

        ctx = copy_context()
        assert ctx.run(_inner) == "req-42"

    def test_correlation_id_in_log_output(self) -> None:
        def _inner() -> dict:
            set_correlation_id("corr-99")
            record = _make_record()
            formatter = StructuredJsonFormatter()
            return json.loads(formatter.format(record))

        ctx = copy_context()
        data = ctx.run(_inner)
        assert data["correlation_id"] == "corr-99"


# ── SensitiveDataFilter ───────────────────────────────────────────────


class TestSensitiveDataFilter:
    """Tests for the PII/secret redaction filter."""

    def setup_method(self) -> None:
        self.filt = SensitiveDataFilter()

    def test_always_returns_true(self) -> None:
        record = _make_record()
        assert self.filt.filter(record) is True

    def test_redacts_password_attr(self) -> None:
        record = _make_record(password="s3cret!")
        self.filt.filter(record)
        assert record.password == "[REDACTED]"  # type: ignore[attr-defined]

    def test_redacts_token_attr(self) -> None:
        record = _make_record(token="abc-xyz")
        self.filt.filter(record)
        assert record.token == "[REDACTED]"  # type: ignore[attr-defined]

    def test_redacts_api_key_attr(self) -> None:
        record = _make_record(api_key="key-1234")
        self.filt.filter(record)
        assert record.api_key == "[REDACTED]"  # type: ignore[attr-defined]

    def test_redacts_password_in_message(self) -> None:
        record = _make_record("Login password=hunter2 ok")
        self.filt.filter(record)
        assert "hunter2" not in record.msg
        assert "[REDACTED]" in record.msg

    def test_redacts_dsn_in_message(self) -> None:
        record = _make_record("DSN: postgresql://user:secret@host/db")
        self.filt.filter(record)
        assert "secret" not in record.msg
        assert "[REDACTED]" in record.msg

    def test_safe_attrs_unchanged(self) -> None:
        record = _make_record(request_id="safe-123")
        self.filt.filter(record)
        assert record.request_id == "safe-123"  # type: ignore[attr-defined]

    def test_all_sensitive_attrs_covered(self) -> None:
        # Verify the constant has the expected minimum set
        expected = {"password", "token", "secret", "api_key", "authorization"}
        assert expected.issubset(_SENSITIVE_ATTRS)


# ── configure_logging ──────────────────────────────────────────────────


class TestConfigureLogging:
    """Tests for the one-shot logging configuration function."""

    def setup_method(self) -> None:
        # Reset the forgeos logger before each test
        root = logging.getLogger("forgeos")
        root.handlers.clear()
        root.filters.clear()
        root.setLevel(logging.WARNING)

    def test_sets_level(self) -> None:
        configure_logging(level="DEBUG")
        root = logging.getLogger("forgeos")
        assert root.level == logging.DEBUG

    def test_adds_handler(self) -> None:
        configure_logging()
        root = logging.getLogger("forgeos")
        assert len(root.handlers) >= 1
        assert isinstance(root.handlers[-1].formatter, StructuredJsonFormatter)

    def test_adds_sensitive_filter(self) -> None:
        configure_logging()
        root = logging.getLogger("forgeos")
        assert any(isinstance(f, SensitiveDataFilter) for f in root.filters)

    def test_no_duplicate_filters(self) -> None:
        configure_logging()
        configure_logging()
        root = logging.getLogger("forgeos")
        filter_count = sum(
            1 for f in root.filters if isinstance(f, SensitiveDataFilter)
        )
        assert filter_count == 1

    def test_invalid_level_defaults_to_info(self) -> None:
        configure_logging(level="BANANA")
        root = logging.getLogger("forgeos")
        assert root.level == logging.INFO

    def test_handler_writes_to_stderr(self) -> None:
        import sys

        configure_logging()
        root = logging.getLogger("forgeos")
        handler = root.handlers[-1]
        assert getattr(handler, "stream", None) is sys.stderr


# ── get_logger ─────────────────────────────────────────────────────────


class TestGetLogger:
    """Tests for the logger factory."""

    def test_returns_logging_logger(self) -> None:
        lg = get_logger("test")
        assert isinstance(lg, logging.Logger)

    def test_name_prefix(self) -> None:
        lg = get_logger("db")
        assert lg.name == "forgeos.db"

    def test_dotted_name(self) -> None:
        lg = get_logger("db.pool")
        assert lg.name == "forgeos.db.pool"

    def test_child_inherits_handlers(self) -> None:
        configure_logging()
        lg = get_logger("child")
        assert lg.parent is not None
        assert lg.parent.name == "forgeos"


# ── Package __init__ re-exports ────────────────────────────────────────


class TestObservabilityPackageExports:
    """Verify that the package __init__.py re-exports the public API."""

    def test_configure_logging_exported(self) -> None:
        from mcp_server.observability import configure_logging as fn

        assert callable(fn)

    def test_get_logger_exported(self) -> None:
        from mcp_server.observability import get_logger as fn

        assert callable(fn)

    def test_set_correlation_id_exported(self) -> None:
        from mcp_server.observability import set_correlation_id as fn

        assert callable(fn)

    def test_get_correlation_id_exported(self) -> None:
        from mcp_server.observability import get_correlation_id as fn

        assert callable(fn)

    def test_formatter_exported(self) -> None:
        from mcp_server.observability import StructuredJsonFormatter as cls

        assert cls is not None

    def test_filter_exported(self) -> None:
        from mcp_server.observability import SensitiveDataFilter as cls

        assert cls is not None
