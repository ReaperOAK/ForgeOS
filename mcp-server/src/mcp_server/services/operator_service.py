"""Operator service — login, credential verification, token and binding management.

Orchestrates operator authentication by coordinating database lookups,
password verification, and JWT token issuance.  This service layer
separates business logic from the token mechanics in
:mod:`mcp_server.auth.operator_auth`.

Also provides machine binding management for operator machine-scoped
permissions (FORGEOS-BE056).

Public API
----------
* :func:`authenticate_operator` — verifies credentials, returns a token.
* :func:`refresh_operator_token` — extends a valid session.
* :func:`register_operator` — creates a new operator with hashed password.
* :func:`bind_operator_to_machine` — add an operator-machine binding (admin).
* :func:`unbind_operator_from_machine` — remove a binding (admin).
* :func:`get_operator_bindings` — list bindings for an operator.
* :func:`validate_operator_machine_access` — enforce machine scope.

.. meta::
   :ticket: FORGEOS-BE053, FORGEOS-BE056
"""

from __future__ import annotations

from typing import Any

from mcp_server.auth.authorization import (
    add_binding,
    list_bindings,
    remove_binding,
    require_operator_machine_access,
)
from mcp_server.auth.operator_auth import (
    OperatorAuthenticationError,
    OperatorIdentity,
    generate_token,
    hash_password,
    refresh_token,
    verify_password,
)
from mcp_server.observability import get_logger

logger = get_logger("operator_service")


# ---------------------------------------------------------------------------
# Login / Authentication
# ---------------------------------------------------------------------------


async def authenticate_operator(
    db_pool: Any,
    name: str,
    password: str,
    jwt_secret: str,
    *,
    expiry_hours: int = 8,
) -> dict[str, str]:
    """Authenticate an operator and return a bearer token.

    Looks up the operator by name in the ``operators`` table, verifies
    the bcrypt-hashed password, and issues a JWT token on success.

    Parameters
    ----------
    db_pool : asyncpg.Pool
        Active database connection pool.
    name : str
        Operator name (unique identifier).
    password : str
        Plaintext password to verify.
    jwt_secret : str
        Secret key for JWT signing.
    expiry_hours : int
        Token validity duration in hours.

    Returns
    -------
    dict[str, str]
        ``{"token": "<jwt>", "operator_id": "<uuid>", "name": "...", "role": "..."}``

    Raises
    ------
    OperatorAuthenticationError
        If the operator does not exist, the password is wrong,
        or the operator is inactive.
    """
    if not name or not password:
        logger.warning("login_failure", extra={"reason": "empty_credentials"})
        raise OperatorAuthenticationError(
            "Name and password are required",
            details={"reason": "empty_credentials"},
        )

    row = await _lookup_operator_by_name(db_pool, name)

    if row is None:
        logger.warning("login_failure", extra={"reason": "operator_not_found", "operator_name": name})
        raise OperatorAuthenticationError(
            "Invalid credentials",
            details={"reason": "invalid_credentials"},
        )

    # Check operator is active
    if not row.get("is_active", True):
        logger.warning("login_failure", extra={"reason": "operator_inactive", "operator_name": name})
        raise OperatorAuthenticationError(
            "Operator account is inactive",
            details={"reason": "operator_inactive"},
        )

    # Verify password
    stored_hash = row.get("password_hash", "")
    if not stored_hash:
        logger.warning("login_failure", extra={"reason": "no_password_set", "operator_name": name})
        raise OperatorAuthenticationError(
            "Invalid credentials",
            details={"reason": "invalid_credentials"},
        )

    if not verify_password(password, stored_hash):
        logger.warning("login_failure", extra={"reason": "password_mismatch", "operator_name": name})
        raise OperatorAuthenticationError(
            "Invalid credentials",
            details={"reason": "invalid_credentials"},
        )

    operator = OperatorIdentity(
        operator_id=str(row["operator_id"]),
        name=row["name"],
        role=row.get("role", "operator"),
    )

    token = generate_token(operator, jwt_secret, expiry_hours=expiry_hours)

    logger.info(
        "login_success",
        extra={"operator_id": operator.operator_id, "operator_name": operator.name},
    )

    return {
        "token": token,
        "operator_id": operator.operator_id,
        "name": operator.name,
        "role": operator.role,
    }


async def refresh_operator_token(
    token: str,
    jwt_secret: str,
    *,
    expiry_hours: int = 8,
) -> dict[str, str]:
    """Refresh an operator's JWT token.

    Issues a new token with a fresh expiry from a valid existing token.
    No database lookup required — identity is extracted from the JWT.

    Parameters
    ----------
    token : str
        The current valid JWT token.
    jwt_secret : str
        Secret key for JWT signing/verification.
    expiry_hours : int
        New token validity duration in hours.

    Returns
    -------
    dict[str, str]
        ``{"token": "<new_jwt>"}``
    """
    new_token = refresh_token(token, jwt_secret, expiry_hours=expiry_hours)
    return {"token": new_token}


