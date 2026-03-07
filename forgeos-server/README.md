<!-- last_reviewed: 2026-03-07T23:00:00Z -->
<!-- audience: developer -->
<!-- diataxis: reference -->

# ForgeOS MCP Server

Distributed MCP orchestration server for AI-driven ticket management.
Exposes ticket lifecycle operations over the
[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) via
Streamable HTTP transport, backed by PostgreSQL.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 22.0  |
| PostgreSQL  | ≥ 15    |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and configure
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL

# 3. Run database migrations
npm run migrate

# 4. Start in development mode (hot-reload)
npm run dev
```

The server starts on `http://localhost:3000` by default.

## npm Scripts

| Script          | Command              | Description                            |
|-----------------|----------------------|----------------------------------------|
| `build`         | `tsc`                | Compile TypeScript to `dist/`          |
| `start`         | `node dist/index.js` | Run compiled production build          |
| `dev`           | `tsx watch src/index.ts` | Development mode with hot-reload   |
| `migrate`       | `tsx src/db/migrate.ts`  | Run pending database migrations    |
| `typecheck`     | `tsc --noEmit`       | Type-check without emitting files      |
| `lint`          | `eslint src/`        | Run ESLint on source files             |
| `test`          | `vitest run`         | Run test suite once                    |
| `test:watch`    | `vitest`             | Run tests in watch mode                |
| `prepare`       | `husky`              | Install Git hooks (runs on `npm install`) |

## Database

### Connection Pool

The server uses a lazily-initialized `pg.Pool` singleton
(`src/db/pool.ts`). The pool is created on the first call to `getPool()`
and reused for the lifetime of the process.

| Setting | Default | Description |
|---------|---------|-------------|
| Max connections | 20 | Maximum concurrent clients |
| Idle timeout | 30 s | Time before idle clients are removed |
| Connection timeout | 10 s | Maximum wait for a new connection |

The pool emits structured pino log events for connection errors,
pool exhaustion (clients waiting), and client lifecycle changes.

#### Health Check

`healthCheck()` executes `SELECT 1`, measures round-trip latency, and
returns pool statistics (total, idle, waiting counts). Used by the
`GET /health` endpoint.

#### Row-Level Security Helpers

Two query helpers enforce RLS by setting PostgreSQL session variables
before each query:

- **`queryWithRLS(agentRole, agentName, sql, params)`** — single query
  in a transaction with automatic rollback on failure.
- **`transactionWithRLS(agentRole, agentName, fn)`** — executes an
  arbitrary async function inside a transaction with RLS context.

Both log slow queries exceeding 1 second.

### File Locks

The file-level mutex system (`src/db/file-mutex.ts`) prevents two agents
from modifying the same workspace file concurrently. It is backed by the
`file_locks` PostgreSQL table with a partial unique index on
`(file_path) WHERE released_at IS NULL` to guarantee mutual exclusion at
the database level.

| Function | Description |
|----------|-------------|
| `acquireFileLocks` | Lock files for a ticket using `INSERT ... ON CONFLICT DO NOTHING`. Rolls back atomically on conflict. |
| `checkFileConflicts` | Return active locks held by other tickets for a set of file paths. |
| `releaseFileLocks` | Set `released_at = NOW()` on all active locks for a ticket. |
| `getActiveLocksForTicket` | List all active locks belonging to a ticket. |
| `getActiveLockForFile` | Return the active lock for a single file path, if any. |

All mutations run inside transactions and emit `FILE_LOCKED` /
`FILE_UNLOCKED` audit events to the `events` table. On conflict,
`acquireFileLocks` throws a `FileConflictError` (HTTP 409) with
structured details of every conflicting file.

### Migrations

SQL migration files live in `src/db/migrations/` and are applied in
lexicographic filename order. The runner (`src/db/migrate.ts`) tracks
applied migrations in a `schema_migrations` table with SHA-256 checksum
verification.

```bash
# Apply pending migrations
npm run migrate
```

Key behaviors:
- **Idempotent** — already-applied migrations are skipped.
- **Checksum verification** — throws if a previously applied migration
  file has been modified, preventing silent schema drift.
