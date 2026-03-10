"""ForgeOS locking subsystem — distributed claim queue, lease management, file mutex.

This package provides:

* **Claim queue** — distributed ticket claim queue using PostgreSQL
  ``SELECT FOR UPDATE SKIP LOCKED`` for fair, non-blocking claim semantics.
* **File mutex** — file-level advisory lock mutex using PostgreSQL
  ``pg_advisory_xact_lock`` for preventing concurrent file modifications.

Public API
----------
* :class:`ClaimResult` — frozen dataclass containing claimed ticket data.
* :class:`ClaimQueue` — the claim queue with atomic claim/release operations.
* :class:`AgentRoleMap` — maps agent roles to compatible ticket types.
* :exc:`ClaimError` — base error for claim failures.
* :exc:`NoEligibleTicketError` — no ticket available for the given criteria.
* :exc:`LeaseExpiredError` — lease on a claimed ticket has expired.
* :class:`FileMutex` — file-level advisory lock mutex.
* :class:`FileLockRecord` — observability record for an active file lock.
* :class:`LockAcquireResult` — result of a lock acquisition attempt.
* :exc:`FileConflictError` — raised on file lock conflicts.
* :func:`file_path_to_lock_key` — deterministic file-path to int64 hash.

* :class:`HeartbeatConfig` — configurable heartbeat parameters.
* :class:`LeaseHeartbeat` — async context manager for automatic heartbeats.
* :class:`HeartbeatRecord` — record of a successful heartbeat.
* :class:`StaleClaim` — a claim with no recent heartbeats.
* :func:`extend_lease` — extend lease for a claimed ticket.
* :func:`find_stale_claims` — detect stale claims.
* :exc:`HeartbeatError` — base error for heartbeat failures.
* :exc:`LeaseNotActiveError` — lease is no longer active.
* :exc:`MaxLeaseDurationExceededError` — max duration exceeded.

.. meta::
   :ticket: FORGEOS-BE006, FORGEOS-BE007, FORGEOS-BE008
"""

from mcp_server.locking.claim_queue import (
    AgentRoleMap,
    ClaimError,
    ClaimQueue,
    ClaimResult,
    LeaseExpiredError,
    NoEligibleTicketError,
)
from mcp_server.locking.file_mutex import (
    FileConflictError,
    FileLockRecord,
    FileMutex,
    LockAcquireResult,
    file_path_to_lock_key,
)
from mcp_server.locking.transaction_config import (
    IsolationLevel,
    OperationIsolation,
    OperationType,
    SerializationError,
    TransactionError,
    isolation_for,
    transactional,
)
from mcp_server.locking.lease_heartbeat import (
    HeartbeatConfig,
    HeartbeatError,
    HeartbeatRecord,
    LeaseHeartbeat,
    LeaseNotActiveError,
    MaxLeaseDurationExceededError,
    StaleClaim,
    extend_lease,
    find_stale_claims,
)

__all__ = [
    "AgentRoleMap",
    "ClaimError",
    "ClaimQueue",
    "ClaimResult",
    "FileConflictError",
    "FileLockRecord",
    "FileMutex",
    "IsolationLevel",
    "LeaseExpiredError",
    "LockAcquireResult",
    "NoEligibleTicketError",
    "OperationIsolation",
    "OperationType",
    "SerializationError",
    "TransactionError",
    "extend_lease",
    "file_path_to_lock_key",
    "find_stale_claims",
    "HeartbeatConfig",
    "HeartbeatError",
    "HeartbeatRecord",
    "isolation_for",
    "LeaseHeartbeat",
    "LeaseNotActiveError",
    "MaxLeaseDurationExceededError",
    "StaleClaim",
    "transactional",
]
