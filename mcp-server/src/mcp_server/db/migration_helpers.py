"""Migration helper utilities for common Alembic DDL patterns.

Provides reusable functions for:
- Creating and dropping PostgreSQL enum types
- Creating and dropping ``updated_at`` auto-update triggers
- Looking up enum values from the ForgeOS domain model

These helpers keep individual migration scripts DRY and consistent.

Design decisions
----------------
* Raw SQL generation (not SQLAlchemy DDL) for PostgreSQL-specific features
  like custom ENUMs, triggers, and stored functions.
* Enum values are defined here as the canonical source for the Python side,
  matching the schema in ``docs/architecture/database-schema.md``.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# ForgeOS domain enum definitions (canonical Python source)
# ---------------------------------------------------------------------------

ENUM_DEFINITIONS: dict[str, list[str]] = {
    "ticket_status": [
        "READY",
        "BLOCKED",
        "CLAIMED",
        "IN_PROGRESS",
        "DONE",
        "FAILED",
        "ESCALATED",
    ],
    "ticket_stage": [
        "READY",
        "RESEARCH",
        "ARCHITECT",
        "PRODUCT_MANAGER",
        "UI_DESIGN",
        "BACKEND",
        "FRONTEND",
        "QA",
        "SECURITY",
        "CI",
        "DOCUMENTATION",
        "VALIDATOR",
        "DONE",
    ],
    "ticket_type": [
        "backend",
        "frontend",
        "fullstack",
        "infra",
        "security",
        "docs",
        "research",
        "architecture",
        "product",
        "design",
    ],
    "ticket_priority": [
        "critical",
        "high",
        "medium",
        "low",
    ],
    "event_type": [
        "CREATED",
        "CLAIMED",
        "RELEASED",
        "STAGE_ADVANCED",
        "STAGE_REJECTED",
        "UPDATED",
        "SPAWNED",
        "ESCALATED",
        "LEASE_EXTENDED",
        "FORCE_RELEASED",
        "RECONCILED",
        "FILE_LOCKED",
        "FILE_UNLOCKED",
    ],
}


# ---------------------------------------------------------------------------
# Enum helpers
# ---------------------------------------------------------------------------


def enum_values_from_type(enum_name: str) -> list[str]:
    """Return the canonical list of values for a ForgeOS enum type.

    Parameters
    ----------
    enum_name : str
        The PostgreSQL enum type name (e.g. ``"ticket_status"``).

    Returns
    -------
    list[str]
        Ordered list of enum values.

    Raises
    ------
    ValueError
        If ``enum_name`` is not a known enum type.
    """
    if enum_name not in ENUM_DEFINITIONS:
        msg = f"Unknown enum type: {enum_name!r}. Known types: {sorted(ENUM_DEFINITIONS)}"
        raise ValueError(msg)
    return list(ENUM_DEFINITIONS[enum_name])


def create_enum_type(enum_name: str, values: list[str]) -> str:
    """Generate SQL to create a PostgreSQL enum type.

    Parameters
    ----------
    enum_name : str
        The enum type name.
    values : list[str]
        Ordered list of enum values.

    Returns
    -------
    str
        A ``CREATE TYPE ... AS ENUM (...)`` SQL statement.

    Raises
    ------
    ValueError
        If ``values`` is empty.
    """
    if not values:
        msg = f"Enum type {enum_name!r} must have at least one value"
        raise ValueError(msg)

    quoted = ", ".join(f"'{v}'" for v in values)
    return f"CREATE TYPE {enum_name} AS ENUM ({quoted});"


def drop_enum_type(enum_name: str) -> str:
    """Generate SQL to drop a PostgreSQL enum type.

    Parameters
    ----------
    enum_name : str
        The enum type name.

    Returns
    -------
    str
        A ``DROP TYPE IF EXISTS ... CASCADE`` SQL statement.
    """
    return f"DROP TYPE IF EXISTS {enum_name} CASCADE;"


# ---------------------------------------------------------------------------
# Trigger helpers
# ---------------------------------------------------------------------------


def create_updated_at_trigger(table_name: str) -> str:
    """Generate SQL to create an ``updated_at`` auto-update trigger.

    Creates:
    1. A shared ``update_updated_at()`` function (idempotent via CREATE OR REPLACE).
    2. A per-table trigger ``trg_{table}_updated_at``.

    Parameters
    ----------
    table_name : str
        The table to attach the trigger to.

    Returns
    -------
    str
        Combined SQL for the function and trigger.
    """
    trigger_name = f"trg_{table_name}_updated_at"
    return f"""\
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER {trigger_name}
    BEFORE UPDATE ON {table_name}
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();"""


def drop_updated_at_trigger(table_name: str) -> str:
    """Generate SQL to drop an ``updated_at`` trigger.

    Parameters
    ----------
    table_name : str
        The table the trigger is attached to.

    Returns
    -------
    str
        SQL to drop the trigger (does not drop the shared function).
    """
    trigger_name = f"trg_{table_name}_updated_at"
    return f"DROP TRIGGER IF EXISTS {trigger_name} ON {table_name};"
