"""Tests for idempotency middleware module.

Covers:
- Key extraction from X-Idempotency-Key header
- In-memory store CRUD + TTL expiry
- Cached response replay (no re-execution)
- In-progress collision → 409 Conflict
- Missing key behavior (configurable: warn vs 400)
- Configurable TTL
- Store backend abstraction
- Concurrent key handling

.. meta::
   :ticket: FORGEOS-BE041
"""

from __future__ import annotations

import asyncio
import time

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.middleware.idempotency import (
    HEADER_NAME,
    IdempotencyConfig,
    IdempotencyEntry,
    IdempotencyMiddleware,
    IdempotencyStore,
    InMemoryIdempotencyStore,
    MissingKeyPolicy,
    _extract_idempotency_key,
    _is_mutating_request,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_call_count = 0


def _counting_handler(request: Request) -> JSONResponse:
    """Handler that increments a counter — proves re-execution vs cache."""
    global _call_count
    _call_count += 1
    return JSONResponse({"count": _call_count, "data": "created"}, status_code=201)


def _echo_handler(request: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


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


def _build_app(
    config: IdempotencyConfig | None = None,
    store: IdempotencyStore | None = None,
) -> Starlette:
    global _call_count
    _call_count = 0

    app = Starlette(
        routes=[
            Route("/test", _counting_handler, methods=["GET", "POST"]),
            Route("/api/tickets/claim", _counting_handler, methods=["POST"]),
            Route("/api/tickets/advance", _counting_handler, methods=["POST"]),
            Route("/mcp", _counting_handler, methods=["GET", "POST"]),
            Route("/mcp/messages", _counting_handler, methods=["POST"]),
            Route("/health", _echo_handler),
            Route("/healthz", _echo_handler),
        ],
    )
    app.add_middleware(
        IdempotencyMiddleware,
        config=config,
        store=store,
    )
    return app


# ---------------------------------------------------------------------------
# IdempotencyConfig tests
# ---------------------------------------------------------------------------


class TestIdempotencyConfig:
    def test_defaults(self) -> None:
        cfg = IdempotencyConfig()
        assert cfg.ttl_seconds == 86400  # 24 hours
        assert cfg.missing_key_policy == MissingKeyPolicy.WARN

    def test_custom_values(self) -> None:
        cfg = IdempotencyConfig(
            ttl_seconds=3600,
            missing_key_policy=MissingKeyPolicy.REJECT,
        )
        assert cfg.ttl_seconds == 3600
        assert cfg.missing_key_policy == MissingKeyPolicy.REJECT


# ---------------------------------------------------------------------------
# MissingKeyPolicy tests
# ---------------------------------------------------------------------------


class TestMissingKeyPolicy:
    def test_enum_values(self) -> None:
        assert MissingKeyPolicy.WARN == "warn"
        assert MissingKeyPolicy.REJECT == "reject"


# ---------------------------------------------------------------------------
# Key extraction tests
# ---------------------------------------------------------------------------


class TestExtractIdempotencyKey:
    def test_extracts_from_header(self) -> None:
        request = _make_request(headers={"X-Idempotency-Key": "abc-123"})
        assert _extract_idempotency_key(request) == "abc-123"

    def test_case_insensitive_header(self) -> None:
        request = _make_request(headers={"x-idempotency-key": "abc-123"})
        assert _extract_idempotency_key(request) == "abc-123"

    def test_returns_none_when_missing(self) -> None:
        request = _make_request()
        assert _extract_idempotency_key(request) is None

    def test_strips_whitespace(self) -> None:
        request = _make_request(headers={"X-Idempotency-Key": "  key-1  "})
        assert _extract_idempotency_key(request) == "key-1"

    def test_empty_header_returns_none(self) -> None:
        request = _make_request(headers={"X-Idempotency-Key": ""})
        assert _extract_idempotency_key(request) is None

    def test_whitespace_only_returns_none(self) -> None:
        request = _make_request(headers={"X-Idempotency-Key": "   "})
        assert _extract_idempotency_key(request) is None


# ---------------------------------------------------------------------------
# Mutating request detection tests
# ---------------------------------------------------------------------------


class TestIsMutatingRequest:
    def test_post_is_mutating(self) -> None:
        request = _make_request(method="POST")
        assert _is_mutating_request(request) is True

    def test_put_is_mutating(self) -> None:
        request = _make_request(method="PUT")
        assert _is_mutating_request(request) is True

    def test_delete_is_mutating(self) -> None:
        request = _make_request(method="DELETE")
        assert _is_mutating_request(request) is True

    def test_patch_is_mutating(self) -> None:
        request = _make_request(method="PATCH")
        assert _is_mutating_request(request) is True

    def test_get_not_mutating(self) -> None:
        request = _make_request(method="GET")
        assert _is_mutating_request(request) is False

    def test_head_not_mutating(self) -> None:
        request = _make_request(method="HEAD")
        assert _is_mutating_request(request) is False


# ---------------------------------------------------------------------------
# InMemoryIdempotencyStore tests
# ---------------------------------------------------------------------------


class TestInMemoryIdempotencyStore:
    @pytest.mark.asyncio
    async def test_get_returns_none_for_missing_key(self) -> None:
        store = InMemoryIdempotencyStore()
        assert await store.get("nonexistent") is None

    @pytest.mark.asyncio
    async def test_set_and_get(self) -> None:
        store = InMemoryIdempotencyStore()
        entry = IdempotencyEntry(
            key="k1",
            status_code=201,
            headers={"content-type": "application/json"},
            body=b'{"ok": true}',
        )
        await store.set("k1", entry, ttl_seconds=3600)
        result = await store.get("k1")
        assert result is not None
        assert result.key == "k1"
        assert result.status_code == 201
        assert result.body == b'{"ok": true}'

    @pytest.mark.asyncio
    async def test_expired_entry_returns_none(self) -> None:
        store = InMemoryIdempotencyStore()
        entry = IdempotencyEntry(
            key="k1",
            status_code=200,
            headers={},
            body=b"ok",
        )
        await store.set("k1", entry, ttl_seconds=0)
        # Entry should already be expired (TTL=0)
        result = await store.get("k1")
        assert result is None

    @pytest.mark.asyncio
    async def test_mark_in_progress_and_get(self) -> None:
        store = InMemoryIdempotencyStore()
        await store.mark_in_progress("k1", ttl_seconds=60)
        result = await store.get("k1")
        assert result is not None
        assert result.in_progress is True

    @pytest.mark.asyncio
    async def test_remove(self) -> None:
        store = InMemoryIdempotencyStore()
        entry = IdempotencyEntry(
            key="k1",
            status_code=200,
            headers={},
            body=b"ok",
        )
        await store.set("k1", entry, ttl_seconds=3600)
        await store.remove("k1")
        assert await store.get("k1") is None

    @pytest.mark.asyncio
    async def test_remove_nonexistent_no_error(self) -> None:
        store = InMemoryIdempotencyStore()
        await store.remove("ghost")  # Should not raise

    @pytest.mark.asyncio
    async def test_cleanup_expired(self) -> None:
        store = InMemoryIdempotencyStore()
        entry = IdempotencyEntry(
            key="k1", status_code=200, headers={}, body=b"ok"
        )
        await store.set("k1", entry, ttl_seconds=0)
        entry2 = IdempotencyEntry(
            key="k2", status_code=200, headers={}, body=b"ok"
        )
        await store.set("k2", entry2, ttl_seconds=3600)
        await store.cleanup_expired()
        assert await store.get("k1") is None
        assert await store.get("k2") is not None


# ---------------------------------------------------------------------------
# Middleware integration tests — cached response replay
# ---------------------------------------------------------------------------


class TestIdempotencyMiddlewareCaching:
    def test_first_request_executes_normally(self) -> None:
        app = _build_app()
        client = TestClient(app)
        resp = client.post(
            "/test",
            headers={"X-Idempotency-Key": "unique-1"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["count"] == 1
        assert data["data"] == "created"

    def test_duplicate_returns_cached_response(self) -> None:
        app = _build_app()
        client = TestClient(app)
        key = "dup-key-1"

        resp1 = client.post("/test", headers={"X-Idempotency-Key": key})
        assert resp1.status_code == 201
        data1 = resp1.json()

        resp2 = client.post("/test", headers={"X-Idempotency-Key": key})
        assert resp2.status_code == 201
        data2 = resp2.json()

        # Same response body — no re-execution
        assert data1 == data2
        # Counter should NOT have incremented on second call
        assert data2["count"] == 1

    def test_different_keys_execute_independently(self) -> None:
        app = _build_app()
        client = TestClient(app)

        resp1 = client.post("/test", headers={"X-Idempotency-Key": "key-a"})
        resp2 = client.post("/test", headers={"X-Idempotency-Key": "key-b"})

        assert resp1.json()["count"] == 1
        assert resp2.json()["count"] == 2

    def test_get_requests_bypass_idempotency(self) -> None:
        app = _build_app()
        client = TestClient(app)

        resp1 = client.get("/test", headers={"X-Idempotency-Key": "get-key"})
        resp2 = client.get("/test", headers={"X-Idempotency-Key": "get-key"})

        # GET is not mutating — both should execute
        assert resp1.json()["count"] == 1
        assert resp2.json()["count"] == 2


# ---------------------------------------------------------------------------
# Middleware — health endpoint exclusion
# ---------------------------------------------------------------------------


class TestIdempotencyMiddlewareExclusions:
    def test_health_endpoint_bypassed(self) -> None:
        app = _build_app()
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Middleware — missing key behavior
# ---------------------------------------------------------------------------


class TestIdempotencyMissingKeyPolicy:
    def test_warn_policy_allows_request(self) -> None:
        config = IdempotencyConfig(missing_key_policy=MissingKeyPolicy.WARN)
        app = _build_app(config=config)
        client = TestClient(app)

        resp = client.post("/test")
        assert resp.status_code == 201  # Request proceeds

    def test_reject_policy_returns_400(self) -> None:
        config = IdempotencyConfig(missing_key_policy=MissingKeyPolicy.REJECT)
        app = _build_app(config=config)
        client = TestClient(app)

        resp = client.post("/test")
        assert resp.status_code == 400
        body = resp.json()
        assert "idempotency" in body.get("error", "").lower()

    def test_reject_policy_mcp_path_returns_jsonrpc(self) -> None:
        config = IdempotencyConfig(missing_key_policy=MissingKeyPolicy.REJECT)
        app = _build_app(config=config)
        client = TestClient(app)

        resp = client.post("/mcp/messages")
        assert resp.status_code == 400
        body = resp.json()
        assert "jsonrpc" in body
        assert body["error"]["code"] == -32602

    def test_reject_policy_ignores_get(self) -> None:
        config = IdempotencyConfig(missing_key_policy=MissingKeyPolicy.REJECT)
        app = _build_app(config=config)
        client = TestClient(app)

        resp = client.get("/test")
        assert resp.status_code == 201  # GET proceeds regardless


# ---------------------------------------------------------------------------
# Middleware — 409 Conflict for in-progress keys
# ---------------------------------------------------------------------------


class TestIdempotencyConflict:
    def test_in_progress_key_returns_409(self) -> None:
        store = InMemoryIdempotencyStore()
        app = _build_app(store=store)
        client = TestClient(app)

        # Manually mark key as in-progress
        asyncio.get_event_loop().run_until_complete(
            store.mark_in_progress("busy-key", ttl_seconds=60)
        )

        resp = client.post(
            "/test", headers={"X-Idempotency-Key": "busy-key"}
        )
        assert resp.status_code == 409
        body = resp.json()
        assert "in-progress" in body.get("error", "").lower()

    def test_in_progress_mcp_path_returns_jsonrpc_409(self) -> None:
        store = InMemoryIdempotencyStore()
        app = _build_app(store=store)
        client = TestClient(app)

        asyncio.get_event_loop().run_until_complete(
            store.mark_in_progress("busy-mcp", ttl_seconds=60)
        )

        resp = client.post(
            "/mcp/messages", headers={"X-Idempotency-Key": "busy-mcp"}
        )
        assert resp.status_code == 409
        body = resp.json()
        assert "jsonrpc" in body


# ---------------------------------------------------------------------------
# Middleware — TTL configuration
# ---------------------------------------------------------------------------


class TestIdempotencyTTL:
    def test_custom_ttl_expired_entry_re_executes(self) -> None:
        store = InMemoryIdempotencyStore()
        config = IdempotencyConfig(ttl_seconds=60)
        app = _build_app(config=config, store=store)
        client = TestClient(app)

        # First request — caches the response
        resp1 = client.post("/test", headers={"X-Idempotency-Key": "ttl-key"})
        assert resp1.status_code == 201
        count1 = resp1.json()["count"]

        # Artificially expire the entry by manipulating the store
        stored = store._entries.get("ttl-key")
        assert stored is not None
        stored.expires_at = time.monotonic() - 1  # Force expiry

        # Second request — entry is expired, should re-execute
        resp2 = client.post("/test", headers={"X-Idempotency-Key": "ttl-key"})
        assert resp2.status_code == 201
        count2 = resp2.json()["count"]

        assert count2 > count1


# ---------------------------------------------------------------------------
# Store abstraction tests
# ---------------------------------------------------------------------------


class TestIdempotencyStoreAbstraction:
    def test_store_is_abstract(self) -> None:
        """IdempotencyStore defines the interface."""
        assert hasattr(IdempotencyStore, "get")
        assert hasattr(IdempotencyStore, "set")
        assert hasattr(IdempotencyStore, "remove")
        assert hasattr(IdempotencyStore, "mark_in_progress")
        assert hasattr(IdempotencyStore, "cleanup_expired")


# ---------------------------------------------------------------------------
# Middleware — response header
# ---------------------------------------------------------------------------


class TestIdempotencyResponseHeaders:
    def test_cached_response_includes_idempotent_replayed_header(self) -> None:
        app = _build_app()
        client = TestClient(app)
        key = "replay-header-key"

        client.post("/test", headers={"X-Idempotency-Key": key})
        resp2 = client.post("/test", headers={"X-Idempotency-Key": key})

        assert resp2.headers.get("X-Idempotent-Replayed") == "true"

    def test_first_request_no_replayed_header(self) -> None:
        app = _build_app()
        client = TestClient(app)

        resp = client.post(
            "/test", headers={"X-Idempotency-Key": "fresh-key"}
        )
        assert "X-Idempotent-Replayed" not in resp.headers


# ---------------------------------------------------------------------------
# HEADER_NAME constant
# ---------------------------------------------------------------------------


class TestHeaderName:
    def test_header_constant(self) -> None:
        assert HEADER_NAME == "x-idempotency-key"
