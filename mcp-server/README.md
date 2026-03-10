# ForgeOS MCP Server

<!-- last_reviewed: 2026-03-11T00:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The ForgeOS MCP Server is a Python-based [Model Context Protocol](https://modelcontextprotocol.io/) server that provides ticket lifecycle management for the ForgeOS multi-agent orchestration platform.

## Prerequisites

- **Python** ≥ 3.10
- **PostgreSQL** 17 (optional for initial bootstrap — server starts without DB)
- **uv** (recommended) or **pip** for dependency management

## Quick Start

### 1. Install dependencies

Using [uv](https://docs.astral.sh/uv/) (recommended):

```bash
cd mcp-server
uv pip install -e ".[dev]"
```

Using pip:

```bash
cd mcp-server
pip install -e ".[dev]"
```

### 2. Configure environment (optional)

The server reads configuration from environment variables with the `FORGEOS_` prefix. Defaults are suitable for local development.

| Variable | Default | Description |
|---|---|---|
| `FORGEOS_HOST` | `0.0.0.0` | Bind address |
| `FORGEOS_PORT` | `8080` | Bind port |
| `FORGEOS_LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `FORGEOS_DATABASE_URL` | `postgresql://forgeos:forgeos@localhost:5432/forgeos` | PostgreSQL connection URI |
| `FORGEOS_DB_MIN_POOL_SIZE` | `2` | Minimum connection pool size |
| `FORGEOS_DB_MAX_POOL_SIZE` | `10` | Maximum connection pool size |

### 3. Start the server

Using the entry point script:

```bash
forgeos-mcp
```

Using Python module invocation:

```bash
python -m mcp_server
```

The server starts with **Streamable HTTP** transport on `http://0.0.0.0:8080/mcp` by default.

### 4. Verify the server is running

Connect with the MCP Python client:

```python
import asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def check():
    async with streamable_http_client("http://localhost:8080/mcp") as (r, w, _):
        async with ClientSession(r, w) as session:
            await session.initialize()
            tools = await session.list_tools()
            print(f"Connected! Tools: {[t.name for t in tools.tools]}")

asyncio.run(check())
```

## Connection Pool

<!-- last_reviewed: 2026-03-11T00:30:00Z -->

The `mcp_server.db` package provides an asyncpg connection pool with lifecycle
management, health checks, and pool metrics.

### Pool Configuration

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://forgeos:forgeos@localhost:5432/forgeos` | PostgreSQL connection string |
| `POOL_MIN` | `2` | Minimum connections kept open |
| `POOL_MAX` | `10` | Maximum connections allowed |
| `POOL_IDLE_TIMEOUT` | `300` | Seconds before idle connections are recycled |
| `POOL_COMMAND_TIMEOUT` | `30` | Per-query timeout in seconds |

Configuration is loaded from environment variables via `PoolConfig(BaseSettings)`.

### Usage

```python
from mcp_server.db import ConnectionPool, PoolConfig

config = PoolConfig()  # reads from env
pool = ConnectionPool(config)

await pool.initialize()  # creates the asyncpg pool

async with pool.acquire() as conn:
    row = await conn.fetchrow("SELECT 1")

await pool.ping()   # True if pool is healthy
stats = pool.stats()  # PoolStats snapshot

await pool.close()  # drains and closes all connections
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `ConnectionPool` | class | Async pool wrapper with lifecycle management |
| `PoolConfig` | class | Pydantic settings for pool configuration |
| `PoolStats` | dataclass | Frozen snapshot of pool metrics (`size`, `free`, `used`, `max`, `min`) |
| `PoolNotInitializedError` | exception | Raised when accessing pool before `initialize()` |

#### ConnectionPool Methods

| Method | Returns | Description |
|---|---|---|
| `initialize()` | `None` | Creates the asyncpg pool; fails fast if DB is unreachable |
| `close()` | `None` | Drains and closes all connections |
| `ping()` | `bool` | Executes `SELECT 1` to verify connectivity |
| `acquire()` | `AsyncContextManager[Connection]` | Yields one connection; auto-releases on exit |
| `stats()` | `PoolStats` | Returns current pool metrics |
| `is_initialized` | `bool` | Property — `True` after `initialize()`, `False` after `close()` |

### Error Handling

| Scenario | Behavior |
|---|---|
| DB unreachable on `initialize()` | Raises `ConnectionRefusedError` (fail fast) |
| `acquire()` before `initialize()` | Raises `PoolNotInitializedError` |
| Query timeout | Raises `asyncpg.QueryCanceledError` after `POOL_COMMAND_TIMEOUT` seconds |


## Graceful Shutdown

<!-- last_reviewed: 2026-03-11T00:30:00Z -->

The server supports graceful shutdown with request draining. On SIGTERM or
SIGINT, the server stops accepting new requests, waits for in-flight work to
finish, runs cleanup callbacks, closes the database pool, and exits.

### Shutdown Configuration

| Parameter | Default | Description |
|---|---|---|
| `shutdown_timeout_seconds` | `30.0` | Max seconds to wait for in-flight requests before forced shutdown |
| `drain_poll_interval_seconds` | `0.5` | Interval between drain-loop polls |

Pass a `ShutdownConfig` to override defaults:

```python
from mcp_server.lifecycle import GracefulShutdownManager, ShutdownConfig

config = ShutdownConfig(shutdown_timeout_seconds=60.0)
manager = GracefulShutdownManager(config=config)
```

### Shutdown Lifecycle

```
RUNNING  ──signal──▸  DRAINING  ──drained──▸  SHUTDOWN
```

1. **Signal received** — SIGTERM or SIGINT triggers `initiate_shutdown()`.
2. **DRAINING** — New requests raise `ShutdownError`. The drain loop polls
   until all in-flight requests complete or the timeout expires.
3. **Cleanup** — Registered callbacks execute in LIFO order (last added first).
4. **Pool close** — The database connection pool is closed.
5. **SHUTDOWN** — The `shutdown_complete` event is set.

### Integration Example

```python
import asyncio
from mcp_server.lifecycle import GracefulShutdownManager

manager = GracefulShutdownManager()
manager.register_signals(asyncio.get_running_loop())
manager.set_db_pool(pool)

# Register cleanup (LIFO order):
manager.add_cleanup_callback("flush_events", flush_pending_events)

# In request middleware:
with manager.request_scope():
    await handle_request(request)

# Check status:
print(manager.status())
# {'state': 'running', 'in_flight_requests': 0, ...}
```

### API Reference

| Symbol | Type | Description |
|---|---|---|
| `GracefulShutdownManager` | class | Main coordinator for shutdown lifecycle |
| `ShutdownConfig` | dataclass | Validated shutdown configuration (timeout, poll interval) |
| `ShutdownState` | enum | `RUNNING`, `DRAINING`, `SHUTDOWN` |
| `ShutdownError` | exception | Raised when a request is rejected during shutdown |

Key methods on `GracefulShutdownManager`:

| Method | Description |
|---|---|
| `register_signals(loop)` | Attach SIGTERM/SIGINT handlers to the event loop |
| `set_db_pool(pool)` | Assign the `asyncpg` pool for cleanup |
| `track_request()` | Increment in-flight counter (raises `ShutdownError` if draining) |
| `complete_request()` | Decrement in-flight counter |
| `request_scope()` | Context manager combining `track_request` / `complete_request` |
| `add_cleanup_callback(name, cb)` | Register a sync or async cleanup callable |
| `initiate_shutdown()` | Begin drain → cleanup → close sequence (idempotent) |
| `status()` | Return dict snapshot of current state |

## Development

### Run tests

```bash
pytest --cov=mcp_server --cov-report=term-missing
```

### Lint and type check

```bash
ruff check src/ tests/
pyright src/
```

## Architecture

The server uses the **FastMCP** high-level API from the [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk):

- **`mcp_server/server.py`** — Server initialization, configuration, error handling, entry point
- **`mcp_server/__init__.py`** — Package metadata (version, app name)
- **`mcp_server/__main__.py`** — `python -m mcp_server` entry point
- **`mcp_server/observability/`** — Structured JSON logging, correlation IDs, and PII redaction
- **`mcp_server/auth/`** — Agent API key authentication, rate limiting, and identity resolution
- **`mcp_server/tools/`** — Dynamic tool registration, schema validation, and FastMCP bridge
- **`mcp_server/events/`** — Append-only event sourcing (EventStore, EventType, Event dataclass)

### Error Handling

Domain errors extend `ForgeOSError` and map to standard JSON-RPC error codes:

| Error Class | JSON-RPC Code | HTTP Equivalent |
|---|---|---|
| `TicketNotFoundError` | `-32602` | 404 |
| `TicketAlreadyClaimedError` | `-32602` | 409 |
| `ValidationError` | `-32602` | 400 |
| `AuthenticationError` | `-32602` | 401 |
| `DatabaseError` | `-32603` | 503 |

Tool-level expected failures use `isError=True` in the MCP `CallToolResult`.

### Transport

The server supports multiple transport protocols. Select one via the
`FORGEOS_TRANSPORT` environment variable:

| Value | Protocol | Default |
|-------|----------|---------|
| `streamable-http` | Streamable HTTP (stateless JSON) | **Yes** |
| `sse` | Server-Sent Events (persistent connections) | No |
| `stdio` | Standard I/O (local development) | No |

#### Streamable HTTP

Stateless request/response transport. Each MCP request is an independent HTTP
POST that returns a JSON response — no server-side session state required.

**Configuration** (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEOS_HTTP_HOST` | `0.0.0.0` | Bind address |
| `FORGEOS_HTTP_PORT` | `3000` | Listen port |
| `FORGEOS_HTTP_MOUNT_PATH` | `/mcp` | URL path prefix |
| `FORGEOS_HTTP_STATELESS` | `true` | Disable session tracking |
| `FORGEOS_HTTP_JSON_RESPONSE` | `true` | Return JSON instead of SSE streams |
| `FORGEOS_HTTP_LOG_LEVEL` | `INFO` | Logging verbosity |
| `FORGEOS_HTTP_SHUTDOWN_TIMEOUT` | `10` | Graceful shutdown seconds |

**Endpoints:**

| Path | Method | Description |
|------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC request endpoint |
| `/mcp/health` | GET | Transport health check |

**Usage:**

```bash
export FORGEOS_TRANSPORT=streamable-http
python -m mcp_server
```

#### SSE Transport

Persistent connection transport using Server-Sent Events. Clients open a
long-lived SSE connection and receive real-time event streams. Includes
built-in connection tracking, idle timeouts, and max-connection limits.

**Configuration** (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEOS_SSE_HOST` | `0.0.0.0` | Bind address |
| `FORGEOS_SSE_PORT` | `3000` | Listen port |
| `FORGEOS_SSE_MAX_CONNECTIONS` | `100` | Maximum concurrent SSE clients |
| `FORGEOS_SSE_IDLE_TIMEOUT` | `300` | Seconds before disconnecting idle clients |
| `FORGEOS_SSE_SWEEP_INTERVAL` | `60` | Seconds between idle-connection sweeps |
| `FORGEOS_SSE_LOG_LEVEL` | `INFO` | Logging verbosity |
| `FORGEOS_SSE_SHUTDOWN_TIMEOUT` | `10` | Graceful shutdown seconds |

**Endpoints:**

| Path | Method | Description |
|------|--------|-------------|
| `/sse` | GET | Open SSE event stream |
| `/messages/` | POST | Send MCP JSON-RPC message |
| `/health` | GET | Transport health check |
| `/connections` | GET | Active connection stats |

**Connection lifecycle:**

1. Client opens `GET /sse` — server assigns a session ID and begins streaming.
2. Client sends MCP requests via `POST /messages/?session_id=<id>`.
3. Server pushes responses and notifications through the SSE stream.
4. Idle connections are reaped after `FORGEOS_SSE_IDLE_TIMEOUT` seconds.
5. When `FORGEOS_SSE_MAX_CONNECTIONS` is reached, new connections receive 503.

**Usage:**

```bash
export FORGEOS_TRANSPORT=sse
python -m mcp_server
```

#### Transport API Reference

| Symbol | Module | Description |
|--------|--------|-------------|
| `TransportType` | `transport` | Enum: `STREAMABLE_HTTP`, `SSE`, `STDIO` |
| `parse_transport()` | `transport` | Parse string to `TransportType` |
| `HTTPTransport` | `transport.http` | Streamable HTTP transport class |
| `HTTPTransportConfig` | `transport.http` | Pydantic config for HTTP transport |
| `SSETransport` | `transport.sse` | SSE transport class |
| `SSETransportConfig` | `transport.sse` | Pydantic config for SSE transport |


## Observability — Structured JSON Logging

The `mcp_server.observability` package provides structured JSON logging with
correlation-ID propagation and automatic PII/secret redaction.

### Quick Start

```python
from mcp_server.observability import configure_logging, get_logger

configure_logging("INFO")          # Call once at startup
logger = get_logger("my_module")   # Per-module named logger
logger.info("Server ready", extra={"port": 8000})
```

**Log output** (single-line JSON, formatted here for clarity):

```json
{
  "timestamp": "2026-03-10T12:34:56.789012+00:00",
  "level": "INFO",
  "message": "Server ready",
  "logger": "my_module",
  "correlation_id": "req-abc123"
}
```

| Field | Type | Description |
|---|---|---|
| `timestamp` | string | ISO 8601 with timezone |
| `level` | string | DEBUG, INFO, WARNING, ERROR, CRITICAL |
| `message` | string | Human-readable log message |
| `logger` | string | Logger name (module path) |
| `correlation_id` | string | Request-scoped trace identifier |

### Configuration

| Variable | Default | Description |
|---|---|---|
| `FORGEOS_LOG_LEVEL` | `INFO` | Root log level (`DEBUG` \| `INFO` \| `WARNING` \| `ERROR` \| `CRITICAL`) |

### Correlation IDs

Use `set_correlation_id` / `get_correlation_id` to propagate a trace identifier
across async boundaries via `contextvars`:

```python
from mcp_server.observability import set_correlation_id, get_correlation_id

set_correlation_id("req-abc123")   # Set in middleware
cid = get_correlation_id()         # Read anywhere in the same async context
```

### Sensitive Data Redaction

`SensitiveDataFilter` automatically masks values that match common secret
patterns (API keys, tokens, passwords, SSNs, emails). The filter is installed
by `configure_logging()` — no extra setup needed.

### Public API

| Symbol | Kind | Purpose |
|---|---|---|
| `configure_logging(level)` | function | One-shot root logger setup |
| `get_logger(name)` | function | Named logger factory |
| `set_correlation_id(id)` | function | Store correlation ID in context |
| `get_correlation_id()` | function | Retrieve current correlation ID |
| `StructuredJsonFormatter` | class | JSON formatter for log records |
| `SensitiveDataFilter` | class | PII / secret redaction filter |


## Authentication — Agent API Keys

<!-- last_reviewed: 2026-03-10T14:00:00Z -->

The `mcp_server.auth` package provides API key authentication for MCP agents.
Each agent is issued a unique key that is validated on every request.

### Key Format

API keys follow the pattern `fgos_<64 hex characters>` (69 characters total).
The `fgos_` prefix identifies ForgeOS keys. Keys are generated from 32 bytes
of `os.urandom`, so each key has 256 bits of entropy.

### Authentication Flow

```
Client sends raw key
       │
       ▼
┌─ Format check ──▸ reject if missing "fgos_" prefix
│
├─ Rate-limit check ──▸ reject if bucket exhausted (60 req/min per prefix)
│
├─ Hash key (SHA-256)
│
├─ Prefix lookup ──▸ SELECT from api_keys WHERE key_prefix = first 8 hex chars
│
├─ Constant-time comparison (hmac.compare_digest) ──▸ reject on mismatch
│
├─ Revocation check ──▸ reject if is_active=FALSE or revoked_at IS NOT NULL
│
├─ Expiry check ──▸ reject if expires_at < NOW()
│
├─ Agent status check ──▸ reject if agent is_active=FALSE
│
└─ Return AgentIdentity(agent_id, agent_name, role, permissions)
```

### Key Storage

Keys are never stored in plaintext. The `api_keys` table stores:

| Column | Description |
|---|---|
| `key_hash` | SHA-256 hex digest of the full key |
| `key_prefix` | First 8 hex characters (indexed for fast lookup) |
| `agent_id` | Foreign key to `agents` table |
| `label` | Human-readable label (e.g. `"production"`) |
| `is_active` | Revocation flag |
| `revoked_at` | Timestamp of revocation (if any) |
| `expires_at` | Optional expiration timestamp |
| `last_used_at` | Updated on each successful authentication |

### Rate Limiting

An in-memory token-bucket rate limiter prevents brute-force attacks:

| Parameter | Default | Description |
|---|---|---|
| `max_requests` | `60` | Maximum requests per window |
| `window_seconds` | `60.0` | Sliding window duration |

Each key prefix gets an independent bucket. When tokens are exhausted, the
request is rejected with `"Rate limit exceeded"` before any database query.

### Key Management

**Generate a key** (admin utility):

```python
from mcp_server.auth import generate_api_key

raw_key, key_hash, key_prefix = generate_api_key()
# Show raw_key to the operator exactly once; persist key_hash and key_prefix.
```

**Provision a key for an agent** (writes to database):

```python
from mcp_server.auth.agent_auth import create_api_key_for_agent

raw_key = await create_api_key_for_agent(
    db_pool,
    agent_id="<uuid>",
    label="production",
    expires_at=None,  # or a datetime for time-limited keys
)
```

**Revoke a key:**

```python
from mcp_server.auth.agent_auth import revoke_api_key

revoked = await revoke_api_key(db_pool, key_prefix="abcd1234")
```

**Validate a key** (used by middleware):

```python
from mcp_server.auth import validate_api_key

identity = await validate_api_key(db_pool, raw_key)
# identity.agent_id, identity.agent_name, identity.role, identity.permissions
```

### Audit Logging

Every authentication attempt is logged via the structured logger:

| Event | Level | Extra Fields |
|---|---|---|
| `auth_success` | INFO | `agent_id`, `agent_name`, `key_prefix` |
| `auth_failure` | WARNING | `reason`, `key_prefix` |
| `auth_rate_limited` | WARNING | `key_prefix` |
| `auth_db_error` | ERROR | `key_prefix`, `error` |
| `api_key_created` | INFO | `agent_id`, `key_prefix`, `label` |
| `api_key_revoked` | INFO | `key_prefix` |

Failed attempts log the key prefix only — never the full key.

### Public API

| Symbol | Kind | Purpose |
|---|---|---|
| `AgentIdentity` | dataclass | Authenticated agent descriptor (`agent_id`, `agent_name`, `role`, `permissions`) |
| `AuthenticationError` | exception | Raised on invalid, expired, revoked, or rate-limited keys |
| `validate_api_key(pool, key)` | async function | Validate key and return `AgentIdentity` |
| `generate_api_key()` | function | Generate `(raw_key, key_hash, key_prefix)` tuple |
| `hash_api_key(key)` | function | Compute SHA-256 hex digest of a raw key |
| `create_api_key_for_agent(pool, agent_id)` | async function | Provision and store a new key |
| `revoke_api_key(pool, prefix)` | async function | Revoke a key by prefix |
| `RateLimiter` | class | Per-prefix token-bucket rate limiter |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FORGEOS_API_KEY` | _(required)_ | API key for agent authentication against the MCP server |


## Event Sourcing

The `mcp_server/events/` package provides an append-only event store that
records every ticket lifecycle transition. All state changes flow through
`EventStore.append_event()`, which assigns monotonically increasing sequence
numbers and immutable timestamps before delegating to a pluggable backend.

### Event Types

| EventType | Description |
|---|---|
| `CREATED` | Ticket created |
| `CLAIMED` | Agent acquired distributed lock |
| `RELEASED` | Agent released claim voluntarily |
| `FORCE_RELEASED` | System released expired lease |
| `STAGE_ADVANCED` | Ticket moved to next SDLC stage |
| `STAGE_REJECTED` | Stage reviewer rejected ticket |
| `REWORKED` | Ticket returned for rework |
| `ESCALATED` | Rework count exceeded threshold |
| `DONE` | Ticket lifecycle complete |
| `UPDATED` | Metadata fields modified |
| `SPAWNED` | New ticket created (by TODO agent) |
| `LEASE_EXTENDED` | Claim lease duration extended |
| `RECONCILED` | Filesystem–MCP state reconciled |
| `FILE_LOCKED` | File-level mutex acquired |
| `FILE_UNLOCKED` | File-level mutex released |

**Aliases:** `COMPLETE` → `DONE`, `REJECTED` → `STAGE_REJECTED`,
`ADVANCED` → `STAGE_ADVANCED`.

### Quick Start

```python
from mcp_server.events import EventStore, EventType, create_event_store

store = create_event_store()

store.append_event(
    ticket_id="FORGEOS-BE012",
    event_type=EventType.CLAIMED,
    agent_name="Backend",
    details={"machine_id": "pop-os"},
)

events = store.get_events_by_ticket("FORGEOS-BE012")
state = store.reconstruct_ticket_state("FORGEOS-BE012")
```

### Event Fields

Every `Event` is a frozen dataclass with these fields:

| Field | Type | Description |
|---|---|---|
| `event_id` | `str` | UUID v4 identifier |
| `ticket_id` | `str` | Associated ticket |
| `event_type` | `EventType` | Lifecycle event category |
| `agent_name` | `str \| None` | Agent that triggered the event |
| `machine_id` | `str \| None` | Host machine identifier |
| `operator` | `str \| None` | Human operator |
| `timestamp` | `datetime` | When the event occurred (UTC) |
| `sequence` | `int` | Monotonically increasing counter |
| `from_stage` | `str \| None` | Previous SDLC stage |
| `to_stage` | `str \| None` | Target SDLC stage |
| `details` | `dict` | Arbitrary metadata |
| `evidence` | `dict` | Completion evidence (artifacts, tests) |
| `metadata` | `dict` | Additional structured data |
| `version` | `int` | Schema version (default `1`) |

### Public API

Exported from `mcp_server.events`:

| Symbol | Kind | Purpose |
|---|---|---|
| `Event` | frozen dataclass | Immutable event record |
| `EventType` | enum | 15 event types + 3 aliases |
| `EventStore` | class | Core event store with query + replay |
| `create_event_store()` | factory function | Create configured EventStore instance |

### EventStore Methods

| Method | Description |
|---|---|
| `append_event(ticket_id, event_type, ...)` | Record a new event |
| `get_events_by_ticket(ticket_id)` | All events for a ticket |
| `get_events_by_type(event_type)` | All events of a given type |
| `get_events_by_agent(agent_name)` | All events by an agent |
| `replay_ticket_events(ticket_id)` | Ordered replay for auditing |
| `reconstruct_ticket_state(ticket_id)` | Derive current state from events |

### Backend Architecture

`EventStore` delegates persistence to an `EventStoreBackend` protocol. The
default `InMemoryEventBackend` stores events in memory (suitable for tests
and single-process deployments). A PostgreSQL backend will be added in a
future ticket to provide durable, multi-process event storage.

### Design Constraints

- **Append-only** — events are never modified or deleted.
- **Monotonic sequencing** — `sequence` values are globally ordered.
- **Frozen events** — `Event` dataclass is frozen; mutation raises `FrozenInstanceError`.
- **Backend-agnostic** — swap storage by implementing `EventStoreBackend` protocol.

See also: [FORGEOS-ARCH007 — Event Sourcing Architecture](../docs/architecture/event-sourcing-schema.md).


## Database Migrations

ForgeOS uses [Alembic](https://alembic.sqlalchemy.org/) for PostgreSQL schema
management. All migration configuration lives under `mcp-server/alembic/`.

### Configuration

Alembic reads the database URL from the `DATABASE_URL` environment variable
(same source as the runtime server):

```bash
export DATABASE_URL="postgresql+asyncpg://forgeos:forgeos@localhost:5432/forgeos"
```

### Running migrations

```bash
cd mcp-server

# Apply all pending migrations
alembic upgrade head

# Roll back one revision
alembic downgrade -1

# Show migration history
alembic history --verbose

# Generate offline SQL (for DBA review)
alembic upgrade head --sql
```

### Creating a new migration

```bash
alembic revision -m "short_description"
```

Alembic stamps each revision file with an ISO-8601 timestamp via the custom
template in `alembic/script.py.mako`.

### Initial schema (revision 001)

The first migration creates the full ForgeOS ticket-management schema:

| Category | Objects |
|---|---|
| Enum types | `ticket_status`, `ticket_type`, `ticket_priority`, `sdlc_stage`, `agent_type` |
| Tables | `tickets`, `ticket_events`, `agents`, `agent_assignments`, `sdlc_transitions`, `system_config`, `audit_log` |
| Triggers | `set_updated_at` on every table with an `updated_at` column |
| Indexes | B-tree, GIN (jsonb), and partial indexes for query performance |
| Seed data | Default row in `system_config` |

### Project structure

```
mcp-server/
  alembic.ini              # Alembic configuration
  alembic/
    env.py                 # Async migration runner (asyncpg)
    script.py.mako         # Timestamped revision template
    versions/
      001_initial_schema.py
  src/mcp_server/
    db/
      __init__.py           # Public re-exports (16 symbols)
      connection.py         # DatabaseConfig, URL helpers, engine factories
      migration_helpers.py  # Enum / trigger / index DDL utilities
```

### Database module API

| Export | Source | Purpose |
|---|---|---|
| `DatabaseConfig` | `connection` | Pydantic-settings model for DB configuration |
| `get_database_url` | `connection` | Read `DATABASE_URL` from environment |
| `convert_to_asyncpg_url` | `connection` | Convert URL to `asyncpg` dialect |
| `convert_to_psycopg2_url` | `connection` | Convert URL to `psycopg2` dialect |
| `create_async_engine` | `connection` | Build async SQLAlchemy engine |
| `create_sync_engine` | `connection` | Build sync SQLAlchemy engine |
| `create_enum_type` | `migration_helpers` | Emit `CREATE TYPE ... AS ENUM` |
| `drop_enum_type` | `migration_helpers` | Emit `DROP TYPE IF EXISTS` |
| `create_updated_at_trigger` | `migration_helpers` | Attach auto-update trigger |
| `drop_updated_at_trigger` | `migration_helpers` | Remove auto-update trigger |
| `create_updated_at_function` | `migration_helpers` | Install `set_updated_at()` PL/pgSQL |
| `drop_updated_at_function` | `migration_helpers` | Remove `set_updated_at()` function |
| `create_index` | `migration_helpers` | Create index with existence check |
| `drop_index` | `migration_helpers` | Drop index with existence check |
| `create_partial_index` | `migration_helpers` | Create filtered index |
| `create_gin_index` | `migration_helpers` | Create GIN index for JSONB |

## License

MIT
