"""Operator token authentication for the ForgeOS MCP Server.

Implements JWT-based token generation, validation, and refresh for
human operators accessing the REST API / dashboard.  Operator
credentials (bcrypt-hashed passwords) are stored in the ``operators``
table created by migration 002.

Architecture
------------
* **JWT tokens** — signed with HS256 using a server-side secret.
  Payload contains ``operator_id``, ``name``, ``role``, and ``exp``.
* **bcrypt password hashing** — passwords are hashed with bcrypt
  before storage.  Work factor is configurable (default 12).
* **Configurable expiry** — default 8 hours, overridable via
  ``FORGEOS_TOKEN_EXPIRY_HOURS`` env var.
* **Token refresh** — extends session without re-authentication by
  issuing a new token from a valid (non-expired) existing token.
* **Structured logging** — all auth events logged via the ForgeOS
  structured logger; never logs passwords or full tokens.

Security
--------
* Passwords are hashed with bcrypt (adaptive cost factor).
* JWT secret must be set via ``FORGEOS_JWT_SECRET`` env var in production.
* Tokens are validated with signature verification and expiry checking.
* Failed authentication attempts are logged with operator name only.
* Token prefix (first 8 chars) logged for audit; never the full token.

.. meta::
   :ticket: FORGEOS-BE053
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any

import bcrypt
import jwt

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, ForgeOSError

logger = get_logger("operator_auth")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_TOKEN_EXPIRY_HOURS: int = 8
"""Default token expiry in hours."""

DEFAULT_BCRYPT_ROUNDS: int = 12
"""Default bcrypt work factor."""

JWT_ALGORITHM: str = "HS256"
"""JWT signing algorithm."""

DEFAULT_JWT_SECRET: str = "forgeos-dev-secret-change-in-production"
"""Fallback JWT secret for local development only."""


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class OperatorIdentity:
    """Authenticated operator descriptor returned on successful validation.

    Attributes
    ----------
    operator_id : str
        UUID of the operator record.
    name : str
        Human-readable operator name.
    role : str
        Operator role (e.g. ``"admin"``, ``"viewer"``).
    """

    operator_id: str
    name: str
    role: str


@dataclass(frozen=True, slots=True)
class TokenPayload:
    """Decoded JWT token payload.

    Attributes
    ----------
    operator_id : str
        UUID of the operator.
    name : str
        Operator name.
    role : str
        Operator role.
    exp : datetime.datetime
        Token expiry timestamp.
    iat : datetime.datetime
        Token issued-at timestamp.
    """

    operator_id: str
    name: str
    role: str
    exp: datetime.datetime
    iat: datetime.datetime


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class OperatorAuthenticationError(ForgeOSError):
    """Raised when operator authentication fails.

    Covers invalid credentials, expired tokens, and malformed tokens.
    """

    error_code: int = INVALID_PARAMS
    status_code: int = 401


class TokenExpiredError(OperatorAuthenticationError):
    """Raised when a JWT token has expired."""

    status_code: int = 401


class TokenInvalidError(OperatorAuthenticationError):
    """Raised when a JWT token is malformed or has an invalid signature."""

    status_code: int = 401


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(plain_password: str, *, rounds: int = DEFAULT_BCRYPT_ROUNDS) -> str:
    """Hash a plaintext password using bcrypt.

    Parameters
    ----------
    plain_password : str
        The plaintext password to hash.
    rounds : int
        Bcrypt work factor (log2 of iterations).

    Returns
    -------
    str
        Bcrypt hash string suitable for database storage.

    Raises
    ------
    OperatorAuthenticationError
        If the password is empty.
    """
    if not plain_password:
        raise OperatorAuthenticationError(
            "Password must not be empty",
            details={"reason": "empty_password"},
        )
    salt = bcrypt.gensalt(rounds=rounds)
    hashed = bcrypt.hashpw(plain_password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash.

    Parameters
    ----------
    plain_password : str
        The plaintext password to verify.
    hashed_password : str
        The bcrypt hash from the database.

    Returns
    -------
    bool
        ``True`` if the password matches, ``False`` otherwise.
    """
    if not plain_password or not hashed_password:
        return False
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8"),
    )


# ---------------------------------------------------------------------------
# Token generation
# ---------------------------------------------------------------------------


def generate_token(
    operator: OperatorIdentity,
    jwt_secret: str,
    *,
    expiry_hours: int = DEFAULT_TOKEN_EXPIRY_HOURS,
) -> str:
    """Generate a JWT bearer token for an authenticated operator.

    The token payload contains ``operator_id``, ``name``, ``role``,
    ``exp`` (expiry), and ``iat`` (issued-at).

    Parameters
    ----------
    operator : OperatorIdentity
        The authenticated operator.
    jwt_secret : str
        Secret key for signing the JWT.
    expiry_hours : int
        Token validity duration in hours.

    Returns
    -------
    str
        Encoded JWT token string.

    Raises
    ------
    OperatorAuthenticationError
        If the JWT secret is empty.
    """
    if not jwt_secret:
        raise OperatorAuthenticationError(
            "JWT secret must not be empty",
            details={"reason": "missing_jwt_secret"},
        )

    now = datetime.datetime.now(datetime.timezone.utc)
    expiry = now + datetime.timedelta(hours=expiry_hours)

    payload: dict[str, Any] = {
        "operator_id": operator.operator_id,
        "name": operator.name,
        "role": operator.role,
        "exp": expiry,
        "iat": now,
    }

    token: str = jwt.encode(payload, jwt_secret, algorithm=JWT_ALGORITHM)

    logger.info(
        "token_generated",
        extra={
            "operator_id": operator.operator_id,
            "operator_name": operator.name,
            "expiry": expiry.isoformat(),
        },
    )

    return token


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------


