"""GitHub webhook signature verification — HMAC-SHA256.

Provides functions to compute and verify GitHub webhook signatures
using constant-time comparison to prevent timing attacks.

.. meta::
   :ticket: FORGEOS-BE060
"""

from __future__ import annotations

import hashlib
import hmac
import os

_SHA256_PREFIX = "sha256="


def get_webhook_secret() -> str | None:
    """Load the GitHub webhook secret from the environment.

    Returns
    -------
    str | None
        The secret string, or ``None`` if not configured / empty.
    """
    secret = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
    return secret if secret else None


def compute_signature(payload: bytes, secret: str) -> str:
    """Compute HMAC-SHA256 signature for *payload* using *secret*.

    Parameters
    ----------
    payload : bytes
        Raw request body.
    secret : str
        Shared webhook secret.

    Returns
    -------
    str
        Signature in ``sha256=<hex_digest>`` format.
    """
    mac = hmac.new(
        key=secret.encode("utf-8"),
        msg=payload,
        digestmod=hashlib.sha256,
    )
    return f"{_SHA256_PREFIX}{mac.hexdigest()}"


def verify_signature(payload: bytes, signature_header: str, secret: str) -> bool:
    """Verify *signature_header* against the computed HMAC of *payload*.

    Uses :func:`hmac.compare_digest` for constant-time comparison
    to prevent timing attacks.

    Parameters
    ----------
    payload : bytes
        Raw request body.
    signature_header : str
        Value of the ``X-Hub-Signature-256`` header (``sha256=<hex>``).
    secret : str
        Shared webhook secret.

    Returns
    -------
    bool
        ``True`` when the signature is valid, ``False`` otherwise.
    """
    if not signature_header or not signature_header.startswith(_SHA256_PREFIX):
        return False

    expected = compute_signature(payload, secret)
    return hmac.compare_digest(expected, signature_header)
