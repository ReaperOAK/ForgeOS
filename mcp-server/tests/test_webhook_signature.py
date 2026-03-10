"""Tests for GitHub webhook signature verification.

.. meta::
   :ticket: FORGEOS-BE060
"""

from __future__ import annotations

import hashlib
import hmac
import os
from unittest.mock import patch

from mcp_server.webhooks.signature import (
    compute_signature,
    get_webhook_secret,
    verify_signature,
)

# ------------------------------------------------------------------ #
# get_webhook_secret
# ------------------------------------------------------------------ #


class TestGetWebhookSecret:
    """Verify loading of webhook secret from environment."""

    def test_returns_secret_when_set(self) -> None:
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": "test-secret-123"}):
            assert get_webhook_secret() == "test-secret-123"

    def test_returns_none_when_not_set(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            assert get_webhook_secret() is None

    def test_returns_none_for_empty_string(self) -> None:
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": ""}):
            assert get_webhook_secret() is None


# ------------------------------------------------------------------ #
# compute_signature
# ------------------------------------------------------------------ #


class TestComputeSignature:
    """Verify HMAC-SHA256 signature computation."""

    def test_computes_correct_hmac(self) -> None:
        payload = b'{"action": "push"}'
        secret = "my-secret"
        expected_mac = hmac.new(
            secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).hexdigest()
        result = compute_signature(payload, secret)
        assert result == f"sha256={expected_mac}"

    def test_different_payloads_produce_different_signatures(self) -> None:
        secret = "shared"
        sig1 = compute_signature(b"payload-a", secret)
        sig2 = compute_signature(b"payload-b", secret)
        assert sig1 != sig2

    def test_different_secrets_produce_different_signatures(self) -> None:
        payload = b"same-payload"
        sig1 = compute_signature(payload, "secret1")
        sig2 = compute_signature(payload, "secret2")
        assert sig1 != sig2

    def test_empty_payload(self) -> None:
        result = compute_signature(b"", "secret")
        assert result.startswith("sha256=")
        assert len(result) == len("sha256=") + 64  # SHA256 hex is 64 chars


# ------------------------------------------------------------------ #
# verify_signature
# ------------------------------------------------------------------ #


class TestVerifySignature:
    """Verify constant-time signature verification."""

    def _make_valid_sig(self, payload: bytes, secret: str) -> str:
        mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        return f"sha256={mac}"

    def test_valid_signature_returns_true(self) -> None:
        payload = b'{"action": "opened"}'
        secret = "webhook-secret"
        sig = self._make_valid_sig(payload, secret)
        assert verify_signature(payload, sig, secret) is True

    def test_invalid_signature_returns_false(self) -> None:
        payload = b'{"action": "opened"}'
        secret = "webhook-secret"
        assert verify_signature(payload, "sha256=invalid_hex_string", secret) is False

    def test_wrong_secret_returns_false(self) -> None:
        payload = b'{"action": "opened"}'
        sig = self._make_valid_sig(payload, "correct-secret")
        assert verify_signature(payload, sig, "wrong-secret") is False

    def test_tampered_payload_returns_false(self) -> None:
        payload = b'{"action": "opened"}'
        secret = "webhook-secret"
        sig = self._make_valid_sig(payload, secret)
        tampered = b'{"action": "closed"}'
        assert verify_signature(tampered, sig, secret) is False

    def test_missing_sha256_prefix_returns_false(self) -> None:
        payload = b'{"action": "opened"}'
        secret = "webhook-secret"
        mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        assert verify_signature(payload, mac, secret) is False

    def test_empty_signature_returns_false(self) -> None:
        assert verify_signature(b"body", "", "secret") is False

    def test_sha1_prefix_rejected(self) -> None:
        """Only sha256= prefix is accepted."""
        payload = b'{"action": "opened"}'
        secret = "webhook-secret"
        mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        assert verify_signature(payload, f"sha1={mac}", secret) is False
