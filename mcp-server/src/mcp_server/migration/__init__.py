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
from mcp_server.migration.exporter import (
    ExportConfig,
    ExportDatabaseReader,
    ExportResult,
    ExportStats,
    TicketExporter,
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
from mcp_server.migration.health_monitor import (
    HealthMonitor,
    HealthMonitorConfig,
    HealthProbe,
    HealthStatus,
    OperationOutcome,
)
from mcp_server.migration.rollback import (
    AlertEmitter,
    FeatureFlagSetter,
    RollbackEvent,
    RollbackExporter,
    RollbackManager,
    RollbackManagerConfig,
    RollbackReason,
    RollbackState,
)
from mcp_server.migration.runner_adapter import (
    AdaptedResult,
    GitClaimer,
    MigrationPhase,
    RunnerAdapter,
    RunnerAdapterConfig,
    SDKClient,
)

__all__ = [
    "AdaptedResult",
    "AlertEmitter",
    "ConflictRecord",
    "ConflictResolver",
    "ConflictType",
    "DatabaseReader",
    "DatabaseWriter",
    "DualModeConfig",
    "DualModeWrapper",
    "ExportConfig",
    "ExportDatabaseReader",
    "ExportResult",
    "ExportStats",
    "FeatureFlagError",
    "FeatureFlagManager",
    "FeatureFlagSetter",
    "FileMode",
    "FlagMode",
    "GitClaimer",
    "HealthMonitor",
    "HealthMonitorConfig",
    "HealthProbe",
    "HealthStatus",
    "ImportConfig",
    "ImportResult",
    "ImportStats",
    "McpMode",
    "MigrationPhase",
    "OperationFlag",
    "OperationMode",
    "OperationOutcome",
    "OperationResult",
    "RollbackEvent",
    "RollbackExporter",
    "RollbackManager",
    "RollbackManagerConfig",
    "RollbackReason",
    "RollbackState",
    "RunnerAdapter",
    "RunnerAdapterConfig",
    "SDKClient",
    "SyncConfig",
    "SyncEngine",
    "SyncResult",
    "SyncStats",
    "TicketExporter",
    "TicketImporter",
    "TicketOperations",
    "TicketTransformer",
    "TransformError",
    "TransformResult",
    "TransformedEvent",
    "TransformedTicket",
]
