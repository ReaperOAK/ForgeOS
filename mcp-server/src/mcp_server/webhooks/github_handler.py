"""GitHub webhook handler — signature verification, event routing, and CI status.

Verifies inbound GitHub webhook requests using HMAC-SHA256 signatures,
extracts the event type from the ``X-GitHub-Event`` header, handles
push events to trigger ticket sync operations, and handles CI
status/check_run events to advance or rework tickets automatically.

.. meta::
   :ticket: FORGEOS-BE060, FORGEOS-BE061, FORGEOS-BE062
"""

from __future__ import annotations

import re
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from mcp_server.observability import get_logger
from mcp_server.webhooks.signature import verify_signature

if TYPE_CHECKING:
    from collections.abc import Mapping

    from mcp_server.services.webhook_service import WebhookEvent, _HandlerRegistry

logger = get_logger("webhooks.github_handler")

# Type alias for the sync callback injected into the push handler.
SyncCallback = Callable[[], Coroutine[Any, Any, dict[str, Any]]]


# ---------------------------------------------------------------------------
# Domain errors
# ---------------------------------------------------------------------------


class GitHubSignatureError(Exception):
    """Raised when the webhook signature is invalid (403)."""

    def __init__(self, message: str = "Invalid webhook signature") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = 403


class GitHubSignatureMissingError(Exception):
    """Raised when the signature header is absent (401)."""

    def __init__(self, message: str = "Missing X-Hub-Signature-256 header") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = 401


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def verify_github_request(
    body: bytes,
    headers: Mapping[str, Any],
    secret: str,
) -> str:
    """Verify a GitHub webhook request and extract the event type.

    Parameters
    ----------
    body : bytes
        Raw request body.
    headers : Mapping[str, Any]
        Request headers (case-insensitive keys expected from Starlette).
    secret : str
        The shared HMAC secret.

    Returns
    -------
    str
        The GitHub event type (from ``X-GitHub-Event`` header), or
        ``"unknown"`` if the header is absent.

    Raises
    ------
    GitHubSignatureMissingError
        If the ``X-Hub-Signature-256`` header is missing (401).
    GitHubSignatureError
        If the signature does not match (403).
    """
    signature_header = headers.get("x-hub-signature-256")

    if not signature_header:
        logger.warning(
            "github_signature_missing",
            extra={"has_event_header": "x-github-event" in headers},
        )
        raise GitHubSignatureMissingError()

    if not verify_signature(body, signature_header, secret):
        logger.warning(
            "github_signature_invalid",
            extra={"signature_prefix": signature_header[:12]},
        )
        raise GitHubSignatureError()

    # Extract event type from header
    event_type_raw = headers.get("x-github-event", "unknown")
    event_type: str = event_type_raw.strip() if isinstance(event_type_raw, str) else "unknown"

    logger.info(
        "github_signature_verified",
        extra={"event_type": event_type},
    )

    return event_type


# ---------------------------------------------------------------------------
# Push event value objects (FORGEOS-BE061)
# ---------------------------------------------------------------------------

_MAIN_BRANCHES: frozenset[str] = frozenset({"main", "master"})


class PushEventValidationError(Exception):
    """Raised when a push event payload fails structural validation."""

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


@dataclass(frozen=True, slots=True)
class PushEventPayload:
    """Parsed GitHub push event payload.

    Attributes
    ----------
    ref : str
        Full git ref (e.g. ``"refs/heads/main"``).
    branch : str
        Short branch name extracted from *ref*.
    commits : list[dict[str, Any]]
        List of commit objects from the push.
    repository_name : str
        Short repository name.
    repository_full_name : str
        Full ``owner/repo`` name.
    sender : str
        Login of the user who pushed.
    is_main_branch : bool
        Whether this push targets the main branch.
    """

    ref: str
    branch: str
    commits: list[dict[str, Any]] = field(default_factory=list)
    repository_name: str = ""
    repository_full_name: str = ""
    sender: str = ""
    is_main_branch: bool = False


# ---------------------------------------------------------------------------
# Push event parsing
# ---------------------------------------------------------------------------


