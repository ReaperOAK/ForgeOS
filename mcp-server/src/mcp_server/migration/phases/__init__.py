"""Migration phases package.

Provides lifecycle management for the phased migration from
filesystem-based ticket operations to database-backed operations.

Phase A — Background Sync:
    Agents continue using the filesystem as-is. The sync engine runs
    in the background, mirroring every filesystem change to the
    database. The filesystem remains the source of truth. No agent
    behaviour changes are required.

Phase B — SDK with Fallback:
    Agents use the ForgeOS SDK for the CLAIM operation (MCP primary,
    filesystem fallback).  WORK commits remain git-based.  The phase
    exits when 95%+ operations succeed via MCP for 48+ hours.

Phase C — Full MCP:
    All ticket operations go through the MCP SDK exclusively.  All
    feature flags are set to ``database`` mode.  The filesystem becomes
    read-only — a periodic DB-to-FS export maintains backup copies.
    The phase exits after zero filesystem writes for 72+ hours.
"""

from mcp_server.migration.phases.phase_a import (
    Discrepancy,
    PhaseA,
    PhaseAConfig,
    PhaseAStatus,
    ValidationReport,
)
from mcp_server.migration.phases.phase_b import (
    FilesystemClaimAdapter,
    OperationBackend,
    OperationRecord,
    PhaseB,
    PhaseBConfig,
    PhaseBStatus,
    SDKClaimAdapter,
    TransitionReport,
)
from mcp_server.migration.phases.phase_c import (
    ExportAdapter,
    ExportRecord,
    FilesystemWriteDetector,
    PhaseC,
    PhaseCConfig,
    PhaseCStatus,
    SDKOperationAdapter,
)
from mcp_server.migration.phases.phase_c import (
    TransitionReport as PhaseCTransitionReport,
)
from mcp_server.migration.phases.phase_d import (
    FilesystemDeprecationInterceptor,
    MigrationReport,
    PhaseD,
    PhaseDConfig,
    PhaseDStatus,
)

__all__ = [
    "Discrepancy",
    "ExportAdapter",
    "ExportRecord",
    "FilesystemClaimAdapter",
    "FilesystemDeprecationInterceptor",
    "FilesystemWriteDetector",
    "MigrationReport",
    "OperationBackend",
    "OperationRecord",
    "PhaseA",
    "PhaseAConfig",
    "PhaseAStatus",
    "PhaseB",
    "PhaseBConfig",
    "PhaseBStatus",
    "PhaseC",
    "PhaseCConfig",
    "PhaseCStatus",
    "PhaseCTransitionReport",
    "PhaseD",
    "PhaseDConfig",
    "PhaseDStatus",
    "SDKClaimAdapter",
    "SDKOperationAdapter",
    "TransitionReport",
    "ValidationReport",
]
