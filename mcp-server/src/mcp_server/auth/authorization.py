"""Operator machine-scoped permission checks for the ForgeOS MCP Server.

Enforces that operators can only perform REST operations on machines
they are registered to.  Admin operators bypass all machine binding
checks.

Architecture
------------
* **Binding table** — ``operator_machine_bindings`` maps operator UUIDs
  to machine identifier strings (many-to-many).
* **Admin bypass** — operators with role ``"admin"`` skip binding checks.
* **UPSERT bindings** — ``add_binding`` uses ``ON CONFLICT DO NOTHING``
  for idempotency.

Security
--------
* Unbound operator-machine pairs are rejected with 403 Forbidden.
* Admin bypass is based on the ``role`` field in the ``operators`` table.
* All authorization decisions are structurally logged.

.. meta::
   :ticket: FORGEOS-BE056
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, ForgeOSError

logger = get_logger("authorization")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ADMIN_ROLE: str = "admin"
"""Role string that bypasses machine binding checks."""


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class OperatorMachineBinding:
    """Immutable descriptor for an operator-machine binding.

    Attributes
    ----------
    id : str
        UUID of the binding record.
    operator_id : str
        UUID of the operator.
    machine_id : str
        Machine identifier string.
    registered_at : datetime.datetime
        When the binding was created (UTC).
    """

    id: str
    operator_id: str
    machine_id: str
    registered_at: datetime.datetime


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class MachineScopeError(ForgeOSError):
    """Raised when an operator is not bound to the requested machine.

    Maps to HTTP 403 Forbidden.
    """

    error_code: int = INVALID_PARAMS
    status_code: int = 403


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _row_to_binding(row: dict[str, Any]) -> OperatorMachineBinding:
    """Convert a database row dict to an :class:`OperatorMachineBinding`."""
    return OperatorMachineBinding(
        id=str(row["id"]),
        operator_id=str(row["operator_id"]),
        machine_id=row["machine_id"],
        registered_at=row["registered_at"],
    )


# ---------------------------------------------------------------------------
# Public API — checks
# ---------------------------------------------------------------------------


async def check_operator_machine_binding(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
) -> bool:
    """Check whether an operator is bound to a machine.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.
    machine_id : str
        Machine identifier string.

    Returns
    -------
    bool
        ``True`` if a binding exists, ``False`` otherwise.
    """
    if not operator_id or not machine_id:
        return False

    sql = """
        SELECT 1 FROM operator_machine_bindings
        WHERE operator_id = $1 AND machine_id = $2
        LIMIT 1
    """
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(sql, operator_id, machine_id)
    return row is not None


async def require_operator_machine_access(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
    role: str,
) -> None:
    """Enforce that an operator may act on the given machine.

    Admin operators (role == ``"admin"``) bypass the check entirely.
    Non-admin operators must have a binding in the
    ``operator_machine_bindings`` table.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.
    machine_id : str
        Machine identifier string from the request.
    role : str
        Operator role (e.g. ``"admin"``, ``"operator"``).

    Raises
    ------
    MachineScopeError
        If the operator is not bound to the machine and is not an admin.
    """
    if role == ADMIN_ROLE:
        logger.info(
            "machine_scope_bypass",
            extra={
                "operator_id": operator_id,
                "machine_id": machine_id,
                "reason": "admin_role",
            },
        )
        return

    bound = await check_operator_machine_binding(db_pool, operator_id, machine_id)
    if not bound:
        logger.warning(
            "machine_scope_denied",
            extra={
                "operator_id": operator_id,
                "machine_id": machine_id,
            },
        )
        raise MachineScopeError(
            f"Operator {operator_id!r} is not bound to machine {machine_id!r}",
            details={
                "reason": "operator_not_bound",
                "operator_id": operator_id,
                "machine_id": machine_id,
            },
        )

    logger.info(
        "machine_scope_allowed",
        extra={
            "operator_id": operator_id,
            "machine_id": machine_id,
        },
    )


# ---------------------------------------------------------------------------
# Public API — binding management
# ---------------------------------------------------------------------------


async def add_binding(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
) -> OperatorMachineBinding:
    """Add an operator-machine binding.

    Uses ``INSERT ... ON CONFLICT DO NOTHING`` so duplicate bindings
    are idempotent.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.
    machine_id : str
        Machine identifier string.

    Returns
    -------
    OperatorMachineBinding
        The created (or existing) binding.

    Raises
    ------
    MachineScopeError
        If operator_id or machine_id is empty, or a database error occurs.
    """
    if not operator_id or not operator_id.strip():
        raise MachineScopeError(
            "operator_id must not be empty",
            details={"reason": "empty_operator_id"},
        )
    if not machine_id or not machine_id.strip():
        raise MachineScopeError(
            "machine_id must not be empty",
            details={"reason": "empty_machine_id"},
        )

    clean_machine = machine_id.strip()

    sql = """
        INSERT INTO operator_machine_bindings (operator_id, machine_id)
        VALUES ($1, $2)
        ON CONFLICT (operator_id, machine_id) DO UPDATE
            SET registered_at = operator_machine_bindings.registered_at
        RETURNING id, operator_id, machine_id, registered_at
    """

    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(sql, operator_id, clean_machine)
    except Exception as exc:
        logger.error(
            "add_binding_failed",
            extra={
                "operator_id": operator_id,
                "machine_id": clean_machine,
                "error": str(exc),
            },
        )
        raise MachineScopeError(
            f"Failed to add binding for operator {operator_id!r} "
            f"to machine {clean_machine!r}: {exc}",
            details={"reason": "database_error"},
        ) from exc

    logger.info(
        "binding_added",
        extra={"operator_id": operator_id, "machine_id": clean_machine},
    )
    return _row_to_binding(dict(row))


async def remove_binding(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
) -> bool:
    """Remove an operator-machine binding.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.
    machine_id : str
        Machine identifier string.

    Returns
    -------
    bool
        ``True`` if a binding was deleted, ``False`` if none existed.

    Raises
    ------
    MachineScopeError
        If operator_id or machine_id is empty.
    """
    if not operator_id or not operator_id.strip():
        raise MachineScopeError(
            "operator_id must not be empty",
            details={"reason": "empty_operator_id"},
        )
    if not machine_id or not machine_id.strip():
        raise MachineScopeError(
            "machine_id must not be empty",
            details={"reason": "empty_machine_id"},
        )

    clean_machine = machine_id.strip()

    sql = """
        DELETE FROM operator_machine_bindings
        WHERE operator_id = $1 AND machine_id = $2
    """

    try:
        async with db_pool.acquire() as conn:
            result = await conn.execute(sql, operator_id, clean_machine)
    except Exception as exc:
        logger.error(
            "remove_binding_failed",
            extra={
                "operator_id": operator_id,
                "machine_id": clean_machine,
                "error": str(exc),
            },
        )
        raise MachineScopeError(
            f"Failed to remove binding: {exc}",
            details={"reason": "database_error"},
        ) from exc

    deleted = result == "DELETE 1"
    if deleted:
        logger.info(
            "binding_removed",
            extra={"operator_id": operator_id, "machine_id": clean_machine},
        )
    else:
        logger.info(
            "binding_not_found",
            extra={"operator_id": operator_id, "machine_id": clean_machine},
        )
    return deleted


async def list_bindings(
    db_pool: Any,
    operator_id: str,
) -> list[OperatorMachineBinding]:
    """List all machine bindings for an operator.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.

    Returns
    -------
    list[OperatorMachineBinding]
        All bindings for the operator, ordered by registration time.
    """
    if not operator_id:
        return []

    sql = """
        SELECT id, operator_id, machine_id, registered_at
        FROM operator_machine_bindings
        WHERE operator_id = $1
        ORDER BY registered_at ASC
    """

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(sql, operator_id)

    return [_row_to_binding(dict(r)) for r in rows]
