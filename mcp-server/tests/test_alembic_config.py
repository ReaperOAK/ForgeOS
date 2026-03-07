"""Tests for Alembic configuration and migration environment.

TDD Evidence
------------
- RED: Tests written FIRST to verify Alembic configuration structure.
- GREEN: ``alembic.ini`` and ``alembic/env.py`` created to satisfy tests.
- REFACTOR: Config paths standardized.
"""

from __future__ import annotations

from configparser import ConfigParser
from pathlib import Path

# Root of the mcp-server package
MCP_SERVER_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# alembic.ini — configuration file
# ---------------------------------------------------------------------------


class TestAlembicIni:
    """Verify alembic.ini is valid and correctly configured."""

    def test_ini_file_exists(self) -> None:
        """alembic.ini exists in the mcp-server root."""
        ini_path = MCP_SERVER_ROOT / "alembic.ini"
        assert ini_path.exists(), f"alembic.ini not found at {ini_path}"

    def test_ini_has_alembic_section(self) -> None:
        """alembic.ini contains an [alembic] section."""
        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        assert "alembic" in config.sections()

    def test_ini_script_location(self) -> None:
        """script_location points to the alembic directory."""
        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        assert config.get("alembic", "script_location") == "alembic"

    def test_ini_sqlalchemy_url_placeholder(self) -> None:
        """sqlalchemy.url is a placeholder (overridden by env.py at runtime)."""
        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        url = config.get("alembic", "sqlalchemy.url")
        # Should be empty or a placeholder — the real URL comes from env vars
        assert url == "" or "placeholder" in url.lower() or "override" in url.lower()

    def test_ini_file_template(self) -> None:
        """file_template produces timestamped migration filenames."""
        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        template = config.get("alembic", "file_template")
        assert "%(rev)s" in template or "%(year)d" in template


# ---------------------------------------------------------------------------
# alembic/env.py — migration environment
# ---------------------------------------------------------------------------


class TestAlembicEnvModule:
    """Verify alembic/env.py exists and has required functions."""

    def test_env_py_exists(self) -> None:
        """alembic/env.py exists."""
        env_path = MCP_SERVER_ROOT / "alembic" / "env.py"
        assert env_path.exists(), f"env.py not found at {env_path}"

    def test_env_py_imports_asyncpg(self) -> None:
        """env.py references async engine configuration."""
        env_path = MCP_SERVER_ROOT / "alembic" / "env.py"
        content = env_path.read_text()
        assert "async" in content.lower()

    def test_env_py_has_run_migrations_online(self) -> None:
        """env.py defines run_migrations_online function."""
        env_path = MCP_SERVER_ROOT / "alembic" / "env.py"
        content = env_path.read_text()
        assert "run_migrations_online" in content

    def test_env_py_has_run_migrations_offline(self) -> None:
        """env.py defines run_migrations_offline function."""
        env_path = MCP_SERVER_ROOT / "alembic" / "env.py"
        content = env_path.read_text()
        assert "run_migrations_offline" in content

    def test_env_py_reads_database_url_from_env(self) -> None:
        """env.py reads DATABASE_URL from environment variables."""
        env_path = MCP_SERVER_ROOT / "alembic" / "env.py"
        content = env_path.read_text()
        assert "DATABASE_URL" in content


# ---------------------------------------------------------------------------
# alembic/script.py.mako — migration template
# ---------------------------------------------------------------------------


class TestAlembicScriptTemplate:
    """Verify migration script template exists and has proper structure."""

    def test_template_exists(self) -> None:
        """script.py.mako exists in alembic directory."""
        template_path = MCP_SERVER_ROOT / "alembic" / "script.py.mako"
        assert template_path.exists()

    def test_template_has_upgrade_function(self) -> None:
        """Template includes upgrade() function."""
        template_path = MCP_SERVER_ROOT / "alembic" / "script.py.mako"
        content = template_path.read_text()
        assert "def upgrade()" in content

    def test_template_has_downgrade_function(self) -> None:
        """Template includes downgrade() function."""
        template_path = MCP_SERVER_ROOT / "alembic" / "script.py.mako"
        content = template_path.read_text()
        assert "def downgrade()" in content


# ---------------------------------------------------------------------------
# alembic/versions/ — migration directory
# ---------------------------------------------------------------------------


class TestAlembicVersionsDir:
    """Verify the versions directory and initial migration exist."""

    def test_versions_directory_exists(self) -> None:
        """alembic/versions/ directory exists."""
        versions_dir = MCP_SERVER_ROOT / "alembic" / "versions"
        assert versions_dir.is_dir()

    def test_initial_migration_exists(self) -> None:
        """At least one migration file exists in versions/."""
        versions_dir = MCP_SERVER_ROOT / "alembic" / "versions"
        py_files = list(versions_dir.glob("*.py"))
        # Filter out __pycache__ and __init__
        migration_files = [f for f in py_files if not f.name.startswith("__")]
        assert len(migration_files) >= 1, "No migration files found"

    def test_initial_migration_has_upgrade_and_downgrade(self) -> None:
        """Initial migration defines both upgrade() and downgrade()."""
        versions_dir = MCP_SERVER_ROOT / "alembic" / "versions"
        py_files = sorted(versions_dir.glob("*.py"))
        migration_files = [f for f in py_files if not f.name.startswith("__")]
        assert len(migration_files) >= 1

        content = migration_files[0].read_text()
        assert "def upgrade()" in content
        assert "def downgrade()" in content

    def test_initial_migration_creates_enum_types(self) -> None:
        """Initial migration creates the base enum types."""
        versions_dir = MCP_SERVER_ROOT / "alembic" / "versions"
        py_files = sorted(versions_dir.glob("*.py"))
        migration_files = [f for f in py_files if not f.name.startswith("__")]
        assert len(migration_files) >= 1

        content = migration_files[0].read_text()
        assert "ticket_status" in content
        assert "ticket_stage" in content
        assert "ticket_type" in content

    def test_initial_migration_creates_tables(self) -> None:
        """Initial migration creates the base schema tables."""
        versions_dir = MCP_SERVER_ROOT / "alembic" / "versions"
        py_files = sorted(versions_dir.glob("*.py"))
        migration_files = [f for f in py_files if not f.name.startswith("__")]
        assert len(migration_files) >= 1

        content = migration_files[0].read_text()
        assert "projects" in content
        assert "agents" in content
        assert "tickets" in content
        assert "events" in content
