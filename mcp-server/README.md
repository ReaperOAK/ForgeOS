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

<!-- last_reviewed: 2026-03-11T14:30:00Z -->
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
   `TicketRepository`, `ClaimRepository`, and `EventRepository`.
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
| `Dependencies` | frozen dataclass | Immutable container holding pool + 3 repositories |
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
| `create(ticket_id, title, ...)` | `TicketRow` | Insert a new ticket |
| `update_stage(ticket_id, new_stage, new_status)` | `TicketRow \| None` | Update stage and status |
| `count_by_stage()` | `dict[str, int]` | Aggregate ticket counts per stage |

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

<!-- last_reviewed: 2026-03-11T00:00:00Z -->
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

<!-- last_reviewed: 2025-07-14T00:00:00Z -->
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
- **`mcp_server/auth/`** — Agent API key authentication, rate limiting, and identity resolution
- **`mcp_server/tools/`** — Dynamic tool registration, schema validation, and FastMCP bridge
- **`mcp_server/events/`** — Append-only event sourcing (EventStore, EventType, Event dataclass)
- **`mcp_server/locking/`** — Distributed claim queue (SKIP LOCKED), file mutex (advisory locks)
- **`mcp_server/sessions/`** -- Agent session lifecycle management (heartbeat, timeout, resumption)

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


## Notification Event Queue

The `mcp_server.notifications` package provides a PostgreSQL-backed async
notification delivery system with at-least-once semantics.

### Status Lifecycle

```
pending ──► processing ──► delivered
                │
                ▼
             failed ──► dead_letter  (after max retries)
```

### Quick Start

```python
from mcp_server.notifications import NotificationQueue, NotificationStatus

async with pool.acquire() as conn:
    queue = NotificationQueue(pool)

    # Enqueue a notification
    note_id = await queue.enqueue(
        conn, channel="email", recipient="ops@example.com",
        payload={"subject": "Alert", "body": "Disk full"},
    )

    # Dequeue next pending (atomic via FOR UPDATE SKIP LOCKED)
    note = await queue.dequeue(conn, channel="email")

    # Mark outcome
    await queue.mark_delivered(conn, note.id)
```

### NotificationQueue Methods

| Method | Description |
|--------|-------------|
| `enqueue(conn, channel, recipient, payload)` | Insert a new notification (status: `pending`) |
| `dequeue(conn, channel)` | Atomically claim next pending notification |
| `mark_delivered(conn, notification_id)` | Transition `processing → delivered` |
| `mark_failed(conn, notification_id, error)` | Transition `processing → failed` or `→ dead_letter` |
| `get_by_id(conn, notification_id)` | Retrieve a single notification by UUID |
| `get_dead_letters(conn, channel, limit)` | List dead-lettered notifications |
| `count_by_status(conn, channel)` | Aggregate counts grouped by status |

### Data Classes

| Class | Description |
|-------|-------------|
| `Notification` | Frozen dataclass with 10 fields (id, channel, recipient, payload, status, etc.) |
| `NotificationStatus` | Enum: `pending`, `processing`, `delivered`, `failed`, `dead_letter` |
| `InvalidTransitionError` | Raised on illegal status transitions |

### Notification Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UUID` | Primary key |
| `channel` | `str` | Delivery channel (email, webhook, etc.) |
| `recipient` | `str` | Target address |
| `payload` | `dict` | Notification content |
| `status` | `NotificationStatus` | Current lifecycle state |
| `attempt` | `int` | Current retry attempt (0-based) |
| `max_attempts` | `int` | Maximum retry attempts (default: 5) |
| `error` | `str \| None` | Last error message |
| `created_at` | `datetime` | Creation timestamp (UTC) |
| `updated_at` | `datetime` | Last modification timestamp (UTC) |

### Retry and Backoff

| Attempt | Delay (seconds) |
|---------|-----------------|
| 1 | 60 |
| 2 | 120 |
| 3 | 240 |
| 4 | 480 |
| 5 | 960 |

Backoff formula: `min(base × factor^attempt, cap)` where base = 60, factor = 2,
cap = 3600.

### Database Schema

Alembic migration `004` (`20260310_000000_004_notification_queue.py`) creates:

| Column | Type | Constraint |
|--------|------|------------|
| `id` | `UUID` | PK, default `gen_random_uuid()` |
| `channel` | `VARCHAR(64)` | NOT NULL |
| `recipient` | `VARCHAR(256)` | NOT NULL |
| `payload` | `JSONB` | NOT NULL, default `'{}'` |
| `status` | `notification_status` | NOT NULL, default `'pending'` |
| `attempt` | `INTEGER` | NOT NULL, default `0` |
| `max_attempts` | `INTEGER` | NOT NULL, default `5` |
| `error` | `TEXT` | Nullable |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, default `now()` |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, auto-updated via trigger |

Includes a partial index on `(channel, created_at)` filtered to `status = 'pending'`
for efficient dequeue queries.

### Design Constraints

- **Exactly-once dequeue** — `FOR UPDATE SKIP LOCKED` prevents double-processing.
- **Frozen notifications** — `Notification` dataclass is frozen; mutation raises `FrozenInstanceError`.
- **Strict transitions** — only transitions in `_VALID_TRANSITIONS` are allowed.
- **Exponential backoff** — `compute_backoff_seconds()` is a pure function with capped output.
- **Dead-letter safety** — notifications exceeding `max_attempts` move to `dead_letter`, never retried.


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
