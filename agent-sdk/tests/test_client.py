"""Tests for forgeos_sdk.client module."""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from forgeos_sdk.client import ConnectionState, ForgeOSClient
from forgeos_sdk.config import TransportType
from forgeos_sdk.exceptions import ConfigurationError
from forgeos_sdk.exceptions import ConnectionError as SDKConnectionError

# ── Helpers for mocking transport + session ──────────────────────────


class FakeTransport:
    """In-memory transport mock for unit testing."""

    def __init__(self, session_id: str | None = None) -> None:
        self._connected = False
        self._session_id = session_id
        self.start_count = 0
        self.close_count = 0

    async def start(self) -> tuple[MagicMock, MagicMock]:
        self.start_count += 1
        self._connected = True
        return MagicMock(name="read"), MagicMock(name="write")

    async def close(self) -> None:
        self.close_count += 1
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def session_id(self) -> str | None:
        return self._session_id


class FailingTransport(FakeTransport):
    """Transport that fails on start N times, then succeeds."""

    def __init__(self, fail_count: int = 1) -> None:
        super().__init__()
        self._fail_count = fail_count
        self._attempts = 0

    async def start(self) -> tuple[MagicMock, MagicMock]:
        self._attempts += 1
        if self._attempts <= self._fail_count:
            raise OSError(f"Connection refused (attempt {self._attempts})")
        return await super().start()


@asynccontextmanager
async def _fake_session_cm(
    _read: Any, _write: Any
) -> AsyncGenerator[AsyncMock, None]:
    """Fake ClientSession context manager."""
    session = AsyncMock(name="ClientSession")
    session.initialize = AsyncMock(
        return_value=MagicMock(
            serverInfo={"name": "forgeos-test"},
            protocolVersion="2025-03-26",
        )
    )
    yield session


# ── Constructor tests (backward-compatible) ──────────────────────────


