"""Tests for mcp_server.migration.feature_flags — FeatureFlagManager."""

from __future__ import annotations

import os
import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest

from mcp_server.migration.feature_flags import (
    DEFAULT_CONFIG_PATH,
    VALID_OPERATIONS,
    FeatureFlagError,
    FeatureFlagManager,
    FlagMode,
    OperationFlag,
    _parse_mode,
    _parse_rollout,
    _validate_operation,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_yaml(tmp_path: Path, content: str) -> Path:
    """Write YAML *content* to a temp file and return its path."""
    p = tmp_path / "flags.yaml"
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


MINIMAL_YAML = """\
global:
  mode: filesystem
"""

FULL_YAML = """\
global:
  mode: filesystem
operations:
  sync:
    mode: dual
  claim:
    mode: filesystem
  status:
    mode: database
    rollout_percentage: 50
agents:
  Backend:
    claim:
      mode: dual
    sync:
      mode: database
"""


# ---------------------------------------------------------------------------
# FlagMode enum
# ---------------------------------------------------------------------------


class TestFlagMode:
    def test_values(self) -> None:
        assert FlagMode.FILESYSTEM.value == "filesystem"
        assert FlagMode.DUAL.value == "dual"
        assert FlagMode.DATABASE.value == "database"

    def test_from_string(self) -> None:
        assert FlagMode("filesystem") is FlagMode.FILESYSTEM
        assert FlagMode("dual") is FlagMode.DUAL
        assert FlagMode("database") is FlagMode.DATABASE

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError):
            FlagMode("invalid")


# ---------------------------------------------------------------------------
# OperationFlag
# ---------------------------------------------------------------------------


class TestOperationFlag:
    def test_evaluate_direct_mode(self) -> None:
        flag = OperationFlag(operation="sync", mode=FlagMode.DUAL)
        assert flag.evaluate() is FlagMode.DUAL

    def test_evaluate_filesystem(self) -> None:
        flag = OperationFlag(operation="claim", mode=FlagMode.FILESYSTEM)
        assert flag.evaluate() is FlagMode.FILESYSTEM

    def test_evaluate_database(self) -> None:
        flag = OperationFlag(operation="status", mode=FlagMode.DATABASE)
        assert flag.evaluate() is FlagMode.DATABASE

    def test_rollout_percentage_100(self) -> None:
        flag = OperationFlag(
            operation="sync", mode=FlagMode.DATABASE, rollout_percentage=100
        )
        assert flag.evaluate() is FlagMode.DATABASE

    def test_rollout_percentage_0(self) -> None:
        flag = OperationFlag(
            operation="sync", mode=FlagMode.DATABASE, rollout_percentage=0
        )
        assert flag.evaluate() is FlagMode.FILESYSTEM

    def test_frozen(self) -> None:
        flag = OperationFlag(operation="sync", mode=FlagMode.DUAL)
        with pytest.raises(AttributeError):
            flag.mode = FlagMode.FILESYSTEM  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


class TestParseMode:
    def test_valid_modes(self) -> None:
        assert _parse_mode("filesystem", "test") is FlagMode.FILESYSTEM
        assert _parse_mode("dual", "test") is FlagMode.DUAL
        assert _parse_mode("database", "test") is FlagMode.DATABASE

    def test_invalid_mode_raises(self) -> None:
        with pytest.raises(FeatureFlagError, match="Invalid mode 'nope'"):
            _parse_mode("nope", "test")

    def test_non_string_raises(self) -> None:
        with pytest.raises(FeatureFlagError, match="expected string"):
            _parse_mode(42, "test")


class TestParseRollout:
    def test_none_returns_none(self) -> None:
        assert _parse_rollout(None, "test") is None

    def test_valid_percentage(self) -> None:
        assert _parse_rollout(50, "test") == 50
        assert _parse_rollout(0, "test") == 0
        assert _parse_rollout(100, "test") == 100

    def test_float_truncated(self) -> None:
        assert _parse_rollout(33.7, "test") == 33

    def test_out_of_range_raises(self) -> None:
        with pytest.raises(FeatureFlagError, match="must be 0"):
            _parse_rollout(101, "test")
        with pytest.raises(FeatureFlagError, match="must be 0"):
            _parse_rollout(-1, "test")

    def test_non_numeric_raises(self) -> None:
        with pytest.raises(FeatureFlagError, match="expected number"):
            _parse_rollout("fifty", "test")


class TestValidateOperation:
    def test_valid_operations(self) -> None:
        for op in VALID_OPERATIONS:
            _validate_operation(op, "test")  # should not raise

    def test_invalid_raises(self) -> None:
        with pytest.raises(FeatureFlagError, match="Unknown operation 'destroy'"):
            _validate_operation("destroy", "test")


# ---------------------------------------------------------------------------
# FeatureFlagManager — loading
# ---------------------------------------------------------------------------


