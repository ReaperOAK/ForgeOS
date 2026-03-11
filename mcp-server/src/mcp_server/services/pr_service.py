"""PR event handler service — correlate pull requests to tickets.

Extracts ticket IDs from PR titles and branch names, parses PR metadata
(author, reviewers, labels), and produces structured :class:`PREvent`
objects for each correlated ticket.

Supported actions: ``opened``, ``closed``, ``merged``, ``synchronize``.
Unrecognised actions are mapped to :attr:`PRAction.OTHER`.

.. meta::
   :ticket: FORGEOS-BE063
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from mcp_server.services.webhook_service import WebhookEvent

logger = get_logger("services.pr_service")

# Matches ticket IDs like FORGEOS-BE028, FORGEOS-FE012, FORGEOS-QA003
_TICKET_ID_RE = re.compile(r"(FORGEOS-[A-Z]+\d+)")

# Branch names considered as the production/main branch for advancement
_MAIN_BRANCHES: frozenset[str] = frozenset({"main", "master"})


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class PRAction(str, Enum):
    """Recognised pull request actions."""

    OPENED = "opened"
    CLOSED = "closed"
    MERGED = "merged"
    SYNCHRONIZE = "synchronize"
    OTHER = "other"

    @classmethod
    def from_string(cls, action: str, *, merged: bool = False) -> PRAction:
        """Map a GitHub action string to a :class:`PRAction`.

        When *action* is ``"closed"`` and *merged* is ``True``, returns
        :attr:`MERGED` instead of :attr:`CLOSED`.
        """
        if action == "closed" and merged:
            return cls.MERGED
        try:
            return cls(action)
        except ValueError:
            return cls.OTHER


@dataclass(frozen=True, slots=True)
class PRMetadata:
    """Extracted pull request metadata from a GitHub webhook payload."""

    number: int
    title: str
    url: str
    author: str
    branch: str
    base_branch: str
    reviewers: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    merged: bool = False


@dataclass(frozen=True, slots=True)
class PREvent:
    """A processed PR event correlated to a specific ticket."""

    ticket_id: str
    action: PRAction
    metadata: PRMetadata
    triggers_advancement: bool = False
    merge_target: str | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dictionary for logging / persistence."""
        return {
            "ticket_id": self.ticket_id,
            "action": self.action.value,
            "pr_number": self.metadata.number,
            "pr_url": self.metadata.url,
            "author": self.metadata.author,
            "branch": self.metadata.branch,
            "base_branch": self.metadata.base_branch,
            "reviewers": self.metadata.reviewers,
            "labels": self.metadata.labels,
            "merged": self.metadata.merged,
            "triggers_advancement": self.triggers_advancement,
            "merge_target": self.merge_target,
            "timestamp": self.timestamp.isoformat(),
        }


# ---------------------------------------------------------------------------
# Pure extraction helpers
# ---------------------------------------------------------------------------


def extract_ticket_ids(title: str, branch: str) -> list[str]:
    """Extract unique FORGEOS ticket IDs from a PR title and branch name.

    Parameters
    ----------
    title : str
        The pull request title.
    branch : str
        The head branch name (e.g. ``"FORGEOS-BE028/add-claim"``).

    Returns
    -------
    list[str]
        De-duplicated ticket IDs in discovery order.
    """
    seen: set[str] = set()
    result: list[str] = []
    for match in _TICKET_ID_RE.finditer(title):
        tid = match.group(1)
        if tid not in seen:
            seen.add(tid)
            result.append(tid)
    for match in _TICKET_ID_RE.finditer(branch):
        tid = match.group(1)
        if tid not in seen:
            seen.add(tid)
            result.append(tid)
    return result


def extract_pr_metadata(payload: dict[str, Any]) -> PRMetadata:
    """Extract :class:`PRMetadata` from a GitHub ``pull_request`` webhook payload.

    Parameters
    ----------
    payload : dict
        The full webhook JSON body (must contain a ``pull_request`` key).

    Returns
    -------
    PRMetadata
        Structured metadata extracted from the payload.
    """
    pr = payload.get("pull_request", {})
    reviewers_raw: list[dict[str, Any]] = pr.get("requested_reviewers", [])
    labels_raw: list[dict[str, Any]] = pr.get("labels", [])

    return PRMetadata(
        number=pr.get("number", payload.get("number", 0)),
        title=pr.get("title", ""),
        url=pr.get("html_url", ""),
        author=pr.get("user", {}).get("login", ""),
        branch=pr.get("head", {}).get("ref", ""),
        base_branch=pr.get("base", {}).get("ref", ""),
        reviewers=[r.get("login", "") for r in reviewers_raw if r.get("login")],
        labels=[lbl.get("name", "") for lbl in labels_raw if lbl.get("name")],
        merged=bool(pr.get("merged", False)),
    )


# ---------------------------------------------------------------------------
# PR Service
# ---------------------------------------------------------------------------


class PRService:
    """Process GitHub ``pull_request`` webhook events.

    Correlates PRs to ForgeOS tickets by extracting ticket IDs from the
    PR title and head branch name.  Produces a list of :class:`PREvent`
    objects — one per correlated ticket.
    """

    async def handle_pr_event(self, event: WebhookEvent) -> list[PREvent]:
        """Handle a validated ``pull_request`` :class:`WebhookEvent`.

        Parameters
        ----------
        event : WebhookEvent
            A webhook event with ``event_type == "pull_request"``.

        Returns
        -------
        list[PREvent]
            One :class:`PREvent` per correlated ticket.  Empty when no
            ticket IDs are found in the PR title or branch.
        """
        payload = event.payload
        metadata = extract_pr_metadata(payload)
        action_str = payload.get("action", "")
        action = PRAction.from_string(action_str, merged=metadata.merged)

        ticket_ids = extract_ticket_ids(metadata.title, metadata.branch)

        if not ticket_ids:
            logger.warning(
                "pr_no_ticket_correlation",
                extra={
                    "event_id": event.event_id,
                    "pr_number": metadata.number,
                    "pr_title": metadata.title,
                    "branch": metadata.branch,
                },
            )
            return []

        # Determine if this merge triggers advancement
        triggers_advancement = (
            action is PRAction.MERGED
            and metadata.base_branch in _MAIN_BRANCHES
        )
        merge_target = metadata.base_branch if action is PRAction.MERGED else None

        results: list[PREvent] = []
        for tid in ticket_ids:
            pr_event = PREvent(
                ticket_id=tid,
                action=action,
                metadata=metadata,
                triggers_advancement=triggers_advancement,
                merge_target=merge_target,
            )
            results.append(pr_event)

            logger.info(
                "pr_event_processed",
                extra={
                    "event_id": event.event_id,
                    "ticket_id": tid,
                    "action": action.value,
                    "pr_number": metadata.number,
                    "triggers_advancement": triggers_advancement,
                },
            )

        return results