class TestForgeOSClientInit:
    """Verify ForgeOSClient constructor behavior."""

    def test_basic_construction(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="Backend",
            transport_type="streamable-http",
        )
        assert client.server_url == "http://localhost:8080/mcp"
        assert client.agent_id == "Backend"
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_sse_transport(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="QA",
            transport_type="sse",
        )
        assert client.transport_type == TransportType.SSE

    def test_stdio_transport(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="Frontend",
            transport_type="stdio",
        )
        assert client.transport_type == TransportType.STDIO

    def test_default_transport_is_streamable_http(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_empty_server_url_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="server_url must not be empty"):
            ForgeOSClient(server_url="", agent_id="test")

    def test_empty_agent_id_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="agent_id must not be empty"):
            ForgeOSClient(server_url="http://localhost:8080/mcp", agent_id="")

    def test_invalid_transport_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="Invalid transport_type"):
            ForgeOSClient(
                server_url="http://localhost:8080/mcp",
                agent_id="test",
                transport_type="websocket",
            )

    def test_invalid_transport_shows_valid_options(self) -> None:
        with pytest.raises(ConfigurationError, match="streamable-http"):
            ForgeOSClient(
                server_url="http://localhost:8080/mcp",
                agent_id="test",
                transport_type="grpc",
            )

    def test_initial_state_is_disconnected(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        assert client.connection_state == ConnectionState.DISCONNECTED
        assert client.is_connected is False
        assert client.session is None
        assert client.server_capabilities is None
        assert client.session_id is None


class TestForgeOSClientFromEnv:
    """Verify ForgeOSClient.from_env() factory."""

    def test_from_env_defaults(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env()
        assert client.server_url == "http://localhost:8080/mcp"
        assert client.agent_id == "unknown-agent"
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_from_env_reads_variables(self) -> None:
        env = {
            "FORGEOS_SERVER_URL": "http://prod:9090/mcp",
            "FORGEOS_AGENT_ID": "Security",
            "FORGEOS_TRANSPORT": "sse",
        }
        with patch.dict(os.environ, env, clear=True):
            client = ForgeOSClient.from_env()
        assert client.server_url == "http://prod:9090/mcp"
        assert client.agent_id == "Security"
        assert client.transport_type == TransportType.SSE

    def test_from_env_with_overrides(self) -> None:
        env = {
            "FORGEOS_SERVER_URL": "http://prod:9090/mcp",
            "FORGEOS_AGENT_ID": "Backend",
        }
        with patch.dict(os.environ, env, clear=True):
            client = ForgeOSClient.from_env(overrides={"agent_id": "QA"})
        assert client.agent_id == "QA"
        assert client.server_url == "http://prod:9090/mcp"

    def test_from_env_override_server_url(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(
                overrides={"server_url": "http://custom:3011/mcp"}
            )
        assert client.server_url == "http://custom:3011/mcp"

    def test_from_env_override_transport(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(overrides={"transport": "stdio"})
        assert client.transport_type == TransportType.STDIO

    def test_from_env_none_overrides(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(overrides=None)
        assert client.server_url == "http://localhost:8080/mcp"


class TestForgeOSClientProperties:
    """Verify client properties are read-only accessors."""

    def test_server_url_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="test",
        )
        assert client.server_url == "http://test:8080/mcp"

    def test_agent_id_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="my-agent",
        )
        assert client.agent_id == "my-agent"

    def test_transport_type_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        assert client.transport_type == TransportType.SSE


# ── Connection lifecycle tests ───────────────────────────────────────


class TestForgeOSClientConnect:
    """Verify connect() behavior."""

    @pytest.mark.asyncio
    async def test_connect_establishes_session(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()

        assert client.is_connected is True
        assert client.connection_state == ConnectionState.CONNECTED
        assert client.session is not None
        assert client.server_capabilities is not None

    @pytest.mark.asyncio
    async def test_connect_when_already_connected_raises(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()

            with pytest.raises(SDKConnectionError, match="Already connected"):
                await client.connect()

    @pytest.mark.asyncio
    async def test_connect_failure_resets_to_disconnected(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
            mode="mcp",
        )
        failing = FailingTransport(fail_count=999)

        with patch("forgeos_sdk.client.create_transport", return_value=failing):
            with pytest.raises(OSError):
                await client.connect()

        assert client.connection_state == ConnectionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_connect_stores_server_capabilities(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()

        assert client.server_capabilities is not None
        assert client.server_capabilities.serverInfo == {"name": "forgeos-test"}


# ── Disconnect tests ─────────────────────────────────────────────────


class TestForgeOSClientDisconnect:
    """Verify disconnect() behavior."""

    @pytest.mark.asyncio
    async def test_disconnect_closes_everything(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()
            await client.disconnect()

        assert client.is_connected is False
        assert client.connection_state == ConnectionState.DISCONNECTED
        assert client.session is None
        assert transport.close_count >= 1

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        await client.disconnect()  # Should not raise
        assert client.connection_state == ConnectionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_disconnect_idempotent(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()
            await client.disconnect()
            await client.disconnect()  # Second call should not raise

        assert client.connection_state == ConnectionState.DISCONNECTED


# ── Reconnect tests ──────────────────────────────────────────────────


class TestForgeOSClientReconnect:
    """Verify reconnect() with exponential backoff."""

    @pytest.mark.asyncio
    async def test_reconnect_succeeds(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            await client.connect()
            # Simulate disconnect
            client._state = ConnectionState.DISCONNECTED
            await client.reconnect()

        assert client.is_connected is True

    @pytest.mark.asyncio
    async def test_reconnect_max_attempts_raises(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        always_fail = FailingTransport(fail_count=999)

        with (
            patch("forgeos_sdk.client.create_transport", return_value=always_fail),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            with pytest.raises(SDKConnectionError, match="Reconnection failed after 3"):
                await client.reconnect(max_attempts=3)

        assert client.connection_state == ConnectionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_reconnect_already_in_progress_raises(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        client._state = ConnectionState.RECONNECTING

        with pytest.raises(SDKConnectionError, match="already in progress"):
            await client.reconnect()

    @pytest.mark.asyncio
    async def test_reconnect_uses_backoff_delay(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        # Fail twice, succeed on third
        call_count = 0

        async def _counting_start() -> tuple[MagicMock, MagicMock]:
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise OSError("refused")
            return MagicMock(), MagicMock()

        transport = FakeTransport()
        transport.start = _counting_start  # type: ignore[assignment]

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
            patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
        ):
            await client.reconnect(max_attempts=5)

        # Should have slept 3 times (once per attempt)
        assert mock_sleep.call_count == 3
        assert client.is_connected is True


# ── Session resumption tests ─────────────────────────────────────────


class TestSessionResumption:
    """Verify session ID tracking and resumption headers."""

    @pytest.mark.asyncio
    async def test_session_id_tracked_from_http_transport(self) -> None:
        from forgeos_sdk.transport import StreamableHttpTransport

        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="streamable-http",
        )
        transport = StreamableHttpTransport(url="http://localhost:8080/mcp")
        transport._get_session_id_fn = lambda: "sess-abc-123"

        async def _fake_start() -> tuple[MagicMock, MagicMock]:
            transport._connected = True
            return MagicMock(), MagicMock()

        transport.start = _fake_start  # type: ignore[assignment]
        transport.close = AsyncMock()  # type: ignore[assignment]

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            await client.connect()

        assert client.session_id == "sess-abc-123"

    @pytest.mark.asyncio
    async def test_session_id_passed_as_header_on_reconnect(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        client._session_id = "prev-session-42"
        transport = FakeTransport()

        with (
            patch(
                "forgeos_sdk.client.create_transport", return_value=transport
            ) as mock_create,
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            await client.reconnect()

        # Verify session ID was passed in headers
        call_kwargs = mock_create.call_args
        headers = call_kwargs.kwargs.get("headers") or {}
        assert headers.get("Mcp-Session-Id") == "prev-session-42"


# ── Backoff calculation tests ────────────────────────────────────────


class TestCalculateBackoff:
    """Verify exponential backoff with jitter."""

    def test_initial_attempt_near_one_second(self) -> None:
        delay = ForgeOSClient._calculate_backoff(0, initial=1.0, jitter_factor=0.0)
        assert delay == 1.0

    def test_second_attempt_doubles(self) -> None:
        delay = ForgeOSClient._calculate_backoff(1, initial=1.0, jitter_factor=0.0)
        assert delay == 2.0

    def test_third_attempt_quadruples(self) -> None:
        delay = ForgeOSClient._calculate_backoff(2, initial=1.0, jitter_factor=0.0)
        assert delay == 4.0

    def test_caps_at_maximum(self) -> None:
        delay = ForgeOSClient._calculate_backoff(
            100, initial=1.0, maximum=30.0, jitter_factor=0.0
        )
        assert delay == 30.0

    def test_jitter_adds_randomness(self) -> None:
        delays = set()
        for _ in range(50):
            d = ForgeOSClient._calculate_backoff(0, initial=1.0, jitter_factor=0.1)
            delays.add(round(d, 4))
        # With jitter, we should get multiple distinct values
        assert len(delays) > 1

    def test_jitter_within_bounds(self) -> None:
        for _ in range(100):
            d = ForgeOSClient._calculate_backoff(
                3, initial=1.0, maximum=30.0, jitter_factor=0.1
            )
            base = min(1.0 * (2**3), 30.0)  # 8.0
            assert base <= d <= base * 1.1

    def test_specific_backoff_sequence(self) -> None:
        expected = [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]
        for attempt, expected_val in enumerate(expected):
            delay = ForgeOSClient._calculate_backoff(
                attempt, initial=1.0, maximum=30.0, jitter_factor=0.0
            )
            assert delay == expected_val, f"attempt {attempt}: {delay} != {expected_val}"


# ── Context manager tests ────────────────────────────────────────────


class TestForgeOSClientContextManager:
    """Verify async context manager behavior."""

    @pytest.mark.asyncio
    async def test_aenter_returns_self(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        async with client as c:
            assert c is client

    @pytest.mark.asyncio
    async def test_aexit_calls_disconnect(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        transport = FakeTransport()

        with (
            patch("forgeos_sdk.client.create_transport", return_value=transport),
            patch("forgeos_sdk.client.ClientSession", side_effect=_fake_session_cm),
        ):
            async with client:
                await client.connect()
                assert client.is_connected is True

        assert client.is_connected is False
        assert client.connection_state == ConnectionState.DISCONNECTED


class TestForgeOSClientPublicAPI:
    """Verify public API exports from __init__.py."""

    def test_import_from_package(self) -> None:
        from forgeos_sdk import ForgeOSClient as Client
        assert Client is ForgeOSClient

    def test_import_exceptions(self) -> None:
        from forgeos_sdk import (
            AuthenticationError,
            ConfigurationError,
            ConnectionError,
            ForgeOSError,
            ToolCallError,
        )
        assert issubclass(ConfigurationError, ForgeOSError)
        assert issubclass(ConnectionError, ForgeOSError)
        assert issubclass(AuthenticationError, ForgeOSError)
        assert issubclass(ToolCallError, ForgeOSError)

    def test_import_config_types(self) -> None:
        from forgeos_sdk import SDKConfig, TransportType
        assert SDKConfig is not None
        assert TransportType.SSE.value == "sse"

    def test_version_available(self) -> None:
        import forgeos_sdk
        assert hasattr(forgeos_sdk, "__version__")
        assert forgeos_sdk.__version__ == "0.1.0"
