"""ForgeOS Agent SDK — Client library for agent-server interaction.

Public API
----------
.. autoclass:: ForgeOSClient
.. autoclass:: SDKConfig
.. autoclass:: TransportType
.. autoclass:: Ticket
.. autoclass:: Evidence
.. autoclass:: Claim
.. autoclass:: OperationResult
.. autoclass:: TicketOperations
.. autofunction:: read_upstream_summary
.. autofunction:: write_summary
.. autofunction:: delete_upstream_summary
.. autodata:: STAGE_TO_AGENT
.. autoclass:: ForgeOSError
.. autoclass:: ConnectionError
.. autoclass:: ConfigurationError
.. autoclass:: AuthenticationError
.. autoclass:: ToolCallError
.. autoclass:: ClaimConflictError
.. autoclass:: LeaseExpiredError
.. autoclass:: InvalidTransitionError
.. autoclass:: NetworkError
.. autoclass:: RunnerHooks
.. autoclass:: HookConfig
.. autoclass:: HookResult
"""

from forgeos_sdk.client import ConnectionState, ForgeOSClient
from forgeos_sdk.config import OperationMode, SDKConfig, TransportType
from forgeos_sdk.exceptions import (
    AuthenticationError,
    ClaimConflictError,
    ConfigurationError,
    ConnectionError,
    ForgeOSError,
    InvalidTransitionError,
    LeaseExpiredError,
    NetworkError,
    ToolCallError,
)
from forgeos_sdk.fallback import FilesystemFallback
from forgeos_sdk.heartbeat import LeaseHeartbeat
from forgeos_sdk.models import (
    AffectedSymbol,
    BlastRadiusResult,
    Claim,
    ContextResponse,
    DelegationPayload,
    Evidence,
    ImportChainResult,
    ImportEntry,
    IndexResult,
    Lesson,
    ListResponse,
    MemoryAddLessonInput,
    MemoryGetContextInput,
    MemorySearchLessonsInput,
    OperationResult,
    OrientationResult,
    SymbolMatch,
    SymbolSearchResult,
    Ticket,
)
from forgeos_sdk.operations import TicketOperations
from forgeos_sdk.runner_hooks import HookConfig, HookResult, RunnerHooks
from forgeos_sdk.summary import (
    STAGE_TO_AGENT,
    delete_upstream_summary,
    read_upstream_summary,
    write_summary,
)

__version__ = "0.1.0"
__app_name__ = "forgeos-agent-sdk"

__all__ = [
    "AffectedSymbol",
    "BlastRadiusResult",
    "Claim",
    "ConnectionState",
    "ContextResponse",
    "DelegationPayload",
    "Evidence",
    "FilesystemFallback",
    "ForgeOSClient",
    "HookConfig",
    "HookResult",
    "ImportChainResult",
    "ImportEntry",
    "IndexResult",
    "LeaseHeartbeat",
    "Lesson",
    "ListResponse",
    "MemoryAddLessonInput",
    "MemoryGetContextInput",
    "MemorySearchLessonsInput",
    "OperationMode",
    "OperationResult",
    "OrientationResult",
    "RunnerHooks",
    "SDKConfig",
    "SymbolMatch",
    "SymbolSearchResult",
    "Ticket",
    "TicketOperations",
    "TransportType",
    "ForgeOSError",
    "ConnectionError",
    "ConfigurationError",
    "AuthenticationError",
    "ToolCallError",
    "ClaimConflictError",
    "LeaseExpiredError",
    "InvalidTransitionError",
    "NetworkError",
    "STAGE_TO_AGENT",
    "read_upstream_summary",
    "write_summary",
    "delete_upstream_summary",
]
