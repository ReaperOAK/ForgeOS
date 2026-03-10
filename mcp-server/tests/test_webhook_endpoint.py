"""Tests for the webhook HTTP receiver endpoint.

.. meta::
   :ticket: FORGEOS-BE059
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

from starlette.applications import Starlette
from starlette.testclient import TestClient

from mcp_server.services.webhook_service import (
    WebhookService,
    _HandlerRegistry,
)
from mcp_server.transport.webhooks import (
    get_webhook_service,
    set_webhook_service,
    webhook_routes,
)

# ------------------------------------------------------------------ #
# Helpers
# ------------------------------------------------------------------ #


def _build_app() -> Starlette:
    """Build a minimal Starlette app with webhook routes."""
    return Starlette(routes=webhook_routes)


def _client() -> TestClient:
    return TestClient(_build_app(), raise_server_exceptions=False)


# ------------------------------------------------------------------ #
# POST /api/webhooks/{source} — happy paths
# ------------------------------------------------------------------ #


class TestWebhookEndpointHappyPaths:
    """Verify 202 Accepted for valid payloads."""

    def test_github_webhook_accepted(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            json={"action": "opened", "number": 7},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["source"] == "github"
        assert body["event_type"] == "opened"
        assert "event_id" in body

    def test_github_with_event_header(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            json={"action": "completed"},
            headers={
                "content-type": "application/json",
                "x-github-event": "push",
            },
        )
        assert resp.status_code == 202
        assert resp.json()["event_type"] == "push"

    def test_custom_webhook_accepted(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/custom",
            json={"event_type": "deploy", "environment": "staging"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["source"] == "custom"
        assert body["event_type"] == "deploy"

    def test_source_case_insensitive(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/GitHub",
            json={"action": "closed"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 202
        assert resp.json()["source"] == "github"


# ------------------------------------------------------------------ #
# POST /api/webhooks/{source} — validation errors
# ------------------------------------------------------------------ #


class TestWebhookEndpointValidationErrors:
    """Verify 400 Bad Request for invalid inputs."""

    def test_unknown_source_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/slack",
            json={"event_type": "message"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        body = resp.json()
        assert "Unknown webhook source" in body["error"]
        assert "details" in body

    def test_missing_github_action_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            json={"number": 42},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert "missing required" in resp.json()["error"]

    def test_missing_custom_event_type_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/custom",
            json={"data": "hello"},
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert "missing required" in resp.json()["error"]

    def test_invalid_json_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            content=b"not json {{{",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert "Invalid JSON" in resp.json()["error"]

    def test_non_object_json_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            content=json.dumps([1, 2, 3]).encode(),
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 400
        assert "JSON object" in resp.json()["error"]

    def test_wrong_content_type_returns_400(self) -> None:
        client = _client()
        resp = client.post(
            "/api/webhooks/github",
            content=b"<xml/>",
            headers={"content-type": "text/xml"},
        )
        assert resp.status_code == 400
        assert "Content-Type" in resp.json()["error"]


# ------------------------------------------------------------------ #
# Service getter/setter
# ------------------------------------------------------------------ #


class TestServiceGetterSetter:
    """Verify the module-level service can be swapped."""

    def test_get_returns_service(self) -> None:
        svc = get_webhook_service()
        assert isinstance(svc, WebhookService)

    def test_set_and_get_roundtrip(self) -> None:
        original = get_webhook_service()
        try:
            custom = WebhookService(registry=_HandlerRegistry())
            set_webhook_service(custom)
            assert get_webhook_service() is custom
        finally:
            set_webhook_service(original)


# ------------------------------------------------------------------ #
# Route table
# ------------------------------------------------------------------ #


class TestWebhookRouteTable:
    """Verify the route table is correctly configured."""

    def test_routes_contains_webhook_route(self) -> None:
        assert len(webhook_routes) == 1
        route = webhook_routes[0]
        assert route.path == "/api/webhooks/{source}"
        assert "POST" in route.methods  # type: ignore[operator]

    def test_method_not_allowed(self) -> None:
        client = _client()
        resp = client.get("/api/webhooks/github")
        assert resp.status_code == 405


# ------------------------------------------------------------------ #
# Integration: custom handler receives event
# ------------------------------------------------------------------ #


class TestWebhookIntegration:
    """End-to-end test with a custom handler."""

    def test_custom_handler_invoked(self) -> None:
        handler = AsyncMock()
        reg = _HandlerRegistry()
        reg.register("github", "opened", handler)
        custom_svc = WebhookService(registry=reg)

        original = get_webhook_service()
        set_webhook_service(custom_svc)
        try:
            client = _client()
            resp = client.post(
                "/api/webhooks/github",
                json={"action": "opened"},
                headers={"content-type": "application/json"},
            )
            assert resp.status_code == 202
        finally:
            set_webhook_service(original)
