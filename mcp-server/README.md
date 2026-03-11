# ForgeOS MCP Server

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
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
| `GITHUB_WEBHOOK_SECRET` | *(none)* | HMAC-SHA256 secret for GitHub webhook signature verification. When set, inbound GitHub webhooks must include a valid `X-Hub-Signature-256` header. |

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


### Health Monitoring

<!-- last_reviewed: 2026-03-11T00:30:00Z -->

The `mcp_server.db.health` module provides background health monitoring for the
connection pool. It tracks pool statistics, detects dead connections via
periodic ping, and recycles stale connections when they exceed a configurable
maximum lifetime.

#### Quick Start

```python
from mcp_server.db import ConnectionPool, PoolHealthMonitor

pool = ConnectionPool(config)
await pool.initialize()

# Start background monitoring (30s interval, 1h max lifetime)
monitor = PoolHealthMonitor(pool, check_interval=30.0, max_lifetime=3600.0)
monitor.start()

# Get health snapshot
report = monitor.health_report()
print(report.saturation_pct)  # e.g. 45.0

# JSON-serializable dict for /health endpoint
health_dict = monitor.to_dict()

# Stop monitoring
await monitor.stop()
```

#### PoolHealthMonitor Parameters

| Parameter | Default | Description |
|---|---|---|
| `pool` | *(required)* | `ConnectionPool` instance to monitor |
| `check_interval` | `30.0` | Seconds between health checks |
| `max_lifetime` | `3600.0` | Maximum connection lifetime before recycling (seconds) |

#### PoolHealthMonitor Methods

| Method | Returns | Description |
|---|---|---|
| `start()` | `None` | Start background health check loop (idempotent) |
| `stop()` | `None` | Cancel the background task and wait for cleanup |
| `health_report()` | `HealthReport` | Build a frozen snapshot of current pool metrics |
| `to_dict()` | `dict` | Return health report as a JSON-serializable dict |
| `record_acquire_wait(wait_ms)` | `None` | Record connection acquire wait time |
| `increment_waiting()` | `None` | Increment waiting request counter |
| `decrement_waiting()` | `None` | Decrement waiting counter (clamped at 0) |
| `is_running` | `bool` | Property — `True` if the background task is active |

#### HealthReport Fields

| Field | Type | Description |
|---|---|---|
| `total_connections` | `int` | Total connections in the pool |
| `active_connections` | `int` | Connections currently in use |
| `idle_connections` | `int` | Connections available for use |
| `waiting_requests` | `int` | Acquire requests waiting for a connection |
| `saturation_pct` | `float` | Percentage of max capacity in active use |
| `avg_wait_time_ms` | `float` | Average acquire wait time in milliseconds |
| `max_lifetime_seconds` | `float` | Configured max connection lifetime |
| `is_healthy` | `bool` | `True` if last ping succeeded |
| `last_check_epoch` | `float` | Monotonic timestamp of last health check |

#### Health Check Behavior

| Event | Action |
|---|---|
| Ping succeeds | Marks pool healthy; checks if `max_lifetime` exceeded |
| Ping fails | Marks pool unhealthy; expires all connections for recycling |
| `max_lifetime` exceeded | Expires connections to force rotation |
| Background task exception | Logs error, continues checking on next interval |



## Dependency Injection — Server-to-Database Wiring

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.dependencies` module provides a frozen dataclass container
that holds the connection pool and all repository instances. The server
lifespan creates this container on startup and tears it down on shutdown.
Tool handlers access repositories through the container — never touching
the pool directly.

### How It Works

1. On server startup, the `_app_lifespan` context manager creates a
   `Dependencies` instance via the async `Dependencies.create()` factory.
2. The factory initialises the `ConnectionPool`, then builds
   `TicketRepository`, `ClaimRepository`, `EventRepository`, and
   `AuditRepository`.
3. The `Dependencies` instance is stored in an `AppContext` dataclass
   and yielded to all tool handlers via the FastMCP lifespan protocol.
4. On shutdown, `Dependencies.close()` drains and closes the pool.

### Quick Start

```python
from mcp_server.dependencies import Dependencies

# Create — initialises pool + repositories
deps = await Dependencies.create(
    dsn="postgresql://forgeos:forgeos@localhost:5432/forgeos",
    min_size=2,
    max_size=10,
)

# Access repositories (never the pool)
ticket = await deps.ticket_repo.get_by_id("FORGEOS-BE018")
claim  = await deps.claim_repo.get_active_claim("FORGEOS-BE018")
events = await deps.event_repo.get_events_by_ticket("FORGEOS-BE018")

# Teardown — drains active connections, then closes
await deps.close()
```

### Degraded Mode

When `FORGEOS_DB_REQUIRED` is `false` (the default), the server starts
even if PostgreSQL is unreachable. In this case `AppContext.dependencies`
is `None` and database-dependent tools return appropriate error responses.

Set `FORGEOS_DB_REQUIRED=true` in production to fail fast with a non-zero
exit code if the database is unavailable at startup.

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `Dependencies` | frozen dataclass | Immutable container holding pool + 4 repositories |
| `Dependencies.create()` | async static method | Factory: initialises pool, builds repos, returns container |
| `Dependencies.close()` | async method | Drains and closes the connection pool |
| `AppContext` | dataclass | Lifespan context with config, dependencies, and health checker |
| `AppContext.db_pool` | property | Backward-compatible pool accessor (prefer repository access) |
| `AppContext.ticket_repo` | property | Shortcut to `dependencies.ticket_repo` |
| `AppContext.claim_repo` | property | Shortcut to `dependencies.claim_repo` |
| `AppContext.event_repo` | property | Shortcut to `dependencies.event_repo` |

### Dependencies Attributes

| Attribute | Type | Description |
|---|---|---|
| `pool` | `ConnectionPool` | The asyncpg pool wrapper (lifecycle + health) |
| `ticket_repo` | `TicketRepository` | Data access for the `tickets` table |
| `claim_repo` | `ClaimRepository` | Atomic claim/release operations |
| `event_repo` | `EventRepository` | Append-only audit trail |
| `audit_repo` | `AuditRepository` | Structured audit log (insert + query) |


## File-Level Advisory Lock Mutex

<!-- last_reviewed: 2026-03-10T20:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server/locking/` package provides a file-level advisory lock mutex
that prevents two agents from modifying the same workspace file concurrently.

### How It Works

1. A file path is hashed to a deterministic signed int64 using CRC32 with a
   fixed `0x464F5247` ("FORG") namespace in the upper 32 bits.
2. `pg_advisory_xact_lock(key)` acquires a transaction-scoped advisory lock
   (blocking mode) or `pg_try_advisory_xact_lock(key)` attempts non-blocking
   acquisition.
3. After the advisory lock is held, a row is inserted into the `file_locks`
   table for observability (the advisory lock is the authoritative mutex).
4. The lock releases automatically when the transaction commits or rolls back.

### Usage

```python
from mcp_server.locking import FileMutex, file_path_to_lock_key

# Create a mutex instance
mutex = FileMutex()

# Blocking acquire — waits until the lock is available
record = await mutex.acquire(conn, "src/db/pool.py", "FORGEOS-BE007")

# Non-blocking acquire — returns immediately
result = await mutex.try_acquire(conn, "src/db/pool.py", "FORGEOS-BE007")
if result.acquired:
    # lock held
    ...

# Check for conflicts before acquiring
conflicts = await mutex.check_conflicts(conn, ["src/db/pool.py"])

# Query active locks
locks = await mutex.get_active_locks(conn, ticket_id="FORGEOS-BE007")
```

### Hash Function

`file_path_to_lock_key(path)` converts a workspace-relative file path to a
signed int64 advisory lock key:

- Normalizes the path (strips whitespace and leading/trailing slashes).
- Computes `CRC32(normalized.encode("utf-8"))` for the lower 32 bits.
- Uses `0x464F5247` ("FORG") as the upper 32 bits (namespace).
- Packs the combined 64-bit value as a signed integer (`struct.pack(">Q")` then
  `struct.unpack(">q")`).

### API Reference

| Symbol | Type | Description |
|--------|------|-------------|
| `FileMutex` | class | Advisory lock manager with blocking and non-blocking modes |
| `file_path_to_lock_key` | function | Deterministic file path to int64 hash |
| `FileLockRecord` | frozen dataclass | Observability record for an active lock |
| `LockAcquireResult` | frozen dataclass | Result of a non-blocking lock attempt |
| `FileConflictError` | exception | Raised when a file is already locked |

### FileMutex Methods

| Method | Description |
|--------|-------------|
| `acquire(conn, file_path, ticket_id, ...)` | Blocking lock acquisition |
| `try_acquire(conn, file_path, ticket_id, ...)` | Non-blocking lock attempt |
| `release_ticket_locks(conn, ticket_id)` | Delete observability records for a ticket |
| `get_active_locks(conn, ...)` | Query active lock records |
| `check_conflicts(conn, file_paths)` | Check if any paths are already locked |

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Empty file path | `ValueError` raised |
| File already locked (blocking) | Waits until lock is released |
| File already locked (non-blocking) | Returns `LockAcquireResult(acquired=False)` |
| Connection lost | Advisory lock auto-released by PostgreSQL |
| Transaction rollback | Advisory lock auto-released |

### Design Constraints

- Advisory locks are transaction-scoped. They release on commit or rollback.
- The `file_locks` table is informational only. The advisory lock is authoritative.
- CRC32 hashing means collisions are theoretically possible but unlikely for
  typical workspace path lengths.
- The "FORG" namespace avoids collisions with advisory locks used by other
  PostgreSQL subsystems.


## Repository Pattern — Data Access Layer

<!-- last_reviewed: 2026-03-10T18:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.repositories` package implements the repository pattern for all
database access. Three repository classes encapsulate SQL queries for tickets,
claims, and events. Each accepts an asyncpg connection pool via constructor
injection and uses parameterized queries exclusively.

### Repositories

| Class | Module | Purpose |
|---|---|---|
| `TicketRepository` | `repositories.ticket_repo` | CRUD, filtering, and stage queries for the `tickets` table |
| `ClaimRepository` | `repositories.claim_repo` | Atomic claim/release operations for distributed ticket locking |
| `EventRepository` | `repositories.event_repo` | Append-only event sourcing for the audit trail |

### Quick Start

```python
from mcp_server.repositories import TicketRepository, ClaimRepository, EventRepository

# All repositories accept an asyncpg pool
ticket_repo = TicketRepository(pool)
claim_repo = ClaimRepository(pool)
event_repo = EventRepository(pool)

# Fetch a ticket
ticket = await ticket_repo.get_by_id("FORGEOS-BE013")

- **`mcp_server/repositories/`** — Repository pattern data access layer (TicketRepository, ClaimRepository, EventRepository)
# List tickets in a stage
ready_tickets = await ticket_repo.list_by_stage("READY", limit=10)

# Claim a ticket atomically
claim = await claim_repo.create_claim(
    ticket_id="FORGEOS-BE013",
    agent_id=agent_uuid,
    agent_name="Backend",
    machine_id="pop-os",
    operator="ReaperOAK",
)

# Append an audit event
event = await event_repo.append_event(
    ticket_id="FORGEOS-BE013",
    event_type="CLAIMED",
    agent_name="Backend",
)
```

### TicketRepository Methods

| Method | Returns | Description |
|---|---|---|
| `get_by_id(ticket_id)` | `TicketRow \| None` | Fetch one ticket by human-readable ID |
| `list_by_stage(stage, limit, offset)` | `list[TicketRow]` | List tickets in a stage, ordered by priority then creation date |
| `list_by_type(ticket_type, limit, offset)` | `list[TicketRow]` | Filter tickets by type |
| `list_tickets(stage, ticket_type, priority, claimed_by, machine_id, limit, offset)` | `tuple[list[TicketRow], int]` | Multi-filter list with total count via `COUNT(*) OVER()` |
| `list_filtered(stage, ticket_type, priority, limit, offset)` | `list[TicketRow]` | Combined filter list (stage, type, priority) |
| `create(ticket_id, title, ...)` | `TicketRow` | Insert a new ticket |
| `update_stage(ticket_id, new_stage, new_status)` | `TicketRow \| None` | Update stage and status |
| `count_by_stage()` | `dict[str, int]` | Aggregate ticket counts per stage |
| `count_by_stage_and_type()` | `list[dict]` | Aggregate ticket counts per stage and type combination |

### ClaimRepository Methods

| Method | Returns | Description |
|---|---|---|
| `create_claim(ticket_id, agent_id, agent_name, machine_id, operator, lease_duration_minutes)` | `ClaimInfo \| None` | Atomically claim an unclaimed READY ticket; returns `None` on conflict |
| `release_claim(ticket_id)` | `bool` | Release a claim, setting ticket back to READY |
| `get_active_claim(ticket_id)` | `ClaimInfo \| None` | Fetch non-expired claim for a ticket |
| `list_expired_claims()` | `list[ClaimInfo]` | List all tickets with expired but unreleased claims |

### EventRepository Methods

| Method | Returns | Description |
|---|---|---|
| `append_event(ticket_id, event_type, ...)` | `EventRow` | Append a new event to the audit trail |
| `get_events_by_ticket(ticket_id, limit, offset)` | `list[EventRow]` | Fetch events for a ticket, newest first |
| `get_events_by_agent(agent_name, limit, offset)` | `list[EventRow]` | Fetch events by a specific agent |
| `get_events_by_timerange(since, until, limit, offset)` | `list[EventRow]` | Fetch events within a time window |

### Data Classes

| Class | Module | Description |
|---|---|---|
| `TicketRow` | `ticket_repo` | Frozen dataclass with all ticket fields (29 attributes) |
| `ClaimInfo` | `claim_repo` | Frozen dataclass with claim state (7 attributes) |
| `EventRow` | `event_repo` | Frozen dataclass with event fields (13 attributes) |

### Design Constraints

- **Parameterized SQL** — all queries use `$1`, `$2`, etc. No string interpolation.
- **Constructor injection** — repositories receive the pool; they never create connections.
- **Async only** — all methods are `async` using asyncpg's native async interface.
- **Immutable results** — all return types are frozen dataclasses.
- **Atomic claims** — `create_claim` uses `UPDATE ... WHERE claimed_by IS NULL` for mutual exclusion.



## Ticket Claim Queue

<!-- last_reviewed: 2026-03-10T17:30:00Z -->

The `mcp_server.locking` package provides a distributed ticket claim queue
using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED`. Agents atomically claim the
next eligible ticket without blocking each other -- if a ticket is already being
claimed by another transaction, it is transparently skipped.

### How it works

1. Agent calls `claim_next()` or `claim_for_role()` with its stage and identity.
2. The stored function `claim_ticket` runs `SELECT FOR UPDATE SKIP LOCKED`
   inside a single transaction.
3. Exactly one agent wins each ticket. Concurrent claimants skip to the next
   eligible row -- no blocking, no deadlocks.
4. The winner receives a `ClaimResult` with ticket data and a lease expiry.

### Quick Start

```python
from mcp_server.locking import ClaimQueue, AgentRoleMap

queue = ClaimQueue(pool)  # accepts any asyncpg-compatible pool

# Claim the next ticket at the BACKEND stage
result = await queue.claim_next(
    stage="BACKEND",
    agent_id="550e8400-e29b-41d4-a716-446655440000",
    agent_name="Backend",
    machine_id="pop-os",
    lease_minutes=30,
)

if result:
    print(f"Claimed {result.ticket_id}: {result.title}")
    print(f"Lease expires: {result.lease_expiry}")

# Claim by role (resolves role to stage automatically)
result = await queue.claim_for_role(
    role="backend",
    agent_id="550e8400-e29b-41d4-a716-446655440000",
    agent_name="Backend",
    machine_id="pop-os",
)

# Claim a specific ticket by ID
result = await queue.claim_by_id(
    ticket_id="FORGEOS-BE006",
    agent_id="550e8400-e29b-41d4-a716-446655440000",
    agent_name="Backend",
    machine_id="pop-os",
)
```

### ClaimQueue Methods

| Method | Returns | Description |
|---|---|---|
| `claim_next(stage, agent_id, ...)` | `ClaimResult \| None` | Claim the next available ticket for a stage |
| `claim_by_id(ticket_id, agent_id, ...)` | `ClaimResult \| None` | Claim a specific ticket by human-readable ID |
| `claim_for_role(role, agent_id, ...)` | `ClaimResult \| None` | Resolve role to stage, then claim next ticket |

All methods accept optional `operator` (str) and `lease_minutes` (int, default 30).

### AgentRoleMap

Stateless utility mapping agent roles to SDLC stages and ticket types.

| Method | Returns | Description |
|---|---|---|
| `stage_for_role(role)` | `str \| None` | SDLC stage for a role (e.g. `"backend"` to `"BACKEND"`) |
| `ticket_types_for_role(role)` | `list[str]` | Ticket types the role can process |
| `is_compatible(role, ticket_type)` | `bool` | Whether a role can handle a ticket type |

Supported roles: `architect`, `research`, `product_manager`, `ui_designer`,
`backend`, `devops`, `frontend`, `qa`, `security`, `ci`, `documentation`, `validator`.

### ClaimResult

Frozen dataclass returned on a successful claim:

| Field | Type | Description |
|---|---|---|
| `id` | `str` | Internal UUID |
| `ticket_id` | `str` | Human-readable ID (e.g. `"FORGEOS-BE006"`) |
| `title` | `str` | Ticket title |
| `ticket_type` | `str` | Type (e.g. `"backend"`) |
| `priority` | `str` | Priority level |
| `stage` | `str` | Current SDLC stage |
| `status` | `str` | Status (will be `"CLAIMED"`) |
| `agent_id` | `str` | UUID of the claiming agent |
| `agent_name` | `str` | Agent display name |
| `machine_id` | `str` | Hostname of the claiming machine |
| `lease_expiry` | `datetime` | When the claim lease expires |
| `file_paths` | `list[str]` | Files in the ticket scope |
| `acceptance_criteria` | `list[str]` | Ticket acceptance criteria |
| `depends_on` | `list[str]` | Dependency ticket IDs |
| `metadata` | `dict[str, Any]` | Additional ticket metadata |

### Error Handling

| Error | HTTP | When |
|---|---|---|
| `ClaimError` | 409 | Base error for claim failures (file conflict, unknown role) |
| `NoEligibleTicketError` | 404 | No ticket available for the given criteria |
| `LeaseExpiredError` | 410 | Lease on a claimed ticket has expired |
| `DatabaseError` | 503 | Database communication error |

### Design Constraints

- **Stored-function delegation** -- all locking SQL lives in PL/pgSQL stored functions.
- **No retry loops** -- returns `None` immediately if no ticket is available.
- **Agent-role filtering** -- `AgentRoleMap` translates role to stage before calling the stored function.
- **Structured logging** -- all operations include agent_id, machine_id, and ticket_id correlation context.


## Lease Heartbeat

<!-- last_reviewed: 2026-03-11T18:45:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.locking.lease_heartbeat` module provides a lease heartbeat
mechanism that replaces the fixed 30-minute lease timeout from the git-based
system. Agents send periodic heartbeats to extend their lease while actively
working on a ticket. When heartbeats stop (crash, disconnect, or completion),
the lease expires naturally and the ticket becomes reclaimable.

### How It Works

1. An agent claims a ticket and receives a `lease_expiry` timestamp.
2. A background `LeaseHeartbeat` task periodically calls `extend_lease()`,
   which issues a conditional `UPDATE` — extending `lease_expiry` only if
   the ticket is still claimed by the same agent.
3. Each successful heartbeat writes a record to the `lease_heartbeats` audit
   table for observability.
4. If the agent crashes or disconnects, heartbeats stop. The lease expires
   and `find_stale_claims()` detects the abandoned claim.

### Configuration

`HeartbeatConfig` is a frozen dataclass controlling heartbeat behavior:

| Parameter | Default | Description |
|---|---|---|
| `interval_seconds` | `60.0` | How often the heartbeat fires (seconds) |
| `extension_seconds` | `120.0` | Seconds added to `lease_expiry` per heartbeat |
| `max_lease_seconds` | `7200.0` | Maximum total lease duration from the original claim time (2 hours) |

Validation rules:
- All values must be positive.
- `interval_seconds` must be less than `extension_seconds` to prevent lease gaps.

### Usage

Use `LeaseHeartbeat` as an async context manager for automatic lifecycle
management:

```python
from mcp_server.locking.lease_heartbeat import LeaseHeartbeat, HeartbeatConfig

config = HeartbeatConfig(interval_seconds=30, extension_seconds=90)