- **Transactional** — each migration runs inside `BEGIN`/`COMMIT`; a
  failure rolls back only the failing migration.

## Configuration

All settings are loaded from environment variables (`.env` supported via
`dotenv`). Validated at startup with Zod — the server exits immediately on
invalid configuration.

| Variable                 | Required | Default               | Description                                  |
|--------------------------|----------|-----------------------|----------------------------------------------|
| `DATABASE_URL`           | Yes      | —                     | PostgreSQL connection string (`postgresql://…`) |
| `PORT`                   | No       | `3000`                | HTTP listen port                             |
| `NODE_ENV`               | No       | `development`         | `development`, `production`, or `test`       |
| `LOG_LEVEL`              | No       | `info`                | Pino log level (`trace`–`fatal`)             |
| `ADMIN_API_KEY`          | No       | `forgeos_admin_CHANGE_ME` | Admin API key (change in production)     |
| `WEBHOOK_SECRET`         | No       | —                     | GitHub webhook HMAC secret                   |
| `WORKSPACE_PATH`         | No       | —                     | Path to the Git workspace                    |
| `RATE_LIMIT_PER_MINUTE`  | No       | `100`                 | Max requests per minute per client           |
| `DEFAULT_LEASE_MINUTES`  | No       | `30`                  | Default ticket claim lease duration          |
| `MAX_LEASE_MINUTES`      | No       | `120`                 | Maximum lease extension allowed              |
| `RECONCILIATION_INTERVAL`| No       | `300`                 | Seconds between expired-lease sweeps         |

### Production Requirements

When `NODE_ENV=production`, the server enforces additional startup validation:

- **`WEBHOOK_SECRET`** must be set (no default).
- **`ADMIN_API_KEY`** must differ from the built-in default
  (`forgeos_admin_CHANGE_ME`).

The server exits immediately if either check fails, listing all missing
variables in the error output.

## HTTP Endpoints

| Method   | Path                       | Auth     | Description                                          |
|----------|----------------------------|----------|------------------------------------------------------|
| `GET`    | `/health`                  | Public   | Health check with DB connectivity status             |
| `POST`   | `/mcp`                     | Bearer   | MCP Streamable HTTP — tool invocation                |
| `GET`    | `/mcp`                     | Bearer   | MCP SSE-based transport (server-to-client)           |
| `DELETE` | `/mcp`                     | Bearer   | MCP session teardown                                 |
| `GET`    | `/events`                  | Public   | SSE stream of real-time ticket changes (legacy)      |
| `GET`    | `/dashboard`               | Public   | Static dashboard UI                                  |
| `GET`    | `/api/events`              | Public   | SSE stream with snapshot + NOTIFY broadcasts         |
| `GET`    | `/api/tickets`             | Bearer   | Paginated, filterable ticket list                    |
| `GET`    | `/api/tickets/:id`         | Bearer   | Full ticket detail with resolved dependency status   |
| `GET`    | `/api/tickets/:id/history` | Bearer   | Ordered event timeline for a ticket                  |
| `GET`    | `/api/stages`              | Bearer   | Pipeline overview with counts per stage              |

### Authentication

Non-public endpoints require an `Authorization: Bearer <api-key>` header.
The key is hashed with SHA-256 and looked up in the `agents` table.
The admin key (`ADMIN_API_KEY`) bypasses the database lookup.

### REST API (`/api/*`)

The REST API serves the dashboard and external consumers. Routes are
defined in `src/api/` and mounted via `createApiRouter()` in
`src/api/index.ts`. REST endpoints require Bearer authentication;
the SSE endpoint is optionally authenticated.

#### GET /api/events — Server-Sent Events

Opens a persistent `text/event-stream` connection that:

1. Sends a **snapshot** of current system state (stage counts + 20 recent
   tickets) as the first event.
2. Subscribes to the PostgreSQL `ticket_changes` NOTIFY channel.
3. Broadcasts `ticket-update` events to all connected clients with
   sub-1-second latency.
