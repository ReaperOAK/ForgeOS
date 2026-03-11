"""Summary handoff helpers for the ForgeOS agent SDK.

Provides file-based summary I/O so agents can read the previous stage's
output, write their own summary, and clean up upstream files — following the
convention ``.github/agent-output/{AgentName}/{ticket-id}.md``.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from pathlib import Path

logger = logging.getLogger("forgeos_sdk")

AGENT_OUTPUT_DIR = ".github/agent-output"
"""Workspace-relative path to the agent output root directory."""

STAGE_TO_AGENT: dict[str, str] = {
    "ARCHITECT": "Architect",
    "RESEARCH": "Research",
    "BACKEND": "Backend",
    "FRONTEND": "Frontend",
    "QA": "QA",
    "SECURITY": "Security",
    "CI": "CIReviewer",
    "DOCS": "Documentation",
    "VALIDATION": "Validator",
}
"""Maps each SDLC implementation stage to its agent output directory name."""


def _previous_stage(current_stage: str, sdlc_flow: Sequence[str]) -> str | None:
    """Return the stage immediately before *current_stage* in *sdlc_flow*.

    Returns ``None`` when *current_stage* is the first entry, is ``READY``,
    ``DONE``, or is not found in the flow.
    """
    if current_stage in ("READY", "DONE"):
        return None
    try:
        idx = list(sdlc_flow).index(current_stage)
    except ValueError:
        return None
    if idx <= 0:
        return None
    prev = sdlc_flow[idx - 1]
    # READY has no agent output
    return None if prev == "READY" else prev


def _upstream_agent(current_stage: str, sdlc_flow: Sequence[str]) -> str | None:
    """Return the agent name that produced the upstream summary for *current_stage*."""
    prev = _previous_stage(current_stage, sdlc_flow)
    if prev is None:
        return None
    return STAGE_TO_AGENT.get(prev)


def _summary_path(agent_name: str, ticket_id: str, workspace_root: Path) -> Path:
    """Build the canonical summary file path."""
    return workspace_root / AGENT_OUTPUT_DIR / agent_name / f"{ticket_id}.md"


def read_upstream_summary(
    ticket_id: str,
    current_stage: str,
    sdlc_flow: Sequence[str],
    *,
    workspace_root: Path | str,
) -> str | None:
    """Read the previous stage agent's summary file.

    Parameters:
        ticket_id: The ticket identifier (e.g. ``FORGEOS-BE048``).
        current_stage: The SDLC stage the calling agent is processing.
        sdlc_flow: Ordered list of stages for this ticket type.
        workspace_root: Absolute path to the repository root.

    Returns:
        The summary content as a string, or ``None`` if no upstream summary
        exists (missing file, no previous stage, or stage not in the flow).
    """
    root = Path(workspace_root)
    agent = _upstream_agent(current_stage, sdlc_flow)
    if agent is None:
        return None

    path = _summary_path(agent, ticket_id, root)
    if not path.is_file():
        logger.debug("No upstream summary at %s", path)
        return None

    content = path.read_text(encoding="utf-8")
    logger.info("Read upstream summary from %s", path)
    return content


def write_summary(
    ticket_id: str,
    agent_name: str,
    content: str,
    *,
    workspace_root: Path | str,
) -> Path:
    """Write the current agent's summary to the output directory.

    Creates the agent output directory if it does not already exist.

    Parameters:
        ticket_id: The ticket identifier.
        agent_name: Agent directory name (e.g. ``"Backend"``).  Typically
            obtained from the ticket's ``claimed_by`` field — no manual
            input needed when wired to claim context.
        content: Markdown summary content to write.
        workspace_root: Absolute path to the repository root.

    Returns:
        The :class:`~pathlib.Path` of the written summary file.
    """
    root = Path(workspace_root)
    path = _summary_path(agent_name, ticket_id, root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    logger.info("Wrote summary to %s", path)
    return path


def delete_upstream_summary(
    ticket_id: str,
    current_stage: str,
    sdlc_flow: Sequence[str],
    *,
    workspace_root: Path | str,
) -> bool:
    """Delete the previous stage agent's summary file after processing.

    Parameters:
        ticket_id: The ticket identifier.
        current_stage: The SDLC stage the calling agent is processing.
        sdlc_flow: Ordered list of stages for this ticket type.
        workspace_root: Absolute path to the repository root.

    Returns:
        ``True`` if the file was deleted, ``False`` if it did not exist or
        there was no upstream stage.
    """
    root = Path(workspace_root)
    agent = _upstream_agent(current_stage, sdlc_flow)
    if agent is None:
        return False

    path = _summary_path(agent, ticket_id, root)
    if not path.is_file():
        logger.debug("No upstream summary to delete at %s", path)
        return False

    path.unlink()
    logger.info("Deleted upstream summary at %s", path)
    return True