async with LeaseHeartbeat(pool, ticket_id="FORGEOS-BE008", agent_id=agent_uuid, config=config):
    # ... do work ... heartbeat runs in background
    pass
# heartbeat task is cancelled on exit
```

Or manage the lifecycle explicitly:

```python
hb = LeaseHeartbeat(pool, ticket_id="FORGEOS-BE008", agent_id=agent_uuid)
await hb.start()

# ... do work ...
print(hb.heartbeat_count)   # number of successful heartbeats
print(hb.is_running)        # True while the background task is active

await hb.stop()
```

### Stale Claim Detection

`find_stale_claims()` returns tickets whose lease has expired without a recent
heartbeat — indicating the claiming agent has stopped working:

```python
from mcp_server.locking.lease_heartbeat import find_stale_claims

stale = await find_stale_claims(pool, heartbeat_interval_seconds=60.0)
for claim in stale:
    print(f"{claim.ticket_id} claimed by {claim.agent_name} on {claim.machine_id}")
```

A claim is stale when:
1. `lease_expiry` is in the past, AND
2. No heartbeat was recorded within `2 × heartbeat_interval_seconds`.

### API Reference

| Symbol | Type | Description |
|---|---|---|
| `HeartbeatConfig` | frozen dataclass | Configuration for heartbeat interval, extension, and max duration |
| `LeaseHeartbeat` | class | Async context manager that runs a background heartbeat task |
| `HeartbeatRecord` | frozen dataclass | Immutable record of one successful heartbeat event |
| `StaleClaim` | frozen dataclass | A claim that has not received a heartbeat within the expected window |
| `extend_lease()` | async function | Conditionally extend `lease_expiry` for an active claim |
| `find_stale_claims()` | async function | Detect claims with expired leases and no recent heartbeats |
| `PoolLike` | Protocol | Minimal async pool interface (structural subtyping) |

### LeaseHeartbeat Properties

| Property | Type | Description |
|---|---|---|
| `ticket_id` | `str` | The ticket being kept alive |
| `agent_id` | `str` | The agent whose lease is extended |
| `config` | `HeartbeatConfig` | Active heartbeat configuration |
| `heartbeat_count` | `int` | Number of successful heartbeats sent |
| `last_error` | `Exception \| None` | Last error encountered, or `None` |
| `is_running` | `bool` | `True` while the background task is active |

### Error Handling

| Error | HTTP | When |
|---|---|---|
| `HeartbeatError` | 409 | Base error for heartbeat failures |
| `LeaseNotActiveError` | 410 | Lease was released, reassigned, or expired before the heartbeat |
| `MaxLeaseDurationExceededError` | 409 | Extending would exceed `max_lease_seconds` |
| `DatabaseError` | 503 | Database communication error |

### Heartbeat Loop Behavior

| Event | Action |
|---|---|
| Heartbeat succeeds | Increments `heartbeat_count`; clears `last_error` |
| `LeaseNotActiveError` | Loop stops gracefully (claim was released or reassigned) |
| `MaxLeaseDurationExceededError` | Loop stops gracefully (max lease duration reached) |
| Transient DB error | Logs the error, sets `last_error`, retries on next interval |
| `asyncio.CancelledError` | Loop exits immediately (normal shutdown path) |
| Context manager exit | Calls `stop()`, cancels the background task |

### Design Constraints

- **Conditional update** — the `UPDATE` only succeeds if `claimed_by` still
  matches the heartbeat sender, preventing extensions on released or
  reassigned tickets.
- **Append-only audit** — every heartbeat writes to `lease_heartbeats`. Records
  are never deleted during normal operation.
- **No retry loops** — if the lease is no longer extendable, the heartbeat
  stops. Callers handle reconnection.
- **Transaction-scoped** — each heartbeat is a single transaction with
  `FOR UPDATE` row locking.
- **Structured logging** — all operations include `ticket_id` and `agent_id`
  correlation context.


## Transaction Isolation

<!-- last_reviewed: 2026-03-11T12:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.locking.transaction_config` module maps ForgeOS operations to
PostgreSQL transaction isolation levels and provides an async context manager
that enforces the correct isolation level per transaction. Serialization
failures (SQLSTATE `40001`) are retried automatically with exponential back-off.

### Isolation Level Strategy

ForgeOS uses two isolation levels, chosen per operation type:

| Operation | Isolation Level | Rationale |
|---|---|---|
| `CLAIM` | `READ COMMITTED` | Claims use `SELECT FOR UPDATE SKIP LOCKED`. Non-blocking semantics skip locked rows, so `SERIALIZABLE` is unnecessary. |
| `ADVANCE` | `SERIALIZABLE` | State transitions must see a consistent snapshot. Concurrent advance/rework on the same ticket is detected and rolled back. |
| `REWORK` | `SERIALIZABLE` | Same consistency requirements as advance — a ticket must not be advanced and reworked simultaneously. |
| `RELEASE` | `READ COMMITTED` | Idempotent operation with no conflicting state. |
| `SPAWN` | `READ COMMITTED` | Inserts a new row with no conflicting state. |
| `READ` | `READ COMMITTED` | Read-only queries for dashboard and status. |

### Usage

```python
from mcp_server.locking import transactional, OperationType

async with transactional(pool, OperationType.ADVANCE) as conn:
    # conn is inside a SERIALIZABLE transaction
    await conn.execute("UPDATE tickets SET stage = $1 WHERE id = $2", new_stage, tid)
```

The context manager acquires a connection from the pool, starts a transaction
at the mapped isolation level, and yields the connection. On success the
transaction commits; on exception it rolls back. The connection is always
released back to the pool.

### Serialization Failure Retry

When PostgreSQL detects a serialization conflict under `SERIALIZABLE` isolation,
it raises SQLSTATE `40001`. The `transactional()` context manager catches this
and retries the entire block with exponential back-off:

```
attempt 1 → fail → sleep 50ms
attempt 2 → fail → sleep 100ms
attempt 3 → fail → sleep 200ms
attempt 4 → fail → raise SerializationError
```

| Parameter | Default | Description |
|---|---|---|
| `max_retries` | `3` | Maximum retry attempts after the initial try |
| `base_delay` | `0.05` | Base delay in seconds (doubles each retry) |

After exhausting retries, `SerializationError` is raised with the operation
type and total attempt count.

### API Reference

| Symbol | Type | Description |
|---|---|---|
| `IsolationLevel` | enum | `READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE` |
| `OperationType` | enum | `CLAIM`, `ADVANCE`, `REWORK`, `RELEASE`, `SPAWN`, `READ` |
| `OperationIsolation` | frozen dataclass | Maps an operation to its isolation level with a justification string |
| `OPERATION_ISOLATION_MAP` | dict | Canonical mapping of all operation types to isolation configs |
| `isolation_for(operation)` | function | Look up the isolation level for an operation type |
| `transactional(pool, operation, ...)` | async context manager | Execute a block inside a correctly-isolated transaction |
| `SerializationError` | exception | Raised after retries are exhausted on `40001` |
| `TransactionError` | exception | Non-retryable transaction failure |
| `PoolLike` | Protocol | Minimal async pool interface (`acquire()` / `release()`) |

### Error Handling

| Scenario | Behavior |
|---|---|
| Serialization failure (`40001`) | Retries with exponential back-off up to `max_retries` |
| Retries exhausted | Raises `SerializationError(operation, attempts)` |
| Non-serialization exception | Propagates immediately, no retry |
| Exception in user block | Transaction rolls back; connection released |
| Successful completion | Transaction commits; connection released |

### Design Constraints

- **No business logic** — this module is purely infrastructure. Business
  operations import `transactional()` and pass a pool + operation type.
- **Enum-driven mapping** — the `OPERATION_ISOLATION_MAP` dict is the single
  source of truth for which operations use which isolation level.
- **Justification-required** — every entry in the map includes a human-readable
  justification string explaining the isolation level choice.
- **Protocol-based pool** — `PoolLike` uses structural subtyping so any pool
  with `acquire()` and `release()` methods works without inheritance.


## Expired Lease Cleanup

<!-- last_reviewed: 2026-03-11T12:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.locking.lease_cleanup` module provides a background task that
periodically scans for expired ticket leases and releases them, making the
associated tickets available for reclaim. Each automatic release is recorded in
the `event_history` table for audit.

### How It Works

1. The background task sleeps for a configurable interval (default 30 seconds).
2. On each cycle, it queries the `tickets` table for rows where `claimed_by IS
   NOT NULL` and `lease_expiry < NOW()`.
3. Each expired lease is released atomically in its own transaction: claim
   fields are cleared, status and stage are reset to READY, and an
   `event_history` record is inserted.
4. If another process already released the same lease, the release is skipped.

### Quick Start

```python
from mcp_server.locking import LeaseCleanupTask, LeaseCleanupConfig

config = LeaseCleanupConfig(scan_interval_seconds=30, batch_size=100)

# Use as an async context manager
async with LeaseCleanupTask(pool, config=config):
    # cleanup runs in background
    ...
# task is cancelled on exit
```

Or use standalone functions for a single scan cycle:

```python
from mcp_server.locking import scan_and_release_expired

releases = await scan_and_release_expired(pool, batch_size=100)
for r in releases:
    print(f"Released {r.ticket_id} (expired {r.time_since_expiry_seconds:.1f}s ago)")
```

### LeaseCleanupConfig

| Parameter | Default | Description |
|---|---|---|
| `scan_interval_seconds` | `30.0` | Seconds between cleanup scans |
| `batch_size` | `100` | Maximum expired leases to process per cycle |

Both parameters must be positive; `ValueError` is raised otherwise.

### LeaseCleanupTask

Async background task with lifecycle management.

| Method / Property | Returns | Description |
|---|---|---|
| `start()` | `None` | Start the background cleanup loop |
| `stop()` | `None` | Cancel the background task gracefully |
| `config` | `LeaseCleanupConfig` | The cleanup configuration |
| `scan_count` | `int` | Number of scan cycles completed |
| `total_released` | `int` | Total expired leases released |
| `last_error` | `Exception \| None` | Last error from the cleanup loop |
| `is_running` | `bool` | Whether the background task is active |
| `__aenter__` / `__aexit__` | — | Async context manager (start on enter, stop on exit) |

### Standalone Functions

| Function | Returns | Description |
|---|---|---|
| `find_expired_leases(pool, batch_size)` | `list[ExpiredLease]` | Query for expired leases, oldest first |
| `release_expired_lease(pool, expired)` | `LeaseRelease` | Release one expired lease atomically |
| `scan_and_release_expired(pool, batch_size)` | `list[LeaseRelease]` | Find and release all expired leases in one cycle |

### Data Classes

| Class | Description |
|---|---|
| `ExpiredLease` | Detected expired lease with `ticket_id`, `agent_id`, `agent_name`, `machine_id`, `lease_expiry`, `last_heartbeat`, `previous_stage` |
| `LeaseRelease` | Successful release record with `ticket_id`, `agent_id`, `agent_name`, `machine_id`, `released_at`, `time_since_expiry_seconds`, `time_since_last_heartbeat_seconds` |

### Error Handling

| Error | When |
|---|---|
| `LeaseCleanupError` | Lease was already released by another process |
| `DatabaseError` | Database communication failure |

The background loop catches both errors per-lease and continues processing
remaining leases. Transient database errors are retried on the next scan cycle.

### Design Constraints

- **Atomic per-lease** — each release runs in its own transaction. One failure
  does not block other releases.
- **Optimistic concurrency** — the `UPDATE` checks `claimed_by` matches the
  expected agent. If another process released the lease first, the update
  affects zero rows and `LeaseCleanupError` is raised.
- **Structured logging** — every release logs `ticket_id`, `agent_id`, and
  `time_since_last_heartbeat_seconds` for operational observability.
- **No retry loops** — if a lease release fails, it is retried on the next
  scan cycle rather than immediately.
- **Protocol-based pool** — `PoolLike` uses structural subtyping for
  dependency injection.


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


## Agent Session Lifecycle Management

<!-- last_reviewed: 2026-03-11T20:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.sessions` package manages per-agent session lifecycles. Each
connecting agent establishes a session that tracks identity, connection state,
and associated ticket claims. Sessions support heartbeat tracking, timeout
cleanup, and resumption after transient disconnects.

### Quick Start

```python
from mcp_server.sessions import SessionManager, SessionConfig, SessionState

config = SessionConfig(session_timeout_seconds=300)
mgr = SessionManager(config=config)

# Create a session when an agent connects
session = mgr.create_session("Backend", "backend", "pop-os")

# Periodic heartbeat keeps the session alive
mgr.heartbeat(session.session_id)

# Disconnect on transport close
mgr.disconnect_session(session.session_id)

# Resume within the resumption window
resumed = mgr.resume_session(session.session_id, "Backend", "backend", "pop-os")

# List all active sessions
active = mgr.list_sessions(state=SessionState.ACTIVE)
```

### Session Configuration

| Parameter | Default | Description |
|---|---|---|
| `session_timeout_seconds` | `300.0` | Max idle time before a session expires |
| `cleanup_interval_seconds` | `30.0` | Interval between background cleanup sweeps |
| `resumption_window_seconds` | `120.0` | Max time a disconnected session stays resumable |

### Session Lifecycle

```
ACTIVE  --disconnect-->  DISCONNECTED  --timeout-->  EXPIRED
  |                          |
  |                          +--resume-->  ACTIVE
  +----------timeout------------------------------>  EXPIRED
```

1. **ACTIVE** -- Agent is connected and sending heartbeats.
2. **DISCONNECTED** -- Transport closed, but session can be resumed within
   `resumption_window_seconds`.
3. **EXPIRED** -- Session timed out. Associated claims are released via
   registered cleanup callbacks.

### SessionManager Methods

| Method | Returns | Description |
|---|---|---|
| `create_session(agent_name, role, machine_id, ...)` | `AgentSession` | Create a new session with identity metadata |
| `heartbeat(session_id)` | `AgentSession` | Update last-heartbeat timestamp |
| `disconnect_session(session_id)` | `AgentSession` | Mark session as disconnected |
| `close_session(session_id)` | `AgentSession` | Close and remove a session (explicit cleanup) |
| `resume_session(session_id, agent_name, role, machine_id)` | `AgentSession` | Resume a disconnected session with identity validation |
| `get_session(session_id)` | `AgentSession` | Retrieve a session by ID |
| `list_sessions(state=None)` | `list[AgentSession]` | List sessions, optionally filtered by state |
| `add_claim(session_id, ticket_id)` | `None` | Associate a ticket claim with a session |
| `remove_claim(session_id, ticket_id)` | `None` | Remove a ticket claim from a session |
| `register_cleanup_callback(callback)` | `None` | Register an async callback for expired sessions |
| `start_cleanup_loop()` | `None` | Start the background expiration task |
| `stop_cleanup_loop()` | `None` | Stop the background expiration task |

### AgentSession Fields

| Field | Type | Description |
|---|---|---|
| `session_id` | `str` | Unique session identifier (UUID4) |
| `agent_name` | `str` | Name of the connected agent |
| `role` | `str` | Agent role (e.g. `backend`, `qa`) |
| `machine_id` | `str` | Hostname or machine identifier |
| `state` | `SessionState` | Current lifecycle state |
| `connected_at` | `datetime` | UTC timestamp of session creation |
| `last_heartbeat` | `datetime` | UTC timestamp of last heartbeat |
| `disconnected_at` | `datetime \| None` | UTC timestamp of disconnect |
| `claimed_ticket_ids` | `list[str]` | Ticket IDs claimed through this session |
| `metadata` | `dict[str, Any]` | Arbitrary key-value metadata |

### Error Handling

| Error | When |
|---|---|
| `SessionNotFoundError` | Session ID does not exist in the manager |
| `SessionExpiredError` | Operating on an expired session or resumption window exceeded |
| `SessionResumeError` | Identity validation fails during resumption (agent_name, role, or machine_id mismatch) |

### Cleanup Callbacks

Register async callbacks to run when sessions expire. Callbacks receive the
expired `AgentSession` and can release ticket claims or close resources:

```python
async def release_claims(session: AgentSession) -> None:
    for ticket_id in session.claimed_ticket_ids:
        await claim_repo.release_claim(ticket_id)

mgr.register_cleanup_callback(release_claims)
await mgr.start_cleanup_loop()
```

### Design Constraints

- **Thread-safe** -- all session state is guarded by `threading.Lock`.
- **Async cleanup** -- background expiration runs via `asyncio.Task`.
- **Identity validation** -- resumption requires matching agent_name, role, and machine_id.
- **Zero external dependencies** -- uses only Python stdlib and internal observability.
- **Callbacks outside lock** -- cleanup callbacks execute after releasing the lock to avoid deadlocks.


## Concurrent Session Management

<!-- last_reviewed: 2026-03-11T20:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.sessions.concurrent` module extends session management with
async-safe concurrent access. `ConcurrentSessionManager` allows multiple agents
to hold simultaneous sessions without interference, enforces a configurable
maximum session limit (default 50), and provides O(1) session lookup.

### Quick Start

```python
from mcp_server.sessions import (
    ConcurrentSessionConfig,
    ConcurrentSessionManager,
    SessionState,
)

config = ConcurrentSessionConfig(max_concurrent_sessions=50)
mgr = ConcurrentSessionManager(config=config)

# Create a session when an agent connects
session = await mgr.create_session("Backend", "backend", "pop-os")

# Periodic heartbeat keeps the session alive
await mgr.heartbeat(session.session_id)

# Disconnect on transport close (session stays tracked for resumption)
await mgr.disconnect_session(session.session_id)

# Close and free the session slot
await mgr.close_session(session.session_id)

# List active sessions
active = await mgr.list_sessions(state=SessionState.ACTIVE)
```

### ConcurrentSessionConfig

Frozen dataclass controlling concurrent session behavior:

| Parameter | Default | Description |
|---|---|---|
| `max_concurrent_sessions` | `50` | Upper bound on simultaneous active sessions |
| `session_timeout_seconds` | `300.0` | Idle time before a session expires |
| `cleanup_interval_seconds` | `30.0` | Interval between background cleanup sweeps |
| `resumption_window_seconds` | `120.0` | Window for resuming disconnected sessions |

### ConcurrentSessionManager Methods

| Method | Returns | Description |
|---|---|---|
| `create_session(agent_name, role, machine_id, ...)` | `AgentSession` | Create a new session; raises `MaxSessionsExceededError` if limit reached |
| `get_session(session_id)` | `AgentSession` | O(1) lookup by session ID |
| `heartbeat(session_id)` | `AgentSession` | Update last-heartbeat timestamp |
| `disconnect_session(session_id)` | `AgentSession` | Mark session as disconnected (does not count against limit) |
| `close_session(session_id)` | `AgentSession` | Close and remove a session, freeing its slot |
| `list_sessions(state=None)` | `list[AgentSession]` | List sessions, optionally filtered by state |
| `add_claim(session_id, ticket_id)` | `None` | Associate a ticket claim with a session |
| `remove_claim(session_id, ticket_id)` | `None` | Remove a ticket claim from a session |
| `register_cleanup_callback(callback)` | `None` | Register an async callback for expired sessions |
| `start_cleanup_loop()` | `None` | Start background expiration task |
| `stop_cleanup_loop()` | `None` | Stop background expiration task |
| `active_count()` | `int` | Number of currently active sessions |
| `session_count()` | `int` | Total tracked sessions (all states) |
| `expire_timed_out_sessions()` | `list[AgentSession]` | Manually trigger expiration sweep |

### Session Limit Behavior

When `create_session()` is called and the number of active sessions equals
`max_concurrent_sessions`, it raises `MaxSessionsExceededError`:

```python
from mcp_server.sessions import MaxSessionsExceededError

try:
    session = await mgr.create_session("NewAgent", "backend", "pop-os")
except MaxSessionsExceededError as exc:
    print(f"Rejected: {exc}")
    print(f"Current: {exc.current_sessions}/{exc.max_sessions}")
    print(f"Retry after: {exc.retry_after_seconds}s")