class TestFeatureFlagManagerLoad:
    def test_load_minimal(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        assert mgr.get_mode("sync") is FlagMode.FILESYSTEM

    def test_load_full(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        assert mgr.get_mode("claim") is FlagMode.FILESYSTEM
        assert mgr.get_mode("sync") is FlagMode.DUAL

    def test_file_not_found(self, tmp_path: Path) -> None:
        mgr = FeatureFlagManager(tmp_path / "nope.yaml")
        with pytest.raises(FileNotFoundError):
            mgr.load()

    def test_invalid_yaml_top_level(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, "- list\n- item\n")
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="Expected YAML mapping"):
            mgr.load()

    def test_invalid_operation_name(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              destroy:
                mode: filesystem
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="Unknown operation 'destroy'"):
            mgr.load()

    def test_invalid_mode_value(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: turbo
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="Invalid mode 'turbo'"):
            mgr.load()

    def test_invalid_operation_config_type(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              sync: true
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="must be a mapping"):
            mgr.load()

    def test_invalid_agent_config_type(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            agents:
              Backend: true
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="must be a mapping"):
            mgr.load()

    def test_invalid_agent_operation_config_type(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            agents:
              Backend:
                sync: true
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="must be a mapping"):
            mgr.load()

    def test_invalid_agent_operation_name(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            agents:
              Backend:
                destroy:
                  mode: filesystem
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="Unknown operation 'destroy'"):
            mgr.load()

    def test_rollout_percentage(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              status:
                mode: database
                rollout_percentage: 100
            """,
        )
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # With 100% rollout, it should always resolve to DATABASE
        assert mgr.get_mode("status") is FlagMode.DATABASE

    def test_idempotent_reload(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        mgr.load()  # second load should be a no-op (same hash)
        assert mgr.get_mode("sync") is FlagMode.FILESYSTEM


# ---------------------------------------------------------------------------
# FeatureFlagManager — get_mode resolution
# ---------------------------------------------------------------------------


class TestGetModeResolution:
    def test_global_default(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # All operations fall through to global
        for op in VALID_OPERATIONS:
            assert mgr.get_mode(op) is FlagMode.FILESYSTEM

    def test_operation_overrides_global(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        assert mgr.get_mode("sync") is FlagMode.DUAL  # operation overrides global

    def test_agent_overrides_operation(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # Without agent: operation-level (filesystem)
        assert mgr.get_mode("claim") is FlagMode.FILESYSTEM
        # With agent: agent-level override (dual)
        assert mgr.get_mode("claim", agent="Backend") is FlagMode.DUAL

    def test_agent_not_configured_falls_through(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # QA agent not configured — falls through to operation/global
        assert mgr.get_mode("sync", agent="QA") is FlagMode.DUAL

    def test_env_override_true(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_SYNC": "true"}):
            assert mgr.get_mode("sync") is FlagMode.DATABASE

    def test_env_override_false(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: database
            """,
        )
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_SYNC": "false"}):
            assert mgr.get_mode("sync") is FlagMode.FILESYSTEM

    def test_env_override_enabled(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_CLAIM": "enabled"}):
            assert mgr.get_mode("claim") is FlagMode.DATABASE

    def test_env_override_disabled(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_CLAIM": "disabled"}):
            assert mgr.get_mode("claim") is FlagMode.FILESYSTEM

    def test_env_override_dual(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_ADVANCE": "dual"}):
            assert mgr.get_mode("advance") is FlagMode.DUAL

    def test_env_override_database_string(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_RELEASE": "database"}):
            assert mgr.get_mode("release") is FlagMode.DATABASE

    def test_env_override_filesystem_string(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_RELEASE": "filesystem"}):
            assert mgr.get_mode("release") is FlagMode.FILESYSTEM

    def test_env_override_beats_agent(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # Agent says "dual" for claim, but env override wins
        with patch.dict(os.environ, {"FORGEOS_FLAG_CLAIM": "false"}):
            assert mgr.get_mode("claim", agent="Backend") is FlagMode.FILESYSTEM

    def test_env_invalid_value_raises(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with patch.dict(os.environ, {"FORGEOS_FLAG_SYNC": "maybe"}), pytest.raises(
            FeatureFlagError, match="Invalid value 'maybe'"
        ):
            mgr.get_mode("sync")

    def test_unknown_operation_raises(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        with pytest.raises(FeatureFlagError, match="Unknown operation 'nuke'"):
            mgr.get_mode("nuke")

    def test_not_loaded_raises(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="not loaded"):
            mgr.get_mode("sync")


# ---------------------------------------------------------------------------
# FeatureFlagManager — reload
# ---------------------------------------------------------------------------


class TestReload:
    def test_reload_picks_up_changes(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        assert mgr.get_mode("sync") is FlagMode.FILESYSTEM

        # Overwrite config
        cfg.write_text(
            textwrap.dedent("""\
            global:
              mode: database
            """),
            encoding="utf-8",
        )
        mgr.reload()
        assert mgr.get_mode("sync") is FlagMode.DATABASE

    def test_auto_reload_on_mtime_change(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg, auto_reload=True)
        mgr.load()
        assert mgr.get_mode("sync") is FlagMode.FILESYSTEM

        # Mutate file and bump mtime
        cfg.write_text(
            textwrap.dedent("""\
            global:
              mode: dual
            """),
            encoding="utf-8",
        )
        # Force mtime to be in the future
        import time

        future = time.time() + 10
        os.utime(cfg, (future, future))
        assert mgr.get_mode("sync") is FlagMode.DUAL


# ---------------------------------------------------------------------------
# FeatureFlagManager — get_all_flags
# ---------------------------------------------------------------------------


class TestGetAllFlags:
    def test_not_loaded(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        result = mgr.get_all_flags()
        assert result == {"loaded": False}

    def test_loaded_minimal(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        result = mgr.get_all_flags()
        assert result["loaded"] is True
        assert result["global"]["mode"] == "filesystem"
        # All operations should be listed (inherited from global)
        for op in VALID_OPERATIONS:
            assert op in result["operations"]
            assert result["operations"][op]["mode"] == "filesystem"
            assert result["operations"][op].get("inherited") is True

    def test_loaded_full(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, FULL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        result = mgr.get_all_flags()
        assert result["loaded"] is True
        assert result["operations"]["sync"]["mode"] == "dual"
        assert result["operations"]["status"]["rollout_percentage"] == 50
        assert "Backend" in result["agents"]
        assert result["agents"]["Backend"]["claim"]["mode"] == "dual"
        assert result["agents"]["Backend"]["sync"]["mode"] == "database"


# ---------------------------------------------------------------------------
# FeatureFlagManager — from_config
# ---------------------------------------------------------------------------


class TestFromConfig:
    def test_from_config_custom_path(self, tmp_path: Path) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager.from_config(cfg)
        assert mgr.get_mode("sync") is FlagMode.FILESYSTEM

    def test_from_config_default_path_missing(self) -> None:
        with pytest.raises(FileNotFoundError):
            FeatureFlagManager.from_config(Path("/nonexistent/flags.yaml"))

    def test_default_config_path(self) -> None:
        assert Path("config/migration-flags.yaml") == DEFAULT_CONFIG_PATH


# ---------------------------------------------------------------------------
# Change logging (audit trail)
# ---------------------------------------------------------------------------


class TestChangeLogging:
    def test_log_emitted_on_global_change(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()

        cfg.write_text(
            textwrap.dedent("""\
            global:
              mode: database
            """),
            encoding="utf-8",
        )
        with caplog.at_level("INFO", logger="forgeos.migration.feature_flags"):
            mgr.reload()

        assert any("Feature flag changed" in r.message for r in caplog.records)

    def test_log_emitted_on_operation_change(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        cfg = _write_yaml(tmp_path, MINIMAL_YAML)
        mgr = FeatureFlagManager(cfg)
        mgr.load()

        cfg.write_text(
            textwrap.dedent("""\
            global:
              mode: filesystem
            operations:
              sync:
                mode: dual
            """),
            encoding="utf-8",
        )
        with caplog.at_level("INFO", logger="forgeos.migration.feature_flags"):
            mgr.reload()

        flag_change_records = [
            r for r in caplog.records if "Feature flag changed" in r.message
        ]
        assert len(flag_change_records) >= 1


# ---------------------------------------------------------------------------
# Rollout percentage edge cases
# ---------------------------------------------------------------------------


class TestRolloutPercentage:
    def test_zero_rollout_always_filesystem(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              sync:
                mode: database
                rollout_percentage: 0
            """,
        )
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        # 0% rollout → always filesystem
        results = {mgr.get_mode("sync") for _ in range(20)}
        assert results == {FlagMode.FILESYSTEM}

    def test_100_rollout_always_database(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              sync:
                mode: database
                rollout_percentage: 100
            """,
        )
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        results = {mgr.get_mode("sync") for _ in range(20)}
        assert results == {FlagMode.DATABASE}

    def test_global_rollout_percentage(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: database
              rollout_percentage: 100
            """,
        )
        mgr = FeatureFlagManager(cfg)
        mgr.load()
        assert mgr.get_mode("sync") is FlagMode.DATABASE

    def test_invalid_rollout_over_100(self, tmp_path: Path) -> None:
        cfg = _write_yaml(
            tmp_path,
            """\
            global:
              mode: filesystem
            operations:
              sync:
                mode: database
                rollout_percentage: 150
            """,
        )
        mgr = FeatureFlagManager(cfg)
        with pytest.raises(FeatureFlagError, match="must be 0"):
            mgr.load()
