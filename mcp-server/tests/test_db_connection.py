"""Tests for database connection configuration and utilities.

TDD Evidence
------------
- RED: Tests written FIRST to define expected connection behavior.
- GREEN: ``db/connection.py`` implemented to satisfy these tests.
- REFACTOR: Configuration consolidated with pydantic-settings.
"""

from __future__ import annotations

import os
from unittest.mock import patch

from mcp_server.db.connection import (
    DatabaseConfig,
    get_async_engine_url,
    get_sync_engine_url,
    make_async_engine,
    make_sync_engine,
)

# ---------------------------------------------------------------------------
# DatabaseConfig — pydantic-settings model
# ---------------------------------------------------------------------------


class TestDatabaseConfig:
    """Verify DatabaseConfig loads from environment variables."""

    def test_default_database_url(self) -> None:
        """Default DATABASE_URL points to local development database."""
        config = DatabaseConfig()
        assert "postgresql" in config.database_url
        assert "localhost" in config.database_url

    def test_database_url_from_env(self) -> None:
        """DATABASE_URL can be overridden via environment variable."""
        custom_url = "postgresql://user:pass@db.example.com:5432/mydb"
        with patch.dict(os.environ, {"DATABASE_URL": custom_url}):
            config = DatabaseConfig()
        assert config.database_url == custom_url

    def test_pool_size_defaults(self) -> None:
        """Pool size defaults are sensible for development."""
        config = DatabaseConfig()
        assert config.db_pool_min_size >= 1
        assert config.db_pool_max_size >= config.db_pool_min_size
        assert config.db_pool_max_size <= 50

    def test_pool_size_from_env(self) -> None:
        """Pool sizes can be overridden via environment variables."""
        with patch.dict(os.environ, {
            "DB_POOL_MIN_SIZE": "5",
            "DB_POOL_MAX_SIZE": "20",
        }):
            config = DatabaseConfig()
        assert config.db_pool_min_size == 5
        assert config.db_pool_max_size == 20

    def test_echo_sql_default_false(self) -> None:
        """SQL echo is off by default (no noisy query logging)."""
        config = DatabaseConfig()
        assert config.db_echo_sql is False

    def test_echo_sql_from_env(self) -> None:
        """SQL echo can be enabled via environment variable."""
        with patch.dict(os.environ, {"DB_ECHO_SQL": "true"}):
            config = DatabaseConfig()
        assert config.db_echo_sql is True


# ---------------------------------------------------------------------------
# URL conversion — asyncpg vs psycopg2 driver prefixes
# ---------------------------------------------------------------------------


class TestURLConversion:
    """Verify conversion between sync and async connection URLs."""

    def test_get_async_engine_url_from_plain(self) -> None:
        """Convert postgresql:// to postgresql+asyncpg://."""
        url = "postgresql://user:pass@localhost:5432/forgeos"
        result = get_async_engine_url(url)
        assert result == "postgresql+asyncpg://user:pass@localhost:5432/forgeos"

    def test_get_async_engine_url_idempotent(self) -> None:
        """Already-async URL is returned unchanged."""
        url = "postgresql+asyncpg://user:pass@localhost:5432/forgeos"
        result = get_async_engine_url(url)
        assert result == url

    def test_get_sync_engine_url_from_plain(self) -> None:
        """Convert postgresql:// to postgresql+psycopg2:// for sync Alembic."""
        url = "postgresql://user:pass@localhost:5432/forgeos"
        result = get_sync_engine_url(url)
        assert result == "postgresql+psycopg2://user:pass@localhost:5432/forgeos"

    def test_get_sync_engine_url_from_async(self) -> None:
        """Convert async URL back to sync for Alembic offline mode."""
        url = "postgresql+asyncpg://user:pass@localhost:5432/forgeos"
        result = get_sync_engine_url(url)
        assert result == "postgresql+psycopg2://user:pass@localhost:5432/forgeos"

    def test_get_async_url_preserves_query_params(self) -> None:
        """Query parameters are preserved during URL conversion."""
        url = "postgresql://user:pass@localhost:5432/forgeos?sslmode=require"
        result = get_async_engine_url(url)
        assert "sslmode=require" in result
        assert result.startswith("postgresql+asyncpg://")

    def test_get_sync_url_preserves_query_params(self) -> None:
        """Query parameters are preserved during sync URL conversion."""
        url = "postgresql+asyncpg://user:pass@localhost:5432/forgeos?sslmode=require"
        result = get_sync_engine_url(url)
        assert "sslmode=require" in result
        assert result.startswith("postgresql+psycopg2://")


# ---------------------------------------------------------------------------
# Engine factories — verify they create SQLAlchemy engines
# ---------------------------------------------------------------------------


class TestEngineFactories:
    """Verify engine factory functions produce valid SQLAlchemy engines."""

    def test_make_async_engine_returns_async_engine(self) -> None:
        """make_async_engine returns an AsyncEngine instance."""
        from sqlalchemy.ext.asyncio import AsyncEngine

        config = DatabaseConfig()
        engine = make_async_engine(config)
        assert isinstance(engine, AsyncEngine)
        assert "asyncpg" in str(engine.url)

    def test_make_sync_engine_returns_engine(self) -> None:
        """make_sync_engine returns a sync Engine instance (for Alembic)."""
        from sqlalchemy import Engine

        config = DatabaseConfig()
        engine = make_sync_engine(config)
        assert isinstance(engine, Engine)

    def test_make_async_engine_uses_config_pool_size(self) -> None:
        """Async engine respects pool size from config."""
        config = DatabaseConfig()
        engine = make_async_engine(config)
        assert engine.pool.size() == config.db_pool_max_size

    def test_make_async_engine_echo_setting(self) -> None:
        """Engine echo setting matches config."""
        with patch.dict(os.environ, {"DB_ECHO_SQL": "true"}):
            config = DatabaseConfig()
        engine = make_async_engine(config)
        assert engine.echo is True
