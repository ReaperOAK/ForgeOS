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
| `FORGEOS_API_KEY` | API key for authentication | `None` (optional) |

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

## Connection Lifecycle

The client manages connect, disconnect, and reconnect operations with
automatic session resumption.

### Connecting

```python
# HTTP/SSE transport — uses server_url from constructor
await client.connect()

# Stdio transport — requires a command
await client.connect(command="python", args=["-m", "my_server"])

# With custom headers and auto-reconnect disabled
await client.connect(headers={"Authorization": "Bearer token"}, auto_reconnect=False)
```

### Async Context Manager

```python
async with ForgeOSClient(
    server_url="http://localhost:8080/mcp",
    agent_id="backend-agent",
) as client:
    await client.connect()
    # client.disconnect() is called automatically on exit
```

### Reconnection

Reconnects with exponential backoff (initial 1 s, max 30 s, jitter).
For HTTP transports, the client sends the previous session ID to attempt
session resumption.

```python
# Automatic reconnect (enabled by default during connect)
await client.connect(auto_reconnect=True)

# Manual reconnect with custom attempt limit
await client.reconnect(max_attempts=5)
```

### Connection State

```python
from forgeos_sdk import ConnectionState

client.connection_state   # ConnectionState.DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING
client.is_connected       # True when state is CONNECTED
client.session            # Active MCP ClientSession or None
client.server_capabilities  # Server capabilities from MCP initialize response
client.session_id         # Session ID for resumption (HTTP transports)
```

## Ticket Operations

`TicketOperations` wraps MCP tool calls with typed inputs and Pydantic
model outputs. Create one from a connected client:

```python
from forgeos_sdk import ForgeOSClient, TicketOperations, Evidence

async with ForgeOSClient.from_env() as client:
    await client.connect()
    ops = TicketOperations(client)

    # Claim the next available ticket for a role
    ticket = await ops.claim_next("BACKEND", machine_id="pop-os", operator="oak")

    # Claim a specific ticket by ID
    ticket = await ops.claim("FORGEOS-BE003")

    # Get the current state of a ticket
    ticket = await ops.get_ticket("FORGEOS-BE003")

    # Advance to the next SDLC stage with evidence
    evidence = Evidence(
        artifacts=["src/handler.py"],
        test_results="42 tests passed, 95% coverage",
        confidence="HIGH",
    )
    ticket = await ops.advance("FORGEOS-BE003", evidence)

    # Send a ticket back for rework
    ticket = await ops.rework("FORGEOS-BE003", "Missing edge-case tests")

    # Release your claim on a ticket
    result = await ops.release("FORGEOS-BE003", reason="Switching tasks")
```

### Available Methods

| Method | MCP Tool | Returns | Description |
|---|---|---|---|
| `claim_next(role)` | `tickets.next` | `Ticket` | Find and claim the next available ticket for a role |
| `claim(ticket_id)` | `tickets.claim` | `Ticket` | Claim a specific ticket by ID |
| `advance(ticket_id, evidence)` | `tickets.complete` | `Ticket` | Complete the current stage and advance |
| `rework(ticket_id, reason)` | `tickets.reject` | `Ticket` | Reject a ticket and send back for rework |
| `release(ticket_id)` | `tickets.release` | `OperationResult` | Release a claim on a ticket |
| `get_ticket(ticket_id)` | `tickets.status` | `Ticket` | Get current ticket state |

All methods are `async` and raise `ToolCallError` on failure.

### Data Models

| Model | Description |
|---|---|
| `Ticket` | Ticket state with ID, title, type, priority, stage, claim info, file paths, and acceptance criteria |
| `Evidence` | Structured completion evidence: artifacts, test results, and confidence level (`HIGH`/`MEDIUM`/`LOW`) |
| `Claim` | Claim result with ticket, lease expiry, and locked file paths |
| `OperationResult` | Generic result with success flag, message, optional ticket, and extra data |

## Transport Layer

Three transport types are supported, selectable via the `transport_type`
constructor parameter or the `FORGEOS_TRANSPORT` environment variable.

| Transport | Value | Use Case |
|---|---|---|
| Streamable HTTP | `streamable-http` | Remote agents (default) |
| Server-Sent Events | `sse` | Remote agents, legacy servers |
| Stdio | `stdio` | Local agents via subprocess |

All transports implement the `MCPTransport` interface with `start()`,
`close()`, and `is_connected` methods.

## Exceptions

All exceptions inherit from `ForgeOSError`:

| Exception | Description |
|---|---|
| `ForgeOSError` | Base exception |
| `ConnectionError` | Cannot connect to MCP server |
| `ConfigurationError` | Invalid or missing configuration |
| `AuthenticationError` | Agent authentication failed |
| `ToolCallError` | MCP tool call failed |
| `ClaimConflictError` | Claim failed — another agent holds the ticket |
| `LeaseExpiredError` | Operation failed — claim lease expired |
| `InvalidTransitionError` | Invalid SDLC stage transition |
| `NetworkError` | Connection failure with optional retry hint |

## Development

```bash
# Run tests
pytest --cov=forgeos_sdk

# Lint
ruff check src/ tests/
```
