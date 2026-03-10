"""ForgeOS SDK exception hierarchy.

All SDK exceptions derive from ForgeOSError for consistent error handling.
"""


class ForgeOSError(Exception):
    """Base exception for all ForgeOS SDK errors."""


class ConnectionError(ForgeOSError):
    """Raised when the SDK cannot connect to the MCP server."""


class ConfigurationError(ForgeOSError):
    """Raised when SDK configuration is invalid or missing."""


class AuthenticationError(ForgeOSError):
    """Raised when agent authentication fails."""


class ToolCallError(ForgeOSError):
    """Raised when an MCP tool call fails.

    Attributes:
        tool_name: The name of the tool that failed.
    """

    def __init__(self, tool_name: str, message: str) -> None:
        self.tool_name = tool_name
        super().__init__(f"Tool '{tool_name}' failed: {message}")
