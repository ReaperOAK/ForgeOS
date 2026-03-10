"""ForgeOS Authentication — agent API keys, machine registration, and operator token auth.

Provides API key authentication for agents, machine identity registration
and verification, and JWT-based token authentication for human operators.

Public API
----------
Agent auth (FORGEOS-BE051):
- :class:`AgentIdentity` — authenticated agent descriptor.
- :class:`AuthenticationError` — raised on invalid/expired/revoked keys.
- :func:`validate_api_key` — validate a key and return agent identity.
- :func:`generate_api_key` — create a new API key for an agent.
- :func:`hash_api_key` — SHA-256 hash a raw API key.

Machine auth (FORGEOS-BE052) — via ``mcp_server.auth.machine_auth``:
- :class:`~machine_auth.MachineIdentity` — immutable machine descriptor.
- :class:`~machine_auth.MachineRegistrationMode` — AUTO or STRICT mode enum.
- :class:`~machine_auth.MachineAuthError` — raised on verification failure (403).
- :func:`~machine_auth.register_machine` — register or upsert a machine.
- :func:`~machine_auth.verify_machine` — verify identity with auto/strict mode.
- :func:`~machine_auth.get_machine` — look up a machine by ID.
- :func:`~machine_auth.deactivate_machine` — soft-deactivate a machine.

Machine service (FORGEOS-BE052) — via ``mcp_server.services.machine_service``:
- :class:`~machine_service.MachineService` — high-level service wrapper.

Operator auth (FORGEOS-BE053):
- :class:`OperatorIdentity` — authenticated operator descriptor.
- :class:`OperatorAuthenticationError` — base operator auth error.
- :class:`TokenExpiredError` — JWT token has expired.
- :class:`TokenInvalidError` — JWT token is invalid or malformed.
- :class:`TokenPayload` — decoded JWT payload.
- :func:`hash_password` — bcrypt password hashing.
- :func:`verify_password` — bcrypt password verification.
- :func:`generate_token` — generate JWT for operator.
- :func:`validate_token` — validate and decode JWT.
- :func:`extract_operator_identity` — extract identity from token.
- :func:`refresh_token` — refresh a valid JWT.
- :func:`extract_bearer_token` — parse Authorization header.

Operator-machine binding (FORGEOS-BE056) — via ``mcp_server.auth.authorization``:
- :class:`~authorization.OperatorMachineBinding` — frozen binding descriptor.
- :class:`~authorization.MachineScopeError` — 403 when operator unbound.
- :data:`~authorization.ADMIN_ROLE` — role that bypasses binding checks.
- :func:`~authorization.check_operator_machine_binding` — check binding exists.
- :func:`~authorization.require_operator_machine_access` — enforce binding or raise.
- :func:`~authorization.add_binding` — idempotent UPSERT binding.
- :func:`~authorization.remove_binding` — delete a binding.
- :func:`~authorization.list_bindings` — list bindings for an operator.

Operator-machine binding service (FORGEOS-BE056) — via ``mcp_server.services.operator_service``:
- :func:`~operator_service.bind_operator_to_machine` — service-layer bind.
- :func:`~operator_service.unbind_operator_from_machine` — service-layer unbind.
- :func:`~operator_service.get_operator_bindings` — list bindings (dict format).
- :func:`~operator_service.validate_operator_machine_access` — enforce binding.

.. meta::
   :ticket: FORGEOS-BE051, FORGEOS-BE052, FORGEOS-BE053, FORGEOS-BE056
   :last_reviewed: 2026-03-11T12:00:00Z
"""

from mcp_server.auth.agent_auth import (
    AgentIdentity,
    AuthenticationError,
    generate_api_key,
    hash_api_key,
    validate_api_key,
)
from mcp_server.auth.authorization import (
    ADMIN_ROLE,
    OPERATOR_ROLE,
    MachineScopeError,
    OperatorMachineBinding,
    RoleStageMismatchError,
    RoleStagePolicy,
    add_binding,
    check_operator_machine_binding,
    check_role_stage_authorization,
    list_bindings,
    remove_binding,
    require_operator_machine_access,
)
from mcp_server.auth.operator_auth import (
    OperatorAuthenticationError,
    OperatorIdentity,
    TokenExpiredError,
    TokenInvalidError,
    TokenPayload,
    extract_bearer_token,
    extract_operator_identity,
    generate_token,
    hash_password,
    refresh_token,
    validate_token,
    verify_password,
)

__all__ = [
    "ADMIN_ROLE",
    "OPERATOR_ROLE",
    "AgentIdentity",
    "AuthenticationError",
    "MachineScopeError",
    "OperatorAuthenticationError",
    "OperatorIdentity",
    "OperatorMachineBinding",
    "RoleStageMismatchError",
    "RoleStagePolicy",
    "TokenExpiredError",
    "TokenInvalidError",
    "TokenPayload",
    "add_binding",
    "check_operator_machine_binding",
    "check_role_stage_authorization",
    "extract_bearer_token",
    "extract_operator_identity",
    "generate_api_key",
    "generate_token",
    "hash_api_key",
    "hash_password",
    "list_bindings",
    "refresh_token",
    "remove_binding",
    "require_operator_machine_access",
    "validate_api_key",
    "validate_token",
    "verify_password",
]
