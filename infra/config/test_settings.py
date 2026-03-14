"""Comprehensive tests for infra/config/settings.py.

Ticket: FORGEOS-DO004 (rework)
Target: >= 80% coverage of settings.py
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

import pytest

from infra.config.settings import (
    ConfigValidationError,
    Environment,
    LogLevel,
    SSLMode,
    _env,
    _env_bool,
    _env_float,
    _env_int,
    _env_required,
    _parse_dotenv,
    _profile_default,
    get_settings,
    load_dotenv_file,
    reset_settings,
    settings,
)


# -------------------------------------------------------------------
# Fixtures
# -------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_env():
    """Ensure a clean environment for every test."""
    reset_settings()
    with mock.patch.dict(os.environ, {}, clear=True):
        yield
    reset_settings()


def _minimal_env(**overrides: str) -> dict[str, str]:
    """Return minimum env vars for a valid Config."""
    base = {
        "ENVIRONMENT": "development",
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "testdb",
        "DB_USER": "testuser",
        "DB_PASSWORD": "secret",
    }
    base.update(overrides)
    return base


# -------------------------------------------------------------------
# Enum tests
# -------------------------------------------------------------------


class TestEnvironmentEnum:
    def test_values(self):
        assert Environment.DEVELOPMENT.value == "development"
        assert Environment.TEST.value == "test"
        assert Environment.PRODUCTION.value == "production"

    def test_str(self):
        assert str(Environment.DEVELOPMENT) == "Environment.DEVELOPMENT"

    def test_from_value(self):
        assert Environment("development") is Environment.DEVELOPMENT


class TestLogLevelEnum:
    def test_all_levels(self):
        levels = [lv.value for lv in LogLevel]
        assert levels == [
            "trace", "debug", "info", "warn", "error", "fatal",
        ]

    def test_from_value(self):
        assert LogLevel("debug") is LogLevel.DEBUG


class TestSSLModeEnum:
    def test_all_modes(self):
        modes = [m.value for m in SSLMode]
        assert modes == [
            "disable", "require", "verify-ca", "verify-full",
        ]


# -------------------------------------------------------------------
# Helper function tests
# -------------------------------------------------------------------


class TestEnv:
    def test_returns_value_when_set(self):
        with mock.patch.dict(os.environ, {"MY_KEY": "val"}):
            assert _env("MY_KEY") == "val"

    def test_returns_default_when_unset(self):
        assert _env("MISSING_KEY", "fallback") == "fallback"

    def test_returns_default_when_empty(self):
        with mock.patch.dict(os.environ, {"EMPTY": ""}):
            assert _env("EMPTY", "fb") == "fb"

    def test_returns_none_when_no_default(self):
        assert _env("NOWHERE") is None


class TestEnvRequired:
    def test_returns_value(self):
        with mock.patch.dict(os.environ, {"REQ": "data"}):
            assert _env_required("REQ") == "data"

    def test_raises_on_missing(self):
        with pytest.raises(ConfigValidationError, match="REQ"):
            _env_required("REQ")


class TestEnvInt:
    def test_reads_int(self):
        with mock.patch.dict(os.environ, {"PORT": "8080"}):
            assert _env_int("PORT", 3011) == 8080

    def test_default(self):
        assert _env_int("PORT", 3011) == 3011

    def test_invalid_raises(self):
        with mock.patch.dict(os.environ, {"PORT": "abc"}):
            with pytest.raises(
                ConfigValidationError, match="integer",
            ):
                _env_int("PORT", 3011)


class TestEnvFloat:
    def test_reads_float(self):
        with mock.patch.dict(os.environ, {"RATE": "0.5"}):
            assert _env_float("RATE", 1.0) == 0.5

    def test_default(self):
        assert _env_float("RATE", 1.0) == 1.0

    def test_invalid_raises(self):
        with mock.patch.dict(os.environ, {"RATE": "xyz"}):
            with pytest.raises(
                ConfigValidationError, match="float",
            ):
                _env_float("RATE", 1.0)


class TestEnvBool:
    @pytest.mark.parametrize(
        "val,expected",
        [("true", True), ("1", True), ("yes", True),
         ("false", False), ("0", False), ("no", False)],
    )
    def test_values(self, val: str, expected: bool):
        with mock.patch.dict(os.environ, {"FLAG": val}):
            assert _env_bool("FLAG", False) is expected

    def test_default(self):
        assert _env_bool("FLAG", True) is True


# -------------------------------------------------------------------
# Profile defaults
# -------------------------------------------------------------------


class TestProfileDefault:
    def test_dev_defaults(self):
        result = _profile_default(
            Environment.DEVELOPMENT, "log_level", "N/A",
        )
        assert result == LogLevel.DEBUG

    def test_test_defaults(self):
        result = _profile_default(
            Environment.TEST, "db_pool_max", 0,
        )
        assert result == 5

    def test_prod_defaults(self):
        result = _profile_default(
            Environment.PRODUCTION, "otel_enabled", None,
        )
        assert result is True

    def test_fallback(self):
        result = _profile_default(
            Environment.DEVELOPMENT, "nonexistent", "fb",
        )
        assert result == "fb"


# -------------------------------------------------------------------
# Config dataclass
# -------------------------------------------------------------------


class TestConfig:
    def test_derived_fields_development(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            cfg = get_settings()
            assert cfg.is_development is True
            assert cfg.is_production is False
            assert cfg.is_test is False

    def test_derived_fields_production(self):
        env = _minimal_env(
            ENVIRONMENT="production",
            ADMIN_API_KEY="prod-key-1234",
            WEBHOOK_SECRET="wh-secret",
            JWT_SECRET="jwt-secret",
            DB_PASSWORD="prod-pw",
        )
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert cfg.is_production is True
            assert cfg.is_development is False

    def test_frozen(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            cfg = get_settings()
            with pytest.raises(AttributeError):
                cfg.port = 9999  # type: ignore[misc]


# -------------------------------------------------------------------
# get_settings / factory
# -------------------------------------------------------------------


class TestGetSettings:
    def test_default_development(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            cfg = get_settings()
            assert cfg.environment == Environment.DEVELOPMENT
            assert cfg.db_host == "localhost"
            assert cfg.db_port == 5432

    def test_database_url_composed(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            cfg = get_settings()
            assert "testuser:secret" in cfg.database_url
            assert "testdb" in cfg.database_url

    def test_database_url_no_password(self):
        env = _minimal_env(DB_PASSWORD="")
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert "testuser@" in cfg.database_url

    def test_database_url_explicit(self):
        env = _minimal_env(
            DATABASE_URL="postgresql://a:b@c:5432/d",
        )
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert cfg.database_url == (
                "postgresql://a:b@c:5432/d"
            )

    def test_invalid_database_url(self):
        env = _minimal_env(
            DATABASE_URL="mysql://bad",
        )
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError, match="postgresql",
            ):
                get_settings()

    def test_invalid_environment(self):
        with mock.patch.dict(
            os.environ, {"ENVIRONMENT": "staging"},
        ):
            with pytest.raises(
                ConfigValidationError, match="staging",
            ):
                get_settings()

    def test_invalid_ssl_mode(self):
        env = _minimal_env(DB_SSL_MODE="bad")
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError, match="DB_SSL_MODE",
            ):
                get_settings()

    def test_invalid_log_level(self):
        env = _minimal_env(LOG_LEVEL="verbose")
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError, match="LOG_LEVEL",
            ):
                get_settings()

    def test_port_out_of_range(self):
        env = _minimal_env(PORT="99999")
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError, match="PORT",
            ):
                get_settings()

    def test_lease_too_small(self):
        env = _minimal_env(DEFAULT_LEASE_MINUTES="2")
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
                match="DEFAULT_LEASE_MINUTES",
            ):
                get_settings()

    def test_max_lease_less_than_default(self):
        env = _minimal_env(
            DEFAULT_LEASE_MINUTES="30",
            MAX_LEASE_MINUTES="10",
        )
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
                match="MAX_LEASE_MINUTES",
            ):
                get_settings()

    def test_feature_flags(self):
        env = _minimal_env(
            FEATURE_DASHBOARD="true",
            FEATURE_WEBHOOKS="yes",
            FEATURE_AGENT_SDK="1",
        )
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert cfg.feature_dashboard is True
            assert cfg.feature_webhooks is True
            assert cfg.feature_agent_sdk is True

    def test_chaos_blocked_in_production(self):
        env = _minimal_env(
            ENVIRONMENT="production",
            FEATURE_CHAOS="true",
            ADMIN_API_KEY="real-key",
            WEBHOOK_SECRET="wh",
            JWT_SECRET="jwt",
            DB_PASSWORD="pw",
        )
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError, match="CHAOS",
            ):
                get_settings()

    def test_cors_origins_split(self):
        env = _minimal_env(
            CORS_ALLOWED_ORIGINS="http://a,http://b",
        )
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert cfg.cors_allowed_origins == [
                "http://a", "http://b",
            ]

    def test_observability_defaults(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            cfg = get_settings()
            assert cfg.otel_enabled is False
            assert cfg.otel_traces_sampler_arg == 1.0

    def test_test_profile_defaults(self):
        env = _minimal_env(ENVIRONMENT="test")
        with mock.patch.dict(os.environ, env):
            cfg = get_settings()
            assert cfg.log_level == LogLevel.WARN
            assert cfg.node_env == "test"
            assert cfg.db_pool_min == 1


# -------------------------------------------------------------------
# Production validation
# -------------------------------------------------------------------


class TestProductionValidation:
    def _prod_env(self, **overrides: str) -> dict[str, str]:
        base = _minimal_env(
            ENVIRONMENT="production",
            ADMIN_API_KEY="prod-api-key",
            WEBHOOK_SECRET="wh-secret",
            JWT_SECRET="jwt-secret",
            DB_PASSWORD="prod-pw",
        )
        base.update(overrides)
        return base

    def test_valid_production(self):
        with mock.patch.dict(os.environ, self._prod_env()):
            cfg = get_settings()
            assert cfg.is_production is True

    def test_missing_admin_key(self):
        with mock.patch.dict(
            os.environ, self._prod_env(ADMIN_API_KEY=""),
        ):
            with pytest.raises(
                ConfigValidationError,
                match="ADMIN_API_KEY",
            ):
                get_settings()

    def test_default_admin_key(self):
        with mock.patch.dict(
            os.environ,
            self._prod_env(
                ADMIN_API_KEY="forgeos_admin_CHANGE_ME",
            ),
        ):
            with pytest.raises(
                ConfigValidationError,
                match="ADMIN_API_KEY",
            ):
                get_settings()

    def test_missing_webhook_secret(self):
        env = self._prod_env()
        del env["WEBHOOK_SECRET"]
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
                match="WEBHOOK_SECRET",
            ):
                get_settings()

    def test_missing_jwt_secret(self):
        env = self._prod_env()
        del env["JWT_SECRET"]
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
                match="JWT_SECRET",
            ):
                get_settings()

    def test_missing_db_password(self):
        env = self._prod_env(DB_PASSWORD="")
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
                match="DB_PASSWORD",
            ):
                get_settings()

    def test_cors_wildcard_blocked(self):
        with mock.patch.dict(
            os.environ,
            self._prod_env(CORS_ALLOWED_ORIGINS="*"),
        ):
            with pytest.raises(
                ConfigValidationError,
                match="CORS_ALLOWED_ORIGINS",
            ):
                get_settings()


# -------------------------------------------------------------------
# Singleton
# -------------------------------------------------------------------


class TestSingleton:
    def test_settings_caches(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            s1 = settings()
            s2 = settings()
            assert s1 is s2

    def test_reset_clears_cache(self):
        with mock.patch.dict(os.environ, _minimal_env()):
            s1 = settings()
            reset_settings()
            s2 = settings()
            assert s1 is not s2


# -------------------------------------------------------------------
# Dotenv loading
# -------------------------------------------------------------------


class TestDotenv:
    def test_load_explicit_path(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text("MY_TEST_VAR=hello\n")
        load_dotenv_file(str(env_file))
        assert os.environ.get("MY_TEST_VAR") == "hello"

    def test_does_not_override_existing(
        self, tmp_path: Path,
    ):
        env_file = tmp_path / ".env"
        env_file.write_text("EXISTING=new\n")
        with mock.patch.dict(
            os.environ, {"EXISTING": "old"},
        ):
            load_dotenv_file(str(env_file))
            assert os.environ["EXISTING"] == "old"

    def test_parse_skips_comments(self, tmp_path: Path):
        env_file = tmp_path / ".env"
        env_file.write_text(
            "# comment\nKEY1=val1\n\nKEY2=val2\n"
        )
        _parse_dotenv(env_file)
        assert os.environ.get("KEY1") == "val1"
        assert os.environ.get("KEY2") == "val2"

    def test_parse_skips_lines_without_equals(
        self, tmp_path: Path,
    ):
        env_file = tmp_path / ".env"
        env_file.write_text("NOEQ\nGOOD=yes\n")
        _parse_dotenv(env_file)
        assert os.environ.get("GOOD") == "yes"
        assert "NOEQ" not in os.environ

    def test_load_nonexistent_path(self):
        # Should not raise
        load_dotenv_file("/nonexistent/.env")

    def test_load_discovers_env_file(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.chdir(tmp_path)
        env_file = tmp_path / ".env"
        env_file.write_text("DISC_VAR=found\n")
        load_dotenv_file()
        assert os.environ.get("DISC_VAR") == "found"


# -------------------------------------------------------------------
# Edge cases / multiple errors
# -------------------------------------------------------------------


class TestMultipleErrors:
    def test_accumulates_errors(self):
        env = _minimal_env(
            PORT="99999",
            DEFAULT_LEASE_MINUTES="1",
            DB_SSL_MODE="invalid",
            LOG_LEVEL="verbose",
        )
        with mock.patch.dict(os.environ, env):
            with pytest.raises(
                ConfigValidationError,
            ) as exc_info:
                get_settings()
            msg = str(exc_info.value)
            assert "PORT" in msg
            assert "DEFAULT_LEASE_MINUTES" in msg
            assert "DB_SSL_MODE" in msg
            assert "LOG_LEVEL" in msg
