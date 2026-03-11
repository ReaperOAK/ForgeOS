"""ForgeOS migration package — dual-mode ticket operations wrapper.

Provides a unified interface that routes ticket lifecycle operations
(claim, advance, release, rework, sync, validate, status) to either
the MCP server or the file-based ``tickets.py`` CLI, depending on the
``FORGEOS_MODE`` environment variable.

Quick start::

    from mcp_server.migration import DualModeWrapper

    wrapper = DualModeWrapper.from_config()
    result = await wrapper.sync()
    print(result.mode_used)  # "file" or "mcp"
"""

from mcp_server.migration.config import DualModeConfig, OperationMode
from mcp_server.migration.dual_mode import (
    DualModeWrapper,
    FileMode,
    McpMode,
    OperationResult,
    TicketOperations,
)
from mcp_server.migration.feature_flags import (
    FeatureFlagError,
    FeatureFlagManager,
    FlagMode,
    OperationFlag,
)
from mcp_server.migration.conflict_resolver import (
    ConflictRecord,
    ConflictResolver,
    ConflictType,
)
from mcp_server.migration.importer import (
    DatabaseWriter,
    ImportConfig,
    ImportResult,
    ImportStats,
    TicketImporter,
)
from mcp_server.migration.sync_engine import (
    DatabaseReader,
    SyncConfig,
    SyncEngine,
    SyncResult,
    SyncStats,
)
from mcp_server.migration.transformers import (
    TicketTransformer,
    TransformError,
    TransformResult,
    TransformedEvent,
    TransformedTicket,
)

__all__ = [
    "ConflictRecord",
    "ConflictResolver",
    "ConflictType",
    "DatabaseReader",
    "DatabaseWriter",
    "DualModeConfig",
    "DualModeWrapper",
    "FeatureFlagError",
    "FeatureFlagManager",
    "FileMode",
    "FlagMode",
    "ImportConfig",
    "ImportResult",
    "ImportStats",
    "McpMode",
    "OperationFlag",
    "OperationMode",
    "OperationResult",
    "SyncConfig",
    "SyncEngine",
    "SyncResult",
    "SyncStats",
    "TicketImporter",
    "TicketOperations",
    "TicketTransformer",
    "TransformError",
    "TransformResult",
    "TransformedEvent",
    "TransformedTicket",
]