def validate_token(
    token: str,
    jwt_secret: str,
) -> TokenPayload:
    """Validate a JWT bearer token and extract the operator identity.

    Parameters
    ----------
    token : str
        The JWT token string (without ``Bearer `` prefix).
    jwt_secret : str
        Secret key used to verify the JWT signature.

    Returns
    -------
    TokenPayload
        Decoded token payload with operator identity and timestamps.

    Raises
    ------
    TokenExpiredError
        If the token has expired.
    TokenInvalidError
        If the token is malformed or the signature is invalid.
    """
    if not token:
        raise TokenInvalidError(
            "Token must not be empty",
            details={"reason": "empty_token"},
        )

    try:
        decoded: dict[str, Any] = jwt.decode(
            token,
            jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat", "operator_id", "name", "role"]},
        )
    except jwt.ExpiredSignatureError as exc:
        logger.warning("token_expired", extra={"token_prefix": token[:8]})
        raise TokenExpiredError(
            "Token has expired",
            details={"reason": "token_expired"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        logger.warning(
            "token_invalid",
            extra={"token_prefix": token[:8], "error": str(exc)},
        )
        raise TokenInvalidError(
            "Invalid token",
            details={"reason": "invalid_token"},
        ) from exc

    exp_dt = datetime.datetime.fromtimestamp(
        decoded["exp"], tz=datetime.timezone.utc
    )
    iat_dt = datetime.datetime.fromtimestamp(
        decoded["iat"], tz=datetime.timezone.utc
    )

    return TokenPayload(
        operator_id=decoded["operator_id"],
        name=decoded["name"],
        role=decoded["role"],
        exp=exp_dt,
        iat=iat_dt,
    )


def extract_operator_identity(
    token: str,
    jwt_secret: str,
) -> OperatorIdentity:
    """Extract operator identity from a valid JWT token.

    Convenience wrapper around :func:`validate_token` that returns
    an :class:`OperatorIdentity` instead of the full payload.
    """
    payload = validate_token(token, jwt_secret)
    return OperatorIdentity(
        operator_id=payload.operator_id,
        name=payload.name,
        role=payload.role,
    )


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------


def refresh_token(
    token: str,
    jwt_secret: str,
    *,
    expiry_hours: int = DEFAULT_TOKEN_EXPIRY_HOURS,
) -> str:
    """Refresh a valid JWT token, extending the session.

    Issues a new token with a fresh expiry timestamp without
    requiring re-authentication.  The original token must still
    be valid (not expired).

    Parameters
    ----------
    token : str
        The current valid JWT token.
    jwt_secret : str
        Secret key for JWT signing/verification.
    expiry_hours : int
        New token validity duration in hours.

    Returns
    -------
    str
        A new JWT token with extended expiry.

    Raises
    ------
    TokenExpiredError
        If the current token has expired.
    TokenInvalidError
        If the current token is malformed.
    """
    payload = validate_token(token, jwt_secret)

    operator = OperatorIdentity(
        operator_id=payload.operator_id,
        name=payload.name,
        role=payload.role,
    )

    new_token = generate_token(operator, jwt_secret, expiry_hours=expiry_hours)

    logger.info(
        "token_refreshed",
        extra={
            "operator_id": operator.operator_id,
            "operator_name": operator.name,
        },
    )

    return new_token


# ---------------------------------------------------------------------------
# Bearer token extraction
# ---------------------------------------------------------------------------


def extract_bearer_token(authorization_header: str) -> str:
    """Extract the token from an HTTP Authorization header.

    Parameters
    ----------
    authorization_header : str
        The full ``Authorization`` header value (e.g. ``"Bearer <token>"``).

    Returns
    -------
    str
        The extracted token string.

    Raises
    ------
    TokenInvalidError
        If the header is missing, empty, or not in ``Bearer <token>`` format.
    """
    if not authorization_header:
        raise TokenInvalidError(
            "Missing Authorization header",
            details={"reason": "missing_authorization"},
        )

    parts = authorization_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise TokenInvalidError(
            "Authorization header must use Bearer scheme",
            details={"reason": "invalid_scheme"},
        )

    token = parts[1].strip()
    if not token:
        raise TokenInvalidError(
            "Bearer token is empty",
            details={"reason": "empty_bearer_token"},
        )

    return token
