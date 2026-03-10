"""Tests for operator machine-scoped permissions — FORGEOS-BE056.

Covers:
- OperatorMachineBinding dataclass
- MachineScopeError exception (403)
- check_operator_machine_binding (binding lookup)
- require_operator_machine_access (enforcement with admin bypass)
- add_binding (create / idempotent upsert)
- remove_binding (delete)
- list_bindings (list all for an operator)
- operator_service binding management wrappers
- Edge cases (empty inputs, database errors)

TDD Evidence
------------
- RED: Tests written first to define expected behavior.
- GREEN: Implementation created to satisfy these tests.
- REFACTOR: Code cleaned up, naming standardized.

.. meta::
   :ticket: FORGEOS-BE056
"""

from __future__ import annotations

import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.auth.authorization import (
    ADMIN_ROLE,
    MachineScopeError,
    OperatorMachineBinding,
    add_binding,
    check_operator_machine_binding,
    list_bindings,
    remove_binding,
    require_operator_machine_access,
)
from mcp_server.server import ForgeOSError
from mcp_server.services.operator_service import (
    bind_operator_to_machine,
    get_operator_bindings,
    unbind_operator_from_machine,
    validate_operator_machine_access,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_NOW = datetime.datetime(2026, 3, 11, 12, 0, tzinfo=datetime.timezone.utc)
_OP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
_MACHINE_ID = "pop-os"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_mock_pool(
    fetchrow_result: dict[str, Any] | None = None,
    fetchrow_side_effect: Exception | None = None,
    fetch_result: list[dict[str, Any]] | None = None,
    execute_result: str = "DELETE 1",
    execute_side_effect: Exception | None = None,
) -> MagicMock:
    """Build an asyncpg-style mock pool."""
    mock_conn = AsyncMock()

    if fetchrow_side_effect is not None:
        mock_conn.fetchrow.side_effect = fetchrow_side_effect
    else:
        mock_conn.fetchrow.return_value = fetchrow_result

    if execute_side_effect is not None:
        mock_conn.execute.side_effect = execute_side_effect
    else:
        mock_conn.execute.return_value = execute_result

    mock_conn.fetch.return_value = fetch_result or []

    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=mock_ctx)

    return pool


def _make_binding_row(
    operator_id: str = _OP_ID,
    machine_id: str = _MACHINE_ID,
    binding_id: str = "11111111-2222-3333-4444-555555555555",
) -> dict[str, Any]:
    """Create a mock binding row."""
    return {
        "id": binding_id,
        "operator_id": operator_id,
        "machine_id": machine_id,
        "registered_at": _NOW,
    }


# ---------------------------------------------------------------------------
# OperatorMachineBinding dataclass
# ---------------------------------------------------------------------------


class TestOperatorMachineBinding:
    """Tests for the OperatorMachineBinding dataclass."""

    def test_creation(self) -> None:
        binding = OperatorMachineBinding(
            id="some-id",
            operator_id=_OP_ID,
            machine_id=_MACHINE_ID,
            registered_at=_NOW,
        )
        assert binding.id == "some-id"
        assert binding.operator_id == _OP_ID
        assert binding.machine_id == _MACHINE_ID
        assert binding.registered_at == _NOW

    def test_frozen(self) -> None:
        binding = OperatorMachineBinding(
            id="id", operator_id=_OP_ID, machine_id="m1", registered_at=_NOW
        )
        with pytest.raises((AttributeError, TypeError)):
            binding.machine_id = "other"  # type: ignore[misc]

    def test_slots(self) -> None:
        binding = OperatorMachineBinding(
            id="id", operator_id=_OP_ID, machine_id="m1", registered_at=_NOW
        )
        assert not hasattr(binding, "__dict__")


# ---------------------------------------------------------------------------
# MachineScopeError
# ---------------------------------------------------------------------------


class TestMachineScopeError:
    """Tests for the MachineScopeError exception."""

    def test_is_forgeos_error(self) -> None:
        err = MachineScopeError("denied")
        assert isinstance(err, ForgeOSError)

    def test_status_code_403(self) -> None:
        err = MachineScopeError("denied")
        assert err.status_code == 403

    def test_message_and_details(self) -> None:
        err = MachineScopeError("not bound", details={"reason": "test"})
        assert str(err) == "not bound"
        assert err.details == {"reason": "test"}


# ---------------------------------------------------------------------------
# check_operator_machine_binding
# ---------------------------------------------------------------------------


