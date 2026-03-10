# ForgeOS Agent SDK

Client library for ForgeOS agents to interact with the MCP server.

## Installation

```bash
# Development (editable install)
pip install -e .

# With dev dependencies
pip install -e ".[dev]"
```

## Configuration

The SDK reads configuration from environment variables with the `FORGEOS_` prefix:

| Variable | Description | Default |
|---|---|---|
| `FORGEOS_SERVER_URL` | MCP server endpoint | `http://localhost:8080/mcp` |
| `FORGEOS_AGENT_ID` | Agent identifier | `unknown-agent` |
| `FORGEOS_TRANSPORT` | Transport type (`streamable-http`, `sse`, `stdio`) | `streamable-http` |

## Usage

```python
from forgeos_sdk import ForgeOSClient

# From environment variables
client = ForgeOSClient.from_env()

# Explicit configuration
client = ForgeOSClient(
    server_url="http://localhost:8080/mcp",
    agent_id="backend-agent",
    transport_type="streamable-http",
)
```

## Exceptions

All exceptions inherit from `ForgeOSError`:

| Exception | Description |
|---|---|
| `ForgeOSError` | Base exception |
| `ConnectionError` | Cannot connect to MCP server |
| `ConfigurationError` | Invalid or missing configuration |
| `AuthenticationError` | Agent authentication failed |
| `ToolCallError` | MCP tool call failed |

## Development

```bash
# Run tests
pytest --cov=forgeos_sdk

# Lint
ruff check src/ tests/
```
