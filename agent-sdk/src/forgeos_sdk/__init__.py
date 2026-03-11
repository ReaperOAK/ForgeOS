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
from forgeos_sdk.models import Claim, Evidence, OperationResult, Ticket
from forgeos_sdk.operations import TicketOperations
from forgeos_sdk.summary import (
    STAGE_TO_AGENT,
    delete_upstream_summary,
    read_upstream_summary,
    write_summary,
)

__version__ = "0.1.0"
__app_name__ = "forgeos-agent-sdk"

__all__ = [
    "Claim",
    "ConnectionState",
    "Evidence",
    "FilesystemFallback",
    "ForgeOSClient",
    "LeaseHeartbeat",
    "OperationMode",
    "OperationResult",
    "SDKConfig",
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
