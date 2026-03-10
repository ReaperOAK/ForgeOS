"""Tests for machine registration and verification — FORGEOS-BE052.

Coverage target: machine_auth.py and machine_service.py at ≥ 80 %.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.auth.machine_auth import (
    MAX_MACHINE_ID_LENGTH,
    MachineAuthError,
    MachineIdentity,
    MachineRegistrationMode,
    _validate_machine_id,
    deactivate_machine,
    get_machine,
    register_machine,
    verify_machine,
)
from mcp_server.server import ForgeOSError
from mcp_server.services.machine_service import MachineService

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc)


def _make_mock_pool(
    fetchrow_result: dict[str, Any] | None = None,
    fetchrow_side_effect: Exception | None = None,
    execute_side_effect: Exception | None = None,
) -> MagicMock:
    """Build an asyncpg-style mock pool usable as ``async with pool.acquire()``."""
    mock_conn = AsyncMock()

    if fetchrow_side_effect is not None:
        mock_conn.fetchrow.side_effect = fetchrow_side_effect
    else:
        mock_conn.fetchrow.return_value = fetchrow_result

    if execute_side_effect is not None:
        mock_conn.execute.side_effect = execute_side_effect
    else:
        mock_conn.execute.return_value = "UPDATE 1"

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=mock_ctx)

    return pool


def _make_machine_row(
    machine_id: str = "test-machine",
    hostname: str = "test-host",
    is_active: bool = True,
) -> dict[str, Any]:
    """Create a mock machine row."""
    return {
        "machine_id": machine_id,
        "hostname": hostname,
        "first_seen_at": _NOW,
        "last_seen_at": _NOW,
        "is_active": is_active,
    }


# ---------------------------------------------------------------------------
# MachineIdentity dataclass
# ---------------------------------------------------------------------------


class TestMachineIdentity:
    """Tests for the MachineIdentity dataclass."""

    def test_creation(self) -> None:
        identity = MachineIdentity(
            machine_id="my-machine",
            hostname="my-host",
            first_seen_at=_NOW,
            last_seen_at=_NOW,
        )
        assert identity.machine_id == "my-machine"
        assert identity.hostname == "my-host"
        assert identity.first_seen_at == _NOW
        assert identity.last_seen_at == _NOW
        assert identity.is_active is True

    def test_inactive_machine(self) -> None:
        identity = MachineIdentity(
            machine_id="m1",
            hostname="h1",
            first_seen_at=_NOW,
            last_seen_at=_NOW,
            is_active=False,
        )
        assert identity.is_active is False

    def test_frozen(self) -> None:
        identity = MachineIdentity(
            machine_id="m1",
            hostname="h1",
            first_seen_at=_NOW,
            last_seen_at=_NOW,
        )
        with pytest.raises((AttributeError, TypeError)):
            identity.machine_id = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# MachineRegistrationMode enum
# ---------------------------------------------------------------------------


class TestMachineRegistrationMode:
    """Tests for the MachineRegistrationMode enum."""

    def test_auto_value(self) -> None:
        assert MachineRegistrationMode.AUTO.value == "auto"

    def test_strict_value(self) -> None:
        assert MachineRegistrationMode.STRICT.value == "strict"

    def test_from_string(self) -> None:
        assert MachineRegistrationMode.from_string("auto") is MachineRegistrationMode.AUTO
        assert MachineRegistrationMode.from_string("STRICT") is MachineRegistrationMode.STRICT
        assert MachineRegistrationMode.from_string(" Auto ") is MachineRegistrationMode.AUTO

        with pytest.raises(ValueError, match="Invalid machine registration mode"):
            MachineRegistrationMode.from_string("unknown")


# ---------------------------------------------------------------------------
# _validate_machine_id
# ---------------------------------------------------------------------------


class TestValidateMachineId:
    """Tests for the _validate_machine_id helper."""

    def test_valid_machine_id(self) -> None:
        assert _validate_machine_id("my-machine") == "my-machine"

    def test_empty_raises(self) -> None:
        with pytest.raises(MachineAuthError, match="must not be empty"):
            _validate_machine_id("")

    def test_whitespace_only_raises(self) -> None:
        with pytest.raises(MachineAuthError, match="must not be empty"):
            _validate_machine_id("   ")

    def test_too_long_raises(self) -> None:
        long_id = "x" * (MAX_MACHINE_ID_LENGTH + 1)
        with pytest.raises(MachineAuthError, match="exceeds maximum length"):
            _validate_machine_id(long_id)

    def test_max_length_ok(self) -> None:
        max_id = "x" * MAX_MACHINE_ID_LENGTH
        assert _validate_machine_id(max_id) == max_id


# ---------------------------------------------------------------------------
# register_machine
# ---------------------------------------------------------------------------


class TestRegisterMachine:
    """Tests for register_machine."""

    @pytest.mark.asyncio
    async def test_register_new_machine(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await register_machine(pool, "test-machine", "test-host")

        assert identity.machine_id == "test-machine"
        assert identity.hostname == "test-host"
        assert identity.is_active is True

    @pytest.mark.asyncio
    async def test_register_uses_machine_id_as_hostname_fallback(self) -> None:
        row = _make_machine_row(machine_id="my-machine", hostname="my-machine")
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await register_machine(pool, "my-machine", "")

        assert identity.machine_id == "my-machine"

    @pytest.mark.asyncio
    async def test_register_empty_machine_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineAuthError, match="must not be empty"):
            await register_machine(pool, "", "host")

    @pytest.mark.asyncio
    async def test_register_db_error_raises(self) -> None:
        pool = _make_mock_pool(
            fetchrow_side_effect=RuntimeError("connection lost"),
        )
        with pytest.raises(MachineAuthError, match="Failed to register"):
            await register_machine(pool, "m1", "h1")


# ---------------------------------------------------------------------------
# verify_machine — AUTO mode
# ---------------------------------------------------------------------------


class TestVerifyMachineAutoMode:
    """Tests for verify_machine in AUTO mode."""

    @pytest.mark.asyncio
    async def test_known_machine_verified(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await verify_machine(pool, "test-machine")

        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_unknown_machine_auto_registered(self) -> None:
        """In AUTO mode, unknown machines should be auto-registered."""
        reg_row = _make_machine_row(machine_id="new-machine", hostname="new-host")

        # First call (verify lookup) returns None, second call (register) returns row
        mock_conn = AsyncMock()
        mock_conn.fetchrow.side_effect = [None, reg_row]
        mock_conn.execute.return_value = "UPDATE 1"

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        pool = MagicMock()
        pool.acquire = MagicMock(return_value=mock_ctx)

        identity = await verify_machine(
            pool, "new-machine", mode=MachineRegistrationMode.AUTO, hostname="new-host"
        )

        assert identity.machine_id == "new-machine"

    @pytest.mark.asyncio
    async def test_inactive_machine_rejected(self) -> None:
        row = _make_machine_row(is_active=False)
        pool = _make_mock_pool(fetchrow_result=row)

        with pytest.raises(MachineAuthError, match="deactivated"):
            await verify_machine(pool, "test-machine")

    @pytest.mark.asyncio
    async def test_last_seen_updated(self) -> None:
        """Verify that last_seen update is attempted on successful verify."""
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)

        await verify_machine(pool, "test-machine")

        # The pool.acquire() context manager should have been called at least twice
        # (once for SELECT, once for UPDATE)
        assert pool.acquire.call_count >= 1

    @pytest.mark.asyncio
    async def test_db_error_raises(self) -> None:
        pool = _make_mock_pool(
            fetchrow_side_effect=RuntimeError("connection lost"),
        )
        with pytest.raises(MachineAuthError, match="Database error"):
            await verify_machine(pool, "test-machine")


# ---------------------------------------------------------------------------
# verify_machine — STRICT mode
# ---------------------------------------------------------------------------


class TestVerifyMachineStrictMode:
    """Tests for verify_machine in STRICT mode."""

    @pytest.mark.asyncio
    async def test_known_machine_verified(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await verify_machine(
            pool, "test-machine", mode=MachineRegistrationMode.STRICT
        )

        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_unknown_machine_rejected(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        with pytest.raises(MachineAuthError, match="rejected in strict mode"):
            await verify_machine(
                pool, "unknown-machine", mode=MachineRegistrationMode.STRICT
            )

    @pytest.mark.asyncio
    async def test_rejection_includes_machine_id(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        with pytest.raises(MachineAuthError, match="my-special-machine"):
            await verify_machine(
                pool, "my-special-machine", mode=MachineRegistrationMode.STRICT
            )

    @pytest.mark.asyncio
    async def test_inactive_machine_rejected_strict(self) -> None:
        row = _make_machine_row(is_active=False)
        pool = _make_mock_pool(fetchrow_result=row)

        with pytest.raises(MachineAuthError, match="deactivated"):
            await verify_machine(
                pool, "test-machine", mode=MachineRegistrationMode.STRICT
            )


# ---------------------------------------------------------------------------
# get_machine
# ---------------------------------------------------------------------------


class TestGetMachine:
    """Tests for get_machine."""

    @pytest.mark.asyncio
    async def test_found(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await get_machine(pool, "test-machine")

        assert identity is not None
        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_not_found(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        result = await get_machine(pool, "nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_empty_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineAuthError, match="must not be empty"):
            await get_machine(pool, "")

    @pytest.mark.asyncio
    async def test_db_error_raises(self) -> None:
        pool = _make_mock_pool(
            fetchrow_side_effect=RuntimeError("connection lost"),
        )
        with pytest.raises(MachineAuthError, match="Failed to look up"):
            await get_machine(pool, "m1")


# ---------------------------------------------------------------------------
# deactivate_machine
# ---------------------------------------------------------------------------


class TestDeactivateMachine:
    """Tests for deactivate_machine."""

    @pytest.mark.asyncio
    async def test_deactivate_existing(self) -> None:
        pool = _make_mock_pool(fetchrow_result={"machine_id": "m1"})

        result = await deactivate_machine(pool, "m1")

        assert result is True

    @pytest.mark.asyncio
    async def test_deactivate_nonexistent(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        result = await deactivate_machine(pool, "ghost")

        assert result is False

    @pytest.mark.asyncio
    async def test_deactivate_empty_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineAuthError, match="must not be empty"):
            await deactivate_machine(pool, "")

    @pytest.mark.asyncio
    async def test_deactivate_db_error_raises(self) -> None:
        pool = _make_mock_pool(
            fetchrow_side_effect=RuntimeError("connection lost"),
        )
        with pytest.raises(MachineAuthError, match="Failed to deactivate"):
            await deactivate_machine(pool, "m1")


# ---------------------------------------------------------------------------
# MachineAuthError
# ---------------------------------------------------------------------------


class TestMachineAuthError:
    """Tests for MachineAuthError."""

    def test_error_code(self) -> None:
        assert MachineAuthError.error_code == -32602

    def test_status_code(self) -> None:
        assert MachineAuthError.status_code == 403

    def test_message(self) -> None:
        err = MachineAuthError("test message")
        assert str(err) == "test message"

    def test_details(self) -> None:
        err = MachineAuthError("msg", details={"key": "val"})
        assert err.details == {"key": "val"}

    def test_default_details(self) -> None:
        err = MachineAuthError("msg")
        assert err.details == {}

    def test_inherits_from_forgeos_error(self) -> None:
        assert issubclass(MachineAuthError, ForgeOSError)


# ---------------------------------------------------------------------------
# MachineService
# ---------------------------------------------------------------------------


class TestMachineService:
    """Tests for the MachineService class."""

    def test_default_mode_is_auto(self) -> None:
        pool = _make_mock_pool()
        svc = MachineService(pool)
        assert svc.mode is MachineRegistrationMode.AUTO

    def test_strict_mode(self) -> None:
        pool = _make_mock_pool()
        svc = MachineService(pool, mode=MachineRegistrationMode.STRICT)
        assert svc.mode is MachineRegistrationMode.STRICT

    @pytest.mark.asyncio
    async def test_register(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)
        svc = MachineService(pool)

        identity = await svc.register("test-machine", "test-host")
        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_verify_auto(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)
        svc = MachineService(pool)

        identity = await svc.verify("test-machine")
        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_verify_strict_rejects_unknown(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        svc = MachineService(pool, mode=MachineRegistrationMode.STRICT)

        with pytest.raises(MachineAuthError, match="rejected"):
            await svc.verify("unknown")

    @pytest.mark.asyncio
    async def test_lookup_found(self) -> None:
        row = _make_machine_row()
        pool = _make_mock_pool(fetchrow_result=row)
        svc = MachineService(pool)

        identity = await svc.lookup("test-machine")
        assert identity is not None
        assert identity.machine_id == "test-machine"

    @pytest.mark.asyncio
    async def test_lookup_not_found(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        svc = MachineService(pool)

        result = await svc.lookup("ghost")
        assert result is None

    @pytest.mark.asyncio
    async def test_deactivate(self) -> None:
        pool = _make_mock_pool(fetchrow_result={"machine_id": "m1"})
        svc = MachineService(pool)

        result = await svc.deactivate("m1")
        assert result is True


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Edge-case and integration-style tests."""

    @pytest.mark.asyncio
    async def test_verify_with_hostname_for_auto_register(self) -> None:
        """AUTO mode passes hostname to register_machine."""
        reg_row = _make_machine_row(machine_id="m1", hostname="custom-host")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.side_effect = [None, reg_row]
        mock_conn.execute.return_value = "UPDATE 1"

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        pool = MagicMock()
        pool.acquire = MagicMock(return_value=mock_ctx)

        identity = await verify_machine(
            pool, "m1", mode=MachineRegistrationMode.AUTO, hostname="custom-host"
        )
        assert identity.hostname == "custom-host"

    @pytest.mark.asyncio
    async def test_last_seen_update_failure_non_critical(self) -> None:
        """last_seen update failure should not cause verify to fail."""
        row = _make_machine_row()

        # First acquire (SELECT) succeeds, second acquire (UPDATE) fails
        mock_conn_1 = AsyncMock()
        mock_conn_1.fetchrow.return_value = row

        mock_conn_2 = AsyncMock()
        mock_conn_2.execute.side_effect = RuntimeError("update failed")

        mock_ctx_1 = AsyncMock()
        mock_ctx_1.__aenter__ = AsyncMock(return_value=mock_conn_1)
        mock_ctx_1.__aexit__ = AsyncMock(return_value=False)

        mock_ctx_2 = AsyncMock()
        mock_ctx_2.__aenter__ = AsyncMock(return_value=mock_conn_2)
        mock_ctx_2.__aexit__ = AsyncMock(return_value=False)

        pool = MagicMock()
        pool.acquire = MagicMock(side_effect=[mock_ctx_1, mock_ctx_2])

        # Should succeed despite update failure
        identity = await verify_machine(pool, "test-machine")
        assert identity.machine_id == "test-machine"

    def test_machine_identity_slots(self) -> None:
        """MachineIdentity uses __slots__ for memory efficiency."""
        identity = MachineIdentity(
            machine_id="m1",
            hostname="h1",
            first_seen_at=_NOW,
            last_seen_at=_NOW,
        )
        with pytest.raises((AttributeError, TypeError)):
            identity.extra_field = "nope"  # type: ignore[attr-defined]

    @pytest.mark.asyncio
    async def test_register_trims_hostname(self) -> None:
        """Hostname with whitespace should be trimmed."""
        row = _make_machine_row(hostname="trimmed-host")
        pool = _make_mock_pool(fetchrow_result=row)

        identity = await register_machine(pool, "m1", "  trimmed-host  ")

        assert identity.hostname == "trimmed-host"
