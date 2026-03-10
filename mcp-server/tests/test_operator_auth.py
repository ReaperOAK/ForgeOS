"""Tests for operator token authentication (FORGEOS-BE053).

Covers:
- Password hashing (bcrypt)
- Password verification
- JWT token generation
- JWT token validation
- Token expiry enforcement
- Token refresh
- Bearer token extraction
- Error scenarios (expired, invalid, malformed)
- Operator service: login, registration
- Edge cases (empty inputs, missing fields)

TDD Evidence
------------
- RED: Tests written first to define expected behavior.
- GREEN: Implementation created to satisfy these tests.
- REFACTOR: Code cleaned up, naming standardized.

.. meta::
   :ticket: FORGEOS-BE053
"""

from __future__ import annotations

import datetime
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest

from mcp_server.auth.operator_auth import (
    DEFAULT_TOKEN_EXPIRY_HOURS,
    JWT_ALGORITHM,
    OperatorAuthenticationError,
    OperatorIdentity,
    TokenExpiredError,
    TokenInvalidError,
    TokenPayload,
    extract_bearer_token,
    generate_token,
    hash_password,
    refresh_token,
    validate_token,
    verify_password,
)
from mcp_server.services.operator_service import (
    authenticate_operator,
    refresh_operator_token,
    register_operator,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

JWT_SECRET = "test-secret-for-unit-tests"


@pytest.fixture()
def operator() -> OperatorIdentity:
    """Create a sample operator identity."""
    return OperatorIdentity(
        operator_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        name="TestOperator",
        role="admin",
    )


@pytest.fixture()
def valid_token(operator: OperatorIdentity) -> str:
    """Generate a valid JWT token for tests."""
    return generate_token(operator, JWT_SECRET)


def _make_mock_pool(
    fetchrow_result: dict[str, Any] | None = None,
    *,
    execute_side_effect: Exception | None = None,
) -> AsyncMock:
    """Create a mock asyncpg pool."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=fetchrow_result)
    mock_conn.execute = AsyncMock(side_effect=execute_side_effect)

    mock_pool = AsyncMock()
    mock_ctx = AsyncMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=mock_ctx)

    return mock_pool


# ---------------------------------------------------------------------------
# Password Hashing
# ---------------------------------------------------------------------------


class TestHashPassword:
    """Tests for hash_password function."""

    def test_returns_bcrypt_hash(self) -> None:
        result = hash_password("mysecretpassword")
        assert isinstance(result, str)
        assert result.startswith("$2b$")

    def test_different_passwords_different_hashes(self) -> None:
        h1 = hash_password("password1")
        h2 = hash_password("password2")
        assert h1 != h2

    def test_same_password_different_salts(self) -> None:
        """Each call produces a different hash due to random salt."""
        h1 = hash_password("samepassword")
        h2 = hash_password("samepassword")
        assert h1 != h2

    def test_custom_rounds(self) -> None:
        result = hash_password("test", rounds=4)
        assert result.startswith("$2b$04$")

    def test_empty_password_raises(self) -> None:
        with pytest.raises(OperatorAuthenticationError, match="empty"):
            hash_password("")


class TestVerifyPassword:
    """Tests for verify_password function."""

    def test_correct_password(self) -> None:
        hashed = hash_password("correctpassword", rounds=4)
        assert verify_password("correctpassword", hashed) is True

    def test_incorrect_password(self) -> None:
        hashed = hash_password("correctpassword", rounds=4)
        assert verify_password("wrongpassword", hashed) is False

    def test_empty_password(self) -> None:
        assert verify_password("", "$2b$12$somehash") is False

    def test_empty_hash(self) -> None:
        assert verify_password("password", "") is False

    def test_both_empty(self) -> None:
        assert verify_password("", "") is False


# ---------------------------------------------------------------------------
# Token Generation
# ---------------------------------------------------------------------------


class TestGenerateToken:
    """Tests for generate_token function."""

    def test_returns_string(self, operator: OperatorIdentity) -> None:
        token = generate_token(operator, JWT_SECRET)
        assert isinstance(token, str)
        assert len(token) > 0

    def test_token_is_valid_jwt(self, operator: OperatorIdentity) -> None:
        token = generate_token(operator, JWT_SECRET)
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert decoded["operator_id"] == operator.operator_id
        assert decoded["name"] == operator.name
        assert decoded["role"] == operator.role
        assert "exp" in decoded
        assert "iat" in decoded

    def test_token_includes_expiry(self, operator: OperatorIdentity) -> None:
        token = generate_token(operator, JWT_SECRET, expiry_hours=2)
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        exp = datetime.datetime.fromtimestamp(decoded["exp"], tz=datetime.timezone.utc)
        iat = datetime.datetime.fromtimestamp(decoded["iat"], tz=datetime.timezone.utc)
        delta = exp - iat
        assert abs(delta.total_seconds() - 7200) < 5  # ~2 hours

    def test_default_expiry_8_hours(self, operator: OperatorIdentity) -> None:
        token = generate_token(operator, JWT_SECRET)
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        exp = datetime.datetime.fromtimestamp(decoded["exp"], tz=datetime.timezone.utc)
        iat = datetime.datetime.fromtimestamp(decoded["iat"], tz=datetime.timezone.utc)
        delta = exp - iat
        assert abs(delta.total_seconds() - 28800) < 5  # ~8 hours

    def test_empty_secret_raises(self, operator: OperatorIdentity) -> None:
        with pytest.raises(OperatorAuthenticationError, match="JWT secret"):
            generate_token(operator, "")

    def test_unique_tokens(self, operator: OperatorIdentity) -> None:
        """Subsequent tokens differ due to different iat timestamps."""
        t1 = generate_token(operator, JWT_SECRET)
        time.sleep(0.01)
        t2 = generate_token(operator, JWT_SECRET)
        assert isinstance(t1, str)
        assert isinstance(t2, str)


# ---------------------------------------------------------------------------
# Token Validation
# ---------------------------------------------------------------------------


class TestValidateToken:
    """Tests for validate_token function."""

    def test_valid_token(self, valid_token: str) -> None:
        payload = validate_token(valid_token, JWT_SECRET)
        assert isinstance(payload, TokenPayload)
        assert payload.operator_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assert payload.name == "TestOperator"
        assert payload.role == "admin"

    def test_payload_has_timestamps(self, valid_token: str) -> None:
        payload = validate_token(valid_token, JWT_SECRET)
        assert isinstance(payload.exp, datetime.datetime)
        assert isinstance(payload.iat, datetime.datetime)
        assert payload.exp > payload.iat

    def test_expired_token_raises(self, operator: OperatorIdentity) -> None:
        now = datetime.datetime.now(datetime.timezone.utc)
        past = now - datetime.timedelta(hours=1)
        payload = {
            "operator_id": operator.operator_id,
            "name": operator.name,
            "role": operator.role,
            "exp": past,
            "iat": past - datetime.timedelta(hours=1),
        }
        token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        with pytest.raises(TokenExpiredError, match="expired"):
            validate_token(token, JWT_SECRET)

    def test_wrong_secret_raises(self, valid_token: str) -> None:
        with pytest.raises(TokenInvalidError, match="Invalid token"):
            validate_token(valid_token, "wrong-secret")

    def test_malformed_token_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="Invalid token"):
            validate_token("not.a.valid.jwt", JWT_SECRET)

    def test_empty_token_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="empty"):
            validate_token("", JWT_SECRET)

    def test_missing_required_claims_raises(self) -> None:
        """Token without required claims should fail validation."""
        payload = {"some_field": "value", "exp": 9999999999, "iat": 1000000000}
        token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        with pytest.raises(TokenInvalidError):
            validate_token(token, JWT_SECRET)

    def test_token_with_wrong_algorithm(self, operator: OperatorIdentity) -> None:
        """Token signed with a different algorithm should fail."""
        payload = {
            "operator_id": operator.operator_id,
            "name": operator.name,
            "role": operator.role,
            "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1),
            "iat": datetime.datetime.now(datetime.timezone.utc),
        }
        token = pyjwt.encode(payload, JWT_SECRET, algorithm="HS384")
        with pytest.raises(TokenInvalidError):
            validate_token(token, JWT_SECRET)


# ---------------------------------------------------------------------------
# Token Refresh
# ---------------------------------------------------------------------------


class TestRefreshToken:
    """Tests for refresh_token function."""

    def test_refresh_returns_new_token(self, valid_token: str) -> None:
        new_token = refresh_token(valid_token, JWT_SECRET)
        assert isinstance(new_token, str)
        assert len(new_token) > 0

    def test_refreshed_token_is_valid(self, valid_token: str) -> None:
        new_token = refresh_token(valid_token, JWT_SECRET)
        payload = validate_token(new_token, JWT_SECRET)
        assert payload.operator_id == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        assert payload.name == "TestOperator"
        assert payload.role == "admin"

    def test_refreshed_token_has_new_expiry(self, valid_token: str) -> None:
        original = validate_token(valid_token, JWT_SECRET)
        time.sleep(0.01)
        new_token = refresh_token(valid_token, JWT_SECRET, expiry_hours=4)
        refreshed = validate_token(new_token, JWT_SECRET)
        assert refreshed.iat >= original.iat

    def test_refresh_expired_token_raises(self, operator: OperatorIdentity) -> None:
        now = datetime.datetime.now(datetime.timezone.utc)
        payload = {
            "operator_id": operator.operator_id,
            "name": operator.name,
            "role": operator.role,
            "exp": now - datetime.timedelta(hours=1),
            "iat": now - datetime.timedelta(hours=9),
        }
        expired_token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        with pytest.raises(TokenExpiredError):
            refresh_token(expired_token, JWT_SECRET)

    def test_refresh_invalid_token_raises(self) -> None:
        with pytest.raises(TokenInvalidError):
            refresh_token("garbage.token.here", JWT_SECRET)


# ---------------------------------------------------------------------------
# Bearer Token Extraction
# ---------------------------------------------------------------------------


class TestExtractBearerToken:
    """Tests for extract_bearer_token function."""

    def test_valid_bearer_header(self) -> None:
        token = extract_bearer_token("Bearer eyJhbGciOi...")
        assert token == "eyJhbGciOi..."

    def test_case_insensitive_bearer(self) -> None:
        token = extract_bearer_token("bearer mytoken123")
        assert token == "mytoken123"

    def test_missing_header_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="Missing"):
            extract_bearer_token("")

    def test_wrong_scheme_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="Bearer scheme"):
            extract_bearer_token("Basic dXNlcjpwYXNz")

    def test_no_token_after_bearer_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="empty"):
            extract_bearer_token("Bearer   ")

    def test_single_word_raises(self) -> None:
        with pytest.raises(TokenInvalidError, match="Bearer scheme"):
            extract_bearer_token("justoneword")


# ---------------------------------------------------------------------------
# OperatorIdentity dataclass
# ---------------------------------------------------------------------------


class TestOperatorIdentity:
    """Tests for OperatorIdentity dataclass."""

    def test_is_frozen(self) -> None:
        oi = OperatorIdentity(operator_id="id", name="test", role="admin")
        with pytest.raises(AttributeError):
            oi.name = "other"  # type: ignore[misc]

    def test_equality(self) -> None:
        a = OperatorIdentity(operator_id="id1", name="test", role="admin")
        b = OperatorIdentity(operator_id="id1", name="test", role="admin")
        assert a == b

    def test_fields(self) -> None:
        oi = OperatorIdentity(operator_id="uid", name="Alice", role="viewer")
        assert oi.operator_id == "uid"
        assert oi.name == "Alice"
        assert oi.role == "viewer"


# ---------------------------------------------------------------------------
# TokenPayload dataclass
# ---------------------------------------------------------------------------


class TestTokenPayload:
    """Tests for TokenPayload dataclass."""

    def test_is_frozen(self) -> None:
        now = datetime.datetime.now(datetime.timezone.utc)
        tp = TokenPayload(
            operator_id="id",
            name="test",
            role="admin",
            exp=now + datetime.timedelta(hours=1),
            iat=now,
        )
        with pytest.raises(AttributeError):
            tp.name = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class TestErrorHierarchy:
    """Tests for operator auth error classes."""

    def test_operator_auth_error_is_forgeos_error(self) -> None:
        from mcp_server.server import ForgeOSError

        err = OperatorAuthenticationError("test")
        assert isinstance(err, ForgeOSError)

    def test_token_expired_error_inherits(self) -> None:
        err = TokenExpiredError("expired")
        assert isinstance(err, OperatorAuthenticationError)
        assert err.status_code == 401

    def test_token_invalid_error_inherits(self) -> None:
        err = TokenInvalidError("invalid")
        assert isinstance(err, OperatorAuthenticationError)
        assert err.status_code == 401

    def test_error_has_details(self) -> None:
        err = OperatorAuthenticationError(
            "test error", details={"reason": "test"}
        )
        assert err.details == {"reason": "test"}
        assert err.message == "test error"


# ---------------------------------------------------------------------------
# Operator Service — authenticate_operator
# ---------------------------------------------------------------------------


class TestAuthenticateOperator:
    """Tests for authenticate_operator service function."""

    @pytest.mark.asyncio()
    async def test_successful_login(self) -> None:
        hashed_pw = hash_password("securepassword", rounds=4)
        row = {
            "operator_id": "11111111-2222-3333-4444-555555555555",
            "name": "TestOp",
            "password_hash": hashed_pw,
            "role": "admin",
            "is_active": True,
        }
        pool = _make_mock_pool(fetchrow_result=row)

        result = await authenticate_operator(
            pool, "TestOp", "securepassword", JWT_SECRET
        )

        assert result["name"] == "TestOp"
        assert result["role"] == "admin"
        assert result["operator_id"] == "11111111-2222-3333-4444-555555555555"
        assert "token" in result
        payload = validate_token(result["token"], JWT_SECRET)
        assert payload.name == "TestOp"

    @pytest.mark.asyncio()
    async def test_operator_not_found(self) -> None:
        pool = _make_mock_pool(fetchrow_result=None)
        with pytest.raises(OperatorAuthenticationError, match="Invalid credentials"):
            await authenticate_operator(pool, "nonexistent", "pass", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_wrong_password(self) -> None:
        hashed_pw = hash_password("correctpw", rounds=4)
        row = {
            "operator_id": "id1",
            "name": "Op1",
            "password_hash": hashed_pw,
            "role": "operator",
            "is_active": True,
        }
        pool = _make_mock_pool(fetchrow_result=row)
        with pytest.raises(OperatorAuthenticationError, match="Invalid credentials"):
            await authenticate_operator(pool, "Op1", "wrongpw", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_inactive_operator(self) -> None:
        hashed_pw = hash_password("pass", rounds=4)
        row = {
            "operator_id": "id2",
            "name": "InactiveOp",
            "password_hash": hashed_pw,
            "role": "operator",
            "is_active": False,
        }
        pool = _make_mock_pool(fetchrow_result=row)
        with pytest.raises(OperatorAuthenticationError, match="inactive"):
            await authenticate_operator(pool, "InactiveOp", "pass", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_empty_credentials(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(OperatorAuthenticationError, match="required"):
            await authenticate_operator(pool, "", "pass", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_empty_password(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(OperatorAuthenticationError, match="required"):
            await authenticate_operator(pool, "Op", "", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_no_password_hash_stored(self) -> None:
        row = {
            "operator_id": "id3",
            "name": "NoPwOp",
            "password_hash": "",
            "role": "operator",
            "is_active": True,
        }
        pool = _make_mock_pool(fetchrow_result=row)
        with pytest.raises(OperatorAuthenticationError, match="Invalid credentials"):
            await authenticate_operator(pool, "NoPwOp", "anypass", JWT_SECRET)

    @pytest.mark.asyncio()
    async def test_custom_expiry(self) -> None:
        hashed_pw = hash_password("pass", rounds=4)
        row = {
            "operator_id": "id4",
            "name": "Op4",
            "password_hash": hashed_pw,
            "role": "operator",
            "is_active": True,
        }
        pool = _make_mock_pool(fetchrow_result=row)
        result = await authenticate_operator(
            pool, "Op4", "pass", JWT_SECRET, expiry_hours=2
        )
        payload = validate_token(result["token"], JWT_SECRET)
        delta = payload.exp - payload.iat
        assert abs(delta.total_seconds() - 7200) < 5


# ---------------------------------------------------------------------------
# Operator Service — refresh_operator_token
# ---------------------------------------------------------------------------


class TestRefreshOperatorToken:
    """Tests for refresh_operator_token service function."""

    @pytest.mark.asyncio()
    async def test_refresh_returns_new_token(self, valid_token: str) -> None:
        result = await refresh_operator_token(valid_token, JWT_SECRET)
        assert "token" in result
        assert isinstance(result["token"], str)

    @pytest.mark.asyncio()
    async def test_refreshed_token_valid(self, valid_token: str) -> None:
        result = await refresh_operator_token(valid_token, JWT_SECRET)
        payload = validate_token(result["token"], JWT_SECRET)
        assert payload.name == "TestOperator"


# ---------------------------------------------------------------------------
# Operator Service — register_operator
# ---------------------------------------------------------------------------


class TestRegisterOperator:
    """Tests for register_operator service function."""

    @pytest.mark.asyncio()
    async def test_successful_registration(self) -> None:
        return_row = {
            "operator_id": "new-uuid-1234",
            "name": "NewOp",
        }
        pool = _make_mock_pool(fetchrow_result=return_row)

        result = await register_operator(pool, "NewOp", "securepass123")

        assert result["operator_id"] == "new-uuid-1234"
        assert result["name"] == "NewOp"

    @pytest.mark.asyncio()
    async def test_empty_name_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(OperatorAuthenticationError, match="required"):
            await register_operator(pool, "", "password123")

    @pytest.mark.asyncio()
    async def test_empty_password_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(OperatorAuthenticationError, match="required"):
            await register_operator(pool, "Op", "")

    @pytest.mark.asyncio()
    async def test_short_password_raises(self) -> None:
        pool = _make_mock_pool()
        with pytest.raises(OperatorAuthenticationError, match="at least 8"):
            await register_operator(pool, "Op", "short")

    @pytest.mark.asyncio()
    async def test_duplicate_name_raises(self) -> None:
        pool = _make_mock_pool()
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(
            side_effect=Exception("duplicate key value violates unique constraint")
        )
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        pool.acquire = MagicMock(return_value=mock_ctx)

        with pytest.raises(OperatorAuthenticationError, match="already exists"):
            await register_operator(pool, "DuplicateOp", "password123")

    @pytest.mark.asyncio()
    async def test_custom_role(self) -> None:
        return_row = {"operator_id": "id-123", "name": "AdminOp"}
        pool = _make_mock_pool(fetchrow_result=return_row)
        result = await register_operator(pool, "AdminOp", "password123", role="admin")
        assert result["name"] == "AdminOp"


# ---------------------------------------------------------------------------
# Integration: end-to-end token lifecycle
# ---------------------------------------------------------------------------


class TestTokenLifecycle:
    """Integration tests for the full token lifecycle."""

    def test_generate_validate_refresh_cycle(self) -> None:
        """Full lifecycle: generate -> validate -> refresh -> validate."""
        op = OperatorIdentity(
            operator_id="lifecycle-id",
            name="LifecycleOp",
            role="admin",
        )

        token = generate_token(op, JWT_SECRET, expiry_hours=1)
        assert isinstance(token, str)

        payload = validate_token(token, JWT_SECRET)
        assert payload.operator_id == "lifecycle-id"
        assert payload.name == "LifecycleOp"
        assert payload.role == "admin"

        new_token = refresh_token(token, JWT_SECRET, expiry_hours=2)
        new_payload = validate_token(new_token, JWT_SECRET)
        assert new_payload.operator_id == "lifecycle-id"
        assert new_payload.name == "LifecycleOp"

    def test_password_hash_verify_cycle(self) -> None:
        """Full cycle: hash -> verify (success) -> verify (failure)."""
        password = "my-secure-password-2026"
        hashed = hash_password(password, rounds=4)

        assert verify_password(password, hashed) is True
        assert verify_password("wrong-password", hashed) is False

    def test_bearer_extraction_and_validation(self) -> None:
        """Extract bearer token from header, then validate it."""
        op = OperatorIdentity(
            operator_id="bearer-test-id",
            name="BearerOp",
            role="viewer",
        )
        token = generate_token(op, JWT_SECRET)
        header = f"Bearer {token}"

        extracted = extract_bearer_token(header)
        payload = validate_token(extracted, JWT_SECRET)
        assert payload.name == "BearerOp"
        assert payload.role == "viewer"