4. Sends `:keepalive` comments every 30 seconds to prevent proxy timeouts.
5. Cleans up the listener on client disconnection (`req.close`).

SSE event format:

```
event: ticket-update
data: {"ticket_id":"TASK-FOS-01-001","stage":"BACKEND",...}

```

#### GET /api/tickets — Paginated List

Returns a paginated JSON array of tickets. Supports query-parameter filters:

| Parameter    | Type   | Default | Description                        |
|--------------|--------|---------|------------------------------------|
| `stage`      | enum   | —       | Filter by SDLC stage               |
| `type`       | enum   | —       | Filter by ticket type              |
| `status`     | enum   | —       | Filter by ticket status            |
| `claimed_by` | string | —       | Filter by claiming agent name      |
| `priority`   | enum   | —       | Filter by priority level           |
| `limit`      | int    | `20`    | Page size (1–100)                  |
| `offset`     | int    | `0`     | Number of rows to skip             |

Response shape:

```json
{
  "data": [ { "ticket_id": "...", ... } ],
  "pagination": { "total": 42, "limit": 20, "offset": 0, "has_more": true }
}
```

#### GET /api/tickets/:id — Ticket Detail

Returns the full ticket object plus a `dependency_status` array showing
whether each entry in `depends_on` is resolved (`DONE`) or not.

Returns `404` if the ticket does not exist.

#### GET /api/tickets/:id/history — Event Timeline

Returns all events from the `events` table for the given ticket, ordered
chronologically (oldest first). Returns `404` if the ticket does not exist.

#### GET /api/stages — Pipeline Overview

Returns per-stage metrics for the ticket pipeline:

```json
{
  "stages": {
    "READY": { "count": 5, "claimed": 0, "ready": 5 },
    "BACKEND": { "count": 3, "claimed": 2, "ready": 1 }
  },
  "total_tickets": 42,
  "timestamp": "2026-03-07T..."
}
```

#### Error Responses

All REST endpoints return structured errors:

| Status | Error Code         | Condition                    |
|--------|--------------------|------------------------------|
| `200`  | —                  | Success                      |
| `400`  | `VALIDATION_ERROR` | Invalid query parameters     |
| `401`  | `UNAUTHORIZED`     | Missing or invalid API key   |
| `404`  | `TICKET_NOT_FOUND` | Ticket ID not in database    |
| `500`  | `INTERNAL_ERROR`   | Unexpected server error      |

## Middleware

The Express middleware stack is mounted in a specific order. Each layer
adds context or handles cross-cutting concerns before the request reaches
a route handler.

### Mount Order

```
1. requestIdMiddleware   — assigns UUID v4 correlation ID
2. requestLogger         — structured JSON request/response logging
3. authMiddleware        — Bearer token authentication
4. Route handlers        — with optional validateBody / validateQuery / validateParams
5. errorHandler          — catches unhandled errors (must be last)
```

### Request ID (`request-id.ts`)

Generates or extracts a UUID v4 correlation ID for every HTTP request.
If the incoming request has an `X-Request-ID` header, it is reused;
otherwise `crypto.randomUUID()` creates a new one. The resolved ID is:

- Attached to `req.requestId` for downstream middleware and handlers.
- Echoed back in the `X-Request-ID` response header.

### Structured Logging (`logging.ts`)

Provides a pino-based singleton `logger` and the `requestLogger`
middleware. Each completed request emits a JSON log line with:

| Field           | Source                            |
|-----------------|-----------------------------------|
| `method`        | `req.method`                      |
| `path`          | `req.path`                        |
| `statusCode`    | `res.statusCode`                  |
| `durationMs`    | `process.hrtime.bigint()` delta   |
| `requestId`     | `req.requestId` (if present)      |
| `userAgent`     | `User-Agent` header               |
| `contentLength` | `Content-Length` response header   |

In development, logs are pretty-printed via `pino-pretty`. In production,
raw JSON lines are emitted for log aggregators.

### Error Handler (`error-handler.ts`)

Express 4-argument error middleware. Classifies errors in priority order:

