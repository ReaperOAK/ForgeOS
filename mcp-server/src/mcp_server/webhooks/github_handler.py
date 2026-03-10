"""GitHub webhook handler — signature verification and event routing.

Verifies inbound GitHub webhook requests using HMAC-SHA256 signatures
and extracts the event type from the ``X-GitHub-Event`` header.

.. meta::
   :ticket: FORGEOS-BE060
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger
from mcp_server.webhooks.signature import verify_signature

if TYPE_CHECKING:
    from collections.abc import Mapping

logger = get_logger("webhooks.github_handler")


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
