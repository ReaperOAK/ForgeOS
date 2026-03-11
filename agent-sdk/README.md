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
| `FORGEOS_MODE` | Operation mode (`mcp`, `filesystem`, `auto`) | `auto` |
| `FORGEOS_HEARTBEAT_INTERVAL` | Lease heartbeat interval in seconds | `300` (5 minutes) |

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
    mode="auto",  # "mcp", "filesystem", or "auto"
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
from forgeos_sdk import ConnectionState, OperationMode

client.connection_state    # ConnectionState.DISCONNECTED | CONNECTING | CONNECTED | RECONNECTING
client.is_connected        # True when state is CONNECTED
client.session             # Active MCP ClientSession or None
client.server_capabilities # Server capabilities from MCP initialize response
client.session_id          # Session ID for resumption (HTTP transports)
client.mode                # OperationMode.MCP | FILESYSTEM | AUTO
client.is_fallback_active  # True when filesystem fallback is active
client.fallback            # FilesystemFallback instance or None
```

## Filesystem Fallback Mode

The SDK supports a filesystem fallback that delegates ticket operations to
the `tickets.py` CLI when the MCP server is unavailable. This enables a
gradual migration from file-based to server-based orchestration.

### Operation Modes

| Mode | Behavior |
|---|---|
| `mcp` | Always connect to the MCP server. Fails if unreachable. |
| `filesystem` | Skip MCP entirely. Delegate all operations to `tickets.py`. |
| `auto` | Try MCP first. Fall back to filesystem on connection failure. |

Set the mode via the `FORGEOS_MODE` environment variable or the `mode`
constructor parameter.

### How It Works

In `auto` mode (the default), `connect()` attempts an MCP connection. If
the server is unreachable, the client transparently switches to filesystem
fallback and logs a warning. All subsequent ticket operations use
`tickets.py` subprocess calls instead of MCP tool calls.

In `filesystem` mode, `connect()` skips the MCP handshake entirely and
activates the fallback immediately.

```python
import os
os.environ["FORGEOS_MODE"] = "auto"

client = ForgeOSClient.from_env()
await client.connect()  # tries MCP, falls back to filesystem if unavailable

print(client.mode)               # OperationMode.FILESYSTEM (if MCP failed)
print(client.is_fallback_active)  # True
```

### Direct Fallback Usage

The `FilesystemFallback` class can also be used directly without the client:

```python
from forgeos_sdk import FilesystemFallback

fallback = FilesystemFallback(agent_id="backend-agent")
ticket = await fallback.get_ticket("FORGEOS-BE001")
ticket = await fallback.claim("FORGEOS-BE001", agent_name="backend-agent")
ticket = await fallback.advance("FORGEOS-BE001")
```

The fallback auto-detects the repository root via `git rev-parse` or by
walking up from the current directory to find `.github/tickets.py`.

### Fallback API

| Method | CLI Command | Returns |
|---|---|---|
| `get_ticket(id)` | Reads JSON from `.github/ticket-state/` | `Ticket` |
| `claim(id)` | `tickets.py --claim` | `Ticket` |
| `advance(id)` | `tickets.py --advance` | `Ticket` |
| `rework(id, reason)` | `tickets.py --rework` | `Ticket` |
| `release(id)` | `tickets.py --release` | `OperationResult` |
| `claim_next(role)` | Scans READY dir + `tickets.py --claim` | `Ticket` |

All methods are `async` and raise `ToolCallError` on failure.

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

### Automatic Lease Heartbeat

`TicketOperations` automatically starts a background heartbeat when a ticket
is claimed via `claim()` or `claim_next()`. The heartbeat periodically calls
the `tickets.heartbeat` MCP tool to extend the lease, preventing expiration
while the agent works.

- Heartbeat **starts** on `claim()` / `claim_next()` success.
- Heartbeat **stops** on `advance()`, `release()`, or `rework()`.
- Call `stop_all_heartbeats()` during cleanup to stop all active heartbeats.

Configure the interval via constructor or environment variable:

```python
# Via constructor — set interval to 2 minutes
ops = TicketOperations(client, heartbeat_interval=120)

# Disable automatic heartbeats
ops = TicketOperations(client, heartbeat_interval=0)

# Via environment variable (used when no constructor value is given)
# export FORGEOS_HEARTBEAT_INTERVAL=120
```

## Lease Heartbeat

The `LeaseHeartbeat` class can also be used directly for fine-grained control
over lease extension. It runs a background `asyncio` task that calls
`tickets.heartbeat` at a configurable interval.

```python
from forgeos_sdk import ForgeOSClient, LeaseHeartbeat

async with ForgeOSClient.from_env() as client:
    await client.connect()

    # Async context manager — starts on entry, stops on exit
    async with LeaseHeartbeat(client, "FORGEOS-BE003", interval_seconds=120):
        # ... do work while heartbeat keeps the lease alive ...
        pass

    # Manual start / stop
    hb = LeaseHeartbeat(client, "FORGEOS-BE003")
    hb.start()
    # ... do work ...
    await hb.stop()
