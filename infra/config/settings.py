"""
ForgeOS Environment Configuration - Typed Settings Module.

Loads configuration from environment variables with sensible defaults,
validates required variables, and provides profile-aware settings for
development, test, and production environments.

Usage:
    from infra.config.settings import get_settings

    settings = get_settings()
    print(settings.database_url)
    print(settings.environment)

Ticket: FORGEOS-DO004
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class Environment(str, Enum):
    """Supported environment profiles."""

    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class LogLevel(str, Enum):
    """Supported structured-log levels."""

    TRACE = "trace"
    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    FATAL = "fatal"


class SSLMode(str, Enum):
    """PostgreSQL SSL connection modes."""

    DISABLE = "disable"
    REQUIRE = "require"
    VERIFY_CA = "verify-ca"
    VERIFY_FULL = "verify-full"


# -------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------


def _env(
    key: str, default: str | None = None,
) -> str | None:
    """Read an env var, returning *default* if unset/empty."""
    value = os.environ.get(key, "")
    return value if value else default


def _env_required(key: str) -> str:
    """Read a required environment variable; raise on missing."""
    value = _env(key)
    if value is None:
        msg = (
            f"Required environment variable '{key}'"
            " is not set"
        )
        raise ConfigValidationError(msg)
    return value


def _env_int(key: str, default: int) -> int:
    """Read an integer environment variable with a default."""
    raw = _env(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigValidationError(
            f"Environment variable '{key}' must be"
            f" an integer, got '{raw}'"
        ) from exc


def _env_float(key: str, default: float) -> float:
    """Read a float environment variable with a default."""
    raw = _env(key)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ConfigValidationError(
            f"Environment variable '{key}' must be"
            f" a float, got '{raw}'"
        ) from exc


def _env_bool(key: str, default: bool) -> bool:
    """Read a boolean env var (true/false/1/0/yes/no)."""
    raw = _env(key)
    if raw is None:
        return default
    return raw.lower() in ("true", "1", "yes")


# -------------------------------------------------------------------
# Errors
# -------------------------------------------------------------------


class ConfigValidationError(Exception):
    """Raised when environment config is invalid."""


# -------------------------------------------------------------------
# Configuration dataclass
# -------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    """Immutable, validated configuration from env vars.

    Frozen (read-only) after construction to prevent accidental
    mutation at runtime.  All sensitive values (passwords, secrets,
    keys) are loaded exclusively from environment variables.
    """

    # -- General --
    environment: Environment
    app_name: str
    app_version: str

    # -- Database --
    database_url: str
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_pool_min: int
    db_pool_max: int
    db_ssl_mode: SSLMode

    # -- MCP Server --
    port: int
    node_env: str
    log_level: LogLevel
    admin_api_key: str
    webhook_secret: str | None
    workspace_path: str | None
    rate_limit_per_minute: int

    # -- Ticket / Lease --
    default_lease_minutes: int
    max_lease_minutes: int
    reconciliation_interval: int

    # -- pgAdmin --
    pgadmin_email: str
    pgadmin_password: str
    pgadmin_port: int

    # -- Observability --
    otel_endpoint: str
    otel_traces_sampler_arg: float
    otel_enabled: bool

    # -- Security --
    cors_allowed_origins: list[str]
    tls_cert_path: str | None
    tls_key_path: str | None
    jwt_secret: str | None
    jwt_expiry: str

    # -- Feature Flags --
    feature_dashboard: bool
    feature_webhooks: bool
    feature_agent_sdk: bool
    feature_chaos: bool

    # -- Derived --
    is_production: bool = field(
        init=False, default=False,
    )
    is_test: bool = field(
        init=False, default=False,
    )
    is_development: bool = field(
        init=False, default=False,
    )

    def __post_init__(self) -> None:
        """Set derived convenience flags."""
        object.__setattr__(
            self,
            "is_production",
            self.environment == Environment.PRODUCTION,
        )
        object.__setattr__(
            self,
            "is_test",
            self.environment == Environment.TEST,
        )
        object.__setattr__(
            self,
            "is_development",
            self.environment == Environment.DEVELOPMENT,
        )


# -------------------------------------------------------------------
# Profile-aware defaults
# -------------------------------------------------------------------

_PROFILE_DEFAULTS: dict[Environment, dict[str, Any]] = {
    Environment.DEVELOPMENT: {
        "log_level": LogLevel.DEBUG,
        "node_env": "development",
        "db_pool_min": 2,
        "db_pool_max": 10,
        "rate_limit_per_minute": 1000,
        "otel_traces_sampler_arg": 1.0,
        "otel_enabled": False,
        "cors_allowed_origins": "http://localhost:3000",
        "feature_dashboard": True,
        "feature_chaos": False,
        "reconciliation_interval": 60,
    },
    Environment.TEST: {
        "log_level": LogLevel.WARN,
        "node_env": "test",
        "db_pool_min": 1,
        "db_pool_max": 5,
        "rate_limit_per_minute": 10000,
        "otel_traces_sampler_arg": 1.0,
        "otel_enabled": False,
        "cors_allowed_origins": "http://localhost:3001",
        "feature_dashboard": False,
        "feature_chaos": False,
        "reconciliation_interval": 10,
    },
    Environment.PRODUCTION: {
        "log_level": LogLevel.INFO,
        "node_env": "production",
        "db_pool_min": 5,
        "db_pool_max": 20,
        "rate_limit_per_minute": 100,
        "otel_traces_sampler_arg": 0.05,
        "otel_enabled": True,
        "cors_allowed_origins": "",
        "feature_dashboard": True,
        "feature_chaos": False,
        "reconciliation_interval": 300,
    },
}


def _profile_default(
    env: Environment, key: str, fallback: Any,
) -> Any:
    """Return profile-aware default for *key*."""
    return _PROFILE_DEFAULTS.get(env, {}).get(
        key, fallback,
    )


# -------------------------------------------------------------------
# Factory
# -------------------------------------------------------------------


def load_dotenv_file(
    path: str | None = None,
) -> None:
    """Load a .env file into ``os.environ`` if it exists.

    Parameters
    ----------
    path : str | None
        Explicit path to a .env file.  When *None*, searches
        for ``infra/.env.<ENVIRONMENT>`` or ``infra/.env``
        relative to the project root.
    """
    if path and Path(path).is_file():
        _parse_dotenv(Path(path))
        return

    env_name = os.environ.get("ENVIRONMENT", "development")
    candidates = [
        Path(f"infra/.env.{env_name}"),
        Path("infra/.env"),
        Path(".env"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            _parse_dotenv(candidate)
            return


def _parse_dotenv(path: Path) -> None:
    """Minimal .env parser - sets missing vars into environ."""
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key not in os.environ:
                os.environ[key] = value


def get_settings(
    dotenv_path: str | None = None,
) -> Config:
    """Build and validate a Config from the environment.

    Optionally loads a .env file first.  Validates all required
    variables and applies profile-aware defaults based on the
    ``ENvalid_envs = [e.value for e in Environment]
        raise ConfigValidationError(
            f"ENVIRONMENT must be one of {valid_envs},"
            f" got '{env_raw}'"
        ) from Noneeters
    ----------
    dotenv_path : str | None
        Path to a .env file to Any) -> Anyng variables.

    Returns
    -------
    Config
        Frozen, validated configuration object.

    Raises
    ------
    ConfigValidationError
        If required variables are missing or invalid.
    """
    load_dotenv_file(dotenv_path)

    # Determine environment first - drives defaults
    env_raw = _env("ENVIRONMENT", "development")
    try:
        environment = Environment(env_raw)
    except ValueError:
        valid_envs = [e.value for e in Environment]
        raise ConfigValidationError(
            f"ENVIRONMENT must be one of {valid_envs},"
            f" got '{env_raw}'"
        ) from None

    def pd(key: str, fallback: Any) -> Any:
        """Profile-default shorthand."""
        return _profile_default(
            environment, key, fallback,
        )

    errors: list[str] = []

    # Database URL
    database_url = _env("DATABASE_URL")
    db_host = _env("DB_HOST", "localhost")
    db_port = _env_int("DB_PORT", 5432)
    db_name = _env("DB_NAME", "forgeos")
    db_user = _env("DB_USER", "forgeos")
    db_password = _env("DB_PASSWORD", "")

    if not database_url:
        if db_password:
            database_url = (
                f"postgresql://{db_user}:{db_password}"
                f"@{db_host}:{db_port}/{db_name}"
            )
        else:
            database_url = (
                f"postgresql://{db_user}"
                f"@{db_host}:{db_port}/{db_name}"
            )

    if not database_url.startswith("postgresql://"):
        errors.append(
            "DATABASE_URL must start with"
            " 'postgresql://'"
        )

    # SSL mode
    ssl_raw = _env("DB_SSL_MODE", "disable")
    try:
        db_ssl_mode = SSLMode(ssl_raw)
    except ValueError:
        ssl_vals = [m.value for m in SSLMode]
        errors.append(
            f"DB_SSL_MODE must be one of {ssl_vals},"
            f" got '{ssl_raw}'"
        )
        db_ssl_mode = SSLMode.DISABLE

    # Log level
    pd_log = pd("log_level", LogLevel.INFO)
    default_log = (
        pd_log.value
        if isinstance(pd_log, LogLevel)
        else str(pd_log)
    )
    log_raw = _env("LOG_LEVEL", default_log)
    try:
        log_level = LogLevel(log_raw)
    except ValueError:
        valid_levels = [lv.value for lv in LogLevel]
        errors.append(
            f"LOG_LEVEL must be one of {valid_levels},"
            f" got '{log_raw}'"
        )
        log_level = LogLevel.INFO

    # Port
    port = _env_int("PORT", 3000)
    if not 1 <= port <= 65535:
        errors.append(
            f"PORT must be between 1 and 65535,"
            f" got {port}"
        )

    # Admin API key
    admin_api_key = _env("ADMIN_API_KEY", "")
    webhook_secret = _env("WEBHOOK_SECRET")

    # Production-specific enforcement
    if environment == Environment.PRODUCTION:
        _prod_checks(
            errors, admin_api_key, webhook_secret,
        )

    # Lease / reconciliation
    default_lease = _env_int(
        "DEFAULT_LEASE_MINUTES", 30,
    )
    max_lease = _env_int("MAX_LEASE_MINUTES", 120)
    recon_default = int(
        pd("reconciliation_interval", 300),
    )
    reconciliation = _env_int(
        "RECONCILIATION_INTERVAL", recon_default,
    )

    if default_lease < 5:
        errors.append(
            "DEFAULT_LEASE_MINUTES must be >= 5,"
            f" got {default_lease}"
        )
    if max_lease < default_lease:
        errors.append(
            f"MAX_LEASE_MINUTES ({max_lease}) must"
            f" be >= DEFAULT_LEASE_MINUTES"
            f" ({default_lease})"
        )

    # CORS
    cors_default = str(
        pd("cors_allowed_origins", ""),
    )
    cors_raw = _env(
        "CORS_ALLOWED_ORIGINS", cors_default,
    )
    cors_origins = (
        [
            o.strip()
            for o in cors_raw.split(",")
            if o.strip()
        ]
        if cors_raw
        else []
    )

    # Feature flags
    feature_dashboard = _env_bool(
        "FEATURE_DASHBOARD",
        bool(pd("feature_dashboard", True)),
    )
    feature_webhooks = _env_bool(
        "FEATURE_WEBHOOKS", False,
    )
    feature_agent_sdk = _env_bool(
        "FEATURE_AGENT_SDK", False,
    )
    feature_chaos = _env_bool(
        "FEATURE_CHAOS",
        bool(pd("feature_chaos", False)),
    )

    if (
        feature_chaos
        and environment == Environment.PRODUCTION
    ):
        errors.append(
            "FEATURE_CHAOS must not be enabled"
            " in production"
        )

    if errors:
        formatted = "\n".join(
            f"  - {e}" for e in errors
        )
        raise ConfigValidationError(
            "Configuration validation failed"
            f" ({len(errors)} error(s)):\n{formatted}"
        )

    return _build_config(
        environment=environment,
        database_url=database_url or "",
        db_host=db_host or "localhost",
        db_port=db_port,
        db_name=db_name or "forgeos",
        db_user=db_user or "forgeos",
        db_password=db_password or "",
        db_ssl_mode=db_ssl_mode,
        port=port,
        log_level=log_level,
        admin_api_key=admin_api_key or "",
        webhook_secret=webhook_secret,
        default_lease=default_lease,
        max_lease=max_lease,
        reconciliation=reconciliation,
        cors_origins=cors_origins,
        feature_dashboard=feature_dashboard,
        feature_webhooks=feature_webhooks,
        feature_agent_sdk=feature_agent_sdk,
        feature_chaos=feature_chaos,
        pd=pd,
    )


def _prod_checks(
    errors: list[str],
    admin_api_key: str | None,
    webhook_secret: str | None,
) -> None:
    """Append production-specific validation errors."""
    if (
        not admin_api_key
        or admin_api_key == "forgeos_admin_CHANGE_ME"
    ):
        errors.append(
            "ADMIN_API_KEY must be explicitly set"
            " in production (not the default)"
        )
    if not webhook_secret:
        errors.append(
            "WEBHOOK_SECRET is required"
            " in production"
        )
    if not _env("JWT_SECRET"):
        errors.append(
            "JWT_SECRET is required in production"
        )
    if not _env("DB_PASSWORD"):
        errors.append(
            "DB_PASSWORD is required in production"
        )
    cors_raw = _env("CORS_ALLOWED_ORIGINS", "")
    if cors_raw == "*":
        errors.append(
            "CORS_ALLOWED_ORIGINS must not be"
            " '*' in production"
        )


def _build_config(  # noqa: PLR0913
    *,
    environment: Environment,
    database_url: str,
    db_host: str,
    db_port: int,
    db_name: str,
    db_user: str,
    db_password: str,
    db_ssl_mode: SSLMode,
    port: int,
    log_level: LogLevel,
    admin_api_key: str,
    webhook_secret: str | None,
    default_lease: int,
    max_lease: int,
    reconciliation: int,
    cors_origins: list[str],
    feature_dashboard: bool,
    feature_webhooks: bool,
    feature_agent_sdk: bool,
    feature_chaos: bool,
    pd: Any,
) -> Config:
    """Construct the Config object (extracted to shorten lines)."""
    node_env_val = (
        _env(
            "NODE_ENV",
            str(pd("node_env", "development")),
        )
        or "development"
    )
    rlpm = _env_int(
        "RATE_LIMIT_PER_MINUTE",
        int(pd("rate_limit_per_minute", 100)),
    )
    pgadmin_email_val = (
        _env(
            "PGADMIN_EMAIL",
            "admin@forgeos.local",
        )
        or "admin@forgeos.local"
    )
    otel_ep = (
        _env(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://localhost:4317",
        )
        or "http://localhost:4317"
    )
    otel_sampler = _env_float(
        "OTEL_TRACES_SAMPLER_ARG",
        float(pd("otel_traces_sampler_arg", 1.0)),
    )
    otel_on = _env_bool(
        "OTEL_ENABLED",
        bool(pd("otel_enabled", False)),
    )

    return Config(
        environment=environment,
        app_name=_env("APP_NAME", "forgeos")
        or "forgeos",
        app_version=_env("APP_VERSION", "0.0.0")
        or "0.0.0",
        database_url=database_url,
        db_host=db_host,
        db_port=db_port,
        db_name=db_name,
        db_user=db_user,
        db_password=db_password,
        db_pool_min=_env_int(
            "DB_POOL_MIN",
            int(pd("db_pool_min", 2)),
        ),
        db_pool_max=_env_int(
            "DB_POOL_MAX",
            int(pd("db_pool_max", 10)),
        ),
        db_ssl_mode=db_ssl_mode,
        port=port,
        node_env=node_env_val,
        log_level=log_level,
        admin_api_key=admin_api_key,
        webhook_secret=webhook_secret,
        workspace_path=_env("WORKSPACE_PATH"),
        rate_limit_per_minute=rlpm,
        default_lease_minutes=default_lease,
        max_lease_minutes=max_lease,
        reconciliation_interval=reconciliation,
        pgadmin_email=pgadmin_email_val,
        pgadmin_password=_env(
            "PGADMIN_PASSWORD", "",
        )
        or "",
        pgadmin_port=_env_int("PGADMIN_PORT", 5050),
        otel_endpoint=otel_ep,
        otel_traces_sampler_arg=otel_sampler,
        otel_enabled=otel_on,
        cors_allowed_origins=cors_origins,
        tls_cert_path=_env("TLS_CERT_PATH"),
        tls_key_path=_env("TLS_KEY_PATH"),
        jwt_secret=_env("JWT_SECRET"),
        jwt_expiry=_env("JWT_EXPIRY", "1h")
        or "1h",
        feature_dashboard=feature_dashboard,
        feature_webhooks=feature_webhooks,
        feature_agent_sdk=feature_agent_sdk,
        feature_chaos=feature_chaos,
    )


# -------------------------------------------------------------------
# Module-level convenience
# -------------------------------------------------------------------

_settings: Config | None = None


def settings() -> Config:
    """Return the cached singleton Config."""
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = get_settings()
    return _settings


def reset_settings() -> None:
    """Clear the cached singleton (useful in tests)."""
    global _settings  # noqa: PLW0603
    _settings = None


# -------------------------------------------------------------------
# CLI: validate configuration and print summary
# -------------------------------------------------------------------

if __name__ == "__main__":
    try:
        cfg = get_settings()
    except ConfigValidationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(
        f"ForgeOS Configuration"
        f" - {cfg.environment.value}"
    )
    print(
        f"  App:           {cfg.app_name}"
        f" v{cfg.app_version}"
    )
    print(
        f"  Database:      {cfg.db_host}"
        f":{cfg.db_port}/{cfg.db_name}"
    )
    print(
        f"  MCP Server:    :{cfg.port}"
        f" ({cfg.node_env})"
    )
    print(f"  Log Level:     {cfg.log_level.value}")
    print(f"  OTEL Enabled:  {cfg.otel_enabled}")
    feat = (
        f"dashboard={cfg.feature_dashboard}"
        f" webhooks={cfg.feature_webhooks}"
        f" agent_sdk={cfg.feature_agent_sdk}"
        f" chaos={cfg.feature_chaos}"
    )
    print(f"  Features:      {feat}")
    lease = (
        f"default={cfg.default_lease_minutes}m"
        f" max={cfg.max_lease_minutes}m"
    )
    print(f"  Lease:         {lease}")
    print(
        f"  CORS Origins:  {cfg.cors_allowed_origins}"
    )
    print("  Status:        OK")
