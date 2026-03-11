"""Filesystem fallback for ForgeOS SDK when MCP server is unavailable.

Delegates ticket lifecycle operations to the existing ``tickets.py`` CLI
and reads ticket state directly from ``.github/ticket-state/`` directories.
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from forgeos_sdk.exceptions import ConfigurationError, ToolCallError
from forgeos_sdk.models import OperationResult, Ticket

logger = logging.getLogger("forgeos_sdk")

STAGES = (
    "READY", "ARCHITECT", "RESEARCH", "BACKEND", "FRONTEND",
    "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE",
)


class FilesystemFallback:
    """Fallback operations via filesystem and ``tickets.py`` CLI.

    Provides the same API surface as :class:`~forgeos_sdk.operations.TicketOperations`
    but delegates mutations (claim, advance, rework, release) to the ``tickets.py``
    CLI and reads ticket JSON directly from ``.github/ticket-state/`` directories.

    Parameters:
        repo_root: Path to the repository root (parent of ``.github/``).
            Auto-detected via ``git rev-parse`` when omitted.
        agent_id: Agent identifier for claim metadata.
    """

    def __init__(
        self,
        *,
        repo_root: Path | None = None,
        agent_id: str = "unknown-agent",
    ) -> None:
        self._repo_root = repo_root or self._detect_repo_root()
        self._agent_id = agent_id
        self._tickets_py = self._repo_root / ".github" / "tickets.py"

        if not self._tickets_py.exists():
            raise ConfigurationError(
                f"tickets.py not found at {self._tickets_py}"
            )

        logger.warning(
            "Filesystem fallback mode active — operations delegate to tickets.py",
            extra={"repo_root": str(self._repo_root), "agent_id": agent_id},
        )

    @property
    def repo_root(self) -> Path:
        """Repository root path."""
        return self._repo_root

    @property
    def agent_id(self) -> str:
        """Agent identifier used for claim metadata."""
        return self._agent_id

    # ── CLI delegation ────────────────────────────────────────────────

    def _run_tickets_py(
        self,
        args: list[str],
    ) -> tuple[int, str, str]:
        """Run ``tickets.py`` with the given arguments.

        Returns:
            Tuple of (return_code, stdout, stderr).

        Raises:
            ToolCallError: On subprocess timeout.
            ConfigurationError: When ``python3`` is not on PATH.
        """
        cmd = ["python3", str(self._tickets_py), *args]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self._repo_root),
            )
            return result.returncode, result.stdout.strip(), result.stderr.strip()
        except subprocess.TimeoutExpired as exc:
            raise ToolCallError(
                "tickets.py", f"Command timed out: {' '.join(args)}"
            ) from exc
        except FileNotFoundError as exc:
            raise ConfigurationError("python3 not found in PATH") from exc

    def _parse_ok_fail(self, stdout: str) -> tuple[bool, str]:
        """Parse ``OK: ...`` or ``FAIL: ...`` from ``tickets.py`` output."""
        if stdout.startswith("OK:"):
            return True, stdout[3:].strip()
        if stdout.startswith("FAIL:"):
            return False, stdout[5:].strip()
        return False, stdout

    # ── Filesystem reads ──────────────────────────────────────────────

    def _state_dir(self) -> Path:
        return self._repo_root / ".github" / "ticket-state"

    def _tickets_dir(self) -> Path:
        return self._repo_root / ".github" / "tickets"

    def _find_ticket_path(self, ticket_id: str) -> Path | None:
        """Find a ticket JSON file across all stage directories."""
        for stage in STAGES:
            path = self._state_dir() / stage / f"{ticket_id}.json"
            if path.exists():
                return path
        return None

    def _load_ticket_json(self, ticket_id: str) -> Ticket:
        """Load and parse a ticket JSON from state or master directory."""
        path = self._find_ticket_path(ticket_id)
        if path is None:
            path = self._tickets_dir() / f"{ticket_id}.json"

        if not path.exists():
            raise ToolCallError(
                "filesystem.get_ticket",
                f"Ticket {ticket_id} not found in state or master directories",
            )

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            raise ToolCallError(
                "filesystem.get_ticket",
                f"Failed to read ticket {ticket_id}: {exc}",
            ) from exc

        return Ticket.model_validate(data)

    # ── Public API (mirrors TicketOperations) ─────────────────────────

    async def get_ticket(self, ticket_id: str) -> Ticket:
        """Get a ticket by reading its JSON directly from the filesystem."""
        return self._load_ticket_json(ticket_id)

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
        lease_minutes: int | None = None,
    ) -> Ticket:
        """Claim a ticket via ``tickets.py --claim``."""
        agent = agent_name or self._agent_id
        machine = machine_id or "unknown"
        op = operator or "sdk-fallback"

        args = ["--claim", ticket_id, agent, machine, op]
        _rc, stdout, _stderr = self._run_tickets_py(args)

        success, message = self._parse_ok_fail(stdout)
        if not success:
            raise ToolCallError("tickets.claim", message)

        return self._load_ticket_json(ticket_id)

    async def advance(
        self,
        ticket_id: str,
        evidence: Any = None,
    ) -> Ticket:
        """Advance a ticket to the next stage via ``tickets.py --advance``."""
        args = ["--advance", ticket_id, self._agent_id]
        _rc, stdout, _stderr = self._run_tickets_py(args)

        success, message = self._parse_ok_fail(stdout)
        if not success:
            raise ToolCallError("tickets.advance", message)

        return self._load_ticket_json(ticket_id)

    async def rework(
        self,
        ticket_id: str,
        reason: str,
        *,
        evidence: dict[str, Any] | None = None,
    ) -> Ticket:
        """Send a ticket back for rework via ``tickets.py --rework``."""
        args = ["--rework", ticket_id, self._agent_id, reason]
        _rc, stdout, _stderr = self._run_tickets_py(args)

        success, message = self._parse_ok_fail(stdout)
        if not success:
            raise ToolCallError("tickets.rework", message)

        return self._load_ticket_json(ticket_id)

    async def release(
        self,
        ticket_id: str,
        *,
        reason: str | None = None,
        force: bool = False,
    ) -> OperationResult:
        """Release a claim on a ticket via ``tickets.py --release``."""
        args = ["--release", ticket_id]
        _rc, stdout, _stderr = self._run_tickets_py(args)

        success, message = self._parse_ok_fail(stdout)
        if not success:
            raise ToolCallError("tickets.release", message)

        ticket = self._load_ticket_json(ticket_id)
        return OperationResult(success=True, message=message, ticket=ticket)

    async def claim_next(
        self,
        role: str,
        *,
        machine_id: str = "",
        operator: str = "",
    ) -> Ticket:
        """Find the next available ticket for a role by scanning the READY directory."""
        ready_dir = self._state_dir() / "READY"
        if not ready_dir.exists():
            raise ToolCallError("tickets.next", "No READY directory found")

        for ticket_path in sorted(ready_dir.glob("*.json")):
            try:
                data = json.loads(ticket_path.read_text(encoding="utf-8"))
                sdlc_flow = data.get("sdlc_flow", [])
                if len(sdlc_flow) > 1 and sdlc_flow[1].upper() == role.upper():
                    ticket_id = data.get("ticket_id", ticket_path.stem)
                    return await self.claim(
                        ticket_id,
                        agent_name=self._agent_id,
                        machine_id=machine_id,
                        operator=operator,
                    )
            except (json.JSONDecodeError, OSError):
                continue

        raise ToolCallError(
            "tickets.next",
            f"No available tickets for role '{role}'",
        )

    # ── Utilities ─────────────────────────────────────────────────────

    @staticmethod
    def _detect_repo_root() -> Path:
        """Detect the repository root via ``git rev-parse`` or walking up from CWD."""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return Path(result.stdout.strip())
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        cwd = Path.cwd()
        for parent in [cwd, *cwd.parents]:
            if (parent / ".github" / "tickets.py").exists():
                return parent

        raise ConfigurationError(
            "Could not detect repository root — run from within a git repo "
            "or set repo_root explicitly"
        )