```

### Properties

| Property | Type | Description |
|---|---|---|
| `running` | `bool` | Whether the heartbeat task is active |
| `ticket_id` | `str` | The ticket ID being monitored |
| `interval_seconds` | `float` | Heartbeat interval in seconds |

### Data Models

| Model | Description |
|---|---|
| `Ticket` | Ticket state with ID, title, type, priority, stage, claim info, file paths, and acceptance criteria |
| `Evidence` | Structured completion evidence: artifacts, test results, and confidence level (`HIGH`/`MEDIUM`/`LOW`) |
| `Claim` | Claim result with ticket, lease expiry, and locked file paths |
| `OperationResult` | Generic result with success flag, message, optional ticket, and extra data |

## Summary Handoff Helpers

Agents pass context between SDLC stages via summary files under
`.github/agent-output/{AgentName}/{ticket-id}.md`. The SDK provides three
functions and one mapping constant to read, write, and clean up these files.

```python
from forgeos_sdk import (
    read_upstream_summary,
    write_summary,
    delete_upstream_summary,
    STAGE_TO_AGENT,
)

workspace = "/path/to/repo"
ticket = "FORGEOS-BE048"
flow = ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]

# Read the previous stage's summary (returns None if missing)
content = read_upstream_summary(ticket, "DOCS", flow, workspace_root=workspace)

# Write your own summary
path = write_summary(ticket, "Documentation", "# Summary\n...", workspace_root=workspace)

# Delete the upstream summary after processing
deleted = delete_upstream_summary(ticket, "DOCS", flow, workspace_root=workspace)
```

### Functions

| Function | Returns | Description |
|---|---|---|
| `read_upstream_summary(ticket_id, current_stage, sdlc_flow, *, workspace_root)` | `str \| None` | Read the previous stage agent's summary file. Returns `None` if no upstream summary exists. |
| `write_summary(ticket_id, agent_name, content, *, workspace_root)` | `Path` | Write the current agent's summary. Creates the output directory if needed. |
| `delete_upstream_summary(ticket_id, current_stage, sdlc_flow, *, workspace_root)` | `bool` | Delete the upstream summary after processing. Returns `True` if deleted. |

### Stage-to-Agent Mapping

`STAGE_TO_AGENT` maps each SDLC stage to its agent output directory name:

| Stage | Agent Directory |
|---|---|
| `ARCHITECT` | `Architect` |
| `RESEARCH` | `Research` |
| `BACKEND` | `Backend` |
| `FRONTEND` | `Frontend` |
| `QA` | `QA` |
| `SECURITY` | `Security` |
| `CI` | `CIReviewer` |
| `DOCS` | `Documentation` |
| `VALIDATION` | `Validator` |

All functions use UTF-8 encoding and handle missing files gracefully.

## Runner Hooks (agent-runner.py Integration)

`RunnerHooks` provides lifecycle hooks that `agent-runner.py` calls at
specific points during the two-commit protocol. The SDK handles MCP ticket
operations while `agent-runner.py` handles all git operations.

### Hook Lifecycle

```
pre_claim_check  →  [agent work]  →  post_advance_or_rework
```

### Setup

```python
from forgeos_sdk import ForgeOSClient
from forgeos_sdk.runner_hooks import RunnerHooks

client = ForgeOSClient.from_env()
await client.connect()
hooks = RunnerHooks(client)
```

### Pre-Claim Check

Validates that the ticket is claimed by the expected agent before the git
CLAIM commit proceeds.

```python
result = await hooks.pre_claim_check("FORGEOS-BE050", agent_name="Backend")
if not result.success:
    print(f"Claim invalid: {result.error}")
    return

ticket = result.ticket  # Ticket data on success
```

### Post-Advance or Rework

After the agent completes work, advances the ticket to the next SDLC stage
or sends it back for rework.

```python
from forgeos_sdk import Evidence

# Advance on success
evidence = Evidence(
    artifacts=["src/handler.py"],
    test_results="42 tests passed",
    confidence="HIGH",
)
result = await hooks.post_advance_or_rework(
    "FORGEOS-BE050",
    success=True,
    evidence=evidence,
)

# Rework on failure
result = await hooks.post_advance_or_rework(
    "FORGEOS-BE050",
    success=False,
    rework_reason="Missing edge-case tests",
)
```

### Hook Configuration

Each hook can be enabled or disabled via environment variables. All hooks
are enabled by default.

| Variable | Hook | Default |
|---|---|---|
| `FORGEOS_HOOK_PRE_CLAIM` | `pre_claim_check` | `true` |
| `FORGEOS_HOOK_POST_ADVANCE` | Advance in `post_advance_or_rework` | `true` |
| `FORGEOS_HOOK_POST_REWORK` | Rework in `post_advance_or_rework` | `true` |

```python
from forgeos_sdk.runner_hooks import RunnerHooks, HookConfig

# From environment variables (default)
hooks = RunnerHooks(client)

# Explicit configuration
config = HookConfig(pre_claim_enabled=True, post_advance_enabled=False)
hooks = RunnerHooks(client, config=config)
```

### HookResult

All hook methods return a `HookResult` dataclass:

| Field | Type | Description |
|---|---|---|
| `success` | `bool` | Whether the hook completed successfully |
| `ticket` | `Ticket \| None` | Ticket data returned by the MCP operation |
| `error` | `str \| None` | Error message when `success` is `False` |
| `data` | `dict` | Additional metadata (e.g. `{"skipped": True}` when disabled) |

### Error Handling

Hooks never raise exceptions. All errors are caught, logged, and returned
in `HookResult`. The runner continues operating even when a hook fails.
When hooks are disabled, they return a successful `HookResult` with
`data={"skipped": True}`.

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
