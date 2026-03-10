"""Tests for auth_middleware module.

.. meta::
   :ticket: FORGEOS-BE054
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from mcp_server.auth.agent_auth import (
    AgentIdentity,
    AuthenticationError,
    RateLimiter,
)
from mcp_server.middleware.auth_middleware import (
    AuthContext,
    AuthMiddleware,
    IdentityType,
    _classify_identity,
    _extract_api_key_from_headers,
    _extract_machine_id,
    _is_mcp_path,
    _unauthorized_response,
    clear_auth_context,
    get_auth_context,
    set_auth_context,
)


def _make_request(path="/test", headers=None, client_host="127.0.0.1"):
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "query_string": b"",
        "headers": [
            (k.lower().encode(), v.encode())
            for k, v in (headers or {}).items()
        ],
        "server": ("localhost", 8000),
        "root_path": "",
    }
    if client_host:
        scope["client"] = (client_host, 12345)
    return Request(scope)


def _echo_handler(request):
    return PlainTextResponse("ok")


def _build_app(db_pool=None, excluded_paths=None):
    app = Starlette(
        routes=[
            Route("/test", _echo_handler),
            Route("/mcp", _echo_handler),
            Route("/mcp/messages", _echo_handler, methods=["POST"]),
            Route("/health", _echo_handler),
            Route("/healthz", _echo_handler),
            Route("/ready", _echo_handler),
            Route("/custom-health", _echo_handler),
            Route("/api/data", _echo_handler),
        ],
    )
    app.add_middleware(
        AuthMiddleware,
        db_pool=db_pool,
        excluded_paths=excluded_paths,
    )
    return app


class TestAuthContext:
    def test_create_auth_context(self):
        ctx = AuthContext(
            identity_type=IdentityType.AGENT,
            identity_id="agent-123",
            role="backend",
        )
        assert ctx.identity_type == IdentityType.AGENT
        assert ctx.identity_id == "agent-123"
        assert ctx.role == "backend"

    def test_defaults(self):
        ctx = AuthContext(
            identity_type=IdentityType.ADMIN,
            identity_id="a1",
            role="admin",
        )
        assert ctx.machine_id == ""
        assert ctx.agent_name == ""
        assert ctx.permissions == []

    def test_frozen(self):
        ctx = AuthContext(
            identity_type=IdentityType.AGENT,
            identity_id="a",
            role="qa",
        )
        with pytest.raises(AttributeError):
            ctx.role = "admin"  # type: ignore[misc]

    def test_set_and_get(self):
        ctx = AuthContext(
            identity_type=IdentityType.OPERATOR,
            identity_id="op-1",
            role="operator",
        )
        set_auth_context(ctx)
        assert get_auth_context() is ctx
        clear_auth_context()

    def test_clear_restores_none(self):
        ctx = AuthContext(
            identity_type=IdentityType.AGENT,
            identity_id="x",
            role="r",
        )
        set_auth_context(ctx)
        clear_auth_context()
        assert get_auth_context() is None


class TestIdentityType:
    def test_agent_value(self):
        assert IdentityType.AGENT.value == "agent"

    def test_operator_value(self):
        assert IdentityType.OPERATOR.value == "operator"

    def test_admin_value(self):
        assert IdentityType.ADMIN.value == "admin"

    def test_classify_admin(self):
        assert _classify_identity("admin") == IdentityType.ADMIN

    def test_classify_backend(self):
        assert _classify_identity("backend") == IdentityType.AGENT

    def test_classify_unknown(self):
        assert _classify_identity("something") == IdentityType.AGENT


class TestPathHelpers:
    @pytest.mark.parametrize(
        "path", ["/health", "/healthz", "/ready", "/readiness", "/livez"]
    )
    def test_excluded_paths(self, path):
        from mcp_server.middleware.auth_middleware import _EXCLUDED_PATHS

        assert path in _EXCLUDED_PATHS

    def test_non_excluded(self):
        from mcp_server.middleware.auth_middleware import _EXCLUDED_PATHS

        assert "/api/test" not in _EXCLUDED_PATHS

    def test_mcp_path(self):
        assert _is_mcp_path("/mcp") is True
        assert _is_mcp_path("/mcp/messages") is True

    def test_non_mcp_path(self):
        assert _is_mcp_path("/api/test") is False

    def test_trailing_slash(self):
        from mcp_server.middleware.auth_middleware import _EXCLUDED_PATHS

        assert "/health/" not in _EXCLUDED_PATHS


class TestCredentialExtraction:
    def test_x_api_key(self):
        req = _make_request(headers={"X-API-Key": "fgos_abc123"})
        assert _extract_api_key_from_headers(req) == "fgos_abc123"

    def test_bearer_token(self):
        req = _make_request(headers={"Authorization": "Bearer fgos_xyz"})
        assert _extract_api_key_from_headers(req) == "fgos_xyz"

    def test_x_api_key_takes_precedence(self):
        req = _make_request(
            headers={
                "X-API-Key": "fgos_first",
                "Authorization": "Bearer fgos_second",
            }
        )
        assert _extract_api_key_from_headers(req) == "fgos_first"

    def test_no_credentials(self):
        assert _extract_api_key_from_headers(_make_request()) is None

    def test_non_bearer_auth(self):
        req = _make_request(headers={"Authorization": "Basic abc123"})
        assert _extract_api_key_from_headers(req) is None

    def test_strips_whitespace(self):
        req = _make_request(headers={"X-API-Key": "  fgos_abc  "})
        assert _extract_api_key_from_headers(req) == "fgos_abc"


class TestMachineIdExtraction:
    def test_x_machine_id(self):
        req = _make_request(headers={"X-Machine-Id": "pop-os"})
        assert _extract_machine_id(req) == "pop-os"

    def test_forwarded_for(self):
        req = _make_request(
            headers={"X-Forwarded-For": "10.0.0.1, 10.0.0.2"}
        )
        assert _extract_machine_id(req) == "10.0.0.1"

    def test_client_host_fallback(self):
        req = _make_request(client_host="192.168.1.5")
        assert _extract_machine_id(req) == "192.168.1.5"


class TestUnauthorizedResponse:
    def test_rest_401(self):
        resp = _unauthorized_response(_make_request(path="/api/test"))
        assert resp.status_code == 401

    def test_mcp_401(self):
        resp = _unauthorized_response(_make_request(path="/mcp/messages"))
        assert resp.status_code == 401

    def test_mcp_jsonrpc_format(self):
        import json

        resp = _unauthorized_response(_make_request(path="/mcp/messages"))
        body = json.loads(resp.body)
        assert body["jsonrpc"] == "2.0"
        assert body["error"]["code"] == -32602

    def test_custom_message(self):
        import json

        resp = _unauthorized_response(
            _make_request(path="/api/test"), "Custom msg"
        )
        body = json.loads(resp.body)
        assert body["error"] == "Custom msg"


class TestAuthMiddlewareHealthExclusion:
    @pytest.mark.parametrize("path", ["/health", "/healthz", "/ready"])
    def test_health_bypasses_auth(self, path):
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        assert client.get(path).status_code == 200

    @pytest.mark.parametrize("path", ["/health", "/healthz", "/ready"])
    def test_health_no_api_key_needed(self, path):
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        assert client.get(path).status_code == 200


class TestAuthMiddlewareUnauthenticated:
    def test_rest_401_no_key(self):
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get("/test")
        assert resp.status_code == 401
        assert resp.json()["error"] == "Authentication required"

    def test_mcp_401_no_key(self):
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.post("/mcp/messages")
        assert resp.status_code == 401
        body = resp.json()
        assert body["jsonrpc"] == "2.0"
        assert body["error"]["code"] == -32602


class TestAuthMiddlewareNoDbPool:
    def test_503_when_no_pool(self):
        app = _build_app(db_pool=None)
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"X-API-Key": "fgos_abc"}
        )
        assert resp.status_code == 503


class TestAuthMiddlewareValidation:
    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_valid_key_passes(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="id-1",
            agent_name="Backend",
            role="backend",
            permissions=["read", "write"],
        )
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"X-API-Key": "fgos_valid_key"}
        )
        assert resp.status_code == 200
        mock_validate.assert_called_once()

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_bearer_token_works(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="id-2", agent_name="QA", role="qa"
        )
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"Authorization": "Bearer fgos_key"}
        )
        assert resp.status_code == 200

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_admin_role_classified(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="admin-1", agent_name="Admin", role="admin"
        )
        captured_ctx = {}

        def capture_handler(request):
            ctx = get_auth_context()
            if ctx:
                captured_ctx["type"] = ctx.identity_type
            return PlainTextResponse("ok")

        app = Starlette(routes=[Route("/test", capture_handler)])
        app.add_middleware(AuthMiddleware, db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"X-API-Key": "fgos_admin_key"}
        )
        assert resp.status_code == 200
        assert captured_ctx["type"] == IdentityType.ADMIN

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_invalid_key_rejected(self, mock_validate):
        mock_validate.side_effect = AuthenticationError("Invalid key")
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"X-API-Key": "fgos_bad"}
        )
        assert resp.status_code == 401

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_mcp_valid_key(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="mcp-1", agent_name="Frontend", role="frontend"
        )
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.post(
            "/mcp/messages", headers={"X-API-Key": "fgos_mcp_key"}
        )
        assert resp.status_code == 200

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_machine_id_set(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="m-1", agent_name="BE", role="backend"
        )
        captured_ctx = {}

        def capture_handler(request):
            ctx = get_auth_context()
            if ctx:
                captured_ctx["machine"] = ctx.machine_id
            return PlainTextResponse("ok")

        app = Starlette(routes=[Route("/test", capture_handler)])
        app.add_middleware(AuthMiddleware, db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test",
            headers={"X-API-Key": "fgos_key", "X-Machine-Id": "pop-os"},
        )
        assert resp.status_code == 200
        assert captured_ctx["machine"] == "pop-os"

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_context_cleared_after_request(self, mock_validate):
        mock_validate.return_value = AgentIdentity(
            agent_id="c-1", agent_name="CI", role="ci"
        )
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        client.get("/test", headers={"X-API-Key": "fgos_key"})
        assert get_auth_context() is None

    @patch("mcp_server.middleware.auth_middleware.validate_api_key")
    def test_rate_limiting(self, mock_validate):
        mock_validate.side_effect = AuthenticationError(
            "Rate limit exceeded"
        )
        app = _build_app(db_pool=MagicMock())
        client = TestClient(app)
        resp = client.get(
            "/test", headers={"X-API-Key": "fgos_rate"}
        )
        assert resp.status_code == 401


class TestAuthMiddlewareCustomExclusions:
    def test_custom_excluded_path(self):
        app = _build_app(
            db_pool=MagicMock(),
            excluded_paths=frozenset({"/custom-health"}),
        )
        client = TestClient(app)
        assert client.get("/custom-health").status_code == 200


class TestAuthMiddlewareDbPoolProperty:
    def test_db_pool_getter_setter(self):
        middleware = AuthMiddleware(app=MagicMock(), db_pool=None)
        assert middleware.db_pool is None
        new_pool = MagicMock()
        middleware.db_pool = new_pool
        assert middleware.db_pool is new_pool
