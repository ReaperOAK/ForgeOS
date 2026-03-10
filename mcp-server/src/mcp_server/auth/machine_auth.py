"""Machine registration and identity verification for the ForgeOS MCP Server.

Implements machine registration, identity verification, lookup, and
deactivation.  Each machine running agents registers with a unique
``machine_id`` (typically hostname or UUID).  On each request the
``machine_id`` is verified against the registry.

Architecture
------------
* **UPSERT registration** — :func:`register_machine` uses
  ``INSERT ... ON CONFLICT DO UPDATE`` so duplicate registrations are
  idempotent and safe under concurrency.
* **Two verification modes** — :class:`MachineRegistrationMode` controls
  whether unknown machines are auto-registered (``AUTO``) or rejected
  (``STRICT``).
* **Fire-and-forget timestamp** — ``last_seen_at`` is updated after
  verification without blocking the response.
* **Frozen dataclass** — :class:`MachineIdentity` is immutable and
  uses ``__slots__`` for memory efficiency.

Security
--------
* ``STRICT`` mode rejects unknown machines with a 403 error.
* Inactive machines are always rejected, regardless of mode.
* ``machine_id`` is validated and length-capped to prevent injection.

.. meta::
   :ticket: FORGEOS-BE052
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from datetime import datetime

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, ForgeOSError

logger = get_logger("machine_auth")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_MACHINE_ID_LENGTH = 255
"""Maximum allowed length for a machine_id."""


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class MachineRegistrationMode(enum.Enum):
    """Controls how unknown machines are handled during verification.

    Attributes
    ----------
    AUTO : str
        Unknown machines are automatically registered on first request.
    STRICT : str
        Unknown machines are rejected with a 403 error.
    """

    AUTO = "auto"
    STRICT = "strict"

    @classmethod
    def from_string(cls, value: str) -> MachineRegistrationMode:
        """Parse a case-insensitive string into a mode enum value.

        Parameters
        ----------
        value : str
            One of ``"auto"`` or ``"strict"`` (case-insensitive).

        Returns
        -------
        MachineRegistrationMode

        Raises
        ------
        ValueError
            If *value* is not a recognised mode.
        """
        try:
            return cls(value.lower().strip())
        except ValueError:
            valid = ", ".join(m.value for m in cls)
            raise ValueError(
                f"Invalid machine registration mode: {value!r}. "
                f"Must be one of: {valid}"
            ) from None


@dataclass(frozen=True, slots=True)
class MachineIdentity:
    """Immutable descriptor for a registered machine.

    Attributes
    ----------
    machine_id : str
        Unique machine identifier (hostname or UUID).
    hostname : str
        Human-readable hostname of the machine.
    first_seen_at : datetime
        When the machine was first registered (UTC).
    last_seen_at : datetime
        When the machine was last seen (UTC).
    is_active : bool
        Whether the machine is currently active.
    """

    machine_id: str
    hostname: str
    first_seen_at: datetime
    last_seen_at: datetime
    is_active: bool = True


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class MachineAuthError(ForgeOSError):
    """Raised when machine verification fails.

    Maps to JSON-RPC error code ``-32602`` (invalid params) in MCP
    responses, with HTTP-equivalent status ``403``.
    """

    error_code: int = INVALID_PARAMS
    status_code: int = 403


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _validate_machine_id(machine_id: str) -> str:
    """Validate and normalise a machine identifier.

    Parameters
    ----------
    machine_id : str
        Raw machine identifier to validate.

    Returns
    -------
    str
        The stripped machine_id.

    Raises
    ------
    MachineAuthError
        If *machine_id* is empty, whitespace-only, or exceeds
        :data:`MAX_MACHINE_ID_LENGTH`.
    """
    cleaned = machine_id.strip()
    if not cleaned:
        raise MachineAuthError(
            "machine_id must not be empty or whitespace-only"
        )
    if len(cleaned) > MAX_MACHINE_ID_LENGTH:
        raise MachineAuthError(
            f"machine_id exceeds maximum length of {MAX_MACHINE_ID_LENGTH}"
        )
    return cleaned


def _row_to_identity(row: dict[str, Any]) -> MachineIdentity:
    """Convert a database row dict to a :class:`MachineIdentity`.

    Parameters
    ----------
    row : dict
        Database row with keys ``machine_id``, ``hostname``,
        ``first_seen_at``, ``last_seen_at``, ``is_active``.

    Returns
    -------
    MachineIdentity
    """
    return MachineIdentity(
        machine_id=row["machine_id"],
        hostname=row["hostname"],
        first_seen_at=row["first_seen_at"],
        last_seen_at=row["last_seen_at"],
        is_active=row["is_active"],
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def register_machine(
    db_pool: Any,
    machine_id: str,
    hostname: str,
) -> MachineIdentity:
    """Register a machine or update its record if it already exists.

    Uses ``INSERT ... ON CONFLICT DO UPDATE`` (UPSERT) so concurrent
    registrations of the same ``machine_id`` are safe.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    machine_id : str
        Unique machine identifier.
    hostname : str
        Human-readable hostname.  Falls back to *machine_id* if empty.

    Returns
    -------
    MachineIdentity
        The registered (or updated) machine record.

    Raises
    ------
    MachineAuthError
        If *machine_id* is invalid or a database error occurs.
    """
    clean_id = _validate_machine_id(machine_id)
    clean_host = hostname.strip() if hostname and hostname.strip() else clean_id

    sql = """
        INSERT INTO machines (machine_id, hostname, first_seen_at, last_seen_at, is_active)
        VALUES ($1, $2, NOW(), NOW(), TRUE)
        ON CONFLICT (machine_id) DO UPDATE
            SET hostname = EXCLUDED.hostname,
                last_seen_at = NOW(),
                is_active = TRUE
        RETURNING machine_id, hostname, first_seen_at, last_seen_at, is_active
    """

    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(sql, clean_id, clean_host)
    except Exception as exc:
        logger.error(
            "machine_register_failed",
            extra={"machine_id": clean_id, "error": str(exc)},
        )
        raise MachineAuthError(
            f"Failed to register machine {clean_id!r}: {exc}"
        ) from exc

    logger.info("machine_registered", extra={"machine_id": clean_id, "hostname": clean_host})
    return _row_to_identity(dict(row))


async def verify_machine(
    db_pool: Any,
    machine_id: str,
    mode: MachineRegistrationMode = MachineRegistrationMode.AUTO,
    hostname: str = "",
) -> MachineIdentity:
    """Verify a machine's identity against the registry.

    In ``AUTO`` mode, unknown machines are automatically registered.
    In ``STRICT`` mode, unknown machines are rejected with a 403 error.
    Inactive machines are always rejected.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    machine_id : str
        Machine identifier to verify.
    mode : MachineRegistrationMode
        How to handle unknown machines.
    hostname : str
        Hostname hint for auto-registration.

    Returns
    -------
    MachineIdentity
        The verified machine identity.

    Raises
    ------
    MachineAuthError
        If the machine is unknown (strict mode), inactive, or a
        database error occurs.
    """
    clean_id = _validate_machine_id(machine_id)

    sql = """
        SELECT machine_id, hostname, first_seen_at, last_seen_at, is_active
        FROM machines
        WHERE machine_id = $1
    """

    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(sql, clean_id)
    except Exception as exc:
        logger.error(
            "machine_verify_db_error",
            extra={"machine_id": clean_id, "error": str(exc)},
        )
        raise MachineAuthError(
            f"Database error verifying machine {clean_id!r}: {exc}"
        ) from exc

    # Unknown machine handling
    if row is None:
        if mode == MachineRegistrationMode.STRICT:
            logger.warning(
                "machine_rejected_strict",
                extra={"machine_id": clean_id},
            )
            raise MachineAuthError(
                f"Unknown machine {clean_id!r} rejected in strict mode"
            )
        # AUTO mode: register the machine
        logger.info("machine_auto_registering", extra={"machine_id": clean_id})
        return await register_machine(db_pool, clean_id, hostname)

    identity = _row_to_identity(dict(row))

    # Reject inactive machines
    if not identity.is_active:
        logger.warning(
            "machine_rejected_inactive",
            extra={"machine_id": clean_id},
        )
        raise MachineAuthError(
            f"Machine {clean_id!r} is deactivated"
        )

    # Fire-and-forget: update last_seen_at
    try:
        async with db_pool.acquire() as conn:
            await conn.execute(
                "UPDATE machines SET last_seen_at = NOW() WHERE machine_id = $1",
                clean_id,
            )
    except Exception:
        logger.debug(
            "machine_last_seen_update_failed",
            extra={"machine_id": clean_id},
        )

    return identity


async def get_machine(
    db_pool: Any,
    machine_id: str,
) -> MachineIdentity | None:
    """Look up a machine by its identifier.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    machine_id : str
        Machine identifier to look up.

    Returns
    -------
    MachineIdentity or None
        The machine record, or ``None`` if not found.

    Raises
    ------
    MachineAuthError
        If *machine_id* is invalid or a database error occurs.
    """
    clean_id = _validate_machine_id(machine_id)

    sql = """
        SELECT machine_id, hostname, first_seen_at, last_seen_at, is_active
        FROM machines
        WHERE machine_id = $1
    """

    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(sql, clean_id)
    except Exception as exc:
        logger.error(
            "machine_lookup_failed",
            extra={"machine_id": clean_id, "error": str(exc)},
        )
        raise MachineAuthError(
            f"Failed to look up machine {clean_id!r}: {exc}"
        ) from exc

    if row is None:
        return None

    return _row_to_identity(dict(row))


async def deactivate_machine(
    db_pool: Any,
    machine_id: str,
) -> bool:
    """Deactivate a machine by setting ``is_active = FALSE``.

    Parameters
    ----------
    db_pool :
        asyncpg connection pool.
    machine_id : str
        Machine identifier to deactivate.

    Returns
    -------
    bool
        ``True`` if the machine was found and deactivated, ``False``
        if no record matched.

    Raises
    ------
    MachineAuthError
        If *machine_id* is invalid or a database error occurs.
    """
    clean_id = _validate_machine_id(machine_id)

    sql = """
        UPDATE machines
        SET is_active = FALSE, last_seen_at = NOW()
        WHERE machine_id = $1
        RETURNING machine_id
    """

    try:
        async with db_pool.acquire() as conn:
            row = await conn.fetchrow(sql, clean_id)
    except Exception as exc:
        logger.error(
            "machine_deactivate_failed",
            extra={"machine_id": clean_id, "error": str(exc)},
        )
        raise MachineAuthError(
            f"Failed to deactivate machine {clean_id!r}: {exc}"
        ) from exc

    deactivated = row is not None
    if deactivated:
        logger.info("machine_deactivated", extra={"machine_id": clean_id})
    else:
        logger.debug("machine_deactivate_not_found", extra={"machine_id": clean_id})

    return deactivated