# ---------------------------------------------------------------------------
# Operator registration
# ---------------------------------------------------------------------------


async def register_operator(
    db_pool: Any,
    name: str,
    password: str,
    *,
    role: str = "operator",
) -> dict[str, str]:
    """Register a new operator with hashed credentials.

    Parameters
    ----------
    db_pool : asyncpg.Pool
        Active database connection pool.
    name : str
        Unique operator name.
    password : str
        Plaintext password (will be bcrypt-hashed before storage).
    role : str
        Operator role (default ``"operator"``).

    Returns
    -------
    dict[str, str]
        ``{"operator_id": "<uuid>", "name": "..."}``

    Raises
    ------
    OperatorAuthenticationError
        If the name is already taken or input is invalid.
    """
    if not name or not password:
        raise OperatorAuthenticationError(
            "Name and password are required",
            details={"reason": "empty_credentials"},
        )

    if len(password) < 8:
        raise OperatorAuthenticationError(
            "Password must be at least 8 characters",
            details={"reason": "password_too_short"},
        )

    password_hash = hash_password(password)

    try:
        row = await _insert_operator(db_pool, name, password_hash, role)
    except Exception as exc:
        error_msg = str(exc)
        if "unique" in error_msg.lower() or "duplicate" in error_msg.lower():
            raise OperatorAuthenticationError(
                f"Operator name already exists: {name}",
                details={"reason": "duplicate_name"},
            ) from exc
        logger.error("register_operator_error", extra={"error": error_msg})
        raise OperatorAuthenticationError(
            "Failed to register operator",
            details={"reason": "database_error"},
        ) from exc

    logger.info(
        "operator_registered",
        extra={"operator_id": str(row["operator_id"]), "operator_name": name},
    )

    return {
        "operator_id": str(row["operator_id"]),
        "name": name,
    }


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


async def _lookup_operator_by_name(
    db_pool: Any,
    name: str,
) -> dict[str, Any] | None:
    """Look up an operator by name, returning credentials and metadata."""
    query = """
        SELECT
            operator_id,
            name,
            password_hash,
            role,
            is_active
        FROM operators
        WHERE name = $1
    """
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(query, name)
        if row is None:
            return None
        return dict(row)


async def _insert_operator(
    db_pool: Any,
    name: str,
    password_hash: str,
    role: str,
) -> dict[str, Any]:
    """Insert a new operator record and return the created row."""
    query = """
        INSERT INTO operators (name, password_hash, role)
        VALUES ($1, $2, $3)
        RETURNING operator_id, name
    """
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(query, name, password_hash, role)
        return dict(row)


# ---------------------------------------------------------------------------
# Machine binding management (FORGEOS-BE056)
# ---------------------------------------------------------------------------


async def bind_operator_to_machine(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
) -> dict[str, str]:
    """Bind an operator to a machine.

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
    dict[str, str]
        ``{"operator_id": "...", "machine_id": "...", "registered_at": "..."}``
    """
    binding = await add_binding(db_pool, operator_id, machine_id)
    logger.info(
        "operator_bound_to_machine",
        extra={"operator_id": operator_id, "machine_id": machine_id},
    )
    return {
        "operator_id": binding.operator_id,
        "machine_id": binding.machine_id,
        "registered_at": binding.registered_at.isoformat(),
    }


async def unbind_operator_from_machine(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
) -> dict[str, Any]:
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
    dict[str, Any]
        ``{"removed": True/False, "operator_id": "...", "machine_id": "..."}``
    """
    removed = await remove_binding(db_pool, operator_id, machine_id)
    logger.info(
        "operator_unbound_from_machine",
        extra={
            "operator_id": operator_id,
            "machine_id": machine_id,
            "removed": removed,
        },
    )
    return {
        "removed": removed,
        "operator_id": operator_id,
        "machine_id": machine_id,
    }


async def get_operator_bindings(
    db_pool: Any,
    operator_id: str,
) -> list[dict[str, str]]:
    """List all machine bindings for an operator.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    operator_id : str
        UUID of the operator.

    Returns
    -------
    list[dict[str, str]]
        List of binding dicts with ``machine_id`` and ``registered_at``.
    """
    bindings = await list_bindings(db_pool, operator_id)
    return [
        {
            "machine_id": b.machine_id,
            "registered_at": b.registered_at.isoformat(),
        }
        for b in bindings
    ]


async def validate_operator_machine_access(
    db_pool: Any,
    operator_id: str,
    machine_id: str,
    role: str,
) -> None:
    """Validate that an operator may act on the given machine.

    Admin operators bypass binding checks.  Non-admin operators
    must have a binding in the ``operator_machine_bindings`` table.

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
        If the operator is not bound and is not an admin.
    """
    await require_operator_machine_access(db_pool, operator_id, machine_id, role)
