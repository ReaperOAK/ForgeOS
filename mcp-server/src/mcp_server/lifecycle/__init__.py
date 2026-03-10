"""ForgeOS lifecycle package — server lifecycle management.

This package provides:
- ``GracefulShutdownManager`` — graceful shutdown with request draining
- ``ShutdownConfig`` — validated shutdown configuration
- ``ShutdownState`` — shutdown state enumeration
- ``ShutdownError`` — domain error for shutdown-related failures
"""

from mcp_server.lifecycle.shutdown import (
    GracefulShutdownManager,
    ShutdownConfig,
    ShutdownError,
    ShutdownState,
)

__all__ = [
    "GracefulShutdownManager",
    "ShutdownConfig",
    "ShutdownError",
    "ShutdownState",
]