```

The error message includes the current and maximum session counts and a
suggested retry delay (equal to `cleanup_interval_seconds`).

### Concurrency Model

- All mutable state access is guarded by `asyncio.Lock`.
- Session storage uses a `dict[str, AgentSession]` for O(1) lookup by ID.
- Cleanup callbacks execute outside the lock to prevent deadlocks.
- Disconnected sessions do not count against the active session limit.
- Session termination (timeout, disconnect, or explicit close) only affects
  the terminated session's resources — other sessions are unaffected.

### Error Handling

| Error | When |
|---|---|
| `MaxSessionsExceededError` | Active session count equals `max_concurrent_sessions` |
| `SessionNotFoundError` | Session ID does not exist in the manager |

### Design Constraints

- **Async-safe** -- `asyncio.Lock` guards all session state mutations.
- **O(1) lookup** -- dict-based storage; no linear scans for get/heartbeat/close.
- **Isolated termination** -- closing one session never affects others.
- **Configurable limit** -- `max_concurrent_sessions` defaults to 50, adjustable at init.
- **Clear rejection** -- `MaxSessionsExceededError` includes counts and retry guidance.
- **Callbacks outside lock** -- cleanup callbacks run after releasing the lock.


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
- **`mcp_server/db/`** — asyncpg connection pool, health monitoring, and pool metrics
- **`mcp_server/observability/`** — Structured JSON logging, correlation IDs, PII redaction, and health/readiness probes
- **`mcp_server/auth/`** — Agent API key authentication, machine registration and verification, rate limiting, and identity resolution
- **`mcp_server/api/`** — REST API routes and Pydantic schemas (`GET /api/tickets` list, `GET /api/tickets/{id}` detail, `GET /api/tickets/{id}/history` audit history, `POST/DELETE /api/tickets/{id}/claim`)
- **`mcp_server/services/`** — Business logic orchestration (TicketService, SyncEngine, MachineService, WebhookService)
- **`mcp_server/middleware/`** — Unified auth middleware (MCP + REST), per-agent rate limiting, correlation ID tracking
- **`mcp_server/tools/`** — Dynamic tool registration, schema validation, ticket tools (`tickets.next`, `tickets.claim`, `tickets.release`, `tickets.status`, `tickets.advance`, `tickets.rework`, `tickets.sync`, `tickets.validate`), and FastMCP bridge
- **`mcp_server/events/`** — Append-only event sourcing (EventStore, EventType, Event dataclass)
- **`mcp_server/locking/`** — Distributed claim queue (SKIP LOCKED), file mutex (advisory locks)
- **`mcp_server/notifications/`** — Notification queue (at-least-once delivery), configurable channels (webhook, Slack) with event-type filtering, background processor with exponential-backoff retries, and dead-letter handling
- **`mcp_server/sessions/`** -- Agent session lifecycle management (heartbeat, timeout, resumption, concurrent access)
- **`mcp_server/transport/webhooks.py`** — Inbound webhook HTTP receiver (`POST /api/webhooks/{source}`)
- **`mcp_server/webhooks/`** — GitHub webhook signature verification (HMAC-SHA256), push event handling, and CI status event handler (check_run/status → ticket advance or rework)

### Error Handling

Domain errors extend `ForgeOSError` and map to standard JSON-RPC error codes:

| Error Class | JSON-RPC Code | HTTP Equivalent |
|---|---|---|
| `TicketNotFoundError` | `-32602` | 404 |
| `TicketAlreadyClaimedError` | `-32602` | 409 |
| `ValidationError` | `-32602` | 400 |
| `AuthenticationError` | `-32602` | 401 |
| `MachineAuthError` | `-32602` | 403 |
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
| `/api/tickets` | GET | Paginated ticket list with filtering |
| `/api/tickets/{id}` | GET | Full ticket detail with resolved dependencies |
| `/api/tickets/{id}/history` | GET | Chronological event audit log for a ticket |
| `/api/tickets/{id}/claim` | POST | Claim a ticket |
| `/api/tickets/{id}/claim` | DELETE | Release a claim |
| `/api/admin/audit` | GET | Audit log query endpoint |

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


## Pipeline Overview REST Endpoint

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `GET /api/pipeline` endpoint returns an aggregated view of ticket counts
per SDLC stage. Suitable for Kanban-style dashboards and pipeline monitoring.

### Request

```http
GET /api/pipeline
GET /api/pipeline?group_by=type
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `group_by` | `string` | *(none)* | Set to `type` to include per-type breakdowns within each stage |

### Response

Returns `200 OK` with a JSON body containing `stages`, `total`, and an optional
`group_by_type` array:

```json
{
  "stages": [
    { "stage": "BACKEND", "count": 4 },
    { "stage": "DONE", "count": 12 },
    { "stage": "QA", "count": 2 },
    { "stage": "READY", "count": 5 }
  ],
  "total": 23,
  "group_by_type": null
}
```

With `?group_by=type`:

```json
{
  "stages": [ ... ],
  "total": 23,
  "group_by_type": [
    { "stage": "BACKEND", "type": "backend", "count": 3 },
    { "stage": "BACKEND", "type": "fullstack", "count": 1 }
  ]
}
```

### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `503` | Database unavailable | `{"error": "Database unavailable"}` |
| `500` | Unexpected query failure | `{"error": "Internal server error"}` |

### Pydantic Schemas

Defined in `mcp_server.api.schemas`:

| Model | Description |
|-------|-------------|
| `StageCount` | Stage name and ticket count |
| `StageTypeCount` | Stage, type, and count triplet |
| `PipelineResponse` | Top-level response with `stages`, `total`, and optional `group_by_type` |

### Route Mounting

The endpoint uses the same factory pattern as the ticket list endpoint.
`create_pipeline_endpoint()` accepts a repo getter for late binding.

```python
from mcp_server.api.routes import create_pipeline_endpoint

pipeline_handler = create_pipeline_endpoint(_get_ticket_repo)
Route("/api/pipeline", pipeline_handler, methods=["GET"])
```


## Health Check REST Endpoint

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `GET /api/health` endpoint returns server health status with component-level
checks. Returns `200` when healthy, `503` when degraded or unhealthy.

### Request

```http
GET /api/health
```

No query parameters. No authentication required.

### Response

Returns `200 OK` when all components are healthy:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "uptime_seconds": 3621.5,
  "response_time_ms": 2.145,
  "components": [
    {
   Ticket Claim REST Endpoint

<!-- last_reviewed: 2026-03-11T04:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The ticket claim endpoint allows agents and integrations to claim and release
tickets via the REST API. It delegates to the same `TicketService` used by the
MCP `tickets.claim` tool.

### Claim a Ticket

```http
POST /api/tickets/{ticket_id}/claim
Content-Type: application/json

{
  "agent_id": "Backend",
  "machine_id": "pop-os",
  "operator": "ReaperOAK",
  "lease_duration_minutes": 30
}
```

#### Request Body

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `agent_id` | `string` | Yes | — | Agent role claiming the ticket |
| `machine_id` | `string` | Yes | — | Machine identifier |
| `operator` | `string` | Yes | — | Human operator name |
| `lease_duration_minutes` | `int` | No | `30` | Lease duration in minutes |

#### Success Response

Returns `200 OK` with the claimed ticket summary:

```json
{
  "ticket_id": "FORGEOS-BE036",
  "title": "Implement Ticket Claim REST Endpoint",
  "type": "backend",
  "stage": "BACKEND",
  "file_paths": ["mcp-server/src/mcp_server/api/routes/tickets.py"],
  "acceptance_criteria": ["POST /api/tickets/:id/claim accepts agent_id..."]
}
```

#### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | Invalid or missing JSON body | `{"error": "Invalid or missing JSON body"}` |
| `400` | Pydantic validation failure | `{"error": "<validation details>"}` |
| `400` | Ticket not in a claimable stage | `{"error": "<details>"}` |
| `404` | Ticket not found | `{"error": "Ticket 'ID' not found"}` |
| `409` | Ticket already claimed | `{"error": "<conflict details>"}` |
| `503` | Database or service unavailable | `{"error": "Service unavailable"}` |

### Release a Claim

```http
DELETE /api/tickets/{ticket_id}/claim?agent_id=Backend&reason=manual+release
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent_id` | `string` | Yes | Agent releasing the claim (must match current holder) |
| `reason` | `string` | No | Reason for releasing the claim |

#### Success Response

Returns `200 OK` with release details:

```json
{
  "ticket_id": "FORGEOS-BE036",
  "previous_stage": "BACKEND",
  "released_by": "Backend",
  "reason": "manual release"
}
```

#### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | Missing `agent_id` query parameter | `{"error": "Query parameter 'agent_id' is required"}` |
| `404` | Ticket not found | `{"error": "Ticket 'ID' not found"}` |
| `409` | Agent does not hold the claim | `{"error": "<ownership mismatch details>"}` |
| `503` | Service unavailable | `{"error": "Service unavailable"}` |

### Pydantic Schemas

Defined in `mcp_server.api.schemas`:

| Model | Description |
|-------|-------------|
| `ClaimRequest` | Request body with `agent_id`, `machine_id`, `operator`, `lease_duration_minutes` |
| `ClaimResponse` | Success response with `ticket_id`, `title`, `type`, `stage`, `file_paths`, `acceptance_criteria` |
| `ReleaseResponse` | Release response with `ticket_id`, `previous_stage`, `released_by`, `reason` |

### Route Mounting

The endpoint is mounted via `create_claim_endpoint()` factory, which accepts
`ticket_service_getter` and `ticket_repo_getter` callables for late binding:

```python
from mcp_server.api.routes import create_claim_endpoint

claim_handler = create_claim_endpoint(_get_ticket_service, _get_ticket_repo)
Route("/api/tickets/{ticket_id}/claim", claim_handler, methods=["POST", "DELETE"])
```

### Design Decisions

- **Shared service layer** — the REST endpoint delegates to the same
  `TicketService.claim_by_id()` and `TicketService.release_ticket()` methods
  used by the MCP tools, ensuring consistent behavior.
- **Factory pattern** — `create_claim_endpoint()` accepts service and repo
  getters, keeping the route handler free of global state.
- **Method dispatch** — a single route handler dispatches `POST` to
  `_handle_claim` and `DELETE` to `_handle_release`, co-locating related
  operations.


##    "name": "database",
      "status": "healthy",
      "details": {
        "pool": { "size": 10, "free": 8, "used": 2 }
      }
    }
  ]
}
```

### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `503` | Health checker not configured | `{"status": "degraded", "components": [{"name": "health_checker", "status": "not_configured"}], ...}` |
| `503` | Health check raised an exception | `{"status": "unhealthy", "components": [{"name": "health_checker", "status": "error", ...}], ...}` |
| `503` | Database unhealthy | `{"status": "unhealthy", "components": [{"name": "database", "status": "unhealthy", ...}], ...}` |

All `503` responses include the full `HealthResponse` schema so clients can
inspect component-level details.

### Pydantic Schemas

Defined in `mcp_server.api.schemas`:

| Model | Description |
|-------|-------------|
| `ComponentHealth` | Component name, status, and optional details dict |
| `HealthResponse` | Top-level response with status, version, uptime, response time, and components |

### Route Mounting

```python
from mcp_server.api.routes import create_health_endpoint

health_handler = create_health_endpoint(_get_health_checker)
Route("/api/health", health_handler, methods=["GET"])
```

### Design Decisions

- **Component-level granularity** — each infrastructure dependency reports its
  own status. Clients can identify which component is degraded.
- **Response timing** — `response_time_ms` measures wall clock time from
  request start to response serialization.
- **Three health states** — `healthy` (all good), `degraded` (checker
  unavailable), `unhealthy` (check failed or database down).
- **Factory pattern** — `create_health_endpoint()` accepts a health checker
  getter for late binding and testability.


## Ticket List REST Endpoint

<!-- last_reviewed: 2026-03-11T03:40:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `GET /api/tickets` endpoint returns a paginated, filtered list of tickets.
It is mounted on the Starlette application alongside the MCP transport and
health check routes.

### Request

```http
GET /api/tickets?stage=READY&type=backend&priority=high&limit=20&offset=0
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `stage` | `string` | *(all)* | Filter by SDLC stage (e.g. `READY`, `BACKEND`, `QA`) |
| `type` | `string` | *(all)* | Filter by ticket type (e.g. `backend`, `frontend`, `infra`) |
| `priority` | `string` | *(all)* | Filter by priority (`critical`, `high`, `medium`, `low`) |
| `claimed_by` | `string` | *(all)* | Filter by the agent name that holds the claim |
| `machine_id` | `string` | *(all)* | Filter by the machine identifier |
| `limit` | `int` | `50` | Maximum rows to return (capped at 200) |
| `offset` | `int` | `0` | Number of rows to skip for pagination |

All parameters are optional. Omitting all filters returns every ticket.

### Response

Returns `200 OK` with a JSON body containing `tickets` and `pagination`:

```json
{
  "tickets": [
    {
      "ticket_id": "FORGEOS-BE034",
      "title": "Implement Ticket List REST Endpoint",
      "type": "backend",
      "priority": "high",
      "stage": "DONE",
      "status": "completed",
      "claimed_by_name": null,
      "machine_id": null,
      "operator": null,
      "rework_count": 1,
      "tags": [],
      "created_at": "2026-03-05T18:06:45Z",
      "updated_at": "2026-03-11T01:15:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400` | Invalid enum value for `stage`, `type`, or `priority` | `{"error": "Invalid value for 'stage': 'BOGUS'. Must be one of: [...]"}` |
| `503` | Database pool unavailable | `{"error": "Database unavailable"}` |
| `500` | Unexpected query failure | `{"error": "Internal server error"}` |

### Pydantic Schemas

Defined in `mcp_server.api.schemas`:

| Model | Description |
|-------|-------------|
| `TicketStageEnum` | Valid SDLC stage values (13 members) |
| `TicketTypeEnum` | Valid ticket type values (10 members) |
| `TicketPriorityEnum` | Valid priority values (`critical`, `high`, `medium`, `low`) |
| `TicketSummary` | Summary fields returned per ticket in list responses |
| `PaginationMeta` | `total`, `limit`, `offset` metadata |
| `TicketListResponse` | Top-level response with `tickets` and `pagination` |

### Route Mounting

The endpoint is mounted in `HTTPTransport.create_app()` using a late-binding
pattern. The transport creates a `_ticket_repo_ref` list that is populated by
the server lifespan once the database pool is ready. This allows the endpoint
to return `503 Database unavailable` when the server starts without a database.

```python
from mcp_server.api.routes import create_tickets_endpoint

# Late-binding getter
_ticket_repo_ref: list[Any] = [None]
def _get_ticket_repo() -> Any:
    return _ticket_repo_ref[0]

tickets_handler = create_tickets_endpoint(_get_ticket_repo)
Route("/api/tickets", tickets_handler, methods=["GET"])
```

### Design Decisions

- **Offset pagination** chosen over cursor-based for simplicity. Suitable for
  the expected ticket volume (hundreds, not millions).
- **`COUNT(*) OVER()` window function** computes the total matching count in a
  single query, avoiding a separate `COUNT` round-trip.
- **Enum validation at the API boundary** rejects invalid filter values with a
  descriptive `400` before the query reaches the database.
- **Factory pattern** (`create_tickets_endpoint`) accepts a repo getter,
  enabling late binding and testability without global state.


## Ticket Detail REST Endpoint

<!-- last_reviewed: 2026-03-11T03:40:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

`GET /api/tickets/{ticket_id}` returns a single ticket with full metadata,
current claim info, acceptance criteria, and resolved dependency status.

### Request

```http
GET /api/tickets/FORGEOS-BE035
```

### Response

Returns `200 OK` with a `TicketDetailResponse` body:

```json
{
  "ticket_id": "FORGEOS-BE035",
  "title": "Implement Ticket Detail and History Endpoints",
  "description": "Implement GET /api/tickets/:id for ticket detail...",
  "type": "backend",
  "priority": "high",
  "stage": "DONE",
  "status": "completed",
  "sdlc_flow": ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
  "claimed_by_name": null,
  "machine_id": null,
  "operator": null,
  "lease_expiry": null,
  "depends_on": ["FORGEOS-BE034", "FORGEOS-BE012"],
  "resolved_dependencies": [
    {
      "ticket_id": "FORGEOS-BE034",
      "title": "Implement Ticket List REST Endpoint",
      "stage": "DONE",
      "is_done": true
    },
    {
      "ticket_id": "FORGEOS-BE012",
      "title": "Event Sourcing Store",
      "stage": "DONE",
      "is_done": true
    }
  ],
  "file_paths": ["mcp-server/src/api/routes/tickets.py", "mcp-server/src/api/schemas.py"],
  "acceptance_criteria": ["GET /api/tickets/:id returns full ticket detail..."],
  "tags": [],
  "rework_count": 0,
  "source_task_file": null,
  "created_at": "2026-03-05T18:06:45Z",
  "updated_at": "2026-03-11T01:30:00Z",
  "completed_at": null
}
```

The `resolved_dependencies` array resolves each entry in `depends_on` to its
current title, stage, and completion status. If a dependency ticket is missing
from the database, only `ticket_id` is returned with `null` title/stage and
`is_done: false`.

### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `404` | Ticket ID not found | `{"error": "Ticket 'BOGUS-ID' not found"}` |
| `503` | Database pool unavailable | `{"error": "Database unavailable"}` |
| `500` | Unexpected query failure | `{"error": "Internal server error"}` |

### Pydantic Schemas

| Model | Description |
|-------|-------------|
| `DependencyInfo` | Resolved dependency with `ticket_id`, `title`, `stage`, `is_done` |
| `TicketDetailResponse` | Full ticket detail with 22 fields including resolved dependencies |


## Ticket History REST Endpoint

<!-- last_reviewed: 2026-03-11T03:40:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

`GET /api/tickets/{ticket_id}/history` returns the chronological event audit
log for a ticket from the event sourcing store.

### Request

```http
GET /api/tickets/FORGEOS-BE035/history?limit=20&offset=0
```

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `int` | `50` | Maximum events to return (capped at 200) |
| `offset` | `int` | `0` | Number of events to skip for pagination |

### Response

Returns `200 OK` with a `HistoryListResponse` body:

```json
{
  "ticket_id": "FORGEOS-BE035",
  "events": [
    {
      "event_type": "CREATED",
      "agent_id": "TODO",
      "machine_id": "system",
      "timestamp": "2026-03-05T18:06:45Z",
      "previous_stage": null,
      "new_stage": "READY",
      "payload": {},
      "sequence_number": 1,
      "aggregate_version": 1
    },
    {
      "event_type": "CLAIMED",
      "agent_id": "Backend",
      "machine_id": "pop-os",
      "timestamp": "2026-03-11T01:28:28Z",
      "previous_stage": "READY",
      "new_stage": "BACKEND",
      "payload": {"operator": "ReaperOAK"},
      "sequence_number": 2,
      "aggregate_version": 2
    }
  ],
  "pagination": {
    "total": 2,
    "limit": 20,
    "offset": 0
  }
}
```

The endpoint verifies the ticket exists before querying the event store. Events
are loaded via `EventStore.replay_ticket_events()` and paginated in memory.

### Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `404` | Ticket ID not found | `{"error": "Ticket 'BOGUS-ID' not found"}` |
| `503` | Database or event store unavailable | `{"error": "Database unavailable"}` or `{"error": "Event store unavailable"}` |
| `500` | Unexpected query failure | `{"error": "Internal server error"}` |

### Pydantic Schemas

| Model | Description |
|-------|-------------|
| `HistoryEntry` | Single event with `event_type`, `agent_id`, `machine_id`, `timestamp`, stage info, `payload`, and sequence metadata |
| `HistoryListResponse` | Response with `ticket_id`, `events` array, and `PaginationMeta` |

### Design Decisions

- **Existence check first** — the endpoint confirms the ticket exists before
  querying the event store, providing a clear `404` for unknown ticket IDs.
- **Event store separation** — history data comes from the append-only event
  store (FORGEOS-BE012), not the tickets table, preserving the event sourcing
  pattern.
- **Factory pattern** — `create_ticket_history_endpoint` accepts both
  ticket repo and event store getters for late binding and testability.


## WebSocket Ticket State Streaming

