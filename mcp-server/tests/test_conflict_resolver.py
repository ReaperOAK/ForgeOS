"""Tests for mcp_server.migration.conflict_resolver."""

from __future__ import annotations

from mcp_server.migration.conflict_resolver import (
    ConflictRecord,
    ConflictResolver,
    ConflictType,
)


class TestConflictResolverStage:
    """Stage conflict resolution (database-wins)."""

    def test_resolve_stage_returns_db_value(self) -> None:
        resolver = ConflictResolver()
        result = resolver.resolve_stage("T-001", "BACKEND", "QA")
        assert result == "QA"

    def test_resolve_stage_logs_conflict(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_stage("T-001", "BACKEND", "QA")

        records = resolver.conflicts
        assert len(records) == 1
        assert records[0].ticket_id == "T-001"
        assert records[0].conflict_type == ConflictType.STAGE_MISMATCH
        assert records[0].fs_value == "BACKEND"
        assert records[0].db_value == "QA"
        assert "database-wins" in records[0].resolution

    def test_resolve_stage_record_has_timestamp(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_stage("T-001", "READY", "BACKEND")
        assert resolver.conflicts[0].resolved_at is not None
        assert len(resolver.conflicts[0].resolved_at) > 0


class TestConflictResolverClaim:
    """Claim conflict resolution (database-wins)."""

    def test_resolve_claim_returns_db_claim(self) -> None:
        resolver = ConflictResolver()
        fs_claim = {"claimed_by": "AgentA", "machine_id": "m1"}
        db_claim = {"claimed_by": "AgentB", "machine_id": "m2"}

        result = resolver.resolve_claim("T-002", fs_claim, db_claim)
        assert result == db_claim

    def test_resolve_claim_logs_conflict(self) -> None:
        resolver = ConflictResolver()
        fs_claim = {"claimed_by": "AgentA"}
        db_claim = {"claimed_by": "AgentB"}

        resolver.resolve_claim("T-002", fs_claim, db_claim)
        records = resolver.conflicts
        assert len(records) == 1
        assert records[0].conflict_type == ConflictType.CLAIM_MISMATCH
        assert records[0].fs_value == fs_claim
        assert records[0].db_value == db_claim


class TestConflictResolverMetadata:
    """Generic metadata conflict resolution."""

    def test_resolve_metadata_returns_db_value(self) -> None:
        resolver = ConflictResolver()
        result = resolver.resolve_metadata("T-003", "priority", "low", "high")
        assert result == "high"

    def test_resolve_metadata_logs_conflict(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_metadata("T-003", "priority", "low", "high")
        records = resolver.conflicts
        assert len(records) == 1
        assert records[0].conflict_type == ConflictType.METADATA_MISMATCH


class TestConflictResolverNewEntries:
    """Recording tickets existing only on one side."""

    def test_record_new_in_fs(self) -> None:
        resolver = ConflictResolver()
        resolver.record_new_in_fs("T-NEW")
        records = resolver.conflicts
        assert len(records) == 1
        assert records[0].conflict_type == ConflictType.NEW_IN_FS
        assert records[0].fs_value == "T-NEW"
        assert records[0].db_value is None

    def test_record_new_in_db(self) -> None:
        resolver = ConflictResolver()
        resolver.record_new_in_db("T-DB")
        records = resolver.conflicts
        assert len(records) == 1
        assert records[0].conflict_type == ConflictType.NEW_IN_DB
        assert records[0].db_value == "T-DB"
        assert records[0].fs_value is None


class TestConflictResolverLifecycle:
    """Audit log management."""

    def test_conflicts_returns_copy(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_stage("T-001", "A", "B")
        c1 = resolver.conflicts
        c2 = resolver.conflicts
        assert c1 == c2
        assert c1 is not c2

    def test_clear_resets_log(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_stage("T-001", "A", "B")
        resolver.resolve_stage("T-002", "C", "D")
        assert len(resolver.conflicts) == 2

        resolver.clear()
        assert len(resolver.conflicts) == 0

    def test_multiple_resolutions_accumulate(self) -> None:
        resolver = ConflictResolver()
        resolver.resolve_stage("T-001", "A", "B")
        resolver.resolve_claim("T-001", {"x": 1}, {"x": 2})
        resolver.record_new_in_fs("T-002")
        assert len(resolver.conflicts) == 3