1. **ForgeOSAppError** — uses the embedded `errorCode` and `statusCode`.
2. **PgDatabaseError** — maps PostgreSQL SQLSTATE codes to ForgeOS error codes.
3. **Generic Error** — falls back to `INTERNAL_ERROR` / HTTP 500.

In production (`NODE_ENV=production`), stack traces and internal details
are never leaked. The response body follows the `ErrorResponse` schema:

```json
{
  "error": "TICKET_NOT_FOUND",
  "message": "An error occurred",
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

#### `withErrorHandling<T>`

Async wrapper for MCP tool handlers. Catches thrown errors and returns
them as structured MCP text content responses so that tool invocations
never crash the transport.

```typescript
const result = await withErrorHandling(async () => {
  const ticket = await ticketRepo.findById(id);
  return { content: [{ type: 'text', text: JSON.stringify(ticket) }] };
});
```

#### PostgreSQL Error Code Mapping

| PG Class | SQLSTATE Codes | ForgeOS Error Code   |
|----------|---------------|----------------------|
| 08 — Connection | 08000–08006 | `DB_UNAVAILABLE`   |
| 23 — Integrity  | 23502       | `INTERNAL_ERROR`   |
| 23 — Integrity  | 23503       | `TICKET_NOT_FOUND` |
| 23 — Integrity  | 23505       | `ALREADY_CLAIMED`  |
| 40 — Transaction | 40001, 40P01 | `INTERNAL_ERROR`  |
| 42 — Syntax     | 42P01       | `DB_UNAVAILABLE`   |
| 57 — Operator   | 57P01–57P03 | `DB_UNAVAILABLE`   |

### Validation (`validation.ts`)

Factory functions that accept a Zod schema and return Express middleware
validating the request body, query string, or URL parameters.

| Factory           | Validates     | On Failure                    |
|-------------------|---------------|-------------------------------|
| `validateBody`    | `req.body`    | 400 with field-level errors   |
| `validateQuery`   | `req.query`   | 400 with field-level errors   |
| `validateParams`  | `req.params`  | 400 with field-level errors   |

On success, the parsed (and potentially transformed) data replaces the
original request property, so downstream handlers receive clean input.

Validation error response:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": {
    "fields": [
      { "field": "title", "message": "Required", "code": "invalid_type" }
    ]
  },
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

## MCP Tools

Ten ticket-management tools are registered under the `tickets.*` namespace:

| Tool                | Description                                          |
|---------------------|------------------------------------------------------|
| `tickets.next`      | Find the next available ticket for a given stage     |
| `tickets.claim`     | Atomically claim a ticket with file-lock detection   |
| `tickets.update`    | Update metadata on a claimed ticket                  |
| `tickets.complete`  | Advance a ticket to the next SDLC stage              |
| `tickets.reject`    | Reject a ticket and trigger rework or escalation     |
| `tickets.spawn`     | Create a child ticket with dependency tracking       |
| `tickets.graph`     | Return the dependency graph (nodes and edges)        |
| `tickets.release`   | Release a claim without advancing                    |
| `tickets.extend`    | Extend the lease on a claimed ticket                 |
| `tickets.stats`     | Return aggregate ticket statistics                   |

### tickets.next — Find Next Available Ticket

Peeks at the highest-priority unclaimed ticket for a given SDLC stage
without claiming it. Read-only — does not modify ticket state.

#### Input Schema

| Parameter  | Type   | Required | Description                               |
|------------|--------|----------|-------------------------------------------|
| `stage`    | enum   | Yes      | SDLC stage to search (e.g. `READY`, `BACKEND`, `QA`) |
| `type`     | enum   | No       | Filter by ticket type (e.g. `backend`, `frontend`, `fullstack`) |
| `priority` | enum   | No       | Minimum priority filter using enum ordering |

All enum values are validated via Zod at invocation time. Invalid values
return a schema validation error before the handler executes.

#### Query Behavior

The handler builds a parameterized SQL query:

```sql
SELECT * FROM tickets
WHERE stage = $1
  AND status = 'READY'
  AND (claimed_by IS NULL OR lease_expiry < NOW())
  [AND type = $2]           -- if type filter provided
  [AND priority >= $3]      -- if priority filter provided
