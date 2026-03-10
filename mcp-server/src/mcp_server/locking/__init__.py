"""ForgeOS locking subsystem — distributed claims, leases, file mutex, transaction isolation.

This package provides:

* **Claim queue** — distributed ticket claim queue using PostgreSQL
  ``SELECT FOR UPDATE SKIP LOCKED`` for fair, non-blocking claim semantics.
* **File mutex** — file-level advisory lock mutex using PostgreSQL
  ``pg_advisory_xact_lock`` for preventing concurrent file modifications.
* **Transaction isolation** — per-operation isolation level mapping with an
  async context manager that sets the isolation level on each transaction
  and retries on serialization failure.

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

* :class:`LeaseCleanupConfig` — configurable cleanup interval.
* :class:`LeaseCleanupTask` — background task for expired lease detection.
* :class:`ExpiredLease` — an expired lease detected during cleanup.
* :class:`LeaseRelease` — record of a released expired lease.
* :func:`find_expired_leases` — scan for expired leases.
* :func:`release_expired_lease` — release a single expired lease.
* :func:`scan_and_release_expired` — scan and release all expired leases.
* :exc:`LeaseCleanupError` — base error for cleanup failures.

* :class:`IsolationLevel` — PostgreSQL isolation levels (enum).
* :class:`OperationType` — ForgeOS operation categories (enum).
* :class:`OperationIsolation` — frozen dataclass mapping operation to isolation level.
* :func:`isolation_for` — look up the isolation level for an operation type.
* :func:`transactional` — async context manager with per-operation isolation and retry.
* :exc:`SerializationError` — retries exhausted on serialization failure.
* :exc:`TransactionError` — non-retryable transaction error.

.. meta::
   :ticket: FORGEOS-BE006, FORGEOS-BE007, FORGEOS-BE008, FORGEOS-BE009, FORGEOS-BE010
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
from mcp_server.locking.lease_cleanup import (
    ExpiredLease,
    LeaseCleanupConfig,
    LeaseCleanupError,
    LeaseCleanupTask,
    LeaseRelease,
    find_expired_leases,
    release_expired_lease,
    scan_and_release_expired,
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

__all__ = [
    "AgentRoleMap",
    "ClaimError",
    "ClaimQueue",
    "ClaimResult",
    "ExpiredLease",
    "FileConflictError",
    "FileLockRecord",
    "FileMutex",
    "HeartbeatConfig",
    "HeartbeatError",
    "HeartbeatRecord",
    "IsolationLevel",
    "LeaseCleanupConfig",
    "LeaseCleanupError",
    "LeaseCleanupTask",
    "LeaseExpiredError",
    "LeaseHeartbeat",
    "LeaseNotActiveError",
    "LeaseRelease",
    "LockAcquireResult",
    "MaxLeaseDurationExceededError",
    "NoEligibleTicketError",
    "OperationIsolation",
    "OperationType",
    "SerializationError",
    "StaleClaim",
    "TransactionError",
    "extend_lease",
    "file_path_to_lock_key",
    "find_expired_leases",
    "find_stale_claims",
    "isolation_for",
    "release_expired_lease",
    "scan_and_release_expired",
    "transactional",
]
