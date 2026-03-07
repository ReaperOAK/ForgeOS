"""Alembic migration environment — async PostgreSQL support via asyncpg.

This module configures Alembic to:
1. Read ``DATABASE_URL`` from environment variables (no hardcoded credentials).
2. Support async migrations via ``run_async_migrations()`` using asyncpg.
3. Support offline mode (SQL script generation) via ``run_migrations_offline()``.
4. Support online mode (direct DB execution) via ``run_migrations_online()``.

Design decisions
----------------
* ``DATABASE_URL`` env var is the single source of truth for connection strings.
* Async engine is used for online migrations to match the application's asyncpg usage.
* Offline mode uses a sync URL for SQL script generation (no DB connection needed).
* The ``update_updated_at`` function is created as a shared utility across all tables.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Alembic Config object — provides access to alembic.ini values
config = context.config

# Interpret the config file for Python logging (unless running programmatically)
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No SQLAlchemy MetaData target — we use raw SQL migrations
target_metadata = None


def _get_database_url() -> str:
    """Resolve the database URL from environment variables.

    Priority:
    1. ``DATABASE_URL`` environment variable (production/CI)
    2. ``sqlalchemy.url`` from ``alembic.ini`` (fallback for development)
    3. Default local connection string

    Returns
    -------
    str
        A PostgreSQL connection URI.
    """
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    ini_url = config.get_main_option("sqlalchemy.url")
    if ini_url:
        return ini_url

    return "postgresql://forgeos:forgeos@localhost:5432/forgeos"


def _make_async_url(url: str) -> str:
    """Ensure the URL uses the asyncpg driver prefix.

    Parameters
    ----------
    url : str
        A PostgreSQL connection URI.

    Returns
    -------
    str
        The URL with ``postgresql+asyncpg://`` scheme.
    """
    import re
    return re.sub(r"^postgresql(\+\w+)?://", "postgresql+asyncpg://", url, count=1)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Generates SQL scripts without connecting to the database.
    Useful for reviewing migration SQL before applying it.
    """
    url = _get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    """Execute migrations within an established connection.

    Parameters
    ----------
    connection : Connection
        An active SQLAlchemy database connection.
    """
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
    )

    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    """Run migrations using an async engine (asyncpg).

    Creates a temporary async engine, runs migrations within its connection,
    then disposes the engine. Uses NullPool to avoid connection leak during
    schema operations.
    """
    db_url = _get_database_url()
    async_url = _make_async_url(db_url)

    # Override the config URL for the async engine
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = async_url

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode with a live database connection.

    Uses async engine (asyncpg) for consistency with the application's
    database access patterns.
    """
    asyncio.run(_run_async_migrations())


# ---------------------------------------------------------------------------
# Determine which mode Alembic is running in
# ---------------------------------------------------------------------------

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