ORDER BY priority DESC, created_at ASC
LIMIT 1
```

The query leverages the `idx_tickets_claimable` composite partial index
for sub-50 ms response times.

#### Response Format

**Success — ticket found:**

```json
{
  "ticket": { "ticket_id": "TASK-FOS-03-001", "stage": "READY", ... },
  "message": "OK"
}
```

**Success — no ticket available:**

```json
{
  "ticket": null,
  "message": "No tickets available"
}
```

**Error:**

```json
{
  "ticket": null,
  "message": "Query error: <details>",
  "error": "INTERNAL_ERROR",
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.next",
    "arguments": {
      "stage": "READY",
      "type": "backend",
      "priority": "high"
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-next.ts` | Zod schema, handler, types |
| `src/tools/index.ts` | Tool registration on McpServer |

### tickets.stats — Dashboard Statistics

Returns aggregate system statistics for dispatcher decision-making and
dashboard display. Computes per-stage ticket counts, per-status ticket
counts, claim health breakdown, average time-in-stage, rework count
distribution, and totals. All six database queries execute in parallel
for sub-200 ms response time.

#### Input Schema

| Parameter          | Type   | Required | Description                                          |
|--------------------|--------|----------|------------------------------------------------------|
| `time_range_hours` | number | No       | Restrict stats to tickets created within the last N hours |

When omitted, statistics cover all tickets (all-time). The value must be
a positive number.

#### Response Format

**Success:**

```json
{
  "stages": { "READY": 5, "BACKEND": 2, "QA": 1, "DONE": 12, "...": 0 },
  "statuses": { "READY": 5, "IN_PROGRESS": 3, "DONE": 12, "...": 0 },
  "claims": { "healthy": 3, "expiring_soon": 1, "expired": 0 },
  "avg_stage_duration": { "READY": 120.5, "BACKEND": 3600.0, "...": 0 },
  "rework_distribution": { "0": 15, "1": 3, "2": 1 },
  "total_tickets": 20,
  "total_done": 12
}
```

| Field                | Type                      | Description                                           |
|----------------------|---------------------------|-------------------------------------------------------|
| `stages`             | `Record<TicketStage, number>` | Ticket count per SDLC stage, all stages included   |
| `statuses`           | `Record<TicketStatus, number>` | Ticket count per operational status               |
| `claims.healthy`     | `number`                  | Claims with more than 5 minutes remaining on lease    |
| `claims.expiring_soon` | `number`                | Claims with less than 5 minutes remaining             |
| `claims.expired`     | `number`                  | Claims with expired leases                            |
| `avg_stage_duration` | `Record<TicketStage, number>` | Average seconds spent in each stage (from events) |
| `rework_distribution` | `Record<string, number>` | Maps rework count values to number of tickets         |
| `total_tickets`      | `number`                  | Total ticket count                                    |
| `total_done`         | `number`                  | Total tickets in DONE status                          |

**Error:**

```json
{
  "message": "Query error: <details>",
  "error": "INTERNAL_ERROR",
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

#### Caching

All-time statistics (no `time_range_hours` filter) are cached in memory
for 5 seconds. Filtered queries always hit the database. The cache
reduces load when multiple agents or dashboard clients poll concurrently.

#### Queries

Six parameterized SQL queries execute in parallel via `Promise.all()`:

1. Ticket count grouped by `stage`
2. Ticket count grouped by `status`
3. Claim health breakdown (healthy / expiring soon / expired)
4. Average time-in-stage from `STAGE_ADVANCED` events
5. Rework count distribution
6. Total tickets and total done

All queries use parameterized placeholders (`$1`) — no string
interpolation of user input.

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.stats",
    "arguments": {
      "time_range_hours": 24
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-stats.ts` | Zod schema, handler, types, caching |
| `src/tools/index.ts` | Tool registration on McpServer |
### tickets.graph — Dependency Graph

Returns the full ticket dependency DAG for visualization. Builds a
directed graph from ticket `depends_on` relationships, validates the
DAG invariant (no cycles), and computes the critical path (longest
path from any root to any leaf). Performance target: < 500 ms for
up to 500 tickets.

#### Input Schema

| Parameter        | Type   | Required | Description                                  |
|------------------|--------|----------|----------------------------------------------|
| `filter`         | object | No       | Narrow the graph by stage, type, or status   |
| `filter.stage`   | enum   | No       | Filter nodes by SDLC stage                   |
| `filter.type`    | enum   | No       | Filter nodes by ticket type                  |
| `filter.status`  | enum   | No       | Filter nodes by operational status           |

All enum values are validated via Zod at invocation time.

#### Query Behavior

The handler builds a parameterized SQL query with optional `WHERE`
clauses for each filter field:

```sql
SELECT * FROM tickets
[WHERE stage = $1 [AND type = $2] [AND status = $3]]
ORDER BY ticket_id
```

After fetching rows, the handler:

1. Builds an adjacency list from each ticket's `depends_on` array.
   Edge direction is dependency → dependent (if B depends on A, the
   edge is A → B).
2. Runs **cycle detection** via Kahn's BFS algorithm (O(V+E)). If a
   cycle is found, returns an error response with `CYCLE_DETECTED`.
3. Computes the **critical path** using topological ordering with
   dynamic programming — the longest path through the DAG.

#### Response Format

**Success:**

```json
{
  "nodes": [
    { "ticket_id": "TASK-FOS-03-001", "stage": "DONE", "depends_on": [], ... },
    { "ticket_id": "TASK-FOS-03-007", "stage": "CI", "depends_on": ["TASK-FOS-03-001"], ... }
  ],
  "edges": [
    { "from": "TASK-FOS-03-001", "to": "TASK-FOS-03-007" }
  ],
  "critical_path": ["TASK-FOS-03-001", "TASK-FOS-03-007"]
}
```

**Error — cycle detected:**

```json
{
  "nodes": [],
  "edges": [],
  "critical_path": [],
  "message": "Cycle detected in dependency graph — DAG invariant violated",
  "error": "CYCLE_DETECTED",
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

**Error — internal failure:**

```json
{
  "nodes": [],
  "edges": [],
  "critical_path": [],
  "message": "Query error: <details>",
  "error": "INTERNAL_ERROR",
  "timestamp": "2026-03-07T10:00:00.000Z"
}
```

#### Graph Algorithms

| Function              | Algorithm              | Complexity | Purpose                              |
|-----------------------|------------------------|------------|--------------------------------------|
| `hasCycle`            | Kahn's BFS             | O(V+E)     | Detect cycles in the dependency DAG  |
| `computeCriticalPath` | Kahn's BFS + DP        | O(V+E)     | Longest path from any root to leaf   |

Both functions are pure (no I/O) and exported for direct unit testing.

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.graph",
    "arguments": {
      "filter": {
        "stage": "READY",
        "type": "backend"
      }
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-graph.ts` | Zod schema, graph algorithms, handler |
| `src/tools/index.ts` | Tool registration on McpServer |
## Commit Message Convention

The repository enforces a commit message format via a
[Husky](https://typicode.github.io/husky/) `commit-msg` hook. Every commit
message must begin with a ticket ID in square brackets.

### Required Format

```
[TICKET-ID] Your message here
```

Where `TICKET-ID` matches the pattern
`[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*` — for example `FORGEOS-001`,
`TASK-FOS-01-001`.

### Valid Examples

| Type | Example |
|------|---------|
| CLAIM commit | `[TASK-FOS-01-001] CLAIM by Backend on machine-1 (operator)` |
| WORK commit  | `[TASK-FOS-01-001] BACKEND complete by Backend on machine-1` |
| General      | `[FORGEOS-001] Fix login bug` |

### Rejection

Commits that do not match the pattern are rejected with a clear error
showing the expected format. To bypass the hook in an emergency:

```bash
git commit --no-verify -m "your message"
```

### Developer Setup

The hook is installed automatically when you run `npm install` (via the
`prepare` script). No manual setup is needed. If hooks are missing after
cloning, run:

```bash
npm run prepare
```

Hook files:

| File | Purpose |
|------|---------|
| `.husky/commit-msg` | Entry point — delegates to the validator script |
| `scripts/validate-commit.sh` | Reads the first line and validates against the ticket ID regex |

## Architecture

```
src/
├── index.ts            # Boot sequence, graceful shutdown
├── server.ts           # Express app factory, MCP endpoint, SSE, NOTIFY
├── config.ts           # Zod-validated environment configuration
├── api/
│   ├── index.ts        # createApiRouter() — mounts REST + SSE sub-routers
│   └── routes/
│       ├── events.ts   # GET /api/events — SSE with snapshot + NOTIFY
│       ├── tickets.ts  # GET /api/tickets, /:id, /:id/history
│       └── stages.ts   # GET /api/stages — pipeline overview
├── db/
│   ├── index.ts        # Barrel exports for pool, migrations, file mutex
│   ├── pool.ts         # PostgreSQL connection pool, healthCheck, RLS helpers
│   ├── file-mutex.ts   # File-level mutex for concurrent lock management
│   ├── migrate.ts      # Migration runner
│   └── migrations/     # SQL migration files (applied in filename order)
├── middleware/
│   ├── index.ts        # Barrel export with mount-order documentation
│   ├── auth.ts         # Bearer token authentication middleware
│   ├── error-handler.ts # Error classification, PG error mapping, MCP wrapper
│   ├── logging.ts      # Pino structured logger, request logging
│   ├── request-id.ts   # UUID v4 request correlation ID
│   └── validation.ts   # Zod schema validation (body, query, params)
├── tools/
│   └── index.ts        # MCP tool registration hub (10 tools)
├── types/
│   └── index.ts        # TypeScript interfaces matching the PostgreSQL schema
└── dashboard/
    ├── index.html      # Static dashboard
    ├── css/style.css
    └── js/app.js
```

### Boot Sequence

1. Validate environment configuration (Zod)
2. Run pending database migrations
3. Create Express app with middleware and routes
4. Start HTTP server on configured port
5. Subscribe to PostgreSQL `ticket_changes` NOTIFY channel
6. Start reconciliation loop for expired claim cleanup
7. Register `SIGTERM`/`SIGINT` graceful shutdown handlers

### Graceful Shutdown

On `SIGTERM` or `SIGINT` the server:

1. Stops the reconciliation timer
2. Closes the HTTP server (drains in-flight requests)
3. Closes the PostgreSQL connection pool
4. Force-exits after 10 seconds if draining stalls

## Docker

The server ships with a multi-stage Dockerfile optimised for small image size
and secure defaults.

### Build the image

```bash
docker build -t forgeos-server .
```

### Run the container

```bash
docker run -d \
  --name forgeos \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/forgeos" \
  -e ADMIN_API_KEY="<your-admin-key>" \
  -e WEBHOOK_SECRET="<your-webhook-secret>" \
  forgeos-server
```

The container exposes port **3000** and includes a built-in health check that
probes `/health` every 30 seconds (`HEALTHCHECK` instruction). Orchestrators
such as Docker Compose, Kubernetes, or ECS use this signal to detect and
restart unhealthy containers automatically.

### Key Dockerfile details

| Aspect | Detail |
|--------|--------|
| Base image | `node:22-alpine` (builder and runtime) |
| Build tool | `npm ci` for reproducible installs |
| Runtime user | `node` (non-root) |
| Health check | `curl -f http://localhost:3000/health` every 30 s |
| Entry point | `node dist/index.js` |
| Expected size | < 200 MB |

### .dockerignore

The `.dockerignore` file keeps the build context small and prevents secrets
from leaking into the image:

| Pattern | Reason |
|---------|--------|
| `node_modules` | Rebuilt inside the image via `npm ci` |
| `dist` | Rebuilt during the builder stage |
| `*.md` (except `README.md`) | Not needed at runtime |
| `.env` / `.env.*` (except `.env.example`) | Prevents secret leakage |
| `.git` / `.gitignore` | VCS metadata not needed |
| `secrets/` | Prevents secrets directory from entering the image |

### Docker Compose

The production Docker Compose file (`docker-compose.yml`) orchestrates a
three-service stack: PostgreSQL, PgBouncer, and the MCP server.

> **Local development stack:** For the simpler three-service setup
> (PostgreSQL + MCP Server + pgAdmin) with hot-reload, see
> [`infra/README.md`](../infra/README.md).

#### Start the stack

```bash
# Start all services in the background
docker compose up -d

# Follow logs
docker compose logs -f

# Stop the stack
docker compose down

# Stop and remove data volume
docker compose down -v
```

#### Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgres` | `postgres:17-alpine` | 5432 (internal) | Primary database with healthcheck and persistent storage |
| `pgbouncer` | `edoburu/pgbouncer` | 6432 (host-mapped) | Connection pooler in transaction mode |
| `mcp-server` | Built from local `Dockerfile` | 3000 (internal) | ForgeOS MCP server |

#### Service details

**postgres** — Runs PostgreSQL 17 on Alpine. The database initialises with
`POSTGRES_DB=forgeos` and `POSTGRES_USER=forgeos`. The password is loaded
from a Docker secret (`/run/secrets/db_password`) rather than an environment
variable. SQL migration files in `src/db/migrations/` are mounted read-only
into `/docker-entrypoint-initdb.d/` so schemas are applied on first start.
A `pg_isready` healthcheck runs every 10 seconds with 5 retries and a
30-second start period. Data persists in the `pgdata` named volume.

**pgbouncer** — Sits between the MCP server and PostgreSQL. Operates in
**transaction** pooling mode with a default pool size of 50 and a maximum
of 200 client connections. Depends on `postgres` being healthy before
starting. Exposes port **6432** to the host for direct pool access during
development.

**mcp-server** — Built from the local Dockerfile. Connects to PostgreSQL
**through PgBouncer** on port 6432, not directly. Depends on both `postgres`
(healthy) and `pgbouncer` (started). Mounts the repository root as a
read-only volume at `/workspace`.

All three services use `restart: unless-stopped`.

#### Dependency graph

```
mcp-server ──depends_on──▶ pgbouncer ──depends_on──▶ postgres
              (started)                  (healthy)
```

#### Secrets

The database password uses Docker's file-based secrets mechanism:

```
forgeos-server/secrets/db_password
```

Set the password in this file before running `docker compose up`. The
default placeholder value must be changed in production.

#### Volumes

| Volume | Mount point | Purpose |
|--------|-------------|----------|
| `pgdata` | `/var/lib/postgresql/data` | Persistent PostgreSQL data |
| `./src/db/migrations` | `/docker-entrypoint-initdb.d:ro` | Auto-apply schema on init |
| `../` (repo root) | `/workspace:ro` | Workspace access for MCP server |

#### Environment variables (docker-compose.yml)

| Service | Variable | Value |
|---------|----------|-------|
| `postgres` | `POSTGRES_DB` | `forgeos` |
| `postgres` | `POSTGRES_USER` | `forgeos` |
| `postgres` | `POSTGRES_PASSWORD_FILE` | `/run/secrets/db_password` |
| `pgbouncer` | `POOL_MODE` | `transaction` |
| `pgbouncer` | `DEFAULT_POOL_SIZE` | `50` |
| `pgbouncer` | `MAX_CLIENT_CONN` | `200` |
| `mcp-server` | `DATABASE_URL` | `postgresql://forgeos:…@pgbouncer:6432/forgeos` |
| `mcp-server` | `PORT` | `3000` |
| `mcp-server` | `NODE_ENV` | `production` |

## TypeScript Configuration

Strict mode is enabled with all supplementary checks:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

Target: ES2022 / NodeNext modules. Output to `dist/` with source maps and
declaration files.

## License

See the repository root for license details.
