"""Tests for agent API key authentication (FORGEOS-BE051).

Covers:
- Key generation and hashing
- API key format validation
- Rate limiting
- Validation with mock database
- Key provisioning and revocation
- Error scenarios (expired, revoked, inactive agent)

.. meta::
   :ticket: FORGEOS-BE051
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.auth.agent_auth import (
    API_KEY_PREFIX,
    AgentIdentity,
    AuthenticationError,
    RateLimiter,
    _extract_prefix,
    create_api_key_for_agent,
    generate_api_key,
    get_rate_limiter,
    hash_api_key,
    revoke_api_key,
    validate_api_key,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """Reset the module-level rate limiter before each test."""
    get_rate_limiter().reset()


def _make_mock_pool(
    rows: list[dict[str, Any]] | None = None,
    *,
    fetchrow_result: dict[str, Any] | None = None,
) -> AsyncMock:
    """Create a mock asyncpg pool that returns the given rows."""
    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=rows or [])
    mock_conn.fetchrow = AsyncMock(return_value=fetchrow_result)
    mock_conn.execute = AsyncMock()

    mock_pool = AsyncMock()
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_ctx)

    return mock_pool


def _make_valid_row(raw_key: str) -> dict[str, Any]:
    """Create a mock row matching a valid API key."""
    key_hash = hash_api_key(raw_key)
    return {
        "key_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "key_hash": key_hash,
        "is_active": True,
        "revoked_at": None,
        "expires_at": None,
        "agent_id": "11111111-2222-3333-4444-555555555555",
        "agent_name": "Backend",
        "agent_role": "backend",
        "permissions": ["tickets.claim", "tickets.complete"],
        "agent_is_active": True,
    }


# ---------------------------------------------------------------------------
# Key Generation & Hashing
# ---------------------------------------------------------------------------


class TestHashApiKey:
    """Tests for hash_api_key function."""

    def test_returns_hex_string(self) -> None:
        result = hash_api_key("fgos_abc123")
        assert isinstance(result, str)
        assert len(result) == 64  # SHA-256 hex

    def test_deterministic(self) -> None:
        key = "fgos_test_key_abc"
        assert hash_api_key(key) == hash_api_key(key)

    def test_different_keys_different_hashes(self) -> None:
        assert hash_api_key("fgos_key_a") != hash_api_key("fgos_key_b")


class TestGenerateApiKey:
    """Tests for generate_api_key function."""

    def test_returns_three_values(self) -> None:
        raw_key, key_hash, key_prefix = generate_api_key()
        assert isinstance(raw_key, str)
        assert isinstance(key_hash, str)
        assert isinstance(key_prefix, str)

    def test_key_starts_with_prefix(self) -> None:
        raw_key, _, _ = generate_api_key()
        assert raw_key.startswith(API_KEY_PREFIX)

    def test_key_length(self) -> None:
        raw_key, _, _ = generate_api_key()
        # fgos_ (5) + 64 hex chars = 69
        assert len(raw_key) == 69

    def test_hash_matches_key(self) -> None:
        raw_key, key_hash, _ = generate_api_key()
        assert hash_api_key(raw_key) == key_hash

    def test_prefix_length(self) -> None:
        _, _, key_prefix = generate_api_key()
        assert len(key_prefix) == 8

    def test_prefix_matches_key_body(self) -> None:
        raw_key, _, key_prefix = generate_api_key()
        body = raw_key.removeprefix(API_KEY_PREFIX)
        assert body.startswith(key_prefix)

    def test_unique_keys(self) -> None:
        keys = {generate_api_key()[0] for _ in range(10)}
        assert len(keys) == 10


class TestExtractPrefix:
    """Tests for _extract_prefix helper."""

    def test_extracts_first_8_chars_after_prefix(self) -> None:
        raw_key = "fgos_abcdef0123456789"
        assert _extract_prefix(raw_key) == "abcdef01"

    def test_works_without_prefix(self) -> None:
        # Should still return first 8 chars of whatever is given
        result = _extract_prefix("xyz12345abcdef")
        assert len(result) == 8


# ---------------------------------------------------------------------------
# Rate Limiter
# ---------------------------------------------------------------------------


class TestRateLimiter:
    """Tests for the RateLimiter class."""

    def test_allows_under_limit(self) -> None:
        limiter = RateLimiter(max_requests=5, window_seconds=60.0)
        for _ in range(5):
            assert limiter.check("prefix01") is True

    def test_blocks_over_limit(self) -> None:
        limiter = RateLimiter(max_requests=3, window_seconds=60.0)
        for _ in range(3):
            limiter.check("prefix01")
        assert limiter.check("prefix01") is False

    def test_separate_prefixes(self) -> None:
        limiter = RateLimiter(max_requests=2, window_seconds=60.0)
        limiter.check("prefix_a")
        limiter.check("prefix_a")
        # prefix_b should still have tokens
        assert limiter.check("prefix_b") is True

    def test_refills_over_time(self) -> None:
        limiter = RateLimiter(max_requests=1, window_seconds=0.1)
        limiter.check("p1")
        assert limiter.check("p1") is False
        # Wait for refill
        time.sleep(0.15)
        assert limiter.check("p1") is True

    def test_reset_clears_state(self) -> None:
        limiter = RateLimiter(max_requests=1, window_seconds=60.0)
        limiter.check("p1")
        assert limiter.check("p1") is False
        limiter.reset()
        assert limiter.check("p1") is True


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class TestValidateApiKey:
    """Tests for validate_api_key function."""

    @pytest.mark.asyncio
    async def test_valid_key_returns_identity(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        pool = _make_mock_pool(rows=[row])

        identity = await validate_api_key(pool, raw_key)

        assert isinstance(identity, AgentIdentity)
        assert identity.agent_id == str(row["agent_id"])
        assert identity.agent_name == "Backend"
        assert identity.role == "backend"
        assert identity.permissions == ["tickets.claim", "tickets.complete"]

    @pytest.mark.asyncio
    async def test_empty_key_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(AuthenticationError, match="Invalid API key format"):
            await validate_api_key(pool, "")

    @pytest.mark.asyncio
    async def test_wrong_prefix_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(AuthenticationError, match="Invalid API key format"):
            await validate_api_key(pool, "bad_prefix_key")

    @pytest.mark.asyncio
    async def test_key_not_found_raises(self) -> None:
        pool = _make_mock_pool(rows=[])
        raw_key, _, _ = generate_api_key()
        with pytest.raises(AuthenticationError, match="Invalid API key"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_hash_mismatch_raises(self) -> None:
        raw_key, _, _ = generate_api_key()
        # Create a row with a different key's hash
        other_key, _, _ = generate_api_key()
        row = _make_valid_row(other_key)
        pool = _make_mock_pool(rows=[row])

        with pytest.raises(AuthenticationError, match="Invalid API key"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_revoked_key_raises(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        row["is_active"] = False
        pool = _make_mock_pool(rows=[row])

        with pytest.raises(AuthenticationError, match="revoked"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_revoked_at_set_raises(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        row["revoked_at"] = "2026-01-01T00:00:00Z"
        pool = _make_mock_pool(rows=[row])

        with pytest.raises(AuthenticationError, match="revoked"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_expired_key_raises(self) -> None:
        import datetime

        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        # Set expired timestamp
        row["expires_at"] = datetime.datetime(
            2020, 1, 1, tzinfo=datetime.timezone.utc
        )
        pool = _make_mock_pool(rows=[row])

        with pytest.raises(AuthenticationError, match="expired"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_inactive_agent_raises(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        row["agent_is_active"] = False
        pool = _make_mock_pool(rows=[row])

        with pytest.raises(AuthenticationError, match="inactive"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_rate_limited_raises(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        pool = _make_mock_pool(rows=[row])

        # Exhaust rate limit
        limiter = get_rate_limiter()
        prefix = _extract_prefix(raw_key)
        rl = RateLimiter(max_requests=1, window_seconds=60.0)
        rl.check(prefix)  # consume the one allowed

        # Patch module-level limiter
        with patch("mcp_server.auth.agent_auth._rate_limiter", rl):
            with pytest.raises(AuthenticationError, match="Rate limit"):
                await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_database_error_raises_auth_error(self) -> None:
        raw_key, _, _ = generate_api_key()
        pool = AsyncMock()
        mock_ctx = AsyncMock()
        mock_conn = AsyncMock()
        mock_conn.fetch = AsyncMock(side_effect=Exception("connection refused"))
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        pool.acquire = MagicMock(return_value=mock_ctx)

        with pytest.raises(AuthenticationError, match="unavailable"):
            await validate_api_key(pool, raw_key)

    @pytest.mark.asyncio
    async def test_updates_last_used(self) -> None:
        raw_key, _, _ = generate_api_key()
        row = _make_valid_row(raw_key)
        pool = _make_mock_pool(rows=[row])

        await validate_api_key(pool, raw_key)

        # Verify execute was called for last_used_at update
        mock_conn = pool.acquire.return_value.__aenter__.return_value
        mock_conn.execute.assert_called_once()


# ---------------------------------------------------------------------------
# Key Provisioning
# ---------------------------------------------------------------------------


class TestCreateApiKeyForAgent:
    """Tests for create_api_key_for_agent function."""

    @pytest.mark.asyncio
    async def test_creates_key_and_returns_raw(self) -> None:
        agent_id = "11111111-2222-3333-4444-555555555555"
        pool = _make_mock_pool(
            fetchrow_result={"id": agent_id, "name": "Backend"}
        )

        raw_key = await create_api_key_for_agent(pool, agent_id)

        assert raw_key.startswith(API_KEY_PREFIX)
        assert len(raw_key) == 69

    @pytest.mark.asyncio
    async def test_agent_not_found_raises(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        with pytest.raises(AuthenticationError, match="Agent not found"):
            await create_api_key_for_agent(pool, "nonexistent-id")


class TestRevokeApiKey:
    """Tests for revoke_api_key function."""

    @pytest.mark.asyncio
    async def test_revokes_existing_key(self) -> None:
        pool = _make_mock_pool(
            fetchrow_result={"id": "some-key-id"}
        )

        result = await revoke_api_key(pool, "abc12345")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_for_missing_key(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)

        result = await revoke_api_key(pool, "nonexist")
        assert result is False


# ---------------------------------------------------------------------------
# AgentIdentity
# ---------------------------------------------------------------------------


class TestAgentIdentity:
    """Tests for the AgentIdentity dataclass."""

    def test_frozen(self) -> None:
        identity = AgentIdentity(
            agent_id="id", agent_name="Test", role="test"
        )
        with pytest.raises(AttributeError):
            identity.agent_name = "Modified"  # type: ignore[misc]

    def test_default_permissions(self) -> None:
        identity = AgentIdentity(
            agent_id="id", agent_name="Test", role="test"
        )
        assert identity.permissions == []

    def test_with_permissions(self) -> None:
        identity = AgentIdentity(
            agent_id="id",
            agent_name="Test",
            role="test",
            permissions=["read", "write"],
        )
        assert identity.permissions == ["read", "write"]


# ---------------------------------------------------------------------------
# AuthenticationError
# ---------------------------------------------------------------------------


class TestAuthenticationError:
    """Tests for the AuthenticationError class."""

    def test_inherits_forgeos_error(self) -> None:
        from mcp_server.server import ForgeOSError

        err = AuthenticationError("test")
        assert isinstance(err, ForgeOSError)

    def test_error_code(self) -> None:
        err = AuthenticationError("test")
        assert err.error_code == -32602

    def test_status_code(self) -> None:
        err = AuthenticationError("test")
        assert err.status_code == 401

    def test_details(self) -> None:
        err = AuthenticationError("msg", details={"key": "value"})
        assert err.details == {"key": "value"}
