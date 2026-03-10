"""ForgeOS database package — connection management, pool, migration helpers.

This package provides:
- ``ConnectionPool`` — asyncpg connection pool with lifecycle management
- ``PoolConfig`` — pydantic-settings model for pool configuration
- ``PoolStats`` — dataclass for pool metrics
- ``PoolNotInitializedError`` — raised when pool ops precede initialization
- ``DatabaseConfig`` — pydantic-settings model for DB configuration
- ``get_async_engine_url`` / ``get_sync_engine_url`` — URL conversion utilities
- ``make_async_engine`` / ``make_sync_engine`` — SQLAlchemy engine factories
- Migration helper functions for common DDL patterns
"""

from mcp_server.db.connection import (
    DatabaseConfig,
    get_async_engine_url,
    get_sync_engine_url,
    make_async_engine,
    make_sync_engine,
)
from mcp_server.db.migration_helpers import (
    create_enum_type,
    create_updated_at_trigger,
    drop_enum_type,
    drop_updated_at_trigger,
    enum_values_from_type,
)
from mcp_server.db.health import HealthReport, PoolHealthMonitor
from mcp_server.db.pool import (
    ConnectionPool,
    PoolConfig,
    PoolNotInitializedError,
    PoolStats,
)

__all__ = [
    "ConnectionPool",
    "DatabaseConfig",
    "HealthReport",
    "PoolConfig",
    "PoolHealthMonitor",
    "PoolNotInitializedError",
    "PoolStats",
    "create_enum_type",
    "create_updated_at_trigger",
    "drop_enum_type",
    "drop_updated_at_trigger",
    "enum_values_from_type",
    "get_async_engine_url",
    "get_sync_engine_url",
    "make_async_engine",
    "make_sync_engine",
]
