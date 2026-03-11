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

__all__ = [
    "Discrepancy",
    "FilesystemClaimAdapter",
    "OperationBackend",
    "OperationRecord",
    "PhaseA",
    "PhaseAConfig",
    "PhaseAStatus",
    "PhaseB",
    "PhaseBConfig",
    "PhaseBStatus",
    "SDKClaimAdapter",
    "TransitionReport",
    "ValidationReport",
]
