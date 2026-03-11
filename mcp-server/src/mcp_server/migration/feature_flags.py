"""Feature flag system for ForgeOS migration.

Controls per-operation routing between file-based (``tickets.py``) and
MCP-backed ticket operations.  Flags are loaded from a YAML config file
and support three resolution scopes (highest priority first):

1. **Environment variable** — ``FORGEOS_FLAG_{OPERATION}`` overrides
   (``true``/``false``, ``enabled``/``disabled``, or a mode name).
2. **Agent-specific** — per-agent, per-operation overrides in YAML.
3. **Operation-specific** — per-operation defaults in YAML.
4. **Global** — fallback mode for all operations.

Each flag resolves to a :class:`FlagMode`:

* ``filesystem`` — legacy file-based mode (default, safest).
* ``dual``       — run both backends, compare results.
* ``database``   — MCP server / PostgreSQL only.

Gradual rollout is supported via ``rollout_percentage`` (0-100): when
set, that fraction of evaluations resolve to ``database`` mode, and the
remainder to ``filesystem``.

Example YAML::

    global:
      mode: filesystem
    operations:
      sync:
        mode: dual
      status:
        mode: database
        rollout_percentage: 25
    agents:
      Backend:
        claim:
          mode: dual
"""

from __future__ import annotations

import hashlib
import os
import random
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from threading import Lock
from typing import Any

import yaml

from mcp_server.observability import get_logger

logger = get_logger("migration.feature_flags")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_OPERATIONS: frozenset[str] = frozenset(
    {"sync", "claim", "advance", "rework", "release", "status", "validate"}
)

_ENV_TRUE_VALUES: frozenset[str] = frozenset(
    {"true", "enabled", "1", "database"}
)
_ENV_FALSE_VALUES: frozenset[str] = frozenset(
    {"false", "disabled", "0", "filesystem"}
)

