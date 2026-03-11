"""Migration phases package.

Provides lifecycle management for the phased migration from
filesystem-based ticket operations to database-backed operations.

Phase A — Background Sync:
    Agents continue using the filesystem as-is. The sync engine runs
    in the background, mirroring every filesystem change to the
    database. The filesystem remains the source of truth. No agent
    behaviour changes are required.
"""

from mcp_server.migration.phases.phase_a import (
    Discrepancy,
    PhaseA,
    PhaseAConfig,
    PhaseAStatus,
    ValidationReport,
)

__all__ = [
    "Discrepancy",
    "PhaseA",
    "PhaseAConfig",
    "PhaseAStatus",
    "ValidationReport",
]