<!-- last_reviewed: 2026-03-11T03:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.api.routes.websocket` module provides a WebSocket endpoint at
`/ws/tickets` that streams ticket state change events to connected clients in
real time. An `EventBroadcaster` service manages client connections, optional
filtering, and heartbeat pings.

### How It Works

1. A client opens a WebSocket connection to `/ws/tickets`.
2. Optional query parameters narrow which events the client receives.
3. The `EventBroadcaster` registers the client and applies its filter.
4. When a ticket state change occurs, `EventBroadcaster.publish()` serializes
   the event and delivers it to every matching client.
5. A background ping loop detects stale connections and removes them.
6. On disconnect, the client is automatically unregistered.

### Query Parameters

| Parameter | Format | Description |
|---|---|---|
| `ticket_ids` | Comma-separated IDs | Only receive events for these tickets (e.g. `FORGEOS-BE039,FORGEOS-BE040`) |
| `stages` | Comma-separated stages | Only receive events involving these SDLC stages (e.g. `BACKEND,QA`) |

When no parameters are provided, the client receives all events.

### Event Message Format

Each message is a JSON object:

```json
{
  "ticket_id": "FORGEOS-BE039",
  "event_type": "ticket.claimed",
  "old_stage": "READY",
  "new_stage": "BACKEND",
  "timestamp": "2026-03-11T01:28:28Z",
  "payload": {
    "agent_id": "Backend",
    "machine_id": "pop-os"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `string` | The ticket identifier |
| `event_type` | `string` | State change type (e.g. `ticket.claimed`, `ticket.advanced`) |
| `old_stage` | `string` | SDLC stage before the change |
| `new_stage` | `string` | SDLC stage after the change |
| `timestamp` | `string` | ISO 8601 timestamp |
| `payload` | `object` | Additional event data (agent, reason, etc.) |

### Connection Example

```python
import asyncio
import websockets

async def stream_tickets():
    uri = "ws://localhost:8080/ws/tickets?stages=BACKEND,QA"
    async with websockets.connect(uri) as ws:
        async for message in ws:
            print(message)

asyncio.run(stream_tickets())
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `create_websocket_endpoint` | function | Factory that returns a Starlette WebSocket handler |
| `EventBroadcaster` | class | Manages client registry, filtering, and fan-out delivery |
| `TicketEvent` | frozen dataclass | Immutable ticket state change event with JSON serialization |
| `ClientFilter` | frozen dataclass | Per-client filter criteria (ticket IDs and/or stages) |
| `WebSocketLike` | protocol | Minimal interface for WebSocket-like objects (testing) |
| `matches_filter` | function | Checks whether an event passes a client's filter |

#### EventBroadcaster Methods

| Method | Returns | Description |
|---|---|---|
| `register(ws, filter)` | `None` | Add a WebSocket client to the broadcast list |
| `unregister(ws)` | `None` | Remove a client (safe to call if not registered) |
| `publish(event)` | `int` | Broadcast an event; returns number of clients delivered to |
| `start()` | `None` | Start the background heartbeat ping loop |
| `stop()` | `None` | Stop the ping loop and clear all clients |
| `client_count` | `int` | Property — number of connected clients |

#### EventBroadcaster Constructor

| Parameter | Default | Description |
|---|---|---|
| `ping_interval` | `30.0` | Seconds between heartbeat pings |

### Design Decisions

- **Filter-at-client** — Each client carries its own `ClientFilter`, so a
  single broadcaster serves all clients without per-topic fan-out queues.
- **Heartbeat via ping bytes** — The broadcaster sends `b"ping"` frames on a
  configurable interval (default 30 s) to detect stale connections. Failed
  pings remove the client immediately.
- **Factory pattern** — `create_websocket_endpoint()` accepts a broadcaster
  getter for deferred wiring, matching the project's dependency injection
  conventions.
- **Protocol-based testing** — `WebSocketLike` protocol allows test doubles
  without importing Starlette WebSocket internals.


## Webhook Receiver

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.transport.webhooks` module exposes a `POST /api/webhooks/{source}`
endpoint that accepts inbound webhook payloads from external systems. The endpoint
validates the payload, acknowledges receipt with 202 Accepted, and dispatches
processing asynchronously via `WebhookService`.

### How It Works

1. External system sends `POST /api/webhooks/{source}` with a JSON body.
2. The route handler validates `Content-Type`, parses the JSON, and identifies
   the source.
3. `WebhookService.validate_payload()` runs source-specific validation
   (GitHub requires `action`; custom requires `event_type`).
4. The endpoint returns 202 Accepted immediately.
5. `WebhookService.process_async()` schedules an `asyncio.Task` that routes
   the event to the matching handler.

### Supported Sources

| Source | Validation | Event Type Resolution |
|--------|------------|----------------------|
| `github` | Payload must contain `action` (non-empty string) | `X-GitHub-Event` header if present, otherwise `action` field |
| `custom` | Payload must contain `event_type` (non-empty string) | `event_type` field |

Unknown sources return 400 Bad Request with the list of known sources.

### Quick Start

Mount the webhook routes into a Starlette application:

```python
from starlette.applications import Starlette
from mcp_server.transport.webhooks import webhook_routes

app = Starlette(routes=webhook_routes)
```

Send a webhook:

```bash
# GitHub-style webhook
curl -X POST http://localhost:8080/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -d '{"action": "completed", "ref": "refs/heads/main"}'

# Custom webhook
curl -X POST http://localhost:8080/api/webhooks/custom \
  -H "Content-Type: application/json" \
  -d '{"event_type": "deploy", "environment": "staging"}'
```

### Registering Custom Handlers

Use the `handler_registry` to route specific (source, event_type) pairs to
async handler functions:

```python
from mcp_server.services.webhook_service import (
    handler_registry,
    WebhookEvent,
)

async def on_github_push(event: WebhookEvent) -> None:
    print(f"Push to {event.payload.get('ref')}")

# Exact match: source="github", event_type="push"
handler_registry.register("github", "push", on_github_push)

# Fallback for all unmatched event types from a source
handler_registry.register_default("custom", my_custom_fallback)
```

If no handler matches, the event is logged and dropped.

### API Reference

| Symbol | Module | Description |
|--------|--------|-------------|
| `webhook_routes` | `transport.webhooks` | List of Starlette `Route` objects to mount |
| `receive_webhook()` | `transport.webhooks` | Route handler for `POST /api/webhooks/{source}` |
| `get_webhook_service()` | `transport.webhooks` | Return the module-level `WebhookService` instance |
| `set_webhook_service()` | `transport.webhooks` | Replace the service instance (testing) |
| `WebhookService` | `services.webhook_service` | Validates payloads, routes events, dispatches async |
| `WebhookEvent` | `services.webhook_service` | Frozen dataclass for a validated inbound event |
| `WebhookSource` | `services.webhook_service` | Enum of known sources (`GITHUB`, `CUSTOM`) |
| `handler_registry` | `services.webhook_service` | Module-level handler registry singleton |
| `WebhookHandler` | `services.webhook_service` | Type alias: `Callable[[WebhookEvent], Coroutine]` |
| `WebhookValidationError` | `services.webhook_service` | Payload failed schema validation |
| `UnknownSourceError` | `services.webhook_service` | Source not in `WebhookSource` enum |

### WebhookService Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `validate_payload(source, payload, event_type_header)` | `WebhookEvent` | Validate and construct an event; raises on failure |
| `dispatch(event)` | `None` | Route event to handler and execute |
| `process_async(event)` | `None` | Schedule dispatch as a background `asyncio.Task` |

### WebhookEvent Fields

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `str` | UUID4 hex assigned on receipt |
| `source` | `str` | Origin identifier (lowercased) |
| `event_type` | `str` | Event classification |
| `payload` | `dict[str, Any]` | Validated JSON body |
| `received_at` | `datetime` | UTC timestamp of receipt |

### Error Responses

| Condition | Status | Response Body |
|-----------|--------|---------------|
| Missing `source` path parameter | 400 | `{"error": "Missing source parameter"}` |
| `Content-Type` is not `application/json` | 400 | `{"error": "Content-Type must be application/json"}` |
| Malformed JSON | 400 | `{"error": "Invalid JSON payload"}` |
| Body is not a JSON object | 400 | `{"error": "Payload must be a JSON object"}` |
| Unknown source | 400 | `{"error": "Unknown webhook source: ...", "details": {...}}` |
| Missing required fields | 400 | `{"error": "... missing required fields: ...", "details": {...}}` |

### GitHub Webhook Signature Verification

<!-- last_reviewed: 2026-03-11T23:59:00Z -->

When `GITHUB_WEBHOOK_SECRET` is set, the server verifies inbound GitHub
webhooks using HMAC-SHA256 signatures. Requests missing or failing
signature verification are rejected before payload validation.

#### How It Works

1. The receiver reads the `X-Hub-Signature-256` header from the request.
2. `compute_signature()` computes `sha256=<HMAC-SHA256(secret, body)>`.
3. `verify_signature()` compares the expected and received signatures using
   `hmac.compare_digest()` (constant-time) to prevent timing attacks.
4. `verify_github_request()` orchestrates the check and extracts the event
   type from the `X-GitHub-Event` header.

#### Configuration

Set the `GITHUB_WEBHOOK_SECRET` environment variable to the same secret
configured in your GitHub repository's webhook settings. When the variable
is unset or empty, signature verification is skipped.

```bash
export GITHUB_WEBHOOK_SECRET="your-webhook-secret"
```

#### Sending a Signed Webhook

```bash
SECRET="your-webhook-secret"
BODY='{"action": "completed", "ref": "refs/heads/main"}'
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)"

curl -X POST http://localhost:8080/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY"
```

#### Error Responses

| Condition | Status | Response Body |
|-----------|--------|---------------|
| `X-Hub-Signature-256` header missing | 401 | `{"error": "Missing X-Hub-Signature-256 header"}` |
| Signature does not match | 403 | `{"error": "Invalid webhook signature"}` |

#### API Reference

| Symbol | Module | Description |
|--------|--------|-------------|
| `get_webhook_secret()` | `webhooks.signature` | Load the secret from `GITHUB_WEBHOOK_SECRET` env var |
| `compute_signature()` | `webhooks.signature` | Compute `sha256=<hex>` HMAC for a payload |
| `verify_signature()` | `webhooks.signature` | Constant-time signature comparison |
| `verify_github_request()` | `webhooks.github_handler` | Verify request and extract event type |
| `GitHubSignatureError` | `webhooks.github_handler` | Raised on signature mismatch (403) |
| `GitHubSignatureMissingError` | `webhooks.github_handler` | Raised when header is absent (401) |

### Design Constraints

- **Async dispatch** — the HTTP response returns before the handler executes,
  following the 202 Accepted pattern for webhook receivers.
- **Source-specific validation** — each source has its own validator function.
  Adding a new source requires a validator entry in `_SOURCE_VALIDATORS`.
- **Handler registry** — routes events by (source, event_type) with optional
  per-source default fallback.
- **Structured logging** — all operations log `event_id`, `source`, and
  `event_type` for correlation.
- **No external dependencies** — uses Starlette (already a dependency) and
  stdlib only.


### CI Status Event Handler

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.webhooks.github_handler` module includes a `CIStatusHandler`
that processes GitHub `check_run` and `status` events. When CI checks pass for
a ticket's branch, the handler advances the ticket past the CI stage. When CI
checks fail, it triggers a rework with the failure reason.

#### How It Works

1. GitHub sends a `check_run` (completed) or `status` event via webhook.
2. The handler extracts the branch name from the event payload.
3. `extract_ticket_id_from_branch()` matches the `FORGEOS-XXNNN` pattern
   in the branch name (case-insensitive).
4. The handler queries the ticket's current stage via `CITicketOps`.
5. If the ticket is in the `CI` stage:
   - **success** conclusion → `advance_ci()` moves the ticket forward.
   - **failure** or **timed_out** → `fail_ci()` records the failure for rework.
   - Other conclusions (e.g. `neutral`, `skipped`) are logged and ignored.
6. Tickets not in the `CI` stage are silently ignored (idempotency).

#### Supported Events

| Event | Trigger | Branch Source |
|-------|---------|---------------|
| `check_run` | `action: "completed"` | `check_run.check_suite.head_branch` |
| `status` | Always (filtered by `state`) | `branches[0].name` |

#### CI Outcome Mapping

| GitHub Value | Mapped Conclusion | Action |
|-------------|-------------------|--------|
| `success` (check_run conclusion or status state) | `success` | Advance ticket |
| `failure` (check_run conclusion or status state) | `failure` | Record failure / rework |
| `timed_out` (check_run conclusion) | `failure` | Record failure / rework |
| `error` (status state) | `failure` | Record failure / rework |
| `pending` (status state) | — | Ignored |
| Other (e.g. `neutral`, `skipped`) | — | Ignored |

#### Quick Start

```python
from mcp_server.webhooks.github_handler import CIStatusHandler
from mcp_server.services.webhook_service import handler_registry

# Implement the CITicketOps protocol
class MyCITicketOps:
    async def get_ticket_stage(self, ticket_id: str) -> str | None: ...
    async def advance_ci(self, ticket_id: str, evidence: dict) -> None: ...
    async def fail_ci(self, ticket_id: str, reason: str, evidence: dict) -> None: ...

handler = CIStatusHandler(MyCITicketOps())
handler.register(handler_registry)
```

#### API Reference

| Symbol | Module | Description |
|--------|--------|-------------|
| `CIStatusHandler` | `webhooks.github_handler` | Handles `check_run` and `status` events for CI automation |
| `CITicketOps` | `webhooks.github_handler` | Runtime-checkable protocol for ticket operations |
| `extract_ticket_id_from_branch()` | `webhooks.github_handler` | Extract `FORGEOS-XXNNN` ticket ID from a branch name |
| `CI_AGENT_ID` | `webhooks.github_handler` | Agent identity constant (`"ci-status-handler"`) |

#### CIStatusHandler Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `handle_check_run(event)` | `None` | Process a `check_run` completed event |
| `handle_status(event)` | `None` | Process a `status` event |
| `register(registry)` | `None` | Register both handlers in the webhook registry |

#### CITicketOps Protocol Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `get_ticket_stage(ticket_id)` | `str \| None` | Return the current SDLC stage, or `None` if not found |
| `advance_ci(ticket_id, evidence)` | `None` | Advance the ticket past the CI stage |
| `fail_ci(ticket_id, reason, evidence)` | `None` | Record CI failure for rework |

#### Evidence Payload

Both `advance_ci` and `fail_ci` receive an evidence dict:

```python
{
    "check_name": "lint / ruff",       # Check name or status context
    "conclusion": "success",           # Mapped conclusion
    "output_summary": "All checks...", # Output summary (may be empty)
    "agent": "ci-status-handler"        # Agent identity
}
```

### PR Event Handler

<!-- last_reviewed: 2026-03-11T23:59:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.services.pr_service` module correlates GitHub `pull_request`
webhook events to ForgeOS tickets. Ticket IDs are extracted from the PR title
and head branch name using the pattern `FORGEOS-<PREFIX><DIGITS>` (e.g.
`FORGEOS-BE028`). Multiple tickets can be linked to the same PR.

#### How It Works

1. `handle_pull_request_event()` in `webhooks.github_handler` receives a
   validated `WebhookEvent` with `event_type == "pull_request"`.
2. `extract_pr_metadata()` parses the payload into a `PRMetadata` dataclass
   (number, title, URL, author, branch, base branch, reviewers, labels).
3. `extract_ticket_ids()` scans the PR title and branch for ticket IDs using
   the regex `FORGEOS-[A-Z]+\d+`. Results are de-duplicated in discovery order.
4. For each correlated ticket ID, a `PREvent` is produced with the resolved
   `PRAction` and advancement flag.
5. When no ticket IDs are found, a warning is logged and an empty list is
   returned — no error is raised.

#### Supported Actions

| GitHub Action | Merged Flag | `PRAction` | Description |
|---------------|-------------|------------|-------------|
| `opened` | — | `OPENED` | PR created |
| `closed` | `false` | `CLOSED` | PR closed without merge |
| `closed` | `true` | `MERGED` | PR merged |
| `synchronize` | — | `SYNCHRONIZE` | New commits pushed |
| *(other)* | — | `OTHER` | Unrecognised action |

#### Advancement Detection

A PR merge triggers advancement when **both** conditions are met:

- `PRAction` is `MERGED`
- The base branch is `main` or `master`

The `triggers_advancement` flag and `merge_target` field on `PREvent` capture
this so downstream consumers can decide whether to advance the ticket stage.

#### Quick Start

The handler is registered automatically when `mcp_server.webhooks` is imported:

```python
from mcp_server.webhooks import handle_pull_request_event
```

No manual registration is needed. To register explicitly:

```python
from mcp_server.services.webhook_service import handler_registry
from mcp_server.webhooks.github_handler import register_pr_handler

register_pr_handler(handler_registry)
```

#### API Reference

| Symbol | Module | Description |
|--------|--------|-------------|
| `PRAction` | `services.pr_service` | Enum — `OPENED`, `CLOSED`, `MERGED`, `SYNCHRONIZE`, `OTHER` |
| `PRMetadata` | `services.pr_service` | Frozen dataclass — parsed PR payload fields |
| `PREvent` | `services.pr_service` | Frozen dataclass — correlated event for one ticket |
| `extract_ticket_ids()` | `services.pr_service` | Extract unique ticket IDs from title and branch |
| `extract_pr_metadata()` | `services.pr_service` | Parse a `pull_request` webhook payload |
| `PRService` | `services.pr_service` | Async service — produces `PREvent` list from a `WebhookEvent` |
| `handle_pull_request_event()` | `webhooks.github_handler` | Async handler dispatched by the webhook registry |
| `register_pr_handler()` | `webhooks.github_handler` | Register the handler in a `HandlerRegistry` |

#### PREvent Fields

| Field | Type | Description |
|-------|------|-------------|
| `ticket_id` | `str` | Correlated ForgeOS ticket ID |
| `action` | `PRAction` | Resolved action enum |
| `metadata` | `PRMetadata` | Full PR metadata |
| `triggers_advancement` | `bool` | `True` when merged into main/master |
| `merge_target` | `str \| None` | Base branch name on merge, else `None` |
| `timestamp` | `datetime` | UTC timestamp of event processing |

#### PRMetadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `number` | `int` | PR number |
| `title` | `str` | PR title |
| `url` | `str` | HTML URL of the PR |
| `author` | `str` | GitHub login of the PR author |
| `branch` | `str` | Head branch name |
| `base_branch` | `str` | Target branch name |
| `reviewers` | `list[str]` | Requested reviewer logins |
| `labels` | `list[str]` | Label names |
| `merged` | `bool` | Whether the PR was merged |


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



## Health Check & Readiness Probes

<!-- last_reviewed: 2025-07-14T23:45:00Z -->
<!-- audience: developers, operators -->
<!-- diataxis: reference -->

The `mcp_server.observability.health` module provides server-level health and
readiness probes. The health check aggregates server status, database
connectivity, connection-pool saturation, and uptime into a single JSON report.
The readiness probe indicates whether the server is accepting requests.

### Health Check

Returns a comprehensive health report with overall status, version, uptime, and
database details including pool saturation metrics.

```python
from mcp_server.observability.health import HealthChecker

checker = HealthChecker(pool=pool)
report = await checker.health_check()
# {
#   "status": "healthy",
#   "version": "0.1.0",
#   "uptime_seconds": 3600.123,
#   "database": {
#     "status": "ok",
#     "pool": {
#       "size": 10, "free_size": 8, "used_size": 2,
#       "min_size": 2, "max_size": 10, "saturation_pct": 20.0
#     }
#   }
# }
```

**Overall status values:**

| Status | Condition |
|---|---|
| `healthy` | Database reachable, pool OK |
| `degraded` | No database configured (DB-less mode) |
| `unhealthy` | Database unreachable or pool error |

### Readiness Probe

Returns a `(is_ready, status_dict)` tuple. The server is ready only when the
state is `READY` and the database is reachable.

```python
checker.mark_ready()  # call after server initialization

is_ready, status = await checker.readiness_check()
# is_ready: True
# status: {"ready": True, "state": "ready"}
```

**Readiness state machine:**

```
STARTING  ──mark_ready()──▸  READY  ──mark_draining()──▸  DRAINING
```

| State | `is_ready` | Use case |
|---|---|---|
| `starting` | `False` | Server is initializing |
| `ready` | `True` | Accepting requests |
| `draining` | `False` | Shutdown in progress |

The readiness probe also returns `False` if the connection pool is not
initialized or the database is unreachable, even when state is `READY`.

### Integration with Graceful Shutdown

`HealthChecker` works with `GracefulShutdownManager` — call `mark_ready()`
after the pool initializes and `mark_draining()` when shutdown begins:

```python
checker = HealthChecker(pool=pool)
await pool.initialize()
checker.mark_ready()

# On shutdown:
checker.mark_draining()
await manager.initiate_shutdown()
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `HealthChecker` | class | Aggregates server health and readiness probes |
| `HealthStatus` | enum | `HEALTHY`, `DEGRADED`, `UNHEALTHY` |
| `ReadinessState` | enum | `STARTING`, `READY`, `DRAINING` |

**HealthChecker methods:**

| Method | Returns | Description |
|---|---|---|
| `health_check()` | `dict[str, Any]` | Full health report with status, version, uptime, database info |
| `readiness_check()` | `tuple[bool, dict]` | `(is_ready, status_dict)` — readiness with reason |
| `mark_ready()` | `None` | Transition to `READY` state |
| `mark_draining()` | `None` | Transition to `DRAINING` state |


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


## Per-Agent Rate Limiting

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.middleware.rate_limiter` module enforces per-agent, per-machine
rate limits using a sliding window algorithm. Write operations (claim, advance,
reject, release) have stricter limits than read operations (status, list).

### How It Works

1. The middleware runs after `AuthMiddleware` in the Starlette stack.
2. Each request is classified as **read** or **write** based on HTTP method
   and path patterns.
3. A rate-limit key is built from `agent_id:machine_id` (authenticated) or
   `anon:<client_ip>` (unauthenticated).
4. A sliding window tracks request timestamps per key. Requests outside the
   window are evicted before counting.
5. If the count exceeds the limit, a 429 response is returned with
   `Retry-After` and rate-limit headers.
6. Health endpoints (`/health`, `/healthz`, `/ready`, `/readiness`, `/livez`,
   `/readyz`) bypass rate limiting.

### Configuration

| Parameter | Default | Description |
|---|---|---|
| `read_limit` | `120` | Maximum read requests per window |
| `read_window` | `60.0` | Read window duration in seconds |
| `write_limit` | `30` | Maximum write requests per window |
| `write_window` | `60.0` | Write window duration in seconds |

All values are configurable via `RateLimitConfig`. Source them from environment
variables at the application layer.

### Quick Start

```python
from mcp_server.middleware import RateLimitConfig, RateLimitMiddleware

# Default limits (120 reads/min, 30 writes/min)
app.add_middleware(RateLimitMiddleware)

# Custom limits
config = RateLimitConfig(read_limit=200, write_limit=50)
app.add_middleware(RateLimitMiddleware, config=config)
```

### Response Headers

Every non-health response includes rate-limit headers:

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Maximum allowed requests for the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Seconds until the oldest tracked request expires |
| `Retry-After` | Seconds to wait (only on 429 responses) |

### 429 Response Format

For MCP paths (`/mcp`), the response uses JSON-RPC error format:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32602, "message": "Rate limit exceeded. Retry after 5s." },
  "id": null
}
```

For REST paths, the response uses standard JSON:

```json
{
  "error": "Rate limit exceeded",
  "retry_after": 5
}
```

### Write Operation Classification

A request is classified as a **write** if any of these conditions hold:

- HTTP method is `POST`, `PUT`, `DELETE`, or `PATCH`.
- URL path contains `/claim`, `/advance`, `/reject`, `/release`, or `/rework`.

All other requests are classified as **read**.

### Public API

| Symbol | Kind | Description |
|---|---|---|
| `RateLimitConfig` | frozen dataclass | Read/write limit and window configuration |
| `RateLimitMiddleware` | class | Starlette middleware enforcing per-agent rate limits |
| `SlidingWindowLimiter` | class | In-memory sliding window rate limiter |

### Structured Logging

| Event | Level | Extra Fields |
|---|---|---|
| `rate_limit_exceeded` | WARNING | `key`, `limit`, `is_write`, `retry_after` |


## Idempotency Key Middleware

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.middleware.idempotency` module prevents duplicate processing
of mutating operations (POST, PUT, PATCH, DELETE). Clients include an
`X-Idempotency-Key` header. The middleware caches the response for that key;
replayed requests return the cached result without re-executing the handler.