DEFAULT_CONFIG_PATH = Path("config/migration-flags.yaml")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class FlagMode(str, Enum):
    """Migration mode for an operation."""

    FILESYSTEM = "filesystem"
    DUAL = "dual"
    DATABASE = "database"


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OperationFlag:
    """Resolved flag for a specific operation.

    Attributes
    ----------
    operation : str
        The operation name.
    mode : FlagMode
        The resolved mode.
    rollout_percentage : int | None
        Percentage of calls using database mode (0-100).
    source : str
        Where the value came from: ``"env"``, ``"agent"``,
        ``"operation"``, or ``"global"``.
    """

    operation: str
    mode: FlagMode
    rollout_percentage: int | None = None
    source: str = "global"

    def evaluate(self) -> FlagMode:
        """Return the effective mode, respecting rollout percentage."""
        if self.rollout_percentage is not None:
            if random.randint(1, 100) <= self.rollout_percentage:
                return FlagMode.DATABASE
            return FlagMode.FILESYSTEM
        return self.mode


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class FeatureFlagError(Exception):
    """Raised when feature flag configuration is invalid."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_mode(value: object, context: str) -> FlagMode:
    """Parse a mode value string into :class:`FlagMode`."""
    if not isinstance(value, str):
        msg = f"Invalid mode type at {context}: expected string, got {type(value).__name__}"
        raise FeatureFlagError(msg)
    try:
        return FlagMode(value)
    except ValueError:
        valid = [m.value for m in FlagMode]
        msg = f"Invalid mode '{value}' at {context}. Valid modes: {valid}"
        raise FeatureFlagError(msg) from None


def _parse_rollout(value: object, context: str) -> int | None:
    """Parse ``rollout_percentage``, returning ``None`` if absent."""
    if value is None:
        return None
    if not isinstance(value, (int, float)):
        msg = (
            f"Invalid rollout_percentage at {context}: "
            f"expected number, got {type(value).__name__}"
        )
        raise FeatureFlagError(msg)
    pct = int(value)
    if not 0 <= pct <= 100:
        msg = f"rollout_percentage at {context} must be 0-100, got {pct}"
        raise FeatureFlagError(msg)
    return pct


def _validate_operation(name: str, context: str) -> None:
    """Raise :class:`FeatureFlagError` for unknown operation names."""
    if name not in VALID_OPERATIONS:
        msg = (
            f"Unknown operation '{name}' in {context}. "
            f"Valid operations: {sorted(VALID_OPERATIONS)}"
        )
        raise FeatureFlagError(msg)


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------


class FeatureFlagManager:
    """Loads and evaluates feature flags from a YAML configuration file.

    Parameters
    ----------
    config_path : str | Path
        Path to the YAML configuration file.
    auto_reload : bool
        If ``True``, automatically re-reads the file when its mtime
        changes (cheap stat check on every :meth:`get_mode` call).
    """

    def __init__(
        self,
        config_path: str | Path,
        *,
        auto_reload: bool = False,
    ) -> None:
        self._config_path = Path(config_path)
        self._auto_reload = auto_reload
        self._lock = Lock()

        # Parsed state
        self._global_mode: FlagMode = FlagMode.FILESYSTEM
        self._global_rollout: int | None = None
        self._operations: dict[str, dict[str, Any]] = {}
        self._agents: dict[str, dict[str, dict[str, Any]]] = {}
        self._last_mtime: float = 0.0
        self._last_hash: str = ""
        self._loaded: bool = False

    # -- public API ---------------------------------------------------------

    def load(self) -> None:
        """Load (or re-load) the configuration from the YAML file.

        Raises
        ------
        FeatureFlagError
            If the YAML structure or values are invalid.
        FileNotFoundError
            If the config file does not exist.
        """
        with self._lock:
            self._load_locked()

    def reload(self) -> None:
        """Force a full reload of the configuration file."""
        with self._lock:
            self._last_hash = ""  # invalidate cache so _load_locked re-parses
            self._load_locked()

    def get_mode(
        self,
        operation: str,
        *,
        agent: str | None = None,
    ) -> FlagMode:
        """Resolve the effective mode for *operation*.

        Resolution order (highest priority first):

        1. ``FORGEOS_FLAG_{OPERATION}`` environment variable.
        2. Agent-specific YAML override (when *agent* is given).
        3. Operation-specific YAML setting.
        4. Global YAML default.

        Parameters
        ----------
        operation : str
            One of the valid operation names (``sync``, ``claim``, …).
        agent : str | None
            Optional agent name for scope-narrowed evaluation.

        Returns
        -------
        FlagMode

        Raises
        ------
        FeatureFlagError
            If *operation* is unknown or the manager is not loaded.
        """
        _validate_operation(operation, "get_mode()")

        if self._auto_reload:
            self._check_reload()

        if not self._loaded:
            msg = "Feature flags not loaded. Call load() first."
            raise FeatureFlagError(msg)

        # 1. Environment variable override
        env_key = f"FORGEOS_FLAG_{operation.upper()}"
        env_value = os.environ.get(env_key)
        if env_value is not None:
            resolved = self._resolve_env_value(env_value, env_key)
            logger.debug(
                "Flag resolved from environment",
                extra={"operation": operation, "env_key": env_key, "mode": resolved.value},
            )
            return resolved

        # 2. Agent-specific override
        if agent and agent in self._agents:
            agent_ops = self._agents[agent]
            if operation in agent_ops:
                cfg = agent_ops[operation]
                return OperationFlag(
                    operation=operation,
                    mode=cfg["mode"],
                    rollout_percentage=cfg.get("rollout_percentage"),
                    source="agent",
                ).evaluate()

        # 3. Operation-specific setting
        if operation in self._operations:
            cfg = self._operations[operation]
            return OperationFlag(
                operation=operation,
                mode=cfg["mode"],
                rollout_percentage=cfg.get("rollout_percentage"),
                source="operation",
            ).evaluate()

        # 4. Global default
        return OperationFlag(
            operation=operation,
            mode=self._global_mode,
            rollout_percentage=self._global_rollout,
            source="global",
        ).evaluate()

    def get_all_flags(self) -> dict[str, Any]:
        """Return a serialisable snapshot of all flag state.

        Useful for monitoring endpoints and diagnostic APIs.
        """
        if not self._loaded:
            return {"loaded": False}

        result: dict[str, Any] = {
            "loaded": True,
            "config_path": str(self._config_path),
            "global": {
                "mode": self._global_mode.value,
                "rollout_percentage": self._global_rollout,
            },
            "operations": {},
            "agents": {},
        }

        for op_name in sorted(VALID_OPERATIONS):
            if op_name in self._operations:
                cfg = self._operations[op_name]
                result["operations"][op_name] = {
                    "mode": cfg["mode"].value,
                    "rollout_percentage": cfg.get("rollout_percentage"),
                }
            else:
                result["operations"][op_name] = {
                    "mode": self._global_mode.value,
                    "rollout_percentage": self._global_rollout,
                    "inherited": True,
                }

        for agent_name in sorted(self._agents):
            agent_ops = self._agents[agent_name]
            result["agents"][agent_name] = {}
            for op_name in sorted(agent_ops):
                cfg = agent_ops[op_name]
                result["agents"][agent_name][op_name] = {
                    "mode": cfg["mode"].value,
                    "rollout_percentage": cfg.get("rollout_percentage"),
                }

        return result

    @classmethod
    def from_config(
        cls,
        config_path: str | Path | None = None,
        *,
        auto_reload: bool = False,
    ) -> FeatureFlagManager:
        """Create a loaded :class:`FeatureFlagManager` from a config file.

        Parameters
        ----------
        config_path : str | Path | None
            Defaults to ``config/migration-flags.yaml``.
        auto_reload : bool
            Enable automatic reload on file changes.
        """
        path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
        manager = cls(path, auto_reload=auto_reload)
        manager.load()
        return manager

    # -- private helpers ----------------------------------------------------

    def _load_locked(self) -> None:
        """Parse the YAML file and update internal state.  Caller holds *_lock*."""
        content = self._config_path.read_text(encoding="utf-8")
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        if content_hash == self._last_hash and self._loaded:
            return  # nothing changed

        data = yaml.safe_load(content)
        if not isinstance(data, dict):
            msg = f"Expected YAML mapping at top level, got {type(data).__name__}"
            raise FeatureFlagError(msg)

        # Snapshot old state for change logging
        old_global = self._global_mode if self._loaded else None
        old_ops = dict(self._operations) if self._loaded else {}

        # --- global ---
        global_cfg = data.get("global", {})
        if not isinstance(global_cfg, dict):
            global_cfg = {}
        new_global = _parse_mode(global_cfg.get("mode", "filesystem"), "global.mode")
        new_global_rollout = _parse_rollout(
            global_cfg.get("rollout_percentage"), "global"
        )

        # --- operations ---
        new_ops: dict[str, dict[str, Any]] = {}
        ops_data = data.get("operations", {})
        if ops_data and isinstance(ops_data, dict):
            for op_name, op_cfg in ops_data.items():
                _validate_operation(op_name, "operations")
                if not isinstance(op_cfg, dict):
                    msg = f"Operation '{op_name}' config must be a mapping"
                    raise FeatureFlagError(msg)
                mode = _parse_mode(
                    op_cfg.get("mode", "filesystem"),
                    f"operations.{op_name}.mode",
                )
                rollout = _parse_rollout(
                    op_cfg.get("rollout_percentage"),
                    f"operations.{op_name}",
                )
                new_ops[op_name] = {"mode": mode, "rollout_percentage": rollout}

        # --- agents ---
        new_agents: dict[str, dict[str, dict[str, Any]]] = {}
        agents_data = data.get("agents", {})
        if agents_data and isinstance(agents_data, dict):
            for agent_name, agent_cfg in agents_data.items():
                if not isinstance(agent_cfg, dict):
                    msg = f"Agent '{agent_name}' config must be a mapping"
                    raise FeatureFlagError(msg)
                new_agents[agent_name] = {}
                for op_name, op_cfg in agent_cfg.items():
                    _validate_operation(op_name, f"agents.{agent_name}")
                    if not isinstance(op_cfg, dict):
                        msg = (
                            f"Agent '{agent_name}' operation '{op_name}' "
                            f"config must be a mapping"
                        )
                        raise FeatureFlagError(msg)
                    mode = _parse_mode(
                        op_cfg.get("mode", "filesystem"),
                        f"agents.{agent_name}.{op_name}.mode",
                    )
                    rollout = _parse_rollout(
                        op_cfg.get("rollout_percentage"),
                        f"agents.{agent_name}.{op_name}",
                    )
                    new_agents[agent_name][op_name] = {
                        "mode": mode,
                        "rollout_percentage": rollout,
                    }

        # Audit-log changes
        if self._loaded:
            self._log_changes(old_global, new_global, old_ops, new_ops)

        # Apply new state
        self._global_mode = new_global
        self._global_rollout = new_global_rollout
        self._operations = new_ops
        self._agents = new_agents
        self._last_hash = content_hash
        self._last_mtime = self._config_path.stat().st_mtime
        self._loaded = True

        logger.info(
            "Feature flags loaded",
            extra={
                "config_path": str(self._config_path),
                "global_mode": self._global_mode.value,
                "operations_configured": len(self._operations),
                "agents_configured": len(self._agents),
            },
        )

    def _log_changes(
        self,
        old_global: FlagMode | None,
        new_global: FlagMode,
        old_ops: dict[str, dict[str, Any]],
        new_ops: dict[str, dict[str, Any]],
    ) -> None:
        """Emit structured log entries for every changed flag value."""
        if old_global is not None and old_global != new_global:
            logger.info(
                "Feature flag changed",
                extra={
                    "scope": "global",
                    "flag": "mode",
                    "old_value": old_global.value,
                    "new_value": new_global.value,
                },
            )

        all_ops = set(old_ops) | set(new_ops)
        for op_name in sorted(all_ops):
            old_mode = old_ops.get(op_name, {}).get("mode")
            new_mode = new_ops.get(op_name, {}).get("mode")
            if old_mode != new_mode:
                logger.info(
                    "Feature flag changed",
                    extra={
                        "scope": "operation",
                        "operation": op_name,
                        "flag": "mode",
                        "old_value": old_mode.value if old_mode else "unset",
                        "new_value": new_mode.value if new_mode else "removed",
                    },
                )

    def _resolve_env_value(self, value: str, env_key: str) -> FlagMode:
        """Map an env-var string to a :class:`FlagMode`."""
        normalised = value.strip().lower()
        if normalised in _ENV_TRUE_VALUES:
            return FlagMode.DATABASE
        if normalised in _ENV_FALSE_VALUES:
            return FlagMode.FILESYSTEM
        if normalised == "dual":
            return FlagMode.DUAL
        msg = (
            f"Invalid value '{value}' for {env_key}. "
            f"Expected: true/false, enabled/disabled, or a mode name."
        )
        raise FeatureFlagError(msg)

    def _check_reload(self) -> None:
        """Stat the config file; reload if mtime increased."""
        try:
            mtime = self._config_path.stat().st_mtime
        except OSError:
            return  # file temporarily unavailable
        if mtime > self._last_mtime:
            with self._lock:
                # re-check after acquiring lock
                try:
                    mtime = self._config_path.stat().st_mtime
                except OSError:
                    return
                if mtime > self._last_mtime:
                    self._load_locked()