class TestCheckOperatorMachineBinding:
    """Tests for check_operator_machine_binding function."""

    async def test_binding_exists(self) -> None:
        pool = _make_mock_pool(fetchrow_result={"exists": 1})
        result = await check_operator_machine_binding(pool, _OP_ID, _MACHINE_ID)
        assert result is True

    async def test_binding_does_not_exist(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        result = await check_operator_machine_binding(pool, _OP_ID, _MACHINE_ID)
        assert result is False

    async def test_empty_operator_id_returns_false(self) -> None:
        pool = _make_mock_pool()
        result = await check_operator_machine_binding(pool, "", _MACHINE_ID)
        assert result is False

    async def test_empty_machine_id_returns_false(self) -> None:
        pool = _make_mock_pool()
        result = await check_operator_machine_binding(pool, _OP_ID, "")
        assert result is False


# ---------------------------------------------------------------------------
# require_operator_machine_access
# ---------------------------------------------------------------------------


class TestRequireOperatorMachineAccess:
    """Tests for require_operator_machine_access function."""

    async def test_admin_bypasses_check(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        # Admin should not raise even when no binding exists
        await require_operator_machine_access(pool, _OP_ID, _MACHINE_ID, ADMIN_ROLE)

    async def test_bound_operator_allowed(self) -> None:
        pool = _make_mock_pool(fetchrow_result={"exists": 1})
        await require_operator_machine_access(pool, _OP_ID, _MACHINE_ID, "operator")

    async def test_unbound_operator_raises_403(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        with pytest.raises(MachineScopeError, match="not bound"):
            await require_operator_machine_access(
                pool, _OP_ID, _MACHINE_ID, "operator"
            )

    async def test_unbound_viewer_raises_403(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        with pytest.raises(MachineScopeError) as exc_info:
            await require_operator_machine_access(
                pool, _OP_ID, _MACHINE_ID, "viewer"
            )
        assert exc_info.value.status_code == 403
        assert exc_info.value.details["reason"] == "operator_not_bound"


# ---------------------------------------------------------------------------
# add_binding
# ---------------------------------------------------------------------------


class TestAddBinding:
    """Tests for add_binding function."""

    async def test_creates_binding(self) -> None:
        row = _make_binding_row()
        pool = _make_mock_pool(fetchrow_result=row)
        binding = await add_binding(pool, _OP_ID, _MACHINE_ID)
        assert isinstance(binding, OperatorMachineBinding)
        assert binding.operator_id == _OP_ID
        assert binding.machine_id == _MACHINE_ID

    async def test_idempotent_upsert(self) -> None:
        """Second add for same pair should return existing binding."""
        row = _make_binding_row()
        pool = _make_mock_pool(fetchrow_result=row)
        b1 = await add_binding(pool, _OP_ID, _MACHINE_ID)
        b2 = await add_binding(pool, _OP_ID, _MACHINE_ID)
        assert b1.operator_id == b2.operator_id
        assert b1.machine_id == b2.machine_id

    async def test_empty_operator_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError, match="operator_id must not be empty"):
            await add_binding(pool, "", _MACHINE_ID)

    async def test_empty_machine_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError, match="machine_id must not be empty"):
            await add_binding(pool, _OP_ID, "")

    async def test_whitespace_only_operator_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError):
            await add_binding(pool, "   ", _MACHINE_ID)

    async def test_whitespace_only_machine_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError):
            await add_binding(pool, _OP_ID, "   ")

    async def test_database_error_raises(self) -> None:
        pool = _make_mock_pool(
            fetchrow_side_effect=RuntimeError("connection lost")
        )
        with pytest.raises(MachineScopeError, match="Failed to add binding"):
            await add_binding(pool, _OP_ID, _MACHINE_ID)

    async def test_strips_machine_id(self) -> None:
        row = _make_binding_row(machine_id="pop-os")
        pool = _make_mock_pool(fetchrow_result=row)
        binding = await add_binding(pool, _OP_ID, "  pop-os  ")
        assert binding.machine_id == "pop-os"


# ---------------------------------------------------------------------------
# remove_binding
# ---------------------------------------------------------------------------


class TestRemoveBinding:
    """Tests for remove_binding function."""

    async def test_removes_existing_binding(self) -> None:
        pool = _make_mock_pool(execute_result="DELETE 1")
        result = await remove_binding(pool, _OP_ID, _MACHINE_ID)
        assert result is True

    async def test_returns_false_when_not_found(self) -> None:
        pool = _make_mock_pool(execute_result="DELETE 0")
        result = await remove_binding(pool, _OP_ID, _MACHINE_ID)
        assert result is False

    async def test_empty_operator_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError, match="operator_id must not be empty"):
            await remove_binding(pool, "", _MACHINE_ID)

    async def test_empty_machine_id_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(MachineScopeError, match="machine_id must not be empty"):
            await remove_binding(pool, _OP_ID, "")

    async def test_database_error_raises(self) -> None:
        pool = _make_mock_pool(execute_side_effect=RuntimeError("db error"))
        with pytest.raises(MachineScopeError, match="Failed to remove binding"):
            await remove_binding(pool, _OP_ID, _MACHINE_ID)


# ---------------------------------------------------------------------------
# list_bindings
# ---------------------------------------------------------------------------