### How It Works

1. Client sends a mutating request with `X-Idempotency-Key: <unique-key>`.
2. Middleware checks the idempotency store:
   - **No entry** — marks key *in-progress*, calls the handler, caches the
     response.
   - **In-progress** — returns `409 Conflict` (the earlier request is still
     running).
   - **Completed** — returns the cached response with
     `X-Idempotent-Replayed: true`.
3. Cached entries expire after a configurable TTL (default 24 hours).
4. If the handler raises an exception, the in-progress marker is removed so
   the client can retry with the same key.

### Configuration

| Parameter | Default | Description |
|---|---|---|
| `ttl_seconds` | `86400` | How long cached responses are retained (24 h) |
| `missing_key_policy` | `"warn"` | `"warn"` — log and allow; `"reject"` — return 400 |

All values are configurable via `IdempotencyConfig`.

### Quick Start

```python
from mcp_server.middleware import (
    IdempotencyConfig,
    IdempotencyMiddleware,
    MissingKeyPolicy,
)

# Default: warn on missing key, 24 h TTL
app.add_middleware(IdempotencyMiddleware)

# Strict: reject requests without a key, 1 h TTL
config = IdempotencyConfig(
    ttl_seconds=3600,
    missing_key_policy=MissingKeyPolicy.REJECT,
)
app.add_middleware(IdempotencyMiddleware, config=config)
```

### Request Headers

| Header | Direction | Description |
|---|---|---|
| `X-Idempotency-Key` | Request | Client-supplied unique key for the operation |
| `X-Idempotent-Replayed` | Response | Set to `"true"` when the response is a cached replay |

### 409 Conflict Response

Returned when a request uses a key that is still being processed.

For MCP paths (`/mcp`):

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Operation with idempotency key '<key>' is still in-progress"
  },
  "id": null
}
```

For REST paths:

```json
{
  "error": "Operation with idempotency key '<key>' is still in-progress"
}
```

### 400 Bad Request (Reject Policy)

Returned when `missing_key_policy` is `REJECT` and the request has no key.

For MCP paths:

```json
{
  "jsonrpc": "2.0",
  "error": { "code": -32602, "message": "Missing required X-Idempotency-Key header" },
  "id": null
}
```

For REST paths:

```json
{
  "error": "Missing required X-Idempotency-Key header for idempotency"
}
```

### Excluded Paths

Health and readiness endpoints bypass idempotency enforcement:
`/health`, `/healthz`, `/ready`, `/readiness`, `/livez`, `/readyz`.

### Storage Backend

The middleware uses a pluggable `IdempotencyStore` interface.
`InMemoryIdempotencyStore` is the default (suitable for single-instance
deployments). Subclass `IdempotencyStore` for external backends
(Redis, PostgreSQL).

### Public API

| Symbol | Kind | Description |
|---|---|---|
| `IdempotencyConfig` | frozen dataclass | TTL and missing-key policy configuration |
| `IdempotencyMiddleware` | class | Starlette middleware enforcing idempotency |
| `IdempotencyStore` | ABC | Abstract interface for pluggable storage backends |
| `InMemoryIdempotencyStore` | class | Default in-process dict-backed store |
| `MissingKeyPolicy` | enum | `WARN` or `REJECT` for missing keys |
| `IdempotencyEntry` | dataclass | Cached response or in-progress marker |
| `HEADER_NAME` | constant | `"x-idempotency-key"` |
| `DEFAULT_TTL_SECONDS` | constant | `86400` (24 hours) |

### IdempotencyStore Methods

| Method | Returns | Description |
|---|---|---|
| `get(key)` | `IdempotencyEntry \| None` | Return entry or `None` if missing/expired |
| `set(key, entry, ttl_seconds=...)` | `None` | Store a completed entry with TTL |
| `remove(key)` | `None` | Remove an entry (no-op if missing) |
| `mark_in_progress(key, ttl_seconds=...)` | `None` | Mark key as in-progress |
| `cleanup_expired()` | `None` | Remove all entries whose TTL has elapsed |

### Structured Logging

| Event | Level | Extra Fields |
|---|---|---|
| `idempotency_key_missing` | WARNING | `path`, `method` |
| `idempotency_key_missing_rejected` | WARNING | `path`, `method` |
| `idempotency_conflict` | INFO | `key`, `path` |
| `idempotency_replay` | INFO | `key`, `path` |


## Auth Middleware — Unified MCP + REST Authentication

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.middleware` package provides a Starlette middleware that
authenticates both MCP tool calls and REST API requests through a single
credential pipeline. It delegates key validation to `mcp_server.auth` and
populates a per-request `AuthContext` via `contextvars` for downstream use
by authorization and audit layers.

### Authentication Flow

```
Incoming request
       │
       ▼
┌─ Path exclusion check ──▸ bypass if /health, /healthz, /ready, etc.
│
├─ Database pool check ──▸ 503 if pool unavailable
│
├─ Credential extraction
│   ├─ X-API-Key header (preferred)
│   └─ Authorization: Bearer <token> (fallback)
│
├─ Validate via validate_api_key() ──▸ 401 on failure
│
├─ Build AuthContext (identity_type, identity_id, role, machine_id, permissions)
│
├─ Set contextvars for downstream handlers
│
├─ Call next middleware / handler
│
└─ Clear AuthContext (finally block)
```

### Excluded Paths

Health and readiness endpoints bypass authentication:

| Path | Purpose |
|---|---|
| `/health` | Liveness probe |
| `/healthz` | Kubernetes liveness |
| `/ready` | Readiness probe |
| `/readiness` | Readiness probe |
| `/livez` | Kubernetes liveness |
| `/readyz` | Kubernetes readiness |

Custom exclusions can be passed via the `excluded_paths` constructor parameter.

### Quick Start

```python
from mcp_server.middleware import AuthMiddleware, get_auth_context

# Add to Starlette/FastAPI app
app.add_middleware(AuthMiddleware, db_pool=pool)

# In a downstream handler, read the authenticated identity
async def my_handler(request):
    ctx = get_auth_context()
    if ctx:
        print(ctx.identity_id, ctx.role, ctx.machine_id)
```

### AuthContext Fields

| Field | Type | Description |
|---|---|---|
| `identity_type` | `IdentityType` | `AGENT`, `OPERATOR`, or `ADMIN` |
| `identity_id` | `str` | UUID of the authenticated agent |
| `role` | `str` | Agent role string (e.g. `"backend"`, `"admin"`) |
| `machine_id` | `str` | Machine ID from `X-Machine-Id`, `X-Forwarded-For`, or client IP |
| `agent_name` | `str` | Human-readable agent name |
| `permissions` | `list[str]` | Granted permissions list |

`AuthContext` is a frozen dataclass with `slots=True` for memory efficiency.

### IdentityType Enum

| Value | Mapped From |
|---|---|
| `AGENT` | Any non-admin role |
| `OPERATOR` | Reserved for future operator auth |
| `ADMIN` | Role string `"admin"` |

### Error Responses

| Scenario | REST Response | MCP Response |
|---|---|---|
| Missing credentials | `401 {"error": "Authentication required"}` | `401 {"jsonrpc": "2.0", "error": {"code": -32602, "message": "Authentication required"}}` |
| Invalid credentials | `401 {"error": "<reason>"}` | `401 {"jsonrpc": "2.0", "error": {"code": -32602, "message": "<reason>"}}` |
| No database pool | `503 {"error": "Service unavailable"}` | `503 {"error": "Service unavailable"}` |

### AuthMiddleware Constructor

| Parameter | Type | Default | Description |
|---|---|---|---|
| `app` | `ASGIApp` | *(required)* | The ASGI application to wrap |
| `db_pool` | `asyncpg.Pool \| None` | `None` | Database pool for credential validation |
| `excluded_paths` | `frozenset[str] \| None` | `None` | Additional paths to exclude from auth |

The `db_pool` property supports get/set for late binding (e.g. when the pool
initializes after middleware registration).

### Context Management Functions

| Function | Description |
|---|---|
| `set_auth_context(ctx)` | Set the `AuthContext` for the current async context |
| `get_auth_context()` | Return the current `AuthContext` or `None` |
| `clear_auth_context()` | Reset the context to `None` (called in `finally` block) |

### Public API

| Symbol | Kind | Purpose |
|---|---|---|
| `AuthMiddleware` | class | Starlette middleware for unified auth |
| `AuthContext` | frozen dataclass | Per-request identity context |
| `IdentityType` | enum | Identity classification (`AGENT`, `OPERATOR`, `ADMIN`) |
| `set_auth_context` | function | Set context for current request |
| `get_auth_context` | function | Read context in downstream handlers |
| `clear_auth_context` | function | Clear context after request completes |

### Audit Logging

| Event | Level | Extra Fields |
|---|---|---|
| `auth_success` | INFO | `identity_type`, `agent_name`, `path` |
| `auth_missing_credentials` | WARNING | `path` |
| `auth_validation_failed` | WARNING | `path`, `reason` |
| `auth_no_db_pool` | ERROR | *(none)* |


## Machine Registration and Verification

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.auth.machine_auth` module provides machine identity
registration and verification. Each machine running agents registers with a
unique `machine_id` (hostname or UUID). On each request the `machine_id` is
verified against the registry.

### Registration Modes

| Mode | Enum Value | Behavior |
|------|------------|----------|
| Auto | `MachineRegistrationMode.AUTO` | Unknown machines are automatically registered on first request |
| Strict | `MachineRegistrationMode.STRICT` | Unknown machines are rejected with a 403 error |

### Verification Flow

```
Client sends machine_id
       │
       ▼
┌─ Validate machine_id ──▸ reject if empty or > 255 chars
│
├─ Look up in machines table
│
├─ Unknown + STRICT mode ──▸ reject with MachineAuthError (403)
│
├─ Unknown + AUTO mode ──▸ auto-register via UPSERT, return identity
│
├─ Known + inactive ──▸ reject with MachineAuthError (403)
│
├─ Known + active ──▸ update last_seen_at (fire-and-forget)
│
└─ Return MachineIdentity(machine_id, hostname, first_seen_at, last_seen_at, is_active)
```

### Quick Start (Low-Level API)

```python
from mcp_server.auth.machine_auth import (
    MachineRegistrationMode,
    register_machine,
    verify_machine,
    get_machine,
    deactivate_machine,
)

# Register a machine (idempotent UPSERT)
identity = await register_machine(db_pool, "worker-01", "worker-01.local")

# Verify on each request (auto-registers if unknown in AUTO mode)
identity = await verify_machine(
    db_pool, "worker-01", mode=MachineRegistrationMode.AUTO
)

# Look up a machine
machine = await get_machine(db_pool, "worker-01")

# Deactivate a machine (soft delete)
was_deactivated = await deactivate_machine(db_pool, "worker-01")
```

### Quick Start (Service Layer)

```python
from mcp_server.auth.machine_auth import MachineRegistrationMode
from mcp_server.services.machine_service import MachineService

svc = MachineService(db_pool, mode=MachineRegistrationMode.STRICT)

identity = await svc.register("worker-01", hostname="worker-01.local")
identity = await svc.verify("worker-01")
machine  = await svc.lookup("worker-01")
result   = await svc.deactivate("worker-01")
```

### Machine Record

The `machines` table stores:

| Column | Description |
|---|---|
| `machine_id` | Unique machine identifier (hostname or UUID) |
| `hostname` | Human-readable hostname |
| `first_seen_at` | Registration timestamp (UTC) |
| `last_seen_at` | Last verification timestamp (UTC) |
| `is_active` | Whether the machine is active |

### Public API — `mcp_server.auth.machine_auth`

| Symbol | Kind | Purpose |
|---|---|---|
| `MachineIdentity` | frozen dataclass | Immutable machine descriptor with `machine_id`, `hostname`, `first_seen_at`, `last_seen_at`, `is_active` |
| `MachineRegistrationMode` | enum | `AUTO` or `STRICT` verification mode |
| `MachineAuthError` | exception | Verification failure (JSON-RPC `-32602`, HTTP 403) |
| `register_machine(pool, id, hostname)` | async function | Register or upsert a machine record |
| `verify_machine(pool, id, mode, hostname)` | async function | Verify identity; auto-register or reject |
| `get_machine(pool, id)` | async function | Look up a machine by ID |
| `deactivate_machine(pool, id)` | async function | Soft-deactivate a machine |

### Public API — `mcp_server.services.machine_service`

| Symbol | Kind | Purpose |
|---|---|---|
| `MachineService` | class | High-level wrapper holding pool and default mode |
| `MachineService.register(id, hostname)` | async method | Register or upsert |
| `MachineService.verify(id, hostname)` | async method | Verify with configured mode |
| `MachineService.lookup(id)` | async method | Look up by ID |
| `MachineService.deactivate(id)` | async method | Soft-deactivate |
| `MachineService.mode` | property | Current `MachineRegistrationMode` |

### Design Constraints

- **UPSERT semantics** — `register_machine` uses `INSERT ... ON CONFLICT DO UPDATE` so concurrent registrations are safe.
- **Fire-and-forget last_seen** — `last_seen_at` updates do not block the verification response.
- **Frozen dataclass** — `MachineIdentity` is immutable with `__slots__` for memory efficiency.
- **Input validation** — `machine_id` is stripped, checked for emptiness, and capped at 255 characters.
- **Parameterized SQL** — all queries use `$1`, `$2` placeholders; no string interpolation.


## Operator Machine-Scoped Permissions

<!-- last_reviewed: 2026-03-11T12:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.auth.authorization` module enforces that operators can only
perform REST operations on machines they are bound to. The
`operator_machine_bindings` table stores many-to-many operator-machine
associations. Admin operators bypass all binding checks.

Higher-level functions in `mcp_server.services.operator_service` wrap the
low-level authorization functions with structured logging.

### How It Works

1. An admin binds an operator to one or more machines via `add_binding()`.
2. On each REST request, `require_operator_machine_access()` checks the
   operator's role — admins pass through; non-admins must have a binding.
3. Unbound operator-machine pairs are rejected with `MachineScopeError`
   (HTTP 403 Forbidden).
4. Operators can be bound to multiple machines. Bindings are idempotent
   (`INSERT ... ON CONFLICT DO NOTHING`).

### Quick Start

```python
from mcp_server.auth.authorization import (
    add_binding,
    remove_binding,
    list_bindings,
    require_operator_machine_access,
)

# Bind operator to a machine (idempotent)
binding = await add_binding(pool, operator_id="uuid-...", machine_id="pop-os")

# Enforce access — raises MachineScopeError if unbound
await require_operator_machine_access(
    pool, operator_id="uuid-...", machine_id="pop-os", role="operator"
)

# Admin bypass — no binding check
await require_operator_machine_access(
    pool, operator_id="uuid-...", machine_id="any-machine", role="admin"
)

# List all bindings for an operator
bindings = await list_bindings(pool, operator_id="uuid-...")
for b in bindings:
    print(f"{b.machine_id} since {b.registered_at}")

# Remove a binding
removed = await remove_binding(pool, operator_id="uuid-...", machine_id="pop-os")
```

### Service Layer

The `operator_service` module provides higher-level wrappers that return
plain dicts suitable for API responses:

```python
from mcp_server.services.operator_service import (
    bind_operator_to_machine,
    unbind_operator_from_machine,
    get_operator_bindings,
    validate_operator_machine_access,
)

# Bind
result = await bind_operator_to_machine(pool, "uuid-...", "pop-os")
# {"operator_id": "...", "machine_id": "pop-os", "registered_at": "..."}

# List
bindings = await get_operator_bindings(pool, "uuid-...")
# [{"machine_id": "pop-os", "registered_at": "..."}]

# Unbind
result = await unbind_operator_from_machine(pool, "uuid-...", "pop-os")
# {"removed": true, "operator_id": "...", "machine_id": "pop-os"}

# Enforce access (delegates to require_operator_machine_access)
await validate_operator_machine_access(pool, "uuid-...", "pop-os", "operator")
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `OperatorMachineBinding` | frozen dataclass | Binding descriptor with `id`, `operator_id`, `machine_id`, `registered_at` |
| `MachineScopeError` | exception | Raised when operator is not bound to the requested machine (403) |
| `ADMIN_ROLE` | constant | Role string (`"admin"`) that bypasses binding checks |

### Authorization Functions

| Function | Returns | Description |
|---|---|---|
| `check_operator_machine_binding(pool, operator_id, machine_id)` | `bool` | Check whether a binding exists |
| `require_operator_machine_access(pool, operator_id, machine_id, role)` | `None` | Enforce binding; raises `MachineScopeError` if unbound and not admin |
| `add_binding(pool, operator_id, machine_id)` | `OperatorMachineBinding` | Create a binding (idempotent UPSERT) |
| `remove_binding(pool, operator_id, machine_id)` | `bool` | Delete a binding; returns `True` if deleted |
| `list_bindings(pool, operator_id)` | `list[OperatorMachineBinding]` | List all bindings for an operator, ordered by registration time |

### Service Functions

| Function | Returns | Description |
|---|---|---|
| `bind_operator_to_machine(pool, operator_id, machine_id)` | `dict` | Service-layer bind returning response dict |
| `unbind_operator_from_machine(pool, operator_id, machine_id)` | `dict` | Service-layer unbind returning `{"removed": bool}` |
| `get_operator_bindings(pool, operator_id)` | `list[dict]` | List bindings as response dicts |
| `validate_operator_machine_access(pool, operator_id, machine_id, role)` | `None` | Enforce binding (delegates to `require_operator_machine_access`) |

### Error Handling

| Scenario | Behavior |
|---|---|
| Unbound operator on non-admin role | Raises `MachineScopeError` (403) |
| Admin role | Bypasses all binding checks |
| Empty `operator_id` or `machine_id` in `add_binding`/`remove_binding` | Raises `MachineScopeError` |
| Database error during binding CRUD | Raises `MachineScopeError` with `database_error` reason |

### Design Constraints

- **Idempotent bindings** — `add_binding` uses `ON CONFLICT DO NOTHING`; adding an existing binding is a no-op.
- **Parameterized SQL** — all queries use `$1`, `$2` placeholders; no string interpolation.
- **Frozen dataclass** — `OperatorMachineBinding` is immutable with `__slots__`.
- **Structured logging** — all authorization decisions log `operator_id` and `machine_id`.
- **Admin bypass** — based on the `role` field in the `operators` table, not on a separate privilege table.


## Role-Based Claim Restrictions

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.auth.authorization` module enforces role-based claim
restrictions so that agents can only claim tickets at the SDLC stage
matching their role. A backend agent may only claim tickets in the BACKEND
stage, a QA agent in the QA stage, and so on. The mapping is configurable
for future role additions.

