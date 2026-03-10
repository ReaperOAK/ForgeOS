"""Tests for rate_limiter middleware module.

.. meta::
   :ticket: FORGEOS-BE042
"""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.middleware.auth_middleware import AuthContext, IdentityType, set_auth_context
from mcp_server.middleware.rate_limiter import (
    DEFAULT_READ_LIMIT,
    DEFAULT_READ_WINDOW,
    DEFAULT_WRITE_LIMIT,
    DEFAULT_WRITE_WINDOW,
    RateLimitConfig,
    RateLimitMiddleware,
    SlidingWindowLimiter,
    _build_rate_limit_key,
    _is_write_operation,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_request(
    path: str = "/test",
    method: str = "GET",
    headers: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
) -> Request:
    scope: dict = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"",
        "headers": [
            (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
        ],
        "server": ("localhost", 8000),
        "root_path": "",
    }
    if client_host:
        scope["client"] = (client_host, 12345)
    return Request(scope)


def _echo_handler(request: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def _build_app(
    config: RateLimitConfig | None = None,
    limiter: SlidingWindowLimiter | None = None,
) -> Starlette:
    app = Starlette(
        routes=[
            Route("/test", _echo_handler),
            Route("/api/tickets", _echo_handler),
            Route("/api/tickets/claim", _echo_handler, methods=["POST"]),
            Route("/mcp", _echo_handler, methods=["GET", "POST"]),
            Route("/mcp/messages", _echo_handler, methods=["POST"]),
            Route("/health", _echo_handler),
            Route("/healthz", _echo_handler),
            Route("/ready", _echo_handler),
        ],
    )
    app.add_middleware(
        RateLimitMiddleware,
        config=config,
        limiter=limiter,
    )
    return app


# ---------------------------------------------------------------------------
# SlidingWindowLimiter unit tests
# ---------------------------------------------------------------------------


class TestSlidingWindowLimiter:
    def test_allows_under_limit(self) -> None:
        limiter = SlidingWindowLimiter()
        allowed, remaining, _ = limiter.check("k1", limit=5, window=60.0)
        assert allowed is True
        assert remaining == 4

    def test_decrements_remaining(self) -> None:
        limiter = SlidingWindowLimiter()
        for i in range(3):
            allowed, remaining, _ = limiter.check("k1", limit=5, window=60.0)
            assert allowed is True
            assert remaining == 5 - i - 1

    def test_rejects_at_limit(self) -> None:
        limiter = SlidingWindowLimiter()
        for _ in range(5):
            limiter.check("k1", limit=5, window=60.0)
        allowed, remaining, reset = limiter.check("k1", limit=5, window=60.0)
        assert allowed is False
        assert remaining == 0
        assert reset > 0

    def test_separate_keys_are_independent(self) -> None:
        limiter = SlidingWindowLimiter()
        for _ in range(5):
            limiter.check("k1", limit=5, window=60.0)
        # k1 is exhausted
        allowed, _, _ = limiter.check("k1", limit=5, window=60.0)
        assert allowed is False
        # k2 is fresh
        allowed, remaining, _ = limiter.check("k2", limit=5, window=60.0)
        assert allowed is True
        assert remaining == 4

    def test_window_expiry_allows_again(self) -> None:
        limiter = SlidingWindowLimiter()
        window = 1.0

        # Exhaust the limit
        for _ in range(3):
            limiter.check("k1", limit=3, window=window)

        allowed, _, _ = limiter.check("k1", limit=3, window=window)
        assert allowed is False

        # Advance time past the window using monotonic patching
        original_monotonic = time.monotonic
        offset = window + 0.1

        with patch("mcp_server.middleware.rate_limiter.time") as mock_time:
            base = original_monotonic()
            mock_time.monotonic.return_value = base + offset
            allowed, remaining, _ = limiter.check("k1", limit=3, window=window)
            assert allowed is True
            assert remaining == 2

    def test_reset_clears_all_state(self) -> None:
        limiter = SlidingWindowLimiter()
        for _ in range(5):
            limiter.check("k1", limit=5, window=60.0)
        limiter.reset()
        allowed, remaining, _ = limiter.check("k1", limit=5, window=60.0)
        assert allowed is True
        assert remaining == 4

    def test_returns_positive_reset_after(self) -> None:
        limiter = SlidingWindowLimiter()
        allowed, _, reset = limiter.check("k1", limit=5, window=60.0)
        assert allowed is True
        assert reset >= 0.0


# ---------------------------------------------------------------------------
# RateLimitConfig tests
# ---------------------------------------------------------------------------


class TestRateLimitConfig:
    def test_defaults(self) -> None:
        cfg = RateLimitConfig()
        assert cfg.read_limit == DEFAULT_READ_LIMIT
        assert cfg.read_window == DEFAULT_READ_WINDOW
        assert cfg.write_limit == DEFAULT_WRITE_LIMIT
        assert cfg.write_window == DEFAULT_WRITE_WINDOW

    def test_custom_values(self) -> None:
        cfg = RateLimitConfig(
            read_limit=200,
            read_window=120.0,
            write_limit=10,
            write_window=30.0,
        )
        assert cfg.read_limit == 200
        assert cfg.read_window == 120.0
        assert cfg.write_limit == 10
        assert cfg.write_window == 30.0

    def test_immutable(self) -> None:
        cfg = RateLimitConfig()
        with pytest.raises(AttributeError):
            cfg.read_limit = 999  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Path classification tests
# ---------------------------------------------------------------------------


class TestPathClassification:
    def test_get_is_read(self) -> None:
        req = _make_request(path="/api/tickets", method="GET")
        assert _is_write_operation(req) is False

    def test_post_is_write(self) -> None:
        req = _make_request(path="/api/tickets", method="POST")
        assert _is_write_operation(req) is True

    def test_put_is_write(self) -> None:
        req = _make_request(path="/api/tickets", method="PUT")
        assert _is_write_operation(req) is True

    def test_delete_is_write(self) -> None:
        req = _make_request(path="/api/tickets", method="DELETE")
        assert _is_write_operation(req) is True

    def test_patch_is_write(self) -> None:
        req = _make_request(path="/api/tickets", method="PATCH")
        assert _is_write_operation(req) is True

    def test_claim_path_is_write(self) -> None:
        req = _make_request(path="/api/tickets/claim", method="GET")
        assert _is_write_operation(req) is True

    def test_advance_path_is_write(self) -> None:
        req = _make_request(path="/api/tickets/advance", method="GET")
        assert _is_write_operation(req) is True

    def test_reject_path_is_write(self) -> None:
        req = _make_request(path="/api/tickets/reject", method="GET")
        assert _is_write_operation(req) is True

    def test_release_path_is_write(self) -> None:
        req = _make_request(path="/api/tickets/release", method="GET")
        assert _is_write_operation(req) is True


# ---------------------------------------------------------------------------
# Rate limit key building tests
# ---------------------------------------------------------------------------


class TestBuildRateLimitKey:
    def test_with_auth_context(self) -> None:
        ctx = AuthContext(
            identity_type=IdentityType.AGENT,
            identity_id="agent-123",
            role="backend",
            machine_id="pop-os",
        )
        set_auth_context(ctx)
        try:
            req = _make_request()
            key = _build_rate_limit_key(req)
            assert key == "agent-123:pop-os"
        finally:
            from mcp_server.middleware.auth_middleware import clear_auth_context

            clear_auth_context()

    def test_with_auth_context_no_machine(self) -> None:
        ctx = AuthContext(
            identity_type=IdentityType.AGENT,
            identity_id="agent-456",
            role="qa",
            machine_id="",
        )
        set_auth_context(ctx)
        try:
            req = _make_request()
            key = _build_rate_limit_key(req)
            assert key == "agent-456:unknown"
        finally:
            from mcp_server.middleware.auth_middleware import clear_auth_context

            clear_auth_context()

    def test_without_auth_context_uses_ip(self) -> None:
        from mcp_server.middleware.auth_middleware import clear_auth_context

        clear_auth_context()
        req = _make_request(client_host="10.0.0.1")
        key = _build_rate_limit_key(req)
        assert key == "anon:10.0.0.1"

    def test_without_auth_and_no_client(self) -> None:
        from mcp_server.middleware.auth_middleware import clear_auth_context

        clear_auth_context()
        scope: dict = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "query_string": b"",
            "headers": [],
            "server": ("localhost", 8000),
            "root_path": "",
        }
        req = Request(scope)
        key = _build_rate_limit_key(req)
        assert key == "anon:unknown"


# ---------------------------------------------------------------------------
# Middleware integration tests
# ---------------------------------------------------------------------------


class TestRateLimitMiddleware:
    def test_allows_requests_under_limit(self) -> None:
        config = RateLimitConfig(read_limit=5, read_window=60.0)
        app = _build_app(config=config)
        client = TestClient(app)
        resp = client.get("/test")
        assert resp.status_code == 200
        assert resp.headers["X-RateLimit-Limit"] == "5"
        assert resp.headers["X-RateLimit-Remaining"] == "4"
        assert "X-RateLimit-Reset" in resp.headers

    def test_returns_429_when_exceeded(self) -> None:
        config = RateLimitConfig(read_limit=3, read_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        # Exhaust the limit
        for _ in range(3):
            resp = client.get("/test")
            assert resp.status_code == 200

        # Next request should be rejected
        resp = client.get("/test")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers
        assert resp.headers["X-RateLimit-Remaining"] == "0"
        body = resp.json()
        assert "error" in body

    def test_write_operations_have_stricter_limits(self) -> None:
        config = RateLimitConfig(
            read_limit=100,
            read_window=60.0,
            write_limit=2,
            write_window=60.0,
        )
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        # POST is a write op — limit of 2
        for _ in range(2):
            resp = client.post("/mcp/messages")
            assert resp.status_code == 200

        resp = client.post("/mcp/messages")
        assert resp.status_code == 429

        # GET is a read op — limit of 100, should still work
        resp = client.get("/test")
        assert resp.status_code == 200

    def test_health_paths_skip_rate_limiting(self) -> None:
        config = RateLimitConfig(read_limit=1, read_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        # Exhaust rate limit on normal path
        client.get("/test")
        resp = client.get("/test")
        assert resp.status_code == 429

        # Health paths should still work
        resp = client.get("/health")
        assert resp.status_code == 200
        assert "X-RateLimit-Limit" not in resp.headers

        resp = client.get("/healthz")
        assert resp.status_code == 200

        resp = client.get("/ready")
        assert resp.status_code == 200

    def test_mcp_path_returns_jsonrpc_error(self) -> None:
        config = RateLimitConfig(write_limit=1, write_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        # Exhaust write limit
        client.post("/mcp/messages")
        resp = client.post("/mcp/messages")
        assert resp.status_code == 429
        body = resp.json()
        assert body.get("jsonrpc") == "2.0"
        assert body["error"]["code"] == -32602
        assert "Rate limit exceeded" in body["error"]["message"]

    def test_non_mcp_path_returns_plain_json_error(self) -> None:
        config = RateLimitConfig(read_limit=1, read_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        client.get("/test")
        resp = client.get("/test")
        assert resp.status_code == 429
        body = resp.json()
        assert body["error"] == "Rate limit exceeded"
        assert "retry_after" in body

    def test_rate_limit_headers_present_on_success(self) -> None:
        config = RateLimitConfig(read_limit=10, read_window=60.0)
        app = _build_app(config=config)
        client = TestClient(app)
        resp = client.get("/test")
        assert resp.status_code == 200
        assert "X-RateLimit-Limit" in resp.headers
        assert "X-RateLimit-Remaining" in resp.headers
        assert "X-RateLimit-Reset" in resp.headers

    def test_retry_after_header_on_429(self) -> None:
        config = RateLimitConfig(read_limit=1, read_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        client.get("/test")
        resp = client.get("/test")
        assert resp.status_code == 429
        retry_after = int(resp.headers["Retry-After"])
        assert retry_after > 0

    def test_different_clients_tracked_separately(self) -> None:
        config = RateLimitConfig(read_limit=2, read_window=60.0)
        limiter = SlidingWindowLimiter()
        _build_app(config=config, limiter=limiter)

        # Use two test clients — same app, but since there's no auth context,
        # both clients get keyed by "anon:testclient" (TestClient has same IP).
        # We verify via the limiter directly for independent key tracking.
        allowed_1, _, _ = limiter.check("agent-a:machine-1", 2, 60.0)
        allowed_2, _, _ = limiter.check("agent-a:machine-1", 2, 60.0)
        allowed_3, _, _ = limiter.check("agent-a:machine-1", 2, 60.0)
        assert allowed_1 is True
        assert allowed_2 is True
        assert allowed_3 is False

        # Different key is independent
        allowed_4, _, _ = limiter.check("agent-b:machine-2", 2, 60.0)
        assert allowed_4 is True

    def test_remaining_decrements_correctly(self) -> None:
        config = RateLimitConfig(read_limit=5, read_window=60.0)
        limiter = SlidingWindowLimiter()
        app = _build_app(config=config, limiter=limiter)
        client = TestClient(app)

        for expected_remaining in [4, 3, 2, 1, 0]:
            resp = client.get("/test")
            if resp.status_code == 200:
                assert resp.headers["X-RateLimit-Remaining"] == str(
                    expected_remaining
                )

    def test_default_config_used_when_none_passed(self) -> None:
        app = _build_app()
        client = TestClient(app)
        resp = client.get("/test")
        assert resp.status_code == 200
        assert resp.headers["X-RateLimit-Limit"] == str(DEFAULT_READ_LIMIT)
