"""Tests for FilesystemFallback — filesystem-based ticket operations.

Covers all acceptance criteria:
  AC1: Fallback mode delegates claim/advance/rework/status to tickets.py CLI subprocess calls
  AC2: Mode selection via FORGEOS_MODE environment variable (mcp, filesystem, auto)
  AC3: Auto mode attempts MCP connection first, falls back to filesystem on connection failure
  AC4: Fallback operations parse tickets.py stdout for result data
  AC5: Fallback mode is transparent to calling agent code (same API surface)
  AC6: Mode switch logged at startup indicating which backend is active

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from forgeos_sdk.exceptions import ConfigurationError, ToolCallError
from forgeos_sdk.fallback import FilesystemFallback
from forgeos_sdk.models import Evidence, OperationResult, Ticket

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_TICKET: dict[str, Any] = {
    "ticket_id": "FORGEOS-BE099",
    "title": "Test ticket",
    "type": "backend",
    "priority": "medium",
    "stage": "READY",
    "status": "READY",
    "sdlc_flow": [
        "READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
    ],
    "claimed_by": None,
    "machine_id": None,
    "operator": None,
    "lease_expiry": None,
    "file_paths": ["src/example.py"],
    "acceptance_criteria": ["AC1"],
    "dependencies": [],
    "rework_count": 0,
    "history": [],
}


@pytest.fixture()
def repo_root(tmp_path: Path) -> Path:
    """Create a minimal repo structure with tickets.py stub."""
    github = tmp_path / ".github"
    github.mkdir()

    # Create a minimal tickets.py
    tickets_py = github / "tickets.py"
    tickets_py.write_text("# placeholder\n")

    # State directories
    for stage in [
        "READY", "ARCHITECT", "RESEARCH", "BACKEND", "FRONTEND",
        "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
    ]:
        (github / "ticket-state" / stage).mkdir(parents=True)

    # Master tickets dir
    (github / "tickets").mkdir(parents=True)

    return tmp_path


@pytest.fixture()
def fallback(repo_root: Path) -> FilesystemFallback:
    """Create a FilesystemFallback with a temporary repo root."""
    return FilesystemFallback(repo_root=repo_root, agent_id="test-agent")


def _write_ticket(
    repo_root: Path,
    ticket: dict[str, Any],
    stage: str = "READY",
) -> Path:
    """Write a ticket JSON to a state directory and master."""
    ticket_id = ticket["ticket_id"]
    state_path = repo_root / ".github" / "ticket-state" / stage / f"{ticket_id}.json"
    master_path = repo_root / ".github" / "tickets" / f"{ticket_id}.json"
    state_path.write_text(json.dumps(ticket), encoding="utf-8")
    master_path.write_text(json.dumps(ticket), encoding="utf-8")
    return state_path


# ---------------------------------------------------------------------------
# Construction / Initialization
# ---------------------------------------------------------------------------


class TestFilesystemFallbackInit:
    """Tests for fallback initialization."""

    def test_init_with_valid_repo_root(self, repo_root: Path) -> None:
        fb = FilesystemFallback(repo_root=repo_root, agent_id="my-agent")
        assert fb.repo_root == repo_root
        assert fb.agent_id == "my-agent"

    def test_init_raises_when_tickets_py_missing(self, tmp_path: Path) -> None:
        (tmp_path / ".github").mkdir()
        with pytest.raises(ConfigurationError, match="tickets.py not found"):
            FilesystemFallback(repo_root=tmp_path)

    def test_init_logs_warning(self, repo_root: Path, caplog: Any) -> None:
        import logging

        with caplog.at_level(logging.WARNING, logger="forgeos_sdk"):
            FilesystemFallback(repo_root=repo_root, agent_id="test-agent")
        assert "Filesystem fallback mode active" in caplog.text

    def test_auto_detect_repo_root_via_git(self) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "/fake/repo\n"

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            root = FilesystemFallback._detect_repo_root()
            assert root == Path("/fake/repo")

    def test_auto_detect_raises_when_not_in_repo(self) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 128
        mock_result.stdout = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            with patch("forgeos_sdk.fallback.Path.cwd", return_value=Path("/tmp/nonrepo")):
                with pytest.raises(ConfigurationError, match="Could not detect repository root"):
                    FilesystemFallback._detect_repo_root()


# ---------------------------------------------------------------------------
# get_ticket — direct filesystem reads
# ---------------------------------------------------------------------------


class TestGetTicket:
    """Tests for get_ticket — reads ticket JSON from state directories."""

    @pytest.mark.asyncio
    async def test_get_ticket_from_state_dir(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        _write_ticket(repo_root, SAMPLE_TICKET, stage="READY")
        ticket = await fallback.get_ticket("FORGEOS-BE099")
        assert isinstance(ticket, Ticket)
        assert ticket.ticket_id == "FORGEOS-BE099"
        assert ticket.title == "Test ticket"

    @pytest.mark.asyncio
    async def test_get_ticket_from_master_when_not_in_state(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        master = repo_root / ".github" / "tickets" / "FORGEOS-BE099.json"
        master.write_text(json.dumps(SAMPLE_TICKET), encoding="utf-8")
        ticket = await fallback.get_ticket("FORGEOS-BE099")
        assert ticket.ticket_id == "FORGEOS-BE099"

    @pytest.mark.asyncio
    async def test_get_ticket_raises_when_not_found(
        self, fallback: FilesystemFallback
    ) -> None:
        with pytest.raises(ToolCallError, match="not found"):
            await fallback.get_ticket("NONEXISTENT")

    @pytest.mark.asyncio
    async def test_get_ticket_raises_on_invalid_json(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        path = repo_root / ".github" / "ticket-state" / "READY" / "BAD.json"
        path.write_text("{invalid json", encoding="utf-8")
        with pytest.raises(ToolCallError, match="Failed to read"):
            await fallback.get_ticket("BAD")


# ---------------------------------------------------------------------------
# claim — delegates to tickets.py CLI
# ---------------------------------------------------------------------------


class TestClaim:
    """Tests for claim — delegates to tickets.py --claim."""

    @pytest.mark.asyncio
    async def test_claim_success(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        claimed = {**SAMPLE_TICKET, "claimed_by": "test-agent", "stage": "READY"}
        _write_ticket(repo_root, claimed, stage="READY")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Claimed FORGEOS-BE099 for test-agent on host1"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            ticket = await fallback.claim(
                "FORGEOS-BE099",
                agent_name="test-agent",
                machine_id="host1",
                operator="dev",
            )
        assert isinstance(ticket, Ticket)
        assert ticket.ticket_id == "FORGEOS-BE099"

    @pytest.mark.asyncio
    async def test_claim_failure(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = "FAIL: Ticket already claimed"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            with pytest.raises(ToolCallError, match="Ticket already claimed"):
                await fallback.claim("FORGEOS-BE099")

    @pytest.mark.asyncio
    async def test_claim_uses_defaults(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        _write_ticket(repo_root, SAMPLE_TICKET, stage="READY")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Claimed"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result) as mock_run:
            await fallback.claim("FORGEOS-BE099")
            cmd = mock_run.call_args[0][0]
            # agent_name defaults to agent_id, machine_id to "unknown"
            assert "test-agent" in cmd
            assert "unknown" in cmd

    @pytest.mark.asyncio
    async def test_claim_timeout_raises(
        self, fallback: FilesystemFallback
    ) -> None:
        with patch(
            "forgeos_sdk.fallback.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="", timeout=30),
        ):
            with pytest.raises(ToolCallError, match="timed out"):
                await fallback.claim("FORGEOS-BE099")


# ---------------------------------------------------------------------------
# advance — delegates to tickets.py CLI
# ---------------------------------------------------------------------------


class TestAdvance:
    """Tests for advance — delegates to tickets.py --advance."""

    @pytest.mark.asyncio
    async def test_advance_success(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        advanced = {**SAMPLE_TICKET, "stage": "QA"}
        _write_ticket(repo_root, advanced, stage="QA")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Advanced FORGEOS-BE099: BACKEND → QA"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            ticket = await fallback.advance(
                "FORGEOS-BE099",
                evidence=Evidence(
                    artifacts=["src/foo.py"],
                    test_results="All pass",
                    confidence="HIGH",
                ),
            )
        assert isinstance(ticket, Ticket)

    @pytest.mark.asyncio
    async def test_advance_failure(
        self, fallback: FilesystemFallback
    ) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = "FAIL: Already at final stage"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            with pytest.raises(ToolCallError, match="Already at final stage"):
                await fallback.advance("FORGEOS-BE099")


# ---------------------------------------------------------------------------
# rework — delegates to tickets.py CLI
# ---------------------------------------------------------------------------


class TestRework:
    """Tests for rework — delegates to tickets.py --rework."""

    @pytest.mark.asyncio
    async def test_rework_success(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        reworked = {**SAMPLE_TICKET, "stage": "BACKEND", "rework_count": 1}
        _write_ticket(repo_root, reworked, stage="BACKEND")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Sent FORGEOS-BE099 back for rework"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            ticket = await fallback.rework("FORGEOS-BE099", "Tests failed")
        assert isinstance(ticket, Ticket)

    @pytest.mark.asyncio
    async def test_rework_failure(
        self, fallback: FilesystemFallback
    ) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = "FAIL: Ticket not found"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            with pytest.raises(ToolCallError, match="Ticket not found"):
                await fallback.rework("NONEXISTENT", "reason")


# ---------------------------------------------------------------------------
# release — delegates to tickets.py CLI
# ---------------------------------------------------------------------------


class TestRelease:
    """Tests for release — delegates to tickets.py --release."""

    @pytest.mark.asyncio
    async def test_release_success(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        _write_ticket(repo_root, SAMPLE_TICKET, stage="READY")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Released claim on FORGEOS-BE099"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            result = await fallback.release("FORGEOS-BE099")
        assert isinstance(result, OperationResult)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_release_failure(
        self, fallback: FilesystemFallback
    ) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = "FAIL: Ticket is not claimed"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            with pytest.raises(ToolCallError, match="not claimed"):
                await fallback.release("FORGEOS-BE099")


# ---------------------------------------------------------------------------
# claim_next — scans READY directory
# ---------------------------------------------------------------------------


class TestClaimNext:
    """Tests for claim_next — scans READY directory for matching tickets."""

    @pytest.mark.asyncio
    async def test_claim_next_finds_matching_ticket(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        _write_ticket(repo_root, SAMPLE_TICKET, stage="READY")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Claimed FORGEOS-BE099"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            ticket = await fallback.claim_next("BACKEND", machine_id="h1", operator="dev")
        assert ticket.ticket_id == "FORGEOS-BE099"

    @pytest.mark.asyncio
    async def test_claim_next_no_match(
        self, fallback: FilesystemFallback, repo_root: Path
    ) -> None:
        _write_ticket(repo_root, SAMPLE_TICKET, stage="READY")
        with pytest.raises(ToolCallError, match="No available tickets"):
            await fallback.claim_next("FRONTEND")

    @pytest.mark.asyncio
    async def test_claim_next_no_ready_dir(
        self, repo_root: Path
    ) -> None:
        import shutil

        shutil.rmtree(repo_root / ".github" / "ticket-state" / "READY")
        fb = FilesystemFallback(repo_root=repo_root, agent_id="test")
        with pytest.raises(ToolCallError, match="No READY directory"):
            await fb.claim_next("BACKEND")


# ---------------------------------------------------------------------------
# _run_tickets_py internal helper
# ---------------------------------------------------------------------------


class TestRunTicketsPy:
    """Tests for the subprocess wrapper."""

    def test_run_returns_output(
        self, fallback: FilesystemFallback
    ) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "OK: Done"
        mock_result.stderr = ""

        with patch("forgeos_sdk.fallback.subprocess.run", return_value=mock_result):
            rc, stdout, stderr = fallback._run_tickets_py(["--status"])
        assert rc == 0
        assert stdout == "OK: Done"

    def test_run_raises_on_python_not_found(
        self, fallback: FilesystemFallback
    ) -> None:
        with patch(
            "forgeos_sdk.fallback.subprocess.run",
            side_effect=FileNotFoundError("python3"),
        ):
            with pytest.raises(ConfigurationError, match="python3 not found"):
                fallback._run_tickets_py(["--status"])


# ---------------------------------------------------------------------------
# _parse_ok_fail helper
# ---------------------------------------------------------------------------


class TestParseOkFail:
    """Tests for stdout parsing."""

    def test_parse_ok(self, fallback: FilesystemFallback) -> None:
        ok, msg = fallback._parse_ok_fail("OK: Claimed successfully")
        assert ok is True
        assert msg == "Claimed successfully"

    def test_parse_fail(self, fallback: FilesystemFallback) -> None:
        ok, msg = fallback._parse_ok_fail("FAIL: Not found")
        assert ok is False
        assert msg == "Not found"

    def test_parse_unknown(self, fallback: FilesystemFallback) -> None:
        ok, msg = fallback._parse_ok_fail("something unexpected")
        assert ok is False
        assert msg == "something unexpected"


# ---------------------------------------------------------------------------
# API surface parity with TicketOperations
# ---------------------------------------------------------------------------


class TestAPISurface:
    """Verify that FilesystemFallback has the same method signatures as TicketOperations."""

    def test_has_claim(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "claim", None))

    def test_has_advance(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "advance", None))

    def test_has_rework(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "rework", None))

    def test_has_release(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "release", None))

    def test_has_get_ticket(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "get_ticket", None))

    def test_has_claim_next(self, fallback: FilesystemFallback) -> None:
        assert callable(getattr(fallback, "claim_next", None))


# ---------------------------------------------------------------------------
# OperationMode config
# ---------------------------------------------------------------------------


class TestOperationModeConfig:
    """Tests for FORGEOS_MODE environment variable support in SDKConfig."""

    def test_default_mode_is_auto(self) -> None:
        from forgeos_sdk.config import OperationMode, SDKConfig

        config = SDKConfig(_env_file=None)  # type: ignore[call-arg]
        assert config.mode == OperationMode.AUTO

    def test_mode_from_env(self, monkeypatch: Any) -> None:
        from forgeos_sdk.config import OperationMode, SDKConfig

        monkeypatch.setenv("FORGEOS_MODE", "filesystem")
        config = SDKConfig(_env_file=None)  # type: ignore[call-arg]
        assert config.mode == OperationMode.FILESYSTEM

    def test_mode_mcp_from_env(self, monkeypatch: Any) -> None:
        from forgeos_sdk.config import OperationMode, SDKConfig

        monkeypatch.setenv("FORGEOS_MODE", "mcp")
        config = SDKConfig(_env_file=None)  # type: ignore[call-arg]
        assert config.mode == OperationMode.MCP

    def test_invalid_mode_raises(self, monkeypatch: Any) -> None:
        from forgeos_sdk.config import SDKConfig

        monkeypatch.setenv("FORGEOS_MODE", "invalid")
        with pytest.raises(Exception):
            SDKConfig(_env_file=None)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# Client fallback integration
# ---------------------------------------------------------------------------


class TestClientFallbackIntegration:
    """Tests for ForgeOSClient mode-aware behavior."""

    def test_client_exposes_mode(self) -> None:
        from forgeos_sdk.client import ForgeOSClient
        from forgeos_sdk.config import OperationMode

        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            mode="auto",
        )
        assert client.mode == OperationMode.AUTO

    def test_client_filesystem_mode(self) -> None:
        from forgeos_sdk.client import ForgeOSClient
        from forgeos_sdk.config import OperationMode

        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            mode="filesystem",
        )
        assert client.mode == OperationMode.FILESYSTEM

    def test_client_from_env_reads_mode(self, monkeypatch: Any) -> None:
        from forgeos_sdk.client import ForgeOSClient
        from forgeos_sdk.config import OperationMode

        monkeypatch.setenv("FORGEOS_MODE", "filesystem")
        client = ForgeOSClient.from_env()
        assert client.mode == OperationMode.FILESYSTEM

    @pytest.mark.asyncio
    async def test_auto_mode_falls_back_on_connection_failure(
        self, repo_root: Path, monkeypatch: Any
    ) -> None:
        from forgeos_sdk.client import ConnectionState, ForgeOSClient
        from forgeos_sdk.config import OperationMode

        client = ForgeOSClient(
            server_url="http://localhost:9999/mcp",
            agent_id="test",
            mode="auto",
            repo_root=repo_root,
        )

        # Mock _establish_connection to fail (server unreachable)
        async def _mock_fail() -> None:
            raise ConnectionError("Connection refused")

        client._establish_connection = _mock_fail  # type: ignore[assignment]

        await client.connect(auto_reconnect=False)

        assert client.mode == OperationMode.FILESYSTEM
        assert client.is_fallback_active is True
        assert client.connection_state == ConnectionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_filesystem_mode_skips_mcp_connect(
        self, repo_root: Path
    ) -> None:
        from forgeos_sdk.client import ConnectionState, ForgeOSClient

        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            mode="filesystem",
            repo_root=repo_root,
        )
        await client.connect()

        assert client.is_fallback_active is True
        assert client.connection_state == ConnectionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_mcp_mode_does_not_fall_back(self) -> None:
        from forgeos_sdk.client import ForgeOSClient
        from forgeos_sdk.exceptions import ConnectionError as SDKConnectionError

        client = ForgeOSClient(
            server_url="http://localhost:9999/mcp",
            agent_id="test",
            mode="mcp",
        )

        async def _mock_fail() -> None:
            raise SDKConnectionError("Connection refused")

        client._establish_connection = _mock_fail  # type: ignore[assignment]

        with pytest.raises(SDKConnectionError):
            await client.connect(auto_reconnect=False)