### How It Works

1. `RoleStagePolicy` maintains a mapping of agent role names to authorized
   SDLC stages. The default policy covers all 14 agent types.
2. When `claim_next()` or `claim_by_id()` is called on `TicketService`,
   `check_role_stage_authorization()` validates the agent's role against
   the ticket's current stage before the claim proceeds.
3. Mismatched role-stage pairs are rejected with `RoleStageMismatchError`
   (HTTP 403) containing the agent role, ticket stage, and authorized stage.
4. Operators (role `"operator"`) and admins (role `"admin"`) bypass the
   check when no `role_override` is specified.
5. When an operator provides a `role_override`, the override role is
   validated against the policy instead.

### Default Role-Stage Mapping

| Agent Role | Authorized Stage |
|---|---|
| `architect` | `ARCHITECT` |
| `research` | `RESEARCH` |
| `product_manager` | `PRODUCT_MANAGER` |
| `ui_designer` | `UI_DESIGN` |
| `backend` | `BACKEND` |
| `devops` | `BACKEND` |
| `frontend` | `FRONTEND` |
| `qa` | `QA` |
| `security` | `SECURITY` |
| `ci` | `CI` |
| `documentation` | `DOCUMENTATION` |
| `validator` | `VALIDATOR` |
| `todo` | *(none — does not process stages)* |
| `dispatcher` | *(none — does not process stages)* |

### Quick Start

```python
from mcp_server.auth.authorization import (
    check_role_stage_authorization,
    RoleStagePolicy,
    RoleStageMismatchError,
)

# Validate that a backend agent can claim a BACKEND ticket
check_role_stage_authorization("backend", "BACKEND")  # passes

# Mismatched role-stage raises RoleStageMismatchError
try:
    check_role_stage_authorization("backend", "QA")
except RoleStageMismatchError as e:
    print(e)  # "Agent role 'backend' is authorized for stage 'BACKEND', not 'QA'"

# Operator bypass (no role_override)
check_role_stage_authorization("operator", "BACKEND")  # passes

# Operator with role_override validates the override role
check_role_stage_authorization("operator", "BACKEND", role_override="backend")  # passes
check_role_stage_authorization("operator", "QA", role_override="backend")  # raises

# Custom policy with overrides or new roles
custom = RoleStagePolicy(overrides={"my_agent": "CUSTOM_STAGE"})
check_role_stage_authorization("my_agent", "CUSTOM_STAGE", policy=custom)  # passes
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `RoleStagePolicy` | class | Configurable role-to-stage mapping with defaults for all 14 agent types |
| `RoleStageMismatchError` | exception | Raised when agent role does not match ticket stage (403) |
| `check_role_stage_authorization` | function | Enforce role-stage match; raises `RoleStageMismatchError` on mismatch |
| `OPERATOR_ROLE` | constant | Role string (`"operator"`) that can bypass stage checks |
| `ADMIN_ROLE` | constant | Role string (`"admin"`) that bypasses all authorization checks |

### RoleStagePolicy Methods

| Method | Returns | Description |
|---|---|---|
| `stage_for_role(role)` | `str \| None` | Authorized SDLC stage for the role, or `None` |
| `is_authorized_role(role)` | `bool` | Whether the role is registered in the policy |
| `all_roles()` | `list[str]` | All registered role names |
| `add_role(role, stage)` | `None` | Add or update a role-stage mapping at runtime |
| `remove_role(role)` | `None` | Remove a role from the mapping |

### check_role_stage_authorization Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agent_role` | `str` | Yes | The claiming agent's role (e.g. `"backend"`) |
| `ticket_stage` | `str` | Yes | The ticket's current SDLC stage (e.g. `"BACKEND"`) |
| `role_override` | `str \| None` | No | Operator override — validates this role instead |
| `policy` | `RoleStagePolicy \| None` | No | Custom policy; defaults to the module-level default |

### Error Handling

| Scenario | Behavior |
|---|---|
| Role matches stage | Authorization passes silently |
| Role-stage mismatch | Raises `RoleStageMismatchError` (403) with descriptive message |
| Unknown role | Raises `RoleStageMismatchError` with `unknown_agent_role` reason |
| Role with no stage (e.g. `todo`) | Raises `RoleStageMismatchError` with `role_has_no_stage` reason |
| Empty `agent_role` or `ticket_stage` | Raises `RoleStageMismatchError` with validation reason |
| Operator without `role_override` | Bypasses check entirely |
| Admin without `role_override` | Bypasses check entirely |
| Operator with `role_override` | Validates the override role against the policy |

### Integration with TicketService

Both `claim_next()` and `claim_by_id()` on `TicketService` call
`check_role_stage_authorization()` before delegating to the `ClaimQueue`.
This ensures role-stage enforcement applies to both the MCP tool path
(`tickets.next`, `tickets.claim`) and the REST API path.

### Design Constraints

- **Configurable mapping** — `RoleStagePolicy` accepts constructor overrides
  and runtime mutations via `add_role()` / `remove_role()`. The default
  mapping is not hardcoded into the authorization function.
- **Case-insensitive** — roles are normalized to lowercase, stages to
  uppercase before comparison.
- **Structured logging** — all authorization decisions (pass, bypass,
  mismatch, unknown role) are logged with `agent_role` and `ticket_stage`.
- **No database dependency** — role-stage authorization is a pure in-memory
  check. No database calls are needed.


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



## Tool Input Validation

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.tools.validation` module validates MCP tool input parameters
against JSON Schema (Draft 2020-12) before handler invocation. Invalid inputs
produce structured error responses with the MCP `INVALID_PARAMS` code (`-32602`).

### Quick Start

```python
from mcp_server.tools import validate_tool_input, ToolInputValidationError

schema = {
    "type": "object",
    "properties": {
        "ticket_id": {"type": "string"},
        "priority": {"type": "integer", "minimum": 1, "maximum": 5},
    },
    "required": ["ticket_id"],
    "additionalProperties": False,
}

# Valid input passes silently
validate_tool_input("my_tool", schema, {"ticket_id": "BE021", "priority": 3})

# Invalid input raises ToolInputValidationError
try:
    validate_tool_input("my_tool", schema, {"priority": "high"})
except ToolInputValidationError as exc:
    for err in exc.field_errors:
        print(f"{err.path}: {err.message}")
    # $.ticket_id: 'ticket_id' is a required property
    # $.priority: 'high' is not of type 'integer'
```

### Features

- **All-errors-at-once** — collects every validation failure in a single pass.
- **JSONPath field paths** — errors reference `$.user.name`, `$.tags[0]`, etc.
- **No type coercion** — inputs must match schema types exactly (string `"3"`
  is not accepted for an integer field).
- **Compiled validator caching** — validators are compiled once per tool name
  and reused, keeping validation under 1 ms for typical inputs.
- **MCP error semantics** — `build_validation_error_data()` produces a
  structured payload ready for MCP `INVALID_PARAMS` error responses.

### Building MCP Error Responses

```python
from mcp_server.tools import (
    build_validation_error_data,
    ToolInputValidationError,
    INVALID_PARAMS,
)

try:
    validate_tool_input("tickets.claim", schema, params)
except ToolInputValidationError as exc:
    error_data = build_validation_error_data(exc)
    # {
    #     "tool_name": "tickets.claim",
    #     "errors": [
    #         {"path": "$.ticket_id", "message": "'ticket_id' is a required property"},
    #         {"path": "$.agent_name", "message": "'agent_name' is a required property"}
    #     ]
    # }
    # Use INVALID_PARAMS (-32602) as the JSON-RPC error code
```

### Validator Cache

Compiled `Draft202012Validator` instances are cached per tool name. Call
`clear_validator_cache()` to reset the cache (primarily useful in tests).

```python
from mcp_server.tools import compile_validator, clear_validator_cache

validator = compile_validator("my_tool", schema)  # compiled and cached
validator2 = compile_validator("my_tool", schema)  # returns cached instance
assert validator is validator2

clear_validator_cache()  # remove all cached validators
```

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `validate_tool_input(tool_name, schema, params)` | function | Validate params against JSON Schema; raises `ToolInputValidationError` on failure |
| `compile_validator(tool_name, schema)` | function | Compile and cache a `Draft202012Validator` for a tool |
| `build_validation_error_data(exc)` | function | Convert a `ToolInputValidationError` into a structured MCP error payload |
| `clear_validator_cache()` | function | Remove all cached validators |
| `FieldError` | dataclass | Frozen dataclass with `path` (str) and `message` (str) |
| `ToolInputValidationError` | exception | Carries `tool_name` (str) and `field_errors` (list of `FieldError`) |
| `McpValidationErrorData` | dataclass | Frozen dataclass with `tool_name` and `errors` list; has `to_dict()` method |
| `INVALID_PARAMS` | constant | MCP/JSON-RPC error code `-32602` |

### Design Constraints

- **Draft 2020-12** — validators use `jsonschema.Draft202012Validator`.
- **No coercion** — type mismatches are always rejected (e.g. `1` is not `true`).
- **All errors collected** — `iter_errors()` gathers every failure before raising.
- **Immutable data** — `FieldError` and `McpValidationErrorData` are frozen dataclasses with `__slots__`.
- **Cache key** — tool name is the cache key; schema changes require `clear_validator_cache()`.


## Ticket Tools — `tickets.next`, `tickets.claim`, `tickets.release`, and `tickets.status` MCP Tools

<!-- last_reviewed: 2026-03-11T00:33:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.tools.ticket_tools` module registers seven MCP tools for
ticket lifecycle management. This section covers the four core tools:
`tickets.next`, `tickets.claim`, `tickets.release`, and `tickets.status`.
Each tool validates input via JSON Schema, delegates to `TicketService` for
business logic, and returns structured data or MCP errors.

### How It Works

**`tickets.next`** — auto-select the next eligible ticket:

1. Agent sends a `tickets.next` tool call with `agent_role`, `machine_id`,
   and `operator`.
2. Input is validated against `TICKETS_NEXT_SCHEMA` (JSON Schema Draft 2020-12).
3. `TicketService.claim_next()` resolves the role to an SDLC stage via
   `AgentRoleMap`, then calls the `ClaimQueue` for atomic claiming with
   `SELECT FOR UPDATE SKIP LOCKED`.
4. On success, the tool returns the claimed ticket's ID, title, type, stage,
   file paths, and acceptance criteria.
5. On failure, the tool returns a structured MCP error (code `-32602`).

**`tickets.claim`** — claim a specific ticket by ID:

1. Agent sends a `tickets.claim` tool call with `ticket_id`, `agent_id`,
   `machine_id`, `operator`, and an optional `lease_duration_minutes`.
2. Input is validated against `TICKETS_CLAIM_SCHEMA` (JSON Schema Draft 2020-12).
3. `TicketService.claim_by_id()` resolves the agent role to an SDLC stage,
   verifies role-stage authorization, then calls `ClaimQueue.claim_by_id()`
   for atomic claiming.
4. On success, the tool returns the claimed ticket data.
5. On failure (not in READY stage, already claimed, role mismatch), the tool
   returns a structured MCP error (code `-32602`).

**`tickets.release`** — release a claimed ticket back to READY:

1. Agent sends a `tickets.release` call with `ticket_id`, `agent_id`, and
   an optional `reason`.
2. Input is validated against `TICKETS_RELEASE_SCHEMA`.
3. `TicketService.release_ticket()` verifies the requesting agent holds the
   active claim. If not, a `ClaimOwnershipError` is returned.
4. The claim is cleared, an event history record is created with event type
   `RELEASED`, and the ticket moves back to READY.
5. Returns a `ReleaseResult` with `ticket_id`, `previous_stage`,
   `released_by`, and `reason`.

**`tickets.status`** — query ticket detail or list:

1. Agent sends a `tickets.status` call with either `ticket_id` for detail
   or filter parameters (`stage`, `type`, `priority`, `page`, `page_size`)
   for a paginated list.
2. With `ticket_id`: returns full `TicketDetail` including history, active
   claim, dependencies, and acceptance criteria.
3. Without `ticket_id`: returns a `TicketListResult` with paginated ticket
   summaries. Filters can be combined.

### Quick Start

```python
from mcp_server.tools import register_ticket_tools
from mcp_server.services import TicketService
from mcp_server.locking import ClaimQueue

queue = ClaimQueue(pool)
service = TicketService(claim_queue=queue)

# Register the tool on a ToolRegistry
register_ticket_tools(registry, service)
```

### Input Schemas

**`tickets.next`:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agent_role` | `string` | Yes | Agent role (e.g. `"backend"`, `"qa"`, `"frontend"`) |
| `machine_id` | `string` | Yes | Hostname of the machine running the agent |
| `operator` | `string` | Yes | Human operator initiating the claim |

**`tickets.claim`:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticket_id` | `string` | Yes | Human-readable ticket ID (e.g. `"FORGEOS-BE006"`) |
| `agent_id` | `string` | Yes | Agent role name (e.g. `"backend"`, `"qa"`) |
| `machine_id` | `string` | Yes | Hostname of the machine running the agent |
| `operator` | `string` | Yes | Human operator initiating the claim |
| `lease_duration_minutes` | `integer` | No | Lease duration in minutes (default 30, max 1440) |

**`tickets.release`:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticket_id` | `string` | Yes | Ticket ID to release |
| `agent_id` | `string` | Yes | Agent role that holds the active claim |
| `reason` | `string` | No | Optional reason for releasing the ticket |

**`tickets.status`:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticket_id` | `string` | No | Specific ticket ID for full detail |
| `stage` | `string` | No | Filter by SDLC stage |
| `type` | `string` | No | Filter by ticket type |
| `priority` | `string` | No | Filter by priority |
| `page` | `integer` | No | Page number (1-based, default 1) |
| `page_size` | `integer` | No | Results per page (1–100, default 20) |

When `ticket_id` is provided, filter parameters are ignored.

### Example Calls

Calling `tickets.release` via MCP:

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.release",
    "arguments": {
      "ticket_id": "FORGEOS-BE032",
      "agent_id": "backend",
      "reason": "Reassigning to another agent"
    }
  }
}
```

Calling `tickets.status` for a single ticket:

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.status",
    "arguments": {
      "ticket_id": "FORGEOS-BE032"
    }
  }
}
```

Calling `tickets.status` with filters:

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.status",
    "arguments": {
      "stage": "READY",
      "priority": "high",
      "page": 1,
      "page_size": 10
    }
  }
}
```

### Response Shapes

**`tickets.next` / `tickets.claim` success:**

```json
{
  "ticket_id": "FORGEOS-BE006",
  "title": "Implement Ticket Claim Queue",
  "type": "backend",
  "stage": "BACKEND",
  "file_paths": ["mcp-server/src/mcp_server/locking/claim_queue.py"],
  "acceptance_criteria": ["Claim queue uses SKIP LOCKED"]
}
```

**`tickets.release` success:**

```json
{
  "ticket_id": "FORGEOS-BE032",
  "previous_stage": "BACKEND",
  "released_by": "backend",
  "reason": "Reassigning to another agent"
}
```

**`tickets.status` detail response:**

```json
{
  "ticket_id": "FORGEOS-BE032",
  "title": "Implement tickets.release and tickets.status Tools",
  "description": "...",
  "type": "backend",
  "priority": "high",
  "stage": "BACKEND",
  "status": "CLAIMED",
  "file_paths": ["mcp-server/src/tools/ticket_tools.py"],
  "acceptance_criteria": ["..."],
  "depends_on": ["FORGEOS-BE028"],
  "current_claim": {
    "claimed_by": "uuid",
    "claimed_by_name": "backend",
    "machine_id": "pop-os",
    "operator": "ReaperOAK",
    "lease_expiry": "2026-03-11T01:00:00+00:00"
  },
  "history": [
    {
      "event_type": "CLAIMED",
      "agent_name": "backend",
      "previous_stage": "READY",
      "new_stage": "BACKEND",
      "created_at": "2026-03-10T22:27:49+00:00"
    }
  ]
}
```

**`tickets.status` list response:**

```json
{
  "tickets": [
    {
      "ticket_id": "FORGEOS-BE033",
      "title": "...",
      "type": "backend",
      "priority": "high",
      "stage": "READY",
      "status": "READY"
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 10
}
```

### Error Responses

**`tickets.next`:**

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| No eligible ticket for role | `true` | `-32602` | `No eligible ticket for role '{role}'` |
| Unknown agent role | `true` | `-32602` | `Unknown agent role: {role}` |
| Invalid input (schema failure) | Raises `ToolInputValidationError` | `-32602` | Field-level error details |

**`tickets.claim`:**

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| Ticket not claimable (wrong stage / already claimed) | `true` | `-32602` | `Ticket '{id}' is not claimable (not in READY stage or already claimed)` |
| Claim conflict (file lock) | `true` | `-32602` | Conflict detail from `ClaimError` |
| Unknown agent role | `true` | `-32602` | `Unknown agent role: {role}` |
| Invalid input (schema failure) | Raises `ToolInputValidationError` | `-32602` | Field-level error details |

**`tickets.release`:**

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| Ticket not found | `true` | `-32602` | `Ticket '{id}' not found` |
| No active claim | `true` | `-32602` | `Ticket '{id}' has no active claim` |
| Agent doesn't own claim | `true` | `-32602` | `Agent '{id}' does not own the claim on '{ticket}'` |

**`tickets.status`:**

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| Ticket not found (by ID) | `true` | `-32602` | `Ticket '{id}' not found` |

### Ticket Service

The `mcp_server.services.ticket_service` module provides a shared orchestration
layer consumed by both MCP tool handlers and REST endpoints.

| Symbol | Kind | Description |
|---|---|---|
| `TicketService` | class | Coordinates claim queue, role mapping, and ticket operations |
| `NextTicketResult` | frozen dataclass | Claim result with ticket ID, title, type, stage, file paths, criteria |
| `ReleaseResult` | frozen dataclass | Release result with ticket ID, previous stage, agent, and reason |
| `TicketDetail` | frozen dataclass | Full ticket detail with history, claim, dependencies, and criteria |
| `TicketListResult` | frozen dataclass | Paginated list of ticket summaries |
| `ClaimOwnershipError` | exception | Raised when releasing agent does not own the active claim |

#### TicketService Methods

| Method | Returns | Description |
|---|---|---|
| `claim_next(agent_role, machine_id, operator, lease_minutes)` | `NextTicketResult` | Resolve role to stage, claim next ticket atomically |
| `claim_by_id(ticket_id, agent_role, machine_id, operator, lease_minutes)` | `NextTicketResult` | Claim a specific ticket by ID with role-stage authorization |
| `release_ticket(ticket_id, agent_id, reason)` | `ReleaseResult` | Release a claim, move ticket to READY, create event |
| `get_ticket_status(ticket_id)` | `TicketDetail` | Full detail with history and active claim |
| `list_tickets(stage, ticket_type, priority, page, page_size)` | `TicketListResult` | Paginated, filtered ticket listing |

#### ReleaseResult Fields

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `str` | Released ticket ID |
| `previous_stage` | `str` | Stage the ticket was in before release |
| `released_by` | `str` | Agent that released the ticket |
| `reason` | `str` | Optional release reason |

#### TicketDetail Fields

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `str` | Human-readable ticket ID |
| `title` | `str` | Ticket title |
| `description` | `str` | Full description |
| `ticket_type` | `str` | Ticket type |
| `priority` | `str` | Priority level |
| `stage` | `str` | Current SDLC stage |
| `status` | `str` | Current status |
| `file_paths` | `list[str]` | Files within ticket scope |
| `acceptance_criteria` | `list[str]` | Acceptance criteria |
| `depends_on` | `list[str]` | Dependency ticket IDs |
| `current_claim` | `dict \| None` | Active claim details (if any) |
| `history` | `list[dict]` | Event history records |

#### TicketListResult Fields

| Field | Type | Description |
|---|---|---|
| `tickets` | `list[dict]` | Ticket summaries (id, title, type, priority, stage, status) |
| `total` | `int` | Count of tickets in the current page |
| `page` | `int` | Current page number |
| `page_size` | `int` | Page size |

### Design Constraints

- **Service layer separation** — tool handler validates input and formats
  output; `TicketService` owns all business logic.
- **TYPE_CHECKING guard** — `ticket_tools.py` imports `TicketService` and
  `ToolRegistry` under `TYPE_CHECKING` only, avoiding runtime circular imports.
- **Closure binding** — `_make_handler()` creates a closure that binds the
  `TicketService` instance, matching the `ToolRegistry` handler protocol.
- **Ownership validation** — `tickets.release` validates that the requesting
  agent holds the active claim before releasing. Non-owners receive an error.
- **Event sourcing** — every release creates an event history record for
  audit and traceability.
- **Structured logging** — all operations log `agent_role`, `machine_id`, and
  `ticket_id` for correlation.


## Ticket Tools — `tickets.advance` MCP Tool

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `tickets.advance` MCP tool moves a ticket to its next SDLC stage. It
validates that the calling agent holds the active claim and that the transition
is legal per the ticket's SDLC flow. Uses SERIALIZABLE transaction isolation
for state integrity.

### How It Works

1. Agent sends a `tickets.advance` tool call with `ticket_id` and `agent_id`.
2. Input is validated against `TICKETS_ADVANCE_SCHEMA` (JSON Schema).
3. `TicketService.advance_ticket()` opens a SERIALIZABLE transaction and
   locks the ticket row with `SELECT ... FOR UPDATE`.
4. The stage engine (`validate_advance`) verifies the current stage is in the
   ticket's `sdlc_flow` and computes the next stage.
5. The ticket row is updated: stage advanced, claim cleared, status set to
   `READY` (or `DONE` for the final stage).
6. An `event_history` record of type `STAGE_ADVANCED` is inserted.
7. On success, the tool returns previous and new stage information.

### Input Schema

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticket_id` | `string` | Yes | Human-readable ticket ID (e.g. `"FORGEOS-BE006"`) |
| `agent_id` | `string` | Yes | Agent role name that holds the active claim |
| `evidence` | `object` | No | Completion evidence (artifacts, coverage, etc.) |

### Example Request

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.advance",
    "arguments": {
      "ticket_id": "FORGEOS-BE006",
      "agent_id": "Backend",
      "evidence": {
        "artifacts": ["src/services/stage_engine.py"],
        "test_coverage": "100%"
      }
    }
  }
}
```

### Success Response

```json
{
  "ticket_id": "FORGEOS-BE006",
  "title": "Implement Stage Engine",
  "type": "backend",
  "previous_stage": "BACKEND",
  "new_stage": "QA",
  "status": "READY"
}
```

### Error Responses

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| Ticket not found | `true` | `-32602` | `Ticket '{id}' not found` |
| Agent does not hold claim | `true` | `-32602` | `Ticket is claimed by '{other}', not '{agent}'` |
| Ticket not claimed | `true` | `-32602` | `Ticket is not currently claimed` |
| Already at final stage | `true` | `-32602` | `Ticket is already at the final stage '{stage}'` |
| Stage not in SDLC flow | `true` | `-32602` | `Current stage '{stage}' is not in the ticket's SDLC flow` |
| No pool configured | `true` | `-32602` | `Pool not configured for advance operations` |

