"""ForgeOS Agent SDK — Client library for agent-server interaction.

Public API
----------
.. autoclass:: ForgeOSClient
.. autoclass:: SDKConfig
.. autoclass:: TransportType
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
from forgeos_sdk.config import SDKConfig, TransportType
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

__version__ = "0.1.0"
__app_name__ = "forgeos-agent-sdk"

__all__ = [
    "ConnectionState",
    "ForgeOSClient",
    "SDKConfig",
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
]
