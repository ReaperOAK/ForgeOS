"""Tests for mcp_server.locking.transaction_config — per-operation isolation.

TDD Evidence:
- RED:  Tests written first targeting all 6 acceptance criteria.
- GREEN: transaction_config.py implemented to satisfy each test.
- REFACTOR: Extracted enums, frozen dataclasses, protocol for pool.

Acceptance Criteria Coverage:
  AC1: Transaction context manager accepts an isolation level parameter
  AC2: Claim operations run under READ COMMITTED isolation
  AC3: State transition operations (advance, rework) run under SERIALIZABLE isolation
  AC4: Serialization failures trigger automatic retry with configurable retry count (default: 3)
  AC5: Each transaction type is documented with justification for its isolation level
  AC6: Transaction wrapper integrates with the asyncpg connection pool
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.locking.transaction_config import (
    DEFAULT_BASE_DELAY,
    DEFAULT_MAX_RETRIES,
    OPERATION_ISOLATION_MAP,
    IsolationLevel,
    OperationIsolation,
    OperationType,
    SerializationError,
    TransactionError,
    isolation_for,
    transactional,
)


# ---------------------------------------------------------------------------
# Helpers — mock pool and connection builder
# ---------------------------------------------------------------------------


class _FakeTransaction:
    """Fake async context manager simulating asyncpg Transaction."""

    def __init__(self, *, fail_with: Exception | None = None) -> None:
        self._fail_with = fail_with
        self.committed = False

    async def __aenter__(self) -> "_FakeTransaction":
        if self._fail_with:
            raise self._fail_with
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        if exc_val is None:
            self.committed = True


def _make_mock_conn(
    *,
    isolation_capture: list[str] | None = None,
    transaction_error: Exception | None = None,
) -> AsyncMock:
    """Build a mock connection that tracks transaction() calls.

    Parameters
    ----------
    isolation_capture : list[str] | None
        If provided, appends the isolation kwarg each time
        ``conn.transaction(isolation=...)`` is called.
    transaction_error : Exception | None
        If provided, the transaction context manager raises this on enter.
    """
    conn = AsyncMock()

    def fake_transaction(*, isolation: str = "read_committed") -> _FakeTransaction:
        if isolation_capture is not None:
            isolation_capture.append(isolation)
        return _FakeTransaction(fail_with=transaction_error)

    conn.transaction = MagicMock(side_effect=fake_transaction)
    return conn


def _make_mock_pool(
    conn: AsyncMock | None = None,
    *,
    isolation_capture: list[str] | None = None,
    transaction_error: Exception | None = None,
) -> AsyncMock:
    """Build a mock pool that returns *conn* on acquire."""
    if conn is None:
        conn = _make_mock_conn(
            isolation_capture=isolation_capture,
            transaction_error=transaction_error,
        )
    pool = AsyncMock()
    pool.acquire = AsyncMock(return_value=conn)
    pool.release = AsyncMock()
    return pool


def _make_serialization_error() -> Exception:
    """Create a fake asyncpg-style serialization failure exception."""
    exc = Exception("could not serialize access")
    exc.sqlstate = "40001"  # type: ignore[attr-defined]
    return exc


# ===========================================================================
# AC1: Transaction context manager accepts an isolation level parameter
# ===========================================================================


class TestIsolationLevel:
    """AC1: IsolationLevel enum covers the three required levels."""

    def test_read_committed_value(self) -> None:
        assert IsolationLevel.READ_COMMITTED.value == "read_committed"

    def test_repeatable_read_value(self) -> None:
        assert IsolationLevel.REPEATABLE_READ.value == "repeatable_read"

    def test_serializable_value(self) -> None:
        assert IsolationLevel.SERIALIZABLE.value == "serializable"

    def test_enum_has_three_members(self) -> None:
        assert len(IsolationLevel) == 3

    def test_values_are_asyncpg_compatible(self) -> None:
        """Values match the strings asyncpg expects for isolation param."""
        valid = {"read_committed", "repeatable_read", "serializable"}
        for level in IsolationLevel:
            assert level.value in valid


class TestOperationType:
    """AC1: OperationType enum covers ForgeOS operations."""

    def test_claim_exists(self) -> None:
        assert OperationType.CLAIM.value == "claim"

    def test_advance_exists(self) -> None:
        assert OperationType.ADVANCE.value == "advance"

    def test_rework_exists(self) -> None:
        assert OperationType.REWORK.value == "rework"

    def test_release_exists(self) -> None:
        assert OperationType.RELEASE.value == "release"

    def test_spawn_exists(self) -> None:
        assert OperationType.SPAWN.value == "spawn"

    def test_read_exists(self) -> None:
        assert OperationType.READ.value == "read"


class TestOperationIsolation:
    """AC1: OperationIsolation is a frozen dataclass value object."""

    def test_frozen(self) -> None:
        oi = OperationIsolation(
            operation=OperationType.CLAIM,
            isolation=IsolationLevel.READ_COMMITTED,
            justification="test",
        )
        with pytest.raises(AttributeError):
            oi.operation = OperationType.ADVANCE  # type: ignore[misc]

    def test_fields(self) -> None:
        oi = OperationIsolation(
            operation=OperationType.ADVANCE,
            isolation=IsolationLevel.SERIALIZABLE,
            justification="prevents concurrent state corruption",
        )
        assert oi.operation == OperationType.ADVANCE
        assert oi.isolation == IsolationLevel.SERIALIZABLE
        assert "concurrent" in oi.justification


# ===========================================================================
# AC2: Claim operations run under READ COMMITTED isolation
# ===========================================================================


class TestClaimIsolation:
    """AC2: Claim operations are mapped to READ COMMITTED."""

    def test_isolation_for_claim(self) -> None:
        assert isolation_for(OperationType.CLAIM) == IsolationLevel.READ_COMMITTED

    def test_claim_mapping_has_justification(self) -> None:
        mapping = OPERATION_ISOLATION_MAP[OperationType.CLAIM]
        assert len(mapping.justification) > 0
        assert "SKIP LOCKED" in mapping.justification

    @pytest.mark.asyncio
    async def test_claim_transaction_uses_read_committed(self) -> None:
        """Verify the context manager passes READ_COMMITTED to conn.transaction()."""
        captured: list[str] = []
        pool = _make_mock_pool(isolation_capture=captured)

        async with transactional(pool, OperationType.CLAIM) as conn:
            assert conn is not None

        assert captured == ["read_committed"]


# ===========================================================================
# AC3: State transitions use SERIALIZABLE isolation
# ===========================================================================


class TestStateTransitionIsolation:
    """AC3: Advance and rework use SERIALIZABLE isolation."""

    def test_isolation_for_advance(self) -> None:
        assert isolation_for(OperationType.ADVANCE) == IsolationLevel.SERIALIZABLE

    def test_isolation_for_rework(self) -> None:
        assert isolation_for(OperationType.REWORK) == IsolationLevel.SERIALIZABLE

    def test_advance_mapping_justification(self) -> None:
        mapping = OPERATION_ISOLATION_MAP[OperationType.ADVANCE]
        assert "consistent snapshot" in mapping.justification

    def test_rework_mapping_justification(self) -> None:
        mapping = OPERATION_ISOLATION_MAP[OperationType.REWORK]
        assert "state transition" in mapping.justification

    @pytest.mark.asyncio
    async def test_advance_transaction_uses_serializable(self) -> None:
        captured: list[str] = []
        pool = _make_mock_pool(isolation_capture=captured)

        async with transactional(pool, OperationType.ADVANCE) as conn:
            assert conn is not None

        assert captured == ["serializable"]

    @pytest.mark.asyncio
    async def test_rework_transaction_uses_serializable(self) -> None:
        captured: list[str] = []
        pool = _make_mock_pool(isolation_capture=captured)

        async with transactional(pool, OperationType.REWORK) as conn:
            assert conn is not None

        assert captured == ["serializable"]


# ===========================================================================
# AC4: Serialization failures trigger automatic retry
# ===========================================================================


class TestSerializationRetry:
    """AC4: Serialization failure retries with configurable count."""

    def test_default_max_retries_is_three(self) -> None:
        assert DEFAULT_MAX_RETRIES == 3

    @pytest.mark.asyncio
    async def test_retries_on_serialization_failure(self) -> None:
        """Context manager retries the block on serialization_failure."""
        attempts: list[int] = []
        ser_err = _make_serialization_error()

        pool = AsyncMock()
        call_count = 0

        def make_conn() -> AsyncMock:
            nonlocal call_count
            call_count += 1
            c = AsyncMock()

            if call_count <= 2:
                # First two calls fail with serialization error
                c.transaction = MagicMock(
                    return_value=_FakeTransaction(fail_with=ser_err)
                )
            else:
                # Third call succeeds
                iso_captured: list[str] = []
                def fake_txn(*, isolation: str = "read_committed") -> _FakeTransaction:
                    iso_captured.append(isolation)
                    return _FakeTransaction()
                c.transaction = MagicMock(side_effect=fake_txn)
            return c

        pool.acquire = AsyncMock(side_effect=lambda: make_conn())
        pool.release = AsyncMock()

        async with transactional(
            pool, OperationType.ADVANCE, max_retries=3, base_delay=0.001
        ) as conn:
            attempts.append(1)

        # Should have acquired 3 connections (2 failures + 1 success)
        assert pool.acquire.call_count == 3
        assert pool.release.call_count == 3

    @pytest.mark.asyncio
    async def test_raises_serialization_error_after_max_retries(self) -> None:
        """After exhausting retries, SerializationError is raised."""
        ser_err = _make_serialization_error()
        pool = _make_mock_pool(transaction_error=ser_err)

        with pytest.raises(SerializationError) as exc_info:
            async with transactional(
                pool, OperationType.ADVANCE, max_retries=2, base_delay=0.001
            ) as conn:
                pass  # pragma: no cover

        assert exc_info.value.operation == OperationType.ADVANCE
        assert exc_info.value.attempts == 3  # initial + 2 retries

    @pytest.mark.asyncio
    async def test_custom_max_retries(self) -> None:
        """max_retries parameter controls retry count."""
        ser_err = _make_serialization_error()
        pool = _make_mock_pool(transaction_error=ser_err)

        with pytest.raises(SerializationError) as exc_info:
            async with transactional(
                pool, OperationType.REWORK, max_retries=5, base_delay=0.001
            ) as conn:
                pass  # pragma: no cover

        assert exc_info.value.attempts == 6  # initial + 5 retries

    @pytest.mark.asyncio
    async def test_non_serialization_error_not_retried(self) -> None:
        """Non-serialization errors propagate immediately without retry."""
        regular_err = RuntimeError("connection lost")
        pool = _make_mock_pool(transaction_error=regular_err)

        with pytest.raises(RuntimeError, match="connection lost"):
            async with transactional(
                pool, OperationType.ADVANCE, max_retries=3, base_delay=0.001
            ) as conn:
                pass  # pragma: no cover

        # Only one attempt — no retry for non-serialization errors.
        assert pool.acquire.call_count == 1

    def test_serialization_error_attributes(self) -> None:
        err = SerializationError(OperationType.ADVANCE, 3)
        assert err.operation == OperationType.ADVANCE
        assert err.attempts == 3
        assert "advance" in str(err)
        assert "3" in str(err)

    @pytest.mark.asyncio
    async def test_exponential_backoff_delays(self) -> None:
        """Verify that retries use exponential back-off."""
        ser_err = _make_serialization_error()
        pool = _make_mock_pool(transaction_error=ser_err)
        delays: list[float] = []

        original_sleep = asyncio.sleep

        async def mock_sleep(delay: float) -> None:
            delays.append(delay)

        with patch("mcp_server.locking.transaction_config.asyncio.sleep", mock_sleep):
            with pytest.raises(SerializationError):
                async with transactional(
                    pool,
                    OperationType.ADVANCE,
                    max_retries=3,
                    base_delay=0.1,
                ) as conn:
                    pass  # pragma: no cover

        # 3 retries → 3 sleep calls with exponential backoff
        assert len(delays) == 3
        assert delays[0] == pytest.approx(0.1)   # 0.1 * 2^0
        assert delays[1] == pytest.approx(0.2)   # 0.1 * 2^1
        assert delays[2] == pytest.approx(0.4)   # 0.1 * 2^2


# ===========================================================================
# AC5: Each transaction type is documented with justification
# ===========================================================================


class TestOperationDocumentation:
    """AC5: Every mapped operation has a non-empty justification."""

    def test_all_operations_have_mapping(self) -> None:
        """Every OperationType has a corresponding entry in the map."""
        for op in OperationType:
            assert op in OPERATION_ISOLATION_MAP, f"Missing mapping for {op.value}"

    def test_all_mappings_have_justification(self) -> None:
        """Every mapping has a non-empty justification string."""
        for op, mapping in OPERATION_ISOLATION_MAP.items():
            assert len(mapping.justification) > 20, (
                f"Justification for {op.value} is too short"
            )

    def test_mapping_consistency(self) -> None:
        """The operation field in each mapping matches its dict key."""
        for op, mapping in OPERATION_ISOLATION_MAP.items():
            assert mapping.operation == op

    @pytest.mark.parametrize(
        "operation,expected_isolation",
        [
            (OperationType.CLAIM, IsolationLevel.READ_COMMITTED),
            (OperationType.ADVANCE, IsolationLevel.SERIALIZABLE),
            (OperationType.REWORK, IsolationLevel.SERIALIZABLE),
            (OperationType.RELEASE, IsolationLevel.READ_COMMITTED),
            (OperationType.SPAWN, IsolationLevel.READ_COMMITTED),
            (OperationType.READ, IsolationLevel.READ_COMMITTED),
        ],
    )
    def test_operation_isolation_mapping(
        self, operation: OperationType, expected_isolation: IsolationLevel
    ) -> None:
        assert isolation_for(operation) == expected_isolation


# ===========================================================================
# AC6: Transaction wrapper integrates with the asyncpg connection pool
# ===========================================================================


class TestPoolIntegration:
    """AC6: Transaction wrapper acquires and releases pool connections."""

    @pytest.mark.asyncio
    async def test_acquires_connection_from_pool(self) -> None:
        pool = _make_mock_pool()

        async with transactional(pool, OperationType.CLAIM) as conn:
            assert conn is not None

        pool.acquire.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_releases_connection_after_success(self) -> None:
        pool = _make_mock_pool()

        async with transactional(pool, OperationType.READ) as conn:
            pass

        pool.release.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_releases_connection_after_error(self) -> None:
        """Connection is released even when the body raises."""
        pool = _make_mock_pool()

        with pytest.raises(ValueError, match="body error"):
            async with transactional(pool, OperationType.SPAWN) as conn:
                raise ValueError("body error")

        pool.release.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_releases_connection_after_serialization_exhaustion(self) -> None:
        """Connection is released after serialization retries are exhausted."""
        ser_err = _make_serialization_error()
        pool = _make_mock_pool(transaction_error=ser_err)

        with pytest.raises(SerializationError):
            async with transactional(
                pool, OperationType.ADVANCE, max_retries=1, base_delay=0.001
            ) as conn:
                pass  # pragma: no cover

        # initial + 1 retry = 2 releases
        assert pool.release.call_count == 2

    @pytest.mark.asyncio
    async def test_transaction_called_with_correct_isolation(self) -> None:
        """Verify conn.transaction() is called with the mapped isolation string."""
        captured: list[str] = []
        pool = _make_mock_pool(isolation_capture=captured)

        async with transactional(pool, OperationType.RELEASE) as conn:
            pass

        assert captured == ["read_committed"]

    @pytest.mark.asyncio
    async def test_different_operations_get_different_isolation(self) -> None:
        """Two operations with different isolation levels get correct params."""
        captured_claim: list[str] = []
        pool_claim = _make_mock_pool(isolation_capture=captured_claim)

        async with transactional(pool_claim, OperationType.CLAIM) as _:
            pass

        captured_advance: list[str] = []
        pool_advance = _make_mock_pool(isolation_capture=captured_advance)

        async with transactional(pool_advance, OperationType.ADVANCE) as _:
            pass

        assert captured_claim == ["read_committed"]
        assert captured_advance == ["serializable"]


# ===========================================================================
# Edge cases and error handling
# ===========================================================================


class TestEdgeCases:
    """Additional edge case tests for robustness."""

    @pytest.mark.asyncio
    async def test_zero_max_retries_no_retry(self) -> None:
        """With max_retries=0, serialization failure raises immediately."""
        ser_err = _make_serialization_error()
        pool = _make_mock_pool(transaction_error=ser_err)

        with pytest.raises(SerializationError) as exc_info:
            async with transactional(
                pool, OperationType.ADVANCE, max_retries=0, base_delay=0.001
            ) as conn:
                pass  # pragma: no cover

        assert exc_info.value.attempts == 1
        assert pool.acquire.call_count == 1

    def test_isolation_for_unknown_operation_raises(self) -> None:
        """isolation_for raises KeyError for unmapped operations."""
        # Create a mock operation not in the map
        with pytest.raises(KeyError):
            isolation_for("nonexistent")  # type: ignore[arg-type]

    def test_default_base_delay_is_reasonable(self) -> None:
        """Default base delay is between 10ms and 1s."""
        assert 0.01 <= DEFAULT_BASE_DELAY <= 1.0

    @pytest.mark.asyncio
    async def test_successful_transaction_no_retry(self) -> None:
        """A successful transaction completes without any retries."""
        pool = _make_mock_pool()

        body_executed = False
        async with transactional(pool, OperationType.READ) as conn:
            body_executed = True

        assert body_executed
        assert pool.acquire.call_count == 1

    def test_transaction_error_can_be_raised(self) -> None:
        """TransactionError is a plain exception for non-retryable failures."""
        err = TransactionError("test error")
        assert str(err) == "test error"