def parse_push_event(payload: dict[str, Any]) -> PushEventPayload:
    """Validate and parse a GitHub push event payload.

    Parameters
    ----------
    payload : dict[str, Any]
        Raw JSON payload from a GitHub push webhook.

    Returns
    -------
    PushEventPayload
        Parsed push event data.

    Raises
    ------
    PushEventValidationError
        If required fields are missing or malformed.
    """
    ref = payload.get("ref")
    if not isinstance(ref, str) or not ref.strip():
        raise PushEventValidationError(
            "Push payload missing or invalid 'ref' field",
            details={"field": "ref", "value": ref},
        )

    commits = payload.get("commits")
    if not isinstance(commits, list):
        raise PushEventValidationError(
            "Push payload missing or invalid 'commits' field",
            details={"field": "commits", "type": type(commits).__name__},
        )

    repository = payload.get("repository")
    if not isinstance(repository, dict):
        raise PushEventValidationError(
            "Push payload missing or invalid 'repository' field",
            details={"field": "repository", "type": type(repository).__name__},
        )

    branch = ref.removeprefix("refs/heads/").strip()
    is_main = branch in _MAIN_BRANCHES

    repo_name = repository.get("name", "")
    repo_full_name = repository.get("full_name", "")
    sender_info = payload.get("sender", {})
    sender = sender_info.get("login", "") if isinstance(sender_info, dict) else ""

    return PushEventPayload(
        ref=ref,
        branch=branch,
        commits=commits,
        repository_name=str(repo_name),
        repository_full_name=str(repo_full_name),
        sender=str(sender),
        is_main_branch=is_main,
    )


# ---------------------------------------------------------------------------
# Push event handler factory
# ---------------------------------------------------------------------------


def create_push_handler(
    sync_fn: SyncCallback | None = None,
) -> Callable[[WebhookEvent], Coroutine[Any, Any, None]]:
    """Create an async push event handler with an injected sync callback.

    Parameters
    ----------
    sync_fn : SyncCallback | None
        Async callable that triggers ticket sync and returns a result dict.
        If ``None``, sync is skipped (handler only logs).

    Returns
    -------
    Callable[[WebhookEvent], Coroutine[Any, Any, None]]
        An async handler suitable for registration in the webhook registry.
    """

    async def _handle_push(event: WebhookEvent) -> None:
        correlation_id = event.event_id

        try:
            push = parse_push_event(event.payload)
        except PushEventValidationError:
            logger.warning(
                "push_event_validation_failed",
                extra={"correlation_id": correlation_id},
            )
            return

        log_extra: dict[str, Any] = {
            "correlation_id": correlation_id,
            "branch": push.branch,
            "ref": push.ref,
            "commit_count": len(push.commits),
            "repository": push.repository_full_name,
            "sender": push.sender,
            "is_main_branch": push.is_main_branch,
        }

        if not push.is_main_branch:
            logger.info("push_non_main_acknowledged", extra=log_extra)
            return

        # Main branch push — trigger sync
        logger.info("push_main_branch_detected", extra=log_extra)

        if sync_fn is None:
            logger.warning(
                "push_sync_skipped_no_engine",
                extra={"correlation_id": correlation_id},
            )
            return

        try:
            sync_result = await sync_fn()
            logger.info(
                "push_sync_completed",
                extra={
                    "correlation_id": correlation_id,
                    "sync_result": sync_result,
                },
            )
        except Exception:
            logger.exception(
                "push_sync_failed",
                extra={"correlation_id": correlation_id},
            )

    return _handle_push


# ---------------------------------------------------------------------------
# CI Status / Check Run event handling (FORGEOS-BE062)
# ---------------------------------------------------------------------------

# Regex to extract a ForgeOS ticket ID from a branch name.
_TICKET_ID_RE = re.compile(r"(FORGEOS-[A-Z]+\d+)", re.IGNORECASE)

# GitHub check_run conclusions that map to CI success.
_CI_SUCCESS_CONCLUSIONS: frozenset[str] = frozenset({"success"})

# GitHub check_run conclusions that map to CI failure.
_CI_FAILURE_CONCLUSIONS: frozenset[str] = frozenset({
    "failure",
    "timed_out",
})

# GitHub status event states mapped to CI outcomes.
_STATUS_SUCCESS_STATES: frozenset[str] = frozenset({"success"})
_STATUS_FAILURE_STATES: frozenset[str] = frozenset({"failure", "error"})

# Agent identity used for system-level CI operations.
CI_AGENT_ID = "ci-status-handler"