### Stage Engine

The `mcp_server.services.stage_engine` module provides pure-domain logic for
SDLC stage transitions. It has zero external imports and no I/O.

| Symbol | Kind | Description |
|---|---|---|
| `get_next_stage(sdlc_flow, current_stage)` | function | Return the next stage in a flow, or `None` |
| `validate_advance(ticket_id, sdlc_flow, current_stage)` | function | Validate and return next stage, or raise |
| `InvalidTransitionError` | exception | Raised on illegal transitions |

### AdvanceTicketResult Fields

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `str` | Human-readable ticket ID |
| `title` | `str` | Ticket title |
| `ticket_type` | `str` | Ticket type (e.g. `"backend"`) |
| `previous_stage` | `str` | Stage before the advance |
| `new_stage` | `str` | Stage after the advance |
| `status` | `str` | New status (`"READY"` or `"DONE"`) |

### Design Constraints

- **SERIALIZABLE isolation** — the advance transaction uses the strictest
  PostgreSQL isolation level to prevent concurrent state corruption.
- **Claim cleared on advance** — after advancing, the ticket is unclaimed
  and available for the next agent in the SDLC flow.
- **Event sourcing** — every transition creates an immutable audit record
  with the previous stage, new stage, agent, and optional evidence.
- **Pure domain engine** — `stage_engine.py` contains zero I/O and zero
  external imports, making it trivially testable.


## Ticket Tools — `tickets.rework` MCP Tool

<!-- last_reviewed: 2026-03-11T03:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `tickets.rework` MCP tool returns a ticket to its implementation stage
with rejection evidence. It enforces a maximum rework count (default 3).
When the count is reached, the ticket is escalated instead of reworked.
Uses SERIALIZABLE transaction isolation for state integrity.

### How It Works

1. Agent sends a `tickets.rework` tool call with `ticket_id`, `agent_id`,
   and `reason`.
2. Input is validated against `TICKETS_REWORK_SCHEMA` (JSON Schema).
3. `TicketService.rework_ticket()` opens a SERIALIZABLE transaction and
   locks the ticket row with `SELECT ... FOR UPDATE`.
4. The service verifies the calling agent holds the active claim.
5. `rework_count` is incremented and checked against `max_reworks`.
6. If `rework_count < max_reworks`, the ticket moves back to its
   implementation stage (first stage after READY in the SDLC flow).
   The claim is released and status set to `READY`.
7. If `rework_count >= max_reworks`, the ticket stays at its current stage,
   status is set to `ESCALATED`, and human intervention is required.
8. A `STAGE_REJECTED` or `ESCALATED` event is recorded in the audit trail.

### Input Schema

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ticket_id` | `string` | Yes | Human-readable ticket ID (e.g. `"FORGEOS-BE006"`) |
| `agent_id` | `string` | Yes | Agent role name that holds the active claim |
| `reason` | `string` | Yes | Rejection reason explaining why rework is needed |
| `rejection_evidence` | `object` | No | Structured evidence (coverage %, failing tests, etc.) |

### Example Request

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.rework",
    "arguments": {
      "ticket_id": "FORGEOS-BE006",
      "agent_id": "QA",
      "reason": "Test coverage below 80% threshold",
      "rejection_evidence": {
        "coverage": "62%",
        "failing_tests": ["test_edge_case_timeout"]
      }
    }
  }
}
```

### Success Response (Rework)

```json
{
  "ticket_id": "FORGEOS-BE006",
  "title": "Implement Stage Engine",
  "type": "backend",
  "previous_stage": "QA",
  "new_stage": "BACKEND",
  "rework_count": 1,
  "escalated": false
}
```

### Success Response (Escalation)

When `rework_count` reaches `max_reworks` (default 3):

```json
{
  "ticket_id": "FORGEOS-BE006",
  "title": "Implement Stage Engine",
  "type": "backend",
  "previous_stage": "QA",
  "new_stage": "QA",
  "rework_count": 3,
  "escalated": true
}
```

### Error Responses

| Scenario | `isError` | `code` | `message` |
|---|---|---|---|
| Ticket not found | `true` | `-32602` | `Ticket '{id}' not found` |
| Agent does not hold claim | `true` | `-32602` | `Ticket is claimed by '{other}', not '{agent}'` |
| Ticket not claimed | `true` | `-32602` | `Ticket is not currently claimed` |
| No pool configured | `true` | `-32602` | `Pool not configured for rework operations` |

### ReworkResult Fields

| Field | Type | Description |
|---|---|---|
| `ticket_id` | `str` | Human-readable ticket ID |
| `title` | `str` | Ticket title |
| `ticket_type` | `str` | Ticket type (e.g. `"backend"`) |
| `previous_stage` | `str` | Stage before the rework |
| `new_stage` | `str` | Implementation stage the ticket returns to (or current stage if escalated) |
| `rework_count` | `int` | New rework count after increment |
| `escalated` | `bool` | `true` if the ticket was escalated instead of reworked |

### Design Constraints

- **SERIALIZABLE isolation** — the rework transaction uses the strictest
  PostgreSQL isolation level to prevent concurrent advance/rework conflicts.
- **Claim cleared on rework** — after reworking, the ticket is unclaimed
  and available for the implementation agent to reclaim.
- **Escalation threshold** — when `rework_count` reaches `max_reworks`
  (default 3), the ticket is escalated for human intervention rather than
  returned to the implementation stage.
- **Event sourcing** — every rework creates an immutable audit record with
  the rejection reason and optional structured evidence.


## Ticket Tools — `tickets.sync` and `tickets.validate` MCP Tools

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.tools.ticket_tools` module registers `tickets.sync` and
`tickets.validate` MCP tools. These tools delegate to the `SyncEngine` in
`mcp_server.services.sync_engine` for dependency resolution and integrity
checking. Both tools accept no parameters.

### `tickets.sync` — Dependency Resolution

Releases expired leases, evaluates the dependency graph for all BLOCKED
tickets, and moves newly unblocked tickets to READY.

**Steps performed:**

1. Calls `scan_and_release_expired()` from the lease cleanup module to
   release all expired leases.
2. Queries all BLOCKED tickets that have non-empty `depends_on` arrays.
3. For each blocked ticket, checks whether all dependencies are in DONE.
4. If all dependencies are met, atomically updates the ticket to READY
   and records a `dependency_resolved` event.

**MCP request:**

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.sync",
    "arguments": {}
  }
}
```

**Success response:**

```json
{
  "released_count": 2,
  "released_tickets": ["FORGEOS-BE010", "FORGEOS-BE015"],
  "unblocked_count": 1,
  "unblocked_tickets": ["FORGEOS-BE033"],
  "errors": []
}
```

| Field | Type | Description |
|---|---|---|
| `released_count` | `int` | Number of expired leases released |
| `released_tickets` | `list[str]` | Ticket IDs whose leases were released |
| `unblocked_count` | `int` | Number of tickets moved from BLOCKED to READY |
| `unblocked_tickets` | `list[str]` | Ticket IDs that were unblocked |
| `errors` | `list[str]` | Errors encountered during sync (partial success possible) |

### `tickets.validate` — Integrity Check

Checks every ticket for stage integrity and SDLC flow validity. Returns a
list of integrity errors (empty list means clean).

**Checks performed:**

1. Each ticket's `stage` is a valid member of the SDLC stage enum.
2. Each ticket's `stage` belongs to its own `sdlc_flow` array.
3. Each ticket's `sdlc_flow` matches the expected flow for its `type`
   (backend, frontend, fullstack, infra, security, docs, research,
   architecture).

**MCP request:**

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.validate",
    "arguments": {}
  }
}
```

**Clean response:**

```json
{
  "is_clean": true,
  "error_count": 0,
  "errors": []
}
```

**Response with errors:**

```json
{
  "is_clean": false,
  "error_count": 1,
  "errors": [
    {
      "ticket_id": "FORGEOS-BE099",
      "error_type": "stage_not_in_flow",
      "message": "Stage 'CI' is not in ticket's sdlc_flow ['READY', 'DOCS', 'VALIDATOR', 'DONE']"
    }
  ]
}
```

| Error Type | Description |
|---|---|
| `invalid_stage` | Stage value is not a recognised SDLC stage |
| `stage_not_in_flow` | Stage is valid but not listed in the ticket's own `sdlc_flow` |
| `unknown_ticket_type` | Ticket type has no defined SDLC flow |
| `flow_mismatch` | Ticket's `sdlc_flow` does not match the expected flow for its type |

### Sync Engine — `mcp_server.services.sync_engine`

The `SyncEngine` class orchestrates both operations. It accepts an asyncpg
connection pool and performs all database work within transactions.

| Symbol | Kind | Description |
|---|---|---|
| `SyncEngine` | class | Orchestrates sync and validate operations |
| `SyncResult` | frozen dataclass | Summary of a sync operation (released, unblocked, errors) |
| `IntegrityError` | frozen dataclass | A single integrity violation (ticket_id, error_type, message) |
| `ValidateResult` | frozen dataclass | List of integrity errors with `is_clean` property |
| `VALID_STAGES` | list | All valid SDLC stage names |
| `SDLC_FLOWS` | dict | Expected SDLC flow for each ticket type |

#### SyncEngine Methods

| Method | Returns | Description |
|---|---|---|
| `sync()` | `SyncResult` | Release expired leases and unblock tickets |
| `validate()` | `ValidateResult` | Full integrity check across all tickets |

### Error Handling

| Scenario | Behavior |
|---|---|
| Lease release fails | Error recorded in `SyncResult.errors`; dependency resolution still runs |
| Dependency resolution fails | Error recorded in `SyncResult.errors` |
| Validate tool exception | Returns MCP error response with code `-32602` |
| Sync tool exception | Returns MCP error response with code `-32602` |

### Design Constraints

- **Partial success** — `tickets.sync` records errors but continues processing
  remaining steps. The caller inspects the `errors` array for failures.
- **No input parameters** — both tools operate on the full ticket set without
  filtering. This matches the `tickets.py --sync` and `--validate` CLI behavior.
- **Transaction isolation** — dependency resolution wraps each ticket update in
  its own transaction to avoid blocking other agents.
- **Deferred import** — `sync()` imports `scan_and_release_expired` lazily to
  avoid circular imports at module level.
- **Frozen dataclasses** — all result types use `frozen=True, slots=True` for
  immutability and memory efficiency.


## Notification Event Queue

<!-- last_reviewed: 2026-03-11T00:33:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.notifications` package provides a PostgreSQL-backed async
notification delivery system with at-least-once semantics, configurable
exponential-backoff retries, and dead-letter handling.

### Status Lifecycle

```
pending ──► processing ──► delivered
                │
                ▼
             failed ──► pending       (retry scheduled)
                │
                ▼
             dead_letter              (after max retries)
                │
                ▼
             pending                  (admin replay)
```

### Quick Start

```python
from mcp_server.notifications import (
    NotificationQueue,
    NotificationProcessor,
    ProcessorConfig,
)

queue = NotificationQueue(pool)

# Enqueue a notification
note_id = await queue.enqueue("ticket.claimed", payload={"ticket_id": "BE067"})

# Dequeue next pending (atomic via FOR UPDATE SKIP LOCKED)
note = await queue.dequeue()

# Mark outcome
await queue.mark_delivered(note.id)
# — or on failure —
await queue.mark_failed(note.id, "Connection refused")
```

### NotificationQueue Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `enqueue(event_type, payload, *, max_retries)` | `str` | Insert a notification (status: `pending`) |
| `dequeue()` | `Notification \| None` | Atomically claim next eligible notification |
| `mark_delivered(notification_id)` | `Notification` | Transition `processing → delivered` |
| `State Change Emitter

<!-- last_reviewed: 2026-03-11T04:45:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.notifications.emitter` module provides a fire-and-forget
emitter that converts ticket lifecycle transitions into notification queue
entries. Inject `StateChangeEmitter` into `TicketService` to emit events
automatically on claim, advance, release, and rework operations.

### Event Types

| Enum Value | String | Trigger |
|------------|--------|---------|
| `EventType.TICKET_CLAIMED` | `ticket.claimed` | Agent claims a ticket |
| `EventType.TICKET_ADVANCED` | `ticket.advanced` | Ticket moves to its next SDLC stage |
| `EventType.TICKET_RELEASED` | `ticket.released` | Claim is released (ticket returns to READY) |
| `EventType.TICKET_REWORKED` | `ticket.reworked` | Ticket is rejected and sent back for rework |

### Quick Start

```python
from mcp_server.notifications import NotificationQueue, StateChangeEmitter

queue = NotificationQueue(pool)
emitter = StateChangeEmitter(queue=queue)

# Emit a claim event
await emitter.emit_claimed(
    ticket_id="FORGEOS-BE065",
    stage="BACKEND",
    agent_id="backend",
    machine_id="pop-os",
    operator="ReaperOAK",
)

# Emit an advance event
await emitter.emit_advanced(
    ticket_id="FORGEOS-BE065",
    old_stage="BACKEND",
    new_stage="QA",
    agent_id="backend",
    evidence={"tests_passed": 42, "coverage": 100},
)
```

### Integration with TicketService

Pass a `StateChangeEmitter` instance to the `TicketService` constructor.
The service calls the emitter after each successful state transition.
If the emitter is `None`, notifications are silently skipped.

```python
from mcp_server.services.ticket_service import TicketService

service = TicketService(
    claim_queue=queue,
    pool=pool,
    emitter=emitter,  # optional — pass None to disable
)
```

The emitter is called at these points in `TicketService`:

| Method | Emitter Call |
|--------|--------------|
| `claim_next()` | `emit_claimed()` |
| `claim_by_id()` | `emit_claimed()` |
| `release_ticket()` | `emit_released()` |
| `advance_ticket()` | `emit_advanced()` |
| `rework_ticket()` | `emit_reworked()` |

### StateChangeEmitter Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `emit_claimed(ticket_id, stage, agent_id, machine_id, operator)` | All keyword-only | Enqueue a `ticket.claimed` event |
| `emit_advanced(ticket_id, old_stage, new_stage, agent_id, evidence)` | `evidence` optional | Enqueue a `ticket.advanced` event |
| `emit_released(ticket_id, stage, agent_id, reason)` | `reason` optional | Enqueue a `ticket.released` event |
| `emit_reworked(ticket_id, old_stage, new_stage, agent_id, reason)` | All required | Enqueue a `ticket.reworked` event |

### Payload Structure

All events produce a JSON payload with these common fields:

| Field | Type | Description |
|-------|------|-------------|
| `ticket_id` | `str` | The affected ticket identifier |
| `old_stage` | `str` | Stage before the transition |
| `new_stage` | `str` | Stage after the transition |
| `agent_id` | `str` | Agent that triggered the event |
| `timestamp` | `str` | ISO 8601 UTC timestamp |

Additional fields vary by event type:

| Event | Extra Fields |
|-------|--------------|
| `ticket.claimed` | `machine_id`, `operator` |
| `ticket.advanced` | `evidence` (optional dict) |
| `ticket.released` | `reason` |
| `ticket.reworked` | `reason` |

### Error Handling

All `emit_*` methods are fire-and-forget. Exceptions from
`NotificationQueue.enqueue()` are caught, logged via structured logging,
and swallowed. A notification failure never blocks a ticket state transition.

### Design Constraints

- **Fire-and-forget** — emitter exceptions never propagate to callers.
- **Optional injection** — `TicketService` works without an emitter (pass `None`).
- **TYPE_CHECKING guard** — `StateChangeEmitter` is imported behind
  `TYPE_CHECKING` in `ticket_service.py` to avoid circular imports.
- **No retry logic** — the emitter delegates retries to the notification
  queue and processor layers.
- **Keyword-only constructors** — `StateChangeEmitter(queue=...)` prevents
  positional argument errors.


## mark_failed(notification_id, error_message)` | `Notification` | Retry or dead-letter based on retry count |
| `get_by_id(notification_id)` | `Notification \| None` | Retrieve a single notification by UUID |
| `get_dead_letters(*, limit)` | `list[Notification]` | List dead-lettered notifications |
| `replay_dead_letter(notification_id)` | `Notification` | Reset a dead-letter to `pending` for redelivery |
| `count_by_status()` | `dict[str, int]` | Aggregate counts grouped by status |

### Data Classes

| Class | Description |
|-------|-------------|
| `Notification` | Frozen dataclass (10 fields): queue item with status, retry count, and error tracking |
| `NotificationStatus` | Enum: `pending`, `processing`, `delivered`, `failed`, `dead_letter` |
| `InvalidTransitionError` | Raised on illegal status transitions |

