"""Tests for GitHub webhook handler with signature verification.

.. meta::
   :ticket: FORGEOS-BE060
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from unittest.mock import patch

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from mcp_server.transport.webhooks import webhook_routes
from mcp_server.webhooks.github_handler import (
    GitHubSignatureError,
    GitHubSignatureMissingError,
    verify_github_request,
)

WEBHOOK_SECRET = "test-secret-for-github"


# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #


def _sign(payload: bytes, secret: str = WEBHOOK_SECRET) -> str:
    mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


def _build_app() -> Starlette:
    return Starlette(routes=webhook_routes)


def _client() -> TestClient:
    return TestClient(_build_app(), raise_server_exceptions=False)


# ------------------------------------------------------------------ #
# verify_github_request unit tests
# ------------------------------------------------------------------ #


class TestVerifyGitHubRequest:
    """Unit tests for the verify_github_request function."""

    def test_valid_signature_returns_event_type(self) -> None:
        payload = b'{"action": "opened"}'
        sig = _sign(payload)
        headers = {
            "x-hub-signature-256": sig,
            "x-github-event": "pull_request",
        }
        event_type = verify_github_request(payload, headers, WEBHOOK_SECRET)
        assert event_type == "pull_request"

    def test_missing_signature_header_raises_401(self) -> None:
        payload = b'{"action": "opened"}'
        headers = {"x-github-event": "push"}
        with pytest.raises(GitHubSignatureMissingError):
            verify_github_request(payload, headers, WEBHOOK_SECRET)

    def test_invalid_signature_raises_403(self) -> None:
        payload = b'{"action": "opened"}'
        headers = {
            "x-hub-signature-256": "sha256=badhex",
            "x-github-event": "push",
        }
        with pytest.raises(GitHubSignatureError):
            verify_github_request(payload, headers, WEBHOOK_SECRET)

    def test_missing_event_header_defaults_to_unknown(self) -> None:
        payload = b'{"action": "opened"}'
        sig = _sign(payload)
        headers = {"x-hub-signature-256": sig}
        event_type = verify_github_request(payload, headers, WEBHOOK_SECRET)
        assert event_type == "unknown"

    def test_event_type_stripped(self) -> None:
        payload = b'{"action": "opened"}'
        sig = _sign(payload)
        headers = {
            "x-hub-signature-256": sig,
            "x-github-event": "  issues  ",
        }
        event_type = verify_github_request(payload, headers, WEBHOOK_SECRET)
        assert event_type == "issues"


# ------------------------------------------------------------------ #
# Integration tests — endpoint with signature verification
# ------------------------------------------------------------------ #


class TestGitHubWebhookEndpointSignature:
    """Integration tests verifying signature enforcement at the endpoint."""

    def test_github_valid_signature_returns_202(self) -> None:
        payload = json.dumps({"action": "opened", "number": 1}).encode()
        sig = _sign(payload)
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": WEBHOOK_SECRET}):
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-hub-signature-256": sig,
                    "x-github-event": "push",
                },
            )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["source"] == "github"

    def test_github_missing_signature_returns_401(self) -> None:
        payload = json.dumps({"action": "opened"}).encode()
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": WEBHOOK_SECRET}):
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-github-event": "push",
                },
            )
        assert resp.status_code == 401
        error_msg = resp.json()["error"].lower()
        assert "missing" in error_msg or "signature" in error_msg

    def test_github_invalid_signature_returns_403(self) -> None:
        payload = json.dumps({"action": "opened"}).encode()
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": WEBHOOK_SECRET}):
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-hub-signature-256": "sha256=deadbeef",
                    "x-github-event": "push",
                },
            )
        assert resp.status_code == 403
        error_msg = resp.json()["error"].lower()
        assert "invalid" in error_msg or "signature" in error_msg

    def test_github_no_secret_configured_skips_verification(self) -> None:
        """When no webhook secret is configured, signature check is skipped."""
        payload = json.dumps({"action": "opened"}).encode()
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_WEBHOOK_SECRET"}
        with patch.dict(os.environ, env, clear=True):
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-github-event": "push",
                },
            )
        assert resp.status_code == 202

    def test_non_github_source_skips_signature_verification(self) -> None:
        """Signature verification only applies to GitHub webhooks."""
        payload = json.dumps({"event_type": "deploy"}).encode()
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": WEBHOOK_SECRET}):
            client = _client()
            resp = client.post(
                "/api/webhooks/custom",
                content=payload,
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 202

    def test_github_event_type_from_header(self) -> None:
        """Event type should come from X-GitHub-Event header."""
        payload = json.dumps({"action": "opened"}).encode()
        sig = _sign(payload)
        with patch.dict(os.environ, {"GITHUB_WEBHOOK_SECRET": WEBHOOK_SECRET}):
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-hub-signature-256": sig,
                    "x-github-event": "pull_request",
                },
            )
        assert resp.status_code == 202
        body = resp.json()
        assert body["event_type"] == "pull_request"