def extract_ticket_id_from_branch(branch: str) -> str | None:
    """Extract a ForgeOS ticket ID from a branch name.

    Looks for the pattern ``FORGEOS-XXNNN`` (case-insensitive) anywhere
    in *branch*.  Returns the uppercased ticket ID, or ``None`` if no
    match is found.
    """
    match = _TICKET_ID_RE.search(branch)
    if match is None:
        return None
    return match.group(1).upper()


@runtime_checkable
class CITicketOps(Protocol):
    """Protocol for ticket operations needed by the CI status handler."""

    async def get_ticket_stage(self, ticket_id: str) -> str | None:
        """Return the current SDLC stage for *ticket_id*, or ``None``."""
        ...

    async def advance_ci(
        self,
        ticket_id: str,
        evidence: dict[str, Any],
    ) -> None:
        """Advance *ticket_id* past the CI stage."""
        ...

    async def fail_ci(
        self,
        ticket_id: str,
        reason: str,
        evidence: dict[str, Any],
    ) -> None:
        """Record CI failure for *ticket_id* for rework consideration."""
        ...


class CIStatusHandler:
    """Handles GitHub ``check_run`` and ``status`` events for CI automation.

    Maps GitHub CI outcomes to ticket operations:

    * **success** → advance ticket past CI stage
    * **failure** → record failure evidence for rework
    * **pending / other** → log and ignore

    Only tickets currently in the ``CI`` stage are affected.
    Duplicate events are handled idempotently (ticket already past CI
    is silently ignored).
    """

    def __init__(self, ticket_ops: CITicketOps) -> None:
        self._ticket_ops = ticket_ops

    # ------------------------------------------------------------------ #
    # check_run handler
    # ------------------------------------------------------------------ #

    async def handle_check_run(self, event: WebhookEvent) -> None:
        """Handle a GitHub ``check_run`` event.

        Only processes ``completed`` actions. Extracts the branch name
        from ``check_run.check_suite.head_branch``, correlates to a
        ticket, and advances or records failure based on conclusion.
        """
        payload = event.payload
        action = payload.get("action", "")

        if action != "completed":
            logger.debug(
                "ci_check_run_action_ignored",
                extra={"action": action, "event_id": event.event_id},
            )
            return

        check_run = payload.get("check_run")
        if not isinstance(check_run, dict):
            logger.warning(
                "ci_check_run_missing_payload",
                extra={"event_id": event.event_id},
            )
            return

        # Extract branch from check_suite
        check_suite = check_run.get("check_suite", {})
        branch = check_suite.get("head_branch", "") if isinstance(check_suite, dict) else ""
        if not branch:
            logger.info(
                "ci_check_run_no_branch",
                extra={"event_id": event.event_id},
            )
            return

        ticket_id = extract_ticket_id_from_branch(branch)
        if ticket_id is None:
            logger.info(
                "ci_check_run_no_ticket_id",
                extra={"branch": branch, "event_id": event.event_id},
            )
            return

        conclusion: str = check_run.get("conclusion", "")
        check_name: str = check_run.get("name", "")
        output = check_run.get("output", {})
        output_summary: str = (
            output.get("summary", "") if isinstance(output, dict) else ""
        )

        log_extra: dict[str, Any] = {
            "event_id": event.event_id,
            "ticket_id": ticket_id,
            "branch": branch,
            "conclusion": conclusion,
            "check_name": check_name,
        }

        await self._process_ci_outcome(
            ticket_id=ticket_id,
            conclusion=conclusion,
            check_name=check_name,
            output_summary=output_summary,
            log_extra=log_extra,
        )

    # ------------------------------------------------------------------ #
    # status handler
    # ------------------------------------------------------------------ #

    async def handle_status(self, event: WebhookEvent) -> None:
        """Handle a GitHub ``status`` event.

        Extracts the branch name from the ``branches`` array,
        correlates to a ticket, and advances or records failure
        based on the ``state`` field.
        """
        payload = event.payload
        state: str = payload.get("state", "")

        # Extract branch from the branches array
        branches = payload.get("branches", [])
        if not isinstance(branches, list) or not branches:
            logger.info(
                "ci_status_no_branches",
                extra={"event_id": event.event_id, "state": state},
            )
            return

        first_branch = branches[0]
        branch: str = (
            first_branch.get("name", "")
            if isinstance(first_branch, dict)
            else ""
        )
        if not branch:
            logger.info(
                "ci_status_empty_branch",
                extra={"event_id": event.event_id},
            )
            return

        ticket_id = extract_ticket_id_from_branch(branch)
        if ticket_id is None:
            logger.info(
                "ci_status_no_ticket_id",
                extra={"branch": branch, "event_id": event.event_id},
            )
            return

        context: str = payload.get("context", "")
        description: str = payload.get("description", "")

        # Map status state to check_run-style conclusion
        if state in _STATUS_SUCCESS_STATES:
            conclusion = "success"
        elif state in _STATUS_FAILURE_STATES:
            conclusion = "failure"
        else:
            logger.info(
                "ci_status_pending_ignored",
                extra={
                    "event_id": event.event_id,
                    "ticket_id": ticket_id,
                    "state": state,
                },
            )
            return

        log_extra: dict[str, Any] = {
            "event_id": event.event_id,
            "ticket_id": ticket_id,
            "branch": branch,
            "conclusion": conclusion,
            "check_name": context,
        }

        await self._process_ci_outcome(
            ticket_id=ticket_id,
            conclusion=conclusion,
            check_name=context,
            output_summary=description,
            log_extra=log_extra,
        )

    # ------------------------------------------------------------------ #
    # Shared CI outcome processing
    # ------------------------------------------------------------------ #

    async def _process_ci_outcome(
        self,
        *,
        ticket_id: str,
        conclusion: str,
        check_name: str,
        output_summary: str,
        log_extra: dict[str, Any],
    ) -> None:
        """Map a CI conclusion to ticket advance or rework.

        Verifies the ticket is currently in the CI stage. If not,
        the event is logged and ignored (idempotency).
        """
        current_stage = await self._ticket_ops.get_ticket_stage(ticket_id)

        if current_stage is None:
            logger.info("ci_ticket_not_found", extra=log_extra)
            return

        if current_stage != "CI":
            logger.info(
                "ci_ticket_not_in_ci_stage",
                extra={**log_extra, "current_stage": current_stage},
            )
            return

        evidence: dict[str, Any] = {
            "check_name": check_name,
            "conclusion": conclusion,
            "output_summary": output_summary,
            "agent": CI_AGENT_ID,
        }

        if conclusion in _CI_SUCCESS_CONCLUSIONS:
            logger.info("ci_advancing_ticket", extra=log_extra)
            await self._ticket_ops.advance_ci(ticket_id, evidence)
            logger.info("ci_ticket_advanced", extra=log_extra)
        elif conclusion in _CI_FAILURE_CONCLUSIONS:
            reason = (
                f"CI check '{check_name}' failed"
                + (f": {output_summary}" if output_summary else "")
            )
            logger.info("ci_recording_failure", extra=log_extra)
            await self._ticket_ops.fail_ci(ticket_id, reason, evidence)
            logger.info("ci_failure_recorded", extra=log_extra)
        else:
            logger.info(
                "ci_conclusion_ignored",
                extra={**log_extra, "conclusion": conclusion},
            )

    # ------------------------------------------------------------------ #
    # Registration
    # ------------------------------------------------------------------ #

    def register(self, registry: _HandlerRegistry) -> None:
        """Register ``check_run`` and ``status`` event handlers."""
        registry.register("github", "check_run", self.handle_check_run)
        registry.register("github", "status", self.handle_status)


# ---------------------------------------------------------------------------
# Pull Request event handler (FORGEOS-BE063)
# ---------------------------------------------------------------------------


async def handle_pull_request_event(event: WebhookEvent) -> None:
    """Handle a GitHub ``pull_request`` webhook event.

    Delegates to :class:`PRService` to extract ticket IDs, parse
    PR metadata, and produce structured :class:`PREvent` objects.
    Invalid or unrelated PRs (no ticket correlation) are logged
    and skipped gracefully.

    Parameters
    ----------
    event : WebhookEvent
        A validated webhook event with ``event_type == "pull_request"``.
    """
    from mcp_server.services.pr_service import PRService

    service = PRService()
    results = await service.handle_pr_event(event)

    for pr_event in results:
        logger.info(
            "pr_event_dispatched",
            extra=pr_event.to_dict(),
        )


# Register the pull_request handler in the module-level registry.
def register_pr_handler(registry: _HandlerRegistry) -> None:
    """Register the ``pull_request`` event handler."""
    registry.register("github", "pull_request", handle_pull_request_event)
