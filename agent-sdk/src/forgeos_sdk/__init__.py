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
"""

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.config import SDKConfig, TransportType
from forgeos_sdk.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ConnectionError,
    ForgeOSError,
    ToolCallError,
)

__version__ = "0.1.0"
__app_name__ = "forgeos-agent-sdk"

__all__ = [
    "ForgeOSClient",
    "SDKConfig",
    "TransportType",
    "ForgeOSError",
    "ConnectionError",
    "ConfigurationError",
    "AuthenticationError",
    "ToolCallError",
]
