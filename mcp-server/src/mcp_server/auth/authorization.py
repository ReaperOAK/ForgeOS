"""Authorization — operator machine-scoped permissions and role-stage policy.

Enforces that operators can only perform REST operations on machines
they are registered to.  Admin operators bypass all machine binding
checks.

Role-stage authorization (FORGEOS-BE055) enforces that agents can only
claim tickets whose current SDLC stage matches the agent's role.

Architecture
------------
* **Binding table** — ``operator_machine_bindings`` maps operator UUIDs
  to machine identifier strings (many-to-many).
* **Admin bypass** — operators with role ``"admin"`` skip binding checks.
* **UPSERT bindings** — ``add_binding`` uses ``ON CONFLICT DO NOTHING``
  for idempotency.
* **Role-stage policy** — :class:`RoleStagePolicy` encodes which agent
  roles may claim tickets at which SDLC stages.  The mapping is
  configurable via constructor overrides for future role additions.
* **Operator override** — operators with role ``"operator"`` can claim
  on behalf of any agent role using an explicit ``role_override``.

Security
--------
* Unbound operator-machine pairs are rejected with 403 Forbidden.
* Admin bypass is based on the ``role`` field in the ``operators`` table.
* Role-stage mismatches are rejected with 403 Forbidden and a descriptive
  error including the agent role, ticket stage, and authorized stage.
* All authorization decisions are structurally logged.

.. meta::
   :ticket: FORGEOS-BE056, FORGEOS-BE055
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import datetime

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


# ---------------------------------------------------------------------------
# Role-stage policy (FORGEOS-BE055)
# ---------------------------------------------------------------------------

OPERATOR_ROLE: str = "operator"
"""Role string that can claim on behalf of any agent role."""

# Default mapping from agent role → authorized SDLC stage.
# Roles that do not process stages (todo, dispatcher) map to None.
_DEFAULT_ROLE_STAGE_MAP: dict[str, str | None] = {
    "architect": "ARCHITECT",
    "research": "RESEARCH",
    "product_manager": "PRODUCT_MANAGER",
    "ui_designer": "UI_DESIGN",
    "backend": "BACKEND",
    "devops": "BACKEND",
    "frontend": "FRONTEND",
    "qa": "QA",
    "security": "SECURITY",
    "ci": "CI",
    "documentation": "DOCUMENTATION",
    "validator": "VALIDATOR",
    "todo": None,
    "dispatcher": None,
}


class RoleStageMismatchError(ForgeOSError):
    """Raised when an agent's role does not match the ticket's SDLC stage.

    Maps to HTTP 403 Forbidden.
    """

    error_code: int = INVALID_PARAMS
    status_code: int = 403


class RoleStagePolicy:
    """Configurable mapping of agent roles to authorized SDLC stages.

    The default mapping covers all 14 agent types.  Callers can supply
    ``overrides`` at construction time or mutate the policy at runtime
    via :meth:`add_role` / :meth:`remove_role`.

    Parameters
    ----------
    overrides : dict[str, str | None] | None
        Optional mapping that overrides or extends the defaults.
    """

    def __init__(self, overrides: dict[str, str | None] | None = None) -> None:
        self._mapping: dict[str, str | None] = dict(_DEFAULT_ROLE_STAGE_MAP)
        if overrides:
            for role, stage in overrides.items():
                self._mapping[role.lower()] = stage

    def stage_for_role(self, role: str) -> str | None:
        """Return the authorized SDLC stage for *role*, or ``None``."""
        return self._mapping.get(role.lower())

    def is_authorized_role(self, role: str) -> bool:
        """Return ``True`` if *role* is a known agent role."""
        return role.lower() in self._mapping

    def all_roles(self) -> list[str]:
        """Return all registered role names."""
        return list(self._mapping.keys())

    def add_role(self, role: str, stage: str | None) -> None:
        """Add or update a role-stage mapping."""
        self._mapping[role.lower()] = stage

    def remove_role(self, role: str) -> None:
        """Remove a role from the mapping."""
        self._mapping.pop(role.lower(), None)


# Module-level default policy instance.
_default_policy = RoleStagePolicy()


def check_role_stage_authorization(
    agent_role: str,
    ticket_stage: str,
    role_override: str | None = None,
    *,
    policy: RoleStagePolicy | None = None,
) -> None:
    """Enforce that an agent's role is authorized to claim a ticket at *ticket_stage*.

    Operators (role == ``"operator"``) and admins (role == ``"admin"``)
    bypass the check when no *role_override* is given.  When *role_override*
    is specified, the override role is validated instead.

    Parameters
    ----------
    agent_role : str
        The claiming agent's role (e.g. ``"backend"``).
    ticket_stage : str
        The ticket's current SDLC stage (e.g. ``"BACKEND"``).
    role_override : str | None
        If the caller is an operator, the actual agent role to authorize.
    policy : RoleStagePolicy | None
        Custom policy; defaults to the module-level default.

    Raises
    ------
    RoleStageMismatchError
        If the role is not authorized for the given stage.
    """
    if not agent_role or not agent_role.strip():
        raise RoleStageMismatchError(
            "agent_role must not be empty",
            details={"reason": "empty_agent_role"},
        )
    if not ticket_stage or not ticket_stage.strip():
        raise RoleStageMismatchError(
            "ticket_stage must not be empty",
            details={"reason": "empty_ticket_stage"},
        )

    effective_policy = policy or _default_policy
    normalized_role = agent_role.strip().lower()
    normalized_stage = ticket_stage.strip().upper()

    # Operators without role_override and admins bypass all stage checks.
    if normalized_role in (OPERATOR_ROLE, ADMIN_ROLE) and role_override is None:
        logger.info(
            "role_stage_bypass",
            extra={
                "agent_role": normalized_role,
                "ticket_stage": normalized_stage,
                "reason": f"{normalized_role}_bypass",
            },
        )
        return

    # When operator provides role_override, validate the override role.
    effective_role = role_override.strip().lower() if role_override else normalized_role

    authorized_stage = effective_policy.stage_for_role(effective_role)

    if authorized_stage is None and not effective_policy.is_authorized_role(effective_role):
        logger.warning(
            "role_stage_unknown_role",
            extra={
                "agent_role": effective_role,
                "ticket_stage": normalized_stage,
            },
        )
        raise RoleStageMismatchError(
            f"Unknown agent role '{effective_role}' cannot claim tickets "
            f"at stage '{normalized_stage}'",
            details={
                "reason": "unknown_agent_role",
                "agent_role": effective_role,
                "ticket_stage": normalized_stage,
            },
        )

    if authorized_stage is None:
        # Role exists but does not process any stage (e.g. todo, dispatcher)
        raise RoleStageMismatchError(
            f"Agent role '{effective_role}' does not process any SDLC stage",
            details={
                "reason": "role_has_no_stage",
                "agent_role": effective_role,
                "ticket_stage": normalized_stage,
            },
        )

    if authorized_stage != normalized_stage:
        logger.warning(
            "role_stage_mismatch",
            extra={
                "agent_role": effective_role,
                "ticket_stage": normalized_stage,
                "authorized_stage": authorized_stage,
            },
        )
        raise RoleStageMismatchError(
            f"Agent role '{effective_role}' is authorized for stage "
            f"'{authorized_stage}', not '{normalized_stage}'",
            details={
                "reason": "role_stage_mismatch",
                "agent_role": effective_role,
                "ticket_stage": normalized_stage,
                "authorized_stage": authorized_stage,
            },
        )

    logger.info(
        "role_stage_authorized",
        extra={
            "agent_role": effective_role,
            "ticket_stage": normalized_stage,
        },
    )