class TestListBindings:
    """Tests for list_bindings function."""

    async def test_returns_empty_for_no_bindings(self) -> None:
        pool = _make_mock_pool(fetch_result=[])
        result = await list_bindings(pool, _OP_ID)
        assert result == []

    async def test_returns_bindings(self) -> None:
        rows = [
            _make_binding_row(machine_id="machine-a", binding_id="id-1"),
            _make_binding_row(machine_id="machine-b", binding_id="id-2"),
        ]
        pool = _make_mock_pool(fetch_result=rows)
        result = await list_bindings(pool, _OP_ID)
        assert len(result) == 2
        assert result[0].machine_id == "machine-a"
        assert result[1].machine_id == "machine-b"

    async def test_empty_operator_returns_empty(self) -> None:
        pool = _make_mock_pool()
        result = await list_bindings(pool, "")
        assert result == []

    async def test_bindings_are_operator_machine_binding_instances(self) -> None:
        rows = [_make_binding_row()]
        pool = _make_mock_pool(fetch_result=rows)
        result = await list_bindings(pool, _OP_ID)
        assert all(isinstance(b, OperatorMachineBinding) for b in result)


# ---------------------------------------------------------------------------
# Operator can register to multiple machines
# ---------------------------------------------------------------------------


class TestMultipleMachineBindings:
    """Tests that an operator can be bound to multiple machines."""

    async def test_operator_bound_to_multiple_machines(self) -> None:
        rows = [
            _make_binding_row(machine_id="machine-1", binding_id="id-1"),
            _make_binding_row(machine_id="machine-2", binding_id="id-2"),
            _make_binding_row(machine_id="machine-3", binding_id="id-3"),
        ]
        pool = _make_mock_pool(fetch_result=rows)
        result = await list_bindings(pool, _OP_ID)
        assert len(result) == 3
        machine_ids = {b.machine_id for b in result}
        assert machine_ids == {"machine-1", "machine-2", "machine-3"}


# ---------------------------------------------------------------------------
# Operator service — bind/unbind/list wrappers
# ---------------------------------------------------------------------------


class TestBindOperatorToMachine:
    """Tests for operator_service.bind_operator_to_machine."""

    async def test_returns_dict(self) -> None:
        row = _make_binding_row()
        pool = _make_mock_pool(fetchrow_result=row)
        result = await bind_operator_to_machine(pool, _OP_ID, _MACHINE_ID)
        assert result["operator_id"] == _OP_ID
        assert result["machine_id"] == _MACHINE_ID
        assert "registered_at" in result


class TestUnbindOperatorFromMachine:
    """Tests for operator_service.unbind_operator_from_machine."""

    async def test_removed_true(self) -> None:
        pool = _make_mock_pool(execute_result="DELETE 1")
        result = await unbind_operator_from_machine(pool, _OP_ID, _MACHINE_ID)
        assert result["removed"] is True
        assert result["operator_id"] == _OP_ID

    async def test_removed_false(self) -> None:
        pool = _make_mock_pool(execute_result="DELETE 0")
        result = await unbind_operator_from_machine(pool, _OP_ID, _MACHINE_ID)
        assert result["removed"] is False


class TestGetOperatorBindings:
    """Tests for operator_service.get_operator_bindings."""

    async def test_returns_list_of_dicts(self) -> None:
        rows = [
            _make_binding_row(machine_id="m-a", binding_id="id-1"),
            _make_binding_row(machine_id="m-b", binding_id="id-2"),
        ]
        pool = _make_mock_pool(fetch_result=rows)
        result = await get_operator_bindings(pool, _OP_ID)
        assert len(result) == 2
        assert result[0]["machine_id"] == "m-a"
        assert "registered_at" in result[0]

    async def test_empty_when_no_bindings(self) -> None:
        pool = _make_mock_pool(fetch_result=[])
        result = await get_operator_bindings(pool, _OP_ID)
        assert result == []


class TestValidateOperatorMachineAccess:
    """Tests for operator_service.validate_operator_machine_access."""

    async def test_admin_passes(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        await validate_operator_machine_access(pool, _OP_ID, _MACHINE_ID, "admin")

    async def test_bound_operator_passes(self) -> None:
        pool = _make_mock_pool(fetchrow_result={"exists": 1})
        await validate_operator_machine_access(pool, _OP_ID, _MACHINE_ID, "operator")

    async def test_unbound_operator_raises(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        with pytest.raises(MachineScopeError):
            await validate_operator_machine_access(
                pool, _OP_ID, _MACHINE_ID, "operator"
            )


# ---------------------------------------------------------------------------
# ADMIN_ROLE constant
# ---------------------------------------------------------------------------


class TestAdminRole:
    """Tests for the ADMIN_ROLE constant."""

    def test_admin_role_value(self) -> None:
        assert ADMIN_ROLE == "admin"
