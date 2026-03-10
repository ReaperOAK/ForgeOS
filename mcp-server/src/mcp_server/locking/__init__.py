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

.. meta::
   :ticket: FORGEOS-BE006, FORGEOS-BE007
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
    "file_path_to_lock_key",
    "isolation_for",
    "transactional",
]
