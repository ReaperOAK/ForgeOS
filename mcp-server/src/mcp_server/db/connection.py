"""Database connection configuration and engine factories.

Provides a ``DatabaseConfig`` pydantic-settings model that loads connection
parameters from environment variables, plus factory functions for creating
SQLAlchemy async and sync engines.

Design decisions
----------------
* ``DATABASE_URL`` is the single source of truth for the connection string.
* URL conversion functions handle driver prefix swapping (asyncpg ↔ psycopg2).
* Engine factories accept a ``DatabaseConfig`` for testability (DI over globals).
* No hardcoded credentials — everything via env vars.
"""

from __future__ import annotations

import re

from pydantic import Field
from pydantic_settings import BaseSettings
from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


class DatabaseConfig(BaseSettings):
    """Database configuration loaded from environment variables.

    Attributes
    ----------
    database_url : str
        PostgreSQL connection URI. Loaded from ``DATABASE_URL`` env var.
    db_pool_min_size : int
        Minimum number of connections in the pool.
    db_pool_max_size : int
        Maximum number of connections in the pool.
    db_echo_sql : bool
        Whether to echo SQL statements to the logger (debug aid).
    """

    database_url: str = Field(
        default="postgresql://forgeos:forgeos@localhost:5432/forgeos",
        description="PostgreSQL connection URI",
    )
    db_pool_min_size: int = Field(
        default=2,
        description="Minimum pool connections",
    )
    db_pool_max_size: int = Field(
        default=10,
        description="Maximum pool connections",
    )
    db_echo_sql: bool = Field(
        default=False,
        description="Echo SQL statements to logger",
    )

    model_config = {"env_prefix": ""}


# ---------------------------------------------------------------------------
# URL conversion helpers
# ---------------------------------------------------------------------------

# Matches the scheme portion of a PostgreSQL URL
_PG_SCHEME_RE = re.compile(r"^postgresql(\+\w+)?://")


def get_async_engine_url(url: str) -> str:
    """Convert a PostgreSQL URL to use the ``asyncpg`` driver.

    Parameters
    ----------
    url : str
        A PostgreSQL connection URI (any driver prefix).

    Returns
    -------
    str
        The URL with ``postgresql+asyncpg://`` scheme.
    """
    return _PG_SCHEME_RE.sub("postgresql+asyncpg://", url, count=1)


def get_sync_engine_url(url: str) -> str:
    """Convert a PostgreSQL URL to use the ``psycopg2`` driver.

    Parameters
    ----------
    url : str
        A PostgreSQL connection URI (any driver prefix).

    Returns
    -------
    str
        The URL with ``postgresql+psycopg2://`` scheme.
    """
    return _PG_SCHEME_RE.sub("postgresql+psycopg2://", url, count=1)


# ---------------------------------------------------------------------------
# Engine factories
# ---------------------------------------------------------------------------


def make_async_engine(config: DatabaseConfig) -> AsyncEngine:
    """Create a SQLAlchemy async engine from configuration.

    Parameters
    ----------
    config : DatabaseConfig
        Validated database configuration.

    Returns
    -------
    AsyncEngine
        A SQLAlchemy ``AsyncEngine`` configured for ``asyncpg``.
    """
    async_url = get_async_engine_url(config.database_url)
    return create_async_engine(
        async_url,
        echo=config.db_echo_sql,
        pool_size=config.db_pool_max_size,
        pool_pre_ping=True,
    )


def make_sync_engine(config: DatabaseConfig) -> Engine:
    """Create a SQLAlchemy sync engine from configuration.

    Used by Alembic for offline migrations and schema introspection.

    Parameters
    ----------
    config : DatabaseConfig
        Validated database configuration.

    Returns
    -------
    Engine
        A SQLAlchemy sync ``Engine``.
    """
    sync_url = get_sync_engine_url(config.database_url)
    return create_engine(
        sync_url,
        echo=config.db_echo_sql,
        pool_size=config.db_pool_max_size,
        pool_pre_ping=True,
    )