### Notification Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `str` | UUID primary key |
| `event_type` | `str` | Event identifier (e.g. `ticket.claimed`) |
| `payload` | `dict` | Notification content (JSONB) |
| `status` | `NotificationStatus` | Current lifecycle state |
| `retry_count` | `int` | Current retry attempt (0-based) |
| `max_retries` | `int` | Maximum delivery attempts (default: 5) |
| `next_retry_at` | `datetime \| None` | Scheduled retry time (UTC) |
| `error_message` | `str \| None` | Last error message |
| `created_at` | `datetime` | Creation timestamp (UTC) |
| `updated_at` | `datetime` | Last modification timestamp (UTC) |

### Retry and Dead-Letter Handling

Failed notifications retry with a configurable backoff schedule. When
`retry_count` reaches `max_retries`, the notification moves to `dead_letter`.

**Default backoff schedule:**

| Retry | Delay |
|-------|-------|
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4+ | 1 hour |

The schedule is configurable via `ProcessorConfig.backoff_schedule` (list of
seconds). If `retry_count` exceeds the schedule length, the last entry is used.

A fallback exponential formula (`base × 2^retry_count`, capped at 3600 s) is
available via `compute_backoff_seconds()` when no schedule is provided.

**Dead-letter replay:** Administrators can reset dead-lettered notifications
to `pending` via `queue.replay_dead_letter(notification_id)`, which clears
`retry_count`, `error_message`, and `next_retry_at`.

### Background Notification Processor

The `NotificationProcessor` runs as an asyncio background task, polling the
queue and delivering notifications through configured channels.

#### Quick Start

```python
from mcp_server.notifications import (
    NotificationProcessor,
    ProcessorConfig,
)
from mcp_server.notifications.channels import ChannelDispatcher

config = ProcessorConfig(
    poll_interval_seconds=5.0,
    batch_size=10,
    backoff_schedule=[60, 300, 900, 3600],
    max_retries=5,
)

processor = NotificationProcessor(queue, dispatcher, config=config)
await processor.start()

# ... processor runs in the background ...

await processor.stop()
```

#### ProcessorConfig Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `poll_interval_seconds` | `5.0` | Seconds between poll cycles when queue is empty |
| `batch_size` | `10` | Maximum notifications dequeued per poll cycle |
| `backoff_schedule` | `[60, 300, 900, 3600]` | Ordered retry delays in seconds |
| `max_retries` | `5` | Max delivery attempts before dead-lettering |

#### NotificationProcessor Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `None` | Launch the background polling task |
| `stop()` | `None` | Cancel the polling task and wait for cleanup |
| `process_one(notification)` | `bool` | Deliver one notification; `True` on success |

#### NotificationProcessor Properties

| Property | Type | Description |
|----------|------|-------------|
| `is_running` | `bool` | Whether the background loop is active |
| `config` | `ProcessorConfig` | Active processor configuration |
| `processed_count` | `int` | Total notifications processed since last start |

#### Processing Flow

1. Processor dequeues up to `batch_size` notifications per cycle.
2. Each notification is dispatched to all matching channels via `ChannelDispatcher`.
3. If all channels succeed (or none match), the notification is marked `delivered`.
4. If any channel fails, `mark_failed()` increments `retry_count` and schedules
   the next retry using the backoff schedule.
5. When `retry_count` reaches `max_retries`, the notification moves to `dead_letter`.
6. If the queue is empty, the processor sleeps for `poll_interval_seconds`.

### Design Constraints

- **Exactly-once dequeue** — `FOR UPDATE SKIP LOCKED` prevents double-processing.
- **Frozen notifications** — `Notification` dataclass is frozen; mutation raises `FrozenInstanceError`.
- **Strict transitions** — only transitions in `_VALID_TRANSITIONS` are allowed.
- **Configurable backoff** — schedule-based lookup with fallback exponential formula.
- **Dead-letter safety** — notifications exceeding `max_retries` move to `dead_letter` and are never auto-retried.
- **Replay support** — dead-lettered notifications can be manually replayed by administrators.
- **Graceful shutdown** — `stop()` cancels the asyncio task and suppresses `CancelledError`.


## Audit Logging

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server/services/audit_service.py`, `mcp_server/repositories/audit_repo.py`,
and `mcp_server/middleware/audit_middleware.py` modules provide comprehensive
audit logging for all authenticated operations. Every MCP tool call and REST API
request is recorded with identity, operation, target, result, and source machine.

### How It Works

1. `AuditMiddleware` (Starlette middleware) intercepts every HTTP request after
   authentication. Health/readiness endpoints are skipped.
2. The middleware extracts the `AuthContext` from `contextvars`, records the
   HTTP method, path, status code, and duration, then delegates to
   `AuditRepository.append()`.
3. `AuditService` provides a higher-level API for tool handlers that need to
   log operations explicitly (e.g. MCP tool calls).
4. `AuditRepository` is append-only — no UPDATE or DELETE methods exist.

### Quick Start

```python
from mcp_server.services.audit_service import AuditService
from mcp_server.repositories.audit_repo import AuditRepository

# Create service with a connection pool
repo = AuditRepository(pool)
service = AuditService(audit_repo=repo)

# Log an operation
entry = await service.log_operation(
    auth_ctx=auth_ctx,
    operation="mcp.claim_next",
    target="FORGEOS-BE058",
    result="success",
    source_machine="pop-os",
)

# Query audit logs with filters
logs = await service.query_logs(
    identity_id="backend-agent",
    operation="mcp.claim_next",
    since=datetime(2026, 3, 1),
    limit=50,
)

# Count matching entries
total = await service.count_logs(identity_type="agent")
```

### Audit Log Schema

The `audit_log` table is created by Alembic migration 006:

| Column | Type | Description |
|---|---|---|
| `audit_id` | `UUID` | Primary key (auto-generated) |
| `identity_type` | `TEXT` | `agent`, `operator`, or `admin` |
| `identity_id` | `TEXT` | Identifier of the authenticated entity |
| `operation` | `TEXT` | Action performed (e.g. `GET /api/tickets`) |
| `target` | `TEXT` | Target resource (e.g. ticket ID, endpoint path) |
| `result` | `TEXT` | Outcome: `success`, `failure`, or `error` |
| `timestamp` | `TIMESTAMPTZ` | When the operation occurred (default `NOW()`) |
| `metadata` | `JSONB` | Additional context (HTTP status, duration, etc.) |
| `source_machine` | `TEXT` | Machine/IP originating the request |

Indexes: `identity_id`, `identity_type`, `operation`, `timestamp`.

### Public API — `mcp_server.services.audit_service`

| Symbol | Kind | Description |
|---|---|---|
| `AuditService` | class | High-level orchestration for audit logging |

#### AuditService Methods

| Method | Returns | Description |
|---|---|---|
| `log_operation(auth_ctx, operation, target, result, metadata, source_machine)` | `AuditLogRow` | Record an authenticated operation |
| `query_logs(identity_id, identity_type, operation, since, until, limit, offset)` | `list[AuditLogRow]` | Query with optional filters, ordered by timestamp DESC |
| `count_logs(identity_id, identity_type, operation, since, until)` | `int` | Count matching entries |

### Public API — `mcp_server.repositories.audit_repo`

| Symbol | Kind | Description |
|---|---|---|
| `AuditRepository` | class | Append-only data access for audit records |
| `AuditLogRow` | dataclass | Frozen, slotted representation of an audit entry |

#### AuditRepository Methods

| Method | Returns | Description |
|---|---|---|
| `append(identity_type, identity_id, operation, target, result, metadata, source_machine)` | `AuditLogRow` | Insert a new audit log entry |
| `query(identity_id, identity_type, operation, since, until, limit, offset)` | `list[AuditLogRow]` | Query with filters; limit capped at 1000 |
| `count(identity_id, identity_type, operation, since, until)` | `int` | Count matching entries |

### Middleware — `mcp_server.middleware.audit_middleware`

| Symbol | Kind | Description |
|---|---|---|
| `AuditMiddleware` | class | Starlette middleware that logs all authenticated requests |

`AuditMiddleware` skips health/readiness endpoints (`/health`, `/healthz`,
`/ready`, `/readiness`, `/livez`, `/readyz`). Source machine is resolved from
`X-Machine-Id` header, then `X-Forwarded-For`, then `request.client.host`.

### Design Constraints

- **Append-only** — `AuditRepository` exposes no UPDATE or DELETE methods. Records are immutable once written.
- **Parameterized SQL** — all queries use `$1`, `$2` placeholders; no string interpolation.
- **Non-blocking middleware** — audit write failures are caught and logged; they never block the response.
- **Frozen dataclass** — `AuditLogRow` is frozen with `__slots__` for immutability and memory efficiency.
- **Limit cap** — `query()` caps the `limit` parameter at 1000 to prevent runaway result sets.


## Notification Channels

<!-- last_reviewed: 2026-03-11T15:30:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.notifications.channels` module provides configurable delivery
channels for the notification system. Channels determine where notifications
are sent (webhook endpoints, Slack) and can filter by event type.

### Channel Types

| Type | Description |
|------|-------------|
| `webhook` | Generic HTTP POST with JSON payload to a configured URL |
| `slack` | Slack incoming webhook with Block Kit formatted messages |

### Quick Start

```python
from mcp_server.notifications import ChannelStore, ChannelDispatcher, ChannelType

store = ChannelStore(pool)

# Create a webhook channel
channel = await store.create_channel(
    name="ops-alerts",
    channel_type=ChannelType.WEBHOOK,
    config={"url": "https://hooks.example.com/forgeos"},
    event_filter=["stage_changed", "ticket_reworked"],
)

# Create a Slack channel (all events)
slack = await store.create_channel(
    name="dev-slack",
    channel_type=ChannelType.SLACK,
    config={"url": "https://hooks.slack.com/services/T.../B.../xxx"},
)

# Dispatch a notification to all matching channels
dispatcher = ChannelDispatcher(store)
results = await dispatcher.dispatch(
    event_type="stage_changed",
    payload={"ticket_id": "FORGEOS-BE066", "details": "BACKEND → QA"},
)

for r in results:
    print(f"{r.channel_id}: {'OK' if r.success else r.error_message}")
```

### Environment-Based Channel Configuration

Channels can be bootstrapped from environment variables without database
access. Set `FORGEOS_CHANNEL_*` variables with JSON values:

```bash
export FORGEOS_CHANNEL_OPS_WEBHOOK='{
  "type": "webhook",
  "url": "https://hooks.example.com/forgeos",
  "event_filter": ["stage_changed", "ticket_reworked"],
  "enabled": true,
  "headers": {"X-Source": "forgeos"}
}'

export FORGEOS_CHANNEL_DEV_SLACK='{
  "type": "slack",
  "url": "https://hooks.slack.com/services/T.../B.../xxx"
}'
```

Load at startup:

```python
from mcp_server.notifications import load_channels_from_env, build_channel_config

env_channels = load_channels_from_env()
for env_cfg in env_channels:
    config = build_channel_config(env_cfg)
    await store.create_channel(
        name=env_cfg.name,
        channel_type=env_cfg.channel_type,
        config=config,
        event_filter=env_cfg.event_filter,
        enabled=env_cfg.enabled,
    )
```

### ChannelStore Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `create_channel(name, channel_type, config, ...)` | `NotificationChannel` | Insert a new channel |
| `get_channel(channel_id)` | `NotificationChannel \| None` | Retrieve a channel by UUID |
| `list_channels(enabled_only=False)` | `list[NotificationChannel]` | List all channels |
| `update_channel(channel_id, ...)` | `NotificationChannel \| None` | Update channel fields |
| `delete_channel(channel_id)` | `bool` | Delete a channel by UUID |

### ChannelDispatcher

Sends notifications to all enabled channels whose event filter matches.
Delivery failures are isolated per-channel and never block queue processing.

| Method | Returns | Description |
|--------|---------|-------------|
| `dispatch(event_type, payload)` | `list[DeliveryResult]` | Send to all matching channels |

### Data Classes

| Class | Description |
|-------|-------------|
| `NotificationChannel` | Frozen dataclass: `channel_id`, `name`, `type`, `config`, `event_filter`, `enabled`, `created_at`, `updated_at` |
| `DeliveryResult` | Result of a delivery attempt: `success`, `channel_id`, `error_message` |
| `ChannelType` | Enum: `webhook`, `slack` |
| `ChannelEnvConfig` | Parsed env var config: `name`, `channel_type`, `url`, `event_filter`, `enabled`, `extra` |

### Event Filtering

Channels can filter which event types they receive. An empty `event_filter`
matches all events. Otherwise, only events whose `event_type` is in the
filter list are delivered.

```python
# Only receives stage_changed and ticket_reworked
channel = await store.create_channel(
    name="filtered",
    channel_type=ChannelType.WEBHOOK,
    config={"url": "https://example.com/hook"},
    event_filter=["stage_changed", "ticket_reworked"],
)

# Receives all event types
channel = await store.create_channel(
    name="all-events",
    channel_type=ChannelType.WEBHOOK,
    config={"url": "https://example.com/all"},
    event_filter=[],
)
```

### Webhook Delivery

Sends a JSON POST request to the configured URL:

```json
{
  "event_type": "stage_changed",
  "payload": {"ticket_id": "FORGEOS-BE066", "details": "..."},
  "channel_id": "550e8400-...",
  "timestamp": "2026-03-11T15:00:00Z"
}
```

Config keys: `url` (required), `timeout` (optional, default 10s),
`headers` (optional, extra headers merged into the request).

### Slack Delivery

Formats the notification as a Slack Block Kit message with header, detail
section, and context footer. Sends to the configured Slack incoming webhook URL.

Config keys: `url` (required), `timeout` (optional, default 10s).

### Database Schema

Alembic migration 006 (`20260311_000000_006_notification_channels.py`) creates:

| Column | Type | Constraint |
|--------|------|------------|
| `channel_id` | `UUID` | PK, default `gen_random_uuid()` |
| `name` | `VARCHAR(128)` | NOT NULL |
| `type` | `channel_type` | NOT NULL (enum: `webhook`, `slack`) |
| `config` | `JSONB` | NOT NULL, default `'{}'` |
| `event_filter` | `TEXT[]` | Nullable |
| `enabled` | `BOOLEAN` | NOT NULL, default `TRUE` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, auto-updated via trigger |

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Missing URL in channel config | Returns `DeliveryResult(success=False)` with error message |
| HTTP non-2xx response | Returns failure result; logged as warning |
| Network/timeout error | Returns failure result; logged with exception details |
| Unsupported channel type | Raises `ValueError` |
| Empty channel name | Raises `ValueError` |
| Dispatch failure on one channel | Other channels still receive the notification |

### Design Constraints

- **Isolated delivery** — each channel delivers independently. One failure
  never blocks other channels or the notification queue.
- **Protocol-based delivery** — `ChannelDelivery` protocol allows adding new
  channel types without modifying existing code.
- **Thread-safe HTTP** — outbound HTTP uses `asyncio.to_thread()` with
  `urllib.request` to avoid blocking the event loop.
- **Immutable channels** — `NotificationChannel` is a frozen dataclass.
- **Structured logging** — all operations include `channel_id` and `event_type`.


## Dual-Mode Wrapper — Migration Bridge

<!-- last_reviewed: 2026-03-11T03:00:00Z -->
<!-- audience: developers -->
<!-- diataxis: reference -->

The `mcp_server.migration` package provides a dual-mode wrapper that routes
ticket lifecycle operations (claim, advance, release, rework, sync, validate,
status) to either the MCP server or the file-based `tickets.py` CLI. This
enables a gradual migration from file-based state management to the PostgreSQL-
backed MCP server without a hard cutover.

### How It Works

1. `DualModeConfig` reads the `FORGEOS_MODE` environment variable to select the
   active backend (`"file"` or `"mcp"`).
2. In **file mode**, `FileMode` delegates each operation to `tickets.py` via
   `asyncio.subprocess`.
3. In **mcp mode**, `McpMode` sends JSON-RPC `tools/call` requests to the MCP
   server endpoint over HTTP.
4. `DualModeWrapper` checks MCP server health before each operation. If the
   server is unreachable and `fallback_enabled` is `True`, the operation falls
   back to file mode automatically.
5. Every operation logs which mode was used for observability.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `FORGEOS_MODE` | `file` | Operation mode: `mcp` routes to the MCP server, `file` uses `tickets.py` |
| `FORGEOS_MCP_SERVER_URL` | `http://localhost:8080` | Base URL of the MCP server |
| `FORGEOS_TICKETS_PY_PATH` | `.github/tickets.py` | Path to the `tickets.py` CLI script |
| `FORGEOS_FALLBACK_ENABLED` | `true` | Fall back to file mode when MCP server is unreachable |
| `FORGEOS_OPERATION_TIMEOUT` | `30` | Timeout in seconds for a single operation |

Configuration is loaded from environment variables via `DualModeConfig(BaseSettings)`
with the `FORGEOS_` prefix (pydantic-settings).

### Quick Start

```python
from mcp_server.migration import DualModeWrapper, DualModeConfig, OperationMode

# Default: file mode, reads FORGEOS_* env vars
wrapper = DualModeWrapper.from_config()
result = await wrapper.sync()
print(result.mode_used)  # "file" or "mcp"
print(result.success)    # True/False

# Explicit MCP mode with fallback
config = DualModeConfig(mode=OperationMode.MCP, fallback_enabled=True)
wrapper = DualModeWrapper.from_config(config)
result = await wrapper.status(ticket_id="FORGEOS-BE068")

# Switch mode at runtime
wrapper.set_mode(OperationMode.FILE)
```

### Supported Operations

| Method | Parameters | Description |
|---|---|---|
| `claim(ticket_id, agent, machine_id, operator)` | 4 required | Claim a ticket for an agent |
| `advance(ticket_id, agent)` | 2 required | Move a ticket to its next SDLC stage |
| `release(ticket_id, reason)` | 2 required | Release a claimed ticket |
| `rework(ticket_id, agent, reason)` | 3 required | Send a ticket back for rework |
| `sync()` | none | Release expired leases; unblock ready tickets |
| `validate()` | none | Run full integrity check |
| `status(ticket_id=None)` | 1 optional | Get ticket status (single or all) |

All methods are async and return `OperationResult`.

### OperationResult

Frozen dataclass returned by every operation:

| Field | Type | Description |
|---|---|---|
| `success` | `bool` | Whether the operation completed without error |
| `message` | `str` | Human-readable outcome summary |
| `mode_used` | `str` | Which backend ran the operation (`"mcp"` or `"file"`) |
| `data` | `dict \| None` | Optional structured payload (e.g. ticket data) |

`to_dict()` serializes the result to a plain dictionary.

### API Reference

| Symbol | Kind | Description |
|---|---|---|
| `DualModeWrapper` | class | Unified router with health-based fallback |
| `DualModeWrapper.from_config()` | classmethod | Factory that builds a fully-wired wrapper |
| `DualModeWrapper.set_mode(mode)` | method | Switch operational mode at runtime |
| `DualModeWrapper.current_mode` | property | Currently active `OperationMode` |
| `FileMode` | class | Subprocess-based `tickets.py` backend |
| `McpMode` | class | HTTP JSON-RPC backend for MCP server |
| `McpMode.is_healthy()` | method | Probe MCP server availability |
| `OperationResult` | frozen dataclass | Immutable result of any ticket operation |
| `TicketOperations` | Protocol | Async interface shared by both backends |
| `DualModeConfig` | BaseSettings | Pydantic-settings configuration model |
| `OperationMode` | enum | `MCP` or `FILE` |

### Fallback Behavior

| Scenario | Behavior |
|---|---|
| Mode is `file` | All operations use `FileMode` directly |
| Mode is `mcp`, server healthy | Operations use `McpMode` |
| Mode is `mcp`, server unhealthy, fallback enabled | Operations fall back to `FileMode` |
| Mode is `mcp`, server unhealthy, fallback disabled | Returns failure result |
| MCP operation fails mid-request, fallback enabled | Retries via `FileMode` |
| Subprocess timeout | Returns failure result with timeout message |

### Design Constraints

- **Protocol-based interface** — `TicketOperations` runtime-checkable Protocol
  ensures both backends expose identical async methods.
- **No `httpx` dependency** — `McpMode` uses stdlib `urllib.request` to avoid
  adding external HTTP dependencies.
- **Thread-safe HTTP** — blocking HTTP calls run in `asyncio.run_in_executor()`
  to stay async-safe.
- **Dependency direction** — the migration package depends only on
  `migration.config` and `mcp_server.observability` (inner to outer).
- **Structured logging** — every operation logs mode, operation name, and
  success status.


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
