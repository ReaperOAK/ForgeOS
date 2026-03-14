<!-- last_reviewed: 2026-03-14T22:30:00Z -->
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

The server starts on `http://localhost:3011` by default.

## npm Scripts

| Script          | Command              | Description                            |
|-----------------|----------------------|----------------------------------------|
| `build`         | `tsc`                | Compile TypeScript to `dist/`          |
| `start`         | `node dist/index.js` | Run compiled production build          |
| `dev`           | `tsx watch src/index.ts` | Development mode with hot-reload   |
| `migrate`       | `tsx src/db/migrate.ts`  | Run pending database migrations    |
| `ingest:legacy-context` | `tsx src/db/ingest-legacy-context.ts` | Import legacy filesystem context into lessons/embeddings |
| `typecheck`     | `tsc --noEmit`       | Type-check without emitting files      |
| `lint`          | `eslint "src/**/*.{ts,tsx}"` | Run ESLint on TypeScript source files |
| `test`          | `vitest run`         | Run test suite once                    |
| `test:watch`    | `vitest`             | Run tests in watch mode                |
| `prepare`       | `husky`              | Install Git hooks (runs on `npm install`) |

### Lifecycle Guardrail Regression Tests

The lifecycle prompt pipeline includes a static regression suite at
`src/__tests__/prompt-lifecycle-guardrails.test.ts`.

Test pattern and purpose:

- Reads lifecycle modules as source text (`compiler.ts`, `tickets-claim.ts`,
  `reconciliation.ts`) and asserts forbidden path patterns are absent.
- Prevents regressions that re-introduce direct filesystem ticket-state
  coupling (for example, `.github/ticket-state` and `.github/tickets`).
- Verifies lifecycle hooks use queue-based prompt compilation triggers instead
  of mutating lifecycle state directly.

Run only this suite:

```bash
npx vitest run src/__tests__/prompt-lifecycle-guardrails.test.ts
```

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

### Prompt Compiler Foundation (Migration 008)

`src/db/migrations/008-prompt-compiler-foundation.sql` adds additive
metadata for deterministic prompt packets and freshness checks. Existing
`compiled_prompt` content remains unchanged.

Added columns on `tickets`:

- `compiled_prompt_compiled_at`
- `compiled_prompt_context_hash`
- `compiled_prompt_packet_schema_version` (default `1`)
- `compiled_prompt_packet_version` (default `v1`)
- `compiled_prompt_template_version`
- `compiled_prompt_freshness_status` (`fresh | stale | missing`)
- `compiled_prompt_stale_reason`
- `compiled_prompt_freshness_checked_at`
- `compiled_prompt_context_repo_commit`
- `compiled_prompt_context_graph_version`
- `compiled_prompt_context_memory_snapshot`

Migration safeguards:

- Backfills new timestamps and packet version defaults for existing rows with
  non-null `compiled_prompt`.
- Adds check constraints for valid freshness status and schema version.
- Adds indexes for `compiled_prompt_context_hash` and
  `compiled_prompt_freshness_status`.

Runtime persistence path:

- `src/services/compiler.ts` stores prompt text plus metadata (`context_hash`,
  packet/schema/template versions, freshness fields, canonical context inputs)
  in both dedicated columns and `tickets.metadata.compiled_prompt`.

### Freshness Gate API (Cache Invalidation)

The compiler service exposes two cache-control helpers in
`src/services/compiler.ts`.

| Function | When to call | Behavior |
|----------|--------------|----------|
| `compileIfStale(ticketId)` | Normal lifecycle compile paths (`claim`, `advance`, reconciliation) where deterministic context may or may not have changed. | Computes current context hash and compares it to stored hash. Returns cached prompt (`provider: cached`) when hash is unchanged. Recompiles and persists when hash is missing or stale. |
| `invalidatePromptCache(ticketId)` | After manual prompt/template-affecting edits or operational override when you must force a fresh compile on next access. | Clears stored `compiled_prompt_context_hash`, marks freshness `missing`, and ensures the next `compileIfStale` triggers full recompilation. |

Operational guidance:

- Prefer `compileIfStale` for automated workflows. It prevents unnecessary
  recompilation and preserves deterministic behavior.
- Use `invalidatePromptCache` sparingly as an explicit override.
- If unsure, call `compileIfStale` first. It is safe in both fresh and stale
  states.

### Packet Validation (11-Section Schema)

Every compiled prompt packet must conform to a strict 11-section schema before
it is stored or dispatched. The sections must appear in this exact order:

| # | Section name |
|---|---|
| 1 | `ROLE` |
| 2 | `TICKET` |
| 3 | `SYSTEM CONSTRAINTS` |
| 4 | `HISTORY` |
| 5 | `LEARNINGS` |
| 6 | `BEST PRACTICES` |
| 7 | `CONTEXT LOCATIONS` |
| 8 | `YOUR EXACT TASK` |
| 9 | `EXECUTION PLAN` |
| 10 | `EDGE CASES` |
| 11 | `POST-COMPLETION` |

Section headers are recognized in two formats: `**SECTION NAME**` (bold
Markdown) and `## SECTION NAME` (Markdown heading, any level 1–6).

Validation logic lives in `src/services/packet-validator.ts` and is called
automatically inside `compileTicketPrompt` and its fallback path.

**What happens when validation fails:**

- `validatePacketSections(text)` returns a `ValidationResult` with
  `valid: false`, a `missingSections` array, a `misordered` array, and a
  `structuredReason` string describing the first detected failure.
- The compiler throws `PacketValidationError(result)`, which carries the full
  `ValidationResult` on its `.result` property for structured logging.
- At API or transport boundaries, call `error.toPublicMessage()` to get a
  fixed, non-leaking error string safe to forward to clients.
- The failed compilation is **not** persisted — no partial packet reaches the
  database.

## Configuration

All settings are loaded from environment variables (`.env` supported via
`dotenv`). Validated at startup with Zod — the server exits immediately on
invalid configuration.

| Variable                 | Required | Default               | Description                                  |
|--------------------------|----------|-----------------------|----------------------------------------------|
| `DATABASE_URL`           | Yes      | —                     | PostgreSQL connection string (`postgresql://…`) |
| `PORT`                   | No       | `3011`                | HTTP listen port                             |
| `NODE_ENV`               | No       | `development`         | `development`, `production`, or `test`       |
| `LOG_LEVEL`              | No       | `info`                | Pino log level (`trace`–`fatal`)             |
| `ADMIN_API_KEY`          | No       | `forgeos_admin_CHANGE_ME` | Admin API key (change in production)     |
| `WEBHOOK_SECRET`         | No       | —                     | GitHub webhook HMAC secret                   |
| `WORKSPACE_PATH`         | No       | —                     | Path to the Git workspace                    |
| `GEMINI_API_KEY`         | No       | —                     | Enables Gemini-first prompt compilation      |
| `GEMINI_MODEL`           | No       | `gemini-1.5-flash`    | Gemini model used by the prompt compiler     |
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
| `POST`   | `/api/admin/agents`            | Admin    | Register a new agent (returns one-time API key)      |
| `GET`    | `/api/admin/agents`            | Admin    | List registered agents (paginated, no key hashes)    |
| `POST`   | `/api/admin/agents/:id/revoke` | Admin    | Revoke an agent's API key                            |
| `DELETE` | `/api/admin/agents/:id`        | Admin    | Deregister (soft-delete) an agent                    |
| `POST`   | `/api/admin/agents/:id/sessions` | Admin  | Create or update an agent session                    |
| `POST`   | `/api/webhooks/github`     | HMAC     | GitHub push webhook receiver with state reconciliation |
| `POST`   | `/api/webhooks/github/recover` | HMAC | Replay missed commits for ghost commit recovery      |

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

### Admin API (`/api/admin/*`)

The admin router provides agent lifecycle management endpoints. All routes
require `admin.manage_keys` permission enforced via `requirePermission()`
middleware. Mounted via `adminRouter` from `src/api/routes/admin.ts`.

Service logic lives in `src/auth/registration.ts` — Zod-validated inputs,
SHA-256 key hashing, and structured pino logging throughout.

#### POST /api/admin/agents — Register Agent

Creates a new agent identity with a generated API key.

**Request body** (JSON):

| Field         | Type       | Required | Description                        |
|---------------|------------|----------|----------------------------------  |
| `name`        | `string`   | Yes      | Unique agent name (3–100 chars)    |
| `role`        | `string`   | Yes      | One of the defined agent roles     |
| `permissions` | `string[]` | No       | Additional permission strings      |
| `machine_id`  | `string`   | No       | Machine identifier for the agent   |

**Response** (201):

```json
{
  "agent": { "id": "uuid", "name": "backend-01", "role": "backend", "is_active": true },
  "api_key": "forgeos_agent_<plaintext>   <- shown once, never stored"
}
```

#### GET /api/admin/agents — List Agents

Returns a paginated list of registered agents. Key hashes are never exposed.

**Query parameters:**

| Param    | Type     | Default | Description                  |
|----------|----------|---------|------------------------------|
| `page`   | `number` | `1`     | Page number (1-based)        |
| `limit`  | `number` | `50`    | Items per page (1–100)       |
| `role`   | `string` | —       | Filter by agent role         |
| `active` | `boolean`| —       | Filter by active status      |

**Response** (200):

```json
{
  "agents": [ { "id": "uuid", "name": "...", "role": "...", "is_active": true, "created_at": "..." } ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

#### POST /api/admin/agents/:id/revoke — Revoke API Key

Sets `revoked_at` on the agent record. Subsequent requests using the revoked
key receive `401 Unauthorized`.

**Response** (200): `{ "success": true, "agent_id": "uuid", "revoked_at": "ISO8601" }`

#### DELETE /api/admin/agents/:id — Deregister Agent

Soft-deletes the agent by setting `is_active = false` and `deregistered_at`.

**Response** (200): `{ "success": true, "agent_id": "uuid", "deregistered_at": "ISO8601" }`

#### POST /api/admin/agents/:id/sessions — Create/Update Session

Associates a session token (MCP session ID) with the agent.

**Request body** (JSON):

| Field           | Type     | Required | Description              |
|-----------------|----------|----------|--------------------------|
| `session_token` | `string` | Yes      | MCP session identifier   |
| `machine_id`    | `string` | No       | Machine running session  |

**Response** (200):

```json
{
  "session_id": "uuid",
  "agent_id": "uuid",
  "session_token": "mcp-session-abc",
  "created_at": "ISO8601"
}
```

### Webhooks (`/api/webhooks/*`)

The webhook router handles GitHub push events and reconciles Git state
with database ticket state. Mounted via `createGitHubWebhookRouter()`
from `src/webhooks/github.ts`.

#### POST /api/webhooks/github — Push Event Receiver

Accepts GitHub push event payloads and reconciles ticket state:

1. Verifies HMAC-SHA256 signature via `X-Hub-Signature-256` header
   against `WEBHOOK_SECRET`. Rejects invalid signatures with `401`.
2. Parses the push event payload to extract commit details.
3. Matches commit messages against CLAIM and WORK patterns:
   - **CLAIM:** `[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)`
   - **WORK:** `[TICKET-ID] STAGE complete by AGENT on MACHINE`
4. Reconciles each detected operation with database state.

Reconciliation rules:

| Git State | DB State | Action |
|-----------|----------|--------|
| CLAIM commit exists | No active claim | Create claim in DB |
| WORK commit exists | Ticket still CLAIMED at stage | Advance ticket |
| No Git commit | Claim exists, lease expired | Release claim |
| Ambiguous | Any | Log warning, flag for admin |

All operations are idempotent — replaying the same webhook produces the
same result. Every action is recorded as a `RECONCILED` event in the
`events` table.

Success response:

```json
{
  "status": "ok",
  "branch": "main",
  "commits": 3,
  "operations": 2,
  "reconciliation": {
    "claims_created": 1,
    "tickets_advanced": 1,
    "claims_released": 0,
    "already_reconciled": 0,
    "ambiguous_states": 0
  },
  "timestamp": "2026-03-10T..."
}
```

#### POST /api/webhooks/github/recover — Ghost Commit Recovery

Replays reconciliation from missed commits. Accepts a JSON body with:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `commits` | array | Yes | Array of commit objects (`id`, `message`, `timestamp`, etc.) |
| `last_known_sha` | string | No | SHA of the last successfully processed commit |

Parses commit messages from the provided array and runs the same
reconciliation engine used by the push event handler. HMAC-SHA256
signature verification is required.

Response on success (HTTP 200):

```json
{
  "status": "recovered",
  "last_known_sha": "abc123",
  "operations_processed": 2,
  "reconciliation": {
    "claims_created": 0,
    "tickets_advanced": 1,
    "claims_released": 0,
    "already_reconciled": 1,
    "ambiguous_states": 0
  },
  "timestamp": "2026-03-10T..."
}
```

#### Periodic Reconciliation

In addition to webhook-driven reconciliation, the server runs a periodic
sweep at a configurable interval (`RECONCILIATION_INTERVAL`, default
300 seconds). The sweep calls the `release_expired_claims()` stored
function to release tickets with expired leases.

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

### tickets.update — Update Ticket Metadata

Updates arbitrary metadata on a claimed ticket. Merges the provided
key-value pairs into the ticket's existing `metadata` JSONB column
using PostgreSQL's `||` operator (shallow merge). Only callable when
the ticket has an active claim. Records an `UPDATED` event in the
`events` table with the metadata payload.

#### Input Schema

| Parameter  | Type   | Required | Description                                       |
|------------|--------|----------|---------------------------------------------------|
| `ticket_id`| string | Yes      | Human-readable ticket identifier (min 1 character)|
| `metadata` | object | Yes      | Key-value pairs to shallow-merge into ticket metadata |

Both fields are validated via Zod at invocation time. Invalid values
return a schema validation error before the handler executes.

#### Handler Workflow

The handler runs in a single database transaction:

1. Locks the ticket row with `SELECT ... FOR UPDATE`.
2. Returns `TICKET_NOT_FOUND` if the ticket does not exist.
3. Returns `NOT_CLAIM_OWNER` if the ticket has no active claim
   (`claimed_by` is null).
4. Merges metadata via `UPDATE tickets SET metadata = metadata || $1::jsonb`.
5. Inserts an `UPDATED` event into the `events` table.
6. Commits and returns the updated ticket.

The `updated_at` column refreshes automatically via the
`trg_tickets_updated_at` database trigger.

#### Response Format

**Success:**

```json
{
  "ticket": { "ticket_id": "TASK-FOS-03-003", "metadata": { "key": "value" }, ... },
  "message": "OK"
}
```

#### Error Codes

| Error Code         | Condition                         | Description                       |
|--------------------|-----------------------------------|-----------------------------------|
| `TICKET_NOT_FOUND` | No ticket with given ID           | Ticket does not exist             |
| `NOT_CLAIM_OWNER`  | Ticket has no active claim        | No agent currently holds the claim|
| `INTERNAL_ERROR`   | Database or runtime failure       | Unexpected error during update    |

**Error response shape:**

```json
{
  "error": "TICKET_NOT_FOUND",
  "message": "Ticket TASK-XXX does not exist",
  "ticket_id": "TASK-XXX",
  "timestamp": "2026-03-10T10:00:00.000Z"
}
```

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.update",
    "arguments": {
      "ticket_id": "TASK-FOS-03-003",
      "metadata": {
        "review_notes": "Approved by security team",
        "priority_override": "critical"
      }
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-update.ts` | Zod schema, handler, types |
| `src/tools/index.ts` | Tool registration on McpServer |

### tickets.complete — Complete Stage and Advance

Marks the current SDLC stage as complete and advances the ticket to the
next stage in its type-specific flow. Requires completion evidence
(artifacts, test results, confidence level). On reaching DONE, resolves
dependencies to unblock downstream tickets.

#### Input Schema

| Parameter      | Type   | Required | Description                                      |
|----------------|--------|----------|--------------------------------------------------|
| `ticket_id`    | string | Yes      | Ticket identifier (e.g. `TASK-FOS-03-004`)       |
| `evidence`     | object | Yes      | Completion evidence payload                      |
| `evidence.artifacts`     | string[] | Yes | File paths created or modified          |
| `evidence.test_results`  | string   | Yes | Test summary (pass/fail counts, coverage) |
| `evidence.confidence`    | enum     | Yes | `HIGH`, `MEDIUM`, or `LOW`               |
| `evidence.notes`         | string   | No  | Optional free-text notes                  |

#### Output Schema

| Field                    | Type     | Description                                  |
|--------------------------|----------|----------------------------------------------|
| `ticket`                 | object   | Updated ticket record (ticket_id, stage, status) |
| `previous_stage`         | string   | The SDLC stage the ticket was in             |
| `new_stage`              | string   | The SDLC stage the ticket advanced to        |
| `dependencies_unblocked` | string[] | Ticket IDs whose dependencies are now resolved |

#### Error Codes

| Error Code            | Condition                 | Description                           |
|-----------------------|---------------------------|---------------------------------------|
| `TICKET_NOT_FOUND`    | No ticket with given ID   | Ticket does not exist                 |
| `NOT_CLAIM_OWNER`     | Caller ≠ claim owner      | Only the claiming agent can complete  |
| `INVALID_TRANSITION`  | Stage violation            | Ticket is not at an advanceable stage |
| `MISSING_EVIDENCE`    | Empty or invalid evidence  | Evidence payload fails Zod validation |

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.complete",
    "arguments": {
      "ticket_id": "TASK-FOS-03-004",
      "evidence": {
        "artifacts": [
          "forgeos-server/src/tools/tickets-complete.ts",
          "forgeos-server/src/sdlc/flows.ts",
          "forgeos-server/src/sdlc/transitions.ts"
        ],
        "test_results": "62 tests passed, 0 failed. Coverage: 92%",
        "confidence": "HIGH"
      }
    }
  }
}
```

#### Example Response

```json
{
  "ticket": {
    "ticket_id": "TASK-FOS-03-004",
    "status": "READY",
    "stage": "QA"
  },
  "previous_stage": "BACKEND",
  "new_stage": "QA",
  "dependencies_unblocked": []
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-complete.ts` | Zod schema, handler, types |
| `src/sdlc/flows.ts` | SDLC_FLOWS constant (10 ticket types → stage arrays) |
| `src/sdlc/transitions.ts` | `getNextStage()`, `getImplementationStage()`, `isValidTransition()` |
| `src/types/index.ts` | `TicketsCompleteOutput`, `TicketType`, `TicketStage` types |
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

### tickets.spawn — Create Child Ticket

Creates a child ticket linked to an existing parent ticket, enabling
self-expanding workflows and task decomposition. The child receives a
generated `ticket_id` following the pattern `{parent_id}-SUB-{n}`,
inherits the parent's `project_id`, and enters the SDLC flow for its
own ticket type.

#### Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `parent_id` | `string` | Yes | — | `ticket_id` of the parent ticket |
| `title` | `string` | Yes | — | Title for the child ticket (1–200 chars) |
| `type` | `enum` | Yes | — | Ticket type determining the SDLC flow |
| `priority` | `enum` | No | `medium` | `critical`, `high`, `medium`, or `low` |
| `acceptance_criteria` | `string[]` | Yes | — | At least one criterion (min 1 char each) |
| `file_paths` | `string[]` | Yes | — | Workspace-relative paths in the child's write scope |
| `description` | `string` | No | — | Detailed description of the child ticket |
| `depends_on` | `string[]` | No | — | `ticket_id` values the child depends on |

#### Child Ticket ID Generation

The handler queries existing children of the parent and assigns an
incremented suffix:

```
{parent_id}-SUB-1, {parent_id}-SUB-2, ...
```

If the child has `depends_on` entries, the initial status is `BLOCKED`.
Otherwise the child starts in `READY` status.

#### Error Codes

| Code | Condition |
|------|-----------|
| `INVALID_SUBTASK` | Title, type, or `acceptance_criteria` missing or empty |
| `TICKET_NOT_FOUND` | Parent ticket does not exist |
| `INTERNAL_ERROR` | Unexpected database or runtime error |

#### Example MCP Invocation

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.spawn",
    "arguments": {
      "parent_id": "TASK-FOS-03-001",
      "title": "Add input validation for spawn handler",
      "type": "backend",
      "acceptance_criteria": ["Validate all required fields before DB insert"],
      "file_paths": ["forgeos-server/src/tools/tickets-spawn.ts"]
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-spawn.ts` | Zod schema, handler, error builder |
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

### tickets.extend — Extend Lease Duration

Extends the lease on a claimed ticket to prevent expiry during long-running
operations. The handler resolves the agent name to a UUID, calls the
`extend_lease` PostgreSQL stored function, and returns the updated ticket
with the new lease expiry timestamp.

#### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `ticket_id` | `string` | Yes | — | Ticket ID whose lease to extend |
| `agent_name` | `string` | Yes | — | Agent name that holds the claim |
| `duration_minutes` | `integer` | No | `30` | Extension duration in minutes (5–120) |

All values are validated via Zod at invocation time. `duration_minutes`
is clamped to 5–120 and defaults to 30 when omitted.

#### Handler Behavior

1. Looks up `agent_name` in the `agents` table to resolve the UUID.
2. If the agent is not found, returns `NOT_CLAIM_OWNER`.
3. Calls the `extend_lease(p_ticket_id, p_agent_id, p_agent_name,
   p_duration_minutes)` stored function. The function uses
   `SELECT FOR UPDATE` to verify claim ownership and checks the
   requested duration against `max_lease_minutes` from `system_config`.
4. On success, updates `lease_expiry` to `NOW() + duration_minutes` and
   records a `LEASE_EXTENDED` event with `new_expiry` and
   `extension_minutes` in the payload.
5. Returns the updated ticket and new lease expiry.

#### Response Format

**Success:**

```json
{
  "ticket": { "ticket_id": "TASK-001", "lease_expiry": "2026-03-10T13:00:00Z", "..." : "..." },
  "new_lease_expiry": "2026-03-10T13:00:00Z"
}
```

**Error — not claim owner:**

```json
{
  "error": "NOT_CLAIM_OWNER",
  "message": "Cannot extend lease: you do not hold the claim on ticket TASK-001",
  "ticket_id": "TASK-001",
  "timestamp": "2026-03-10T12:00:00.000Z"
}
```

**Error — duration exceeds maximum:**

```json
{
  "error": "LEASE_TOO_LONG",
  "message": "Requested duration exceeds max_lease_minutes",
  "ticket_id": "TASK-001",
  "timestamp": "2026-03-10T12:00:00.000Z"
}
```

#### Error Codes

| Error Code | Condition |
|------------|-----------|
| `NOT_CLAIM_OWNER` | Agent does not hold the claim, or agent not registered |
| `LEASE_TOO_LONG` | `duration_minutes` exceeds `max_lease_minutes` system config |
| `INTERNAL_ERROR` | Unexpected database or runtime error |

#### MCP Invocation Example

```json
{
  "method": "tools/call",
  "params": {
    "name": "tickets.extend",
    "arguments": {
      "ticket_id": "TASK-FOS-03-009",
      "agent_name": "Backend",
      "duration_minutes": 45
    }
  }
}
```

#### Implementation Files

| File | Purpose |
|------|---------|
| `src/tools/tickets-extend.ts` | Zod schema, handler, types |
| `src/tools/index.ts` | Tool registration on McpServer |

## Agent-Runner SDK

TypeScript wrapper that agents import to execute the two-commit protocol
safely. Calls MCP tools over HTTP first; falls back to `tickets.py` CLI
when the server is unreachable.

### Quick Start

```ts
import { AgentRunner } from './sdk/agent-runner.js';

const runner = new AgentRunner();

// 1. Claim
const claim = await runner.claimTicket(
  'TASK-001', 'Backend', 'pop-os', 'Ticketer'
);

// 2. Do work ...

// 3. Complete
await runner.completeStage('TASK-001', 'Backend', {
  artifacts: ['src/api/handler.ts'],
  test_results: '32 passed',
  confidence: 'HIGH',
});
```

### Configuration

All values are read from environment variables and validated with Zod on first use.

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEOS_MCP_URL` | `http://localhost:3011/mcp` | MCP server endpoint |
| `FORGEOS_API_KEY` | *(required)* | Bearer token for MCP auth |
| `FORGEOS_FALLBACK_ENABLED` | `true` | Enable `tickets.py` CLI fallback |
| `FORGEOS_TICKETS_PY_PATH` | `.github/tickets.py` | Path to CLI script |
| `FORGEOS_MCP_TIMEOUT_MS` | `10000` | HTTP timeout (1000-60000 ms) |
| `FORGEOS_WORKSPACE_PATH` | `process.cwd()` | Workspace root for CLI |

### Public API

| Method | Returns | Description |
|--------|---------|-------------|
| `claimTicket(id, agent, machine, operator)` | `ClaimResult` | Acquire distributed lock |
| `completeStage(id, agent, evidence)` | `CompleteResult` | Mark stage done, advance |
| `releaseTicket(id, agent)` | `ReleaseResult` | Release claim without completing |
| `pushWork(files)` | `void` | Stage files explicitly (rejects forbidden patterns) |
| `validateGitAddPatterns(args)` | `void` | Throw if args match `git add .` / `-A` / `--all` |
| `validateScope(files, allowed)` | `void` | Throw if any file is outside allowed paths |

Each result carries a `source` field (`'mcp'` or `'fallback'`) so callers know which path was taken.

### Error Classes

| Class | Trigger |
|-------|---------|
| `ForbiddenGitAddError` | `git add .`, `git add -A`, `git add --all`, `git add -a` |
| `ScopeViolationError` | Staged file outside ticket `file_paths` |
| `TicketOperationError` | Both MCP call and CLI fallback failed |

### Fallback Behavior

When `FORGEOS_FALLBACK_ENABLED` is `true` (default) and the MCP server is
unreachable or returns an error, the runner shells out to `tickets.py`:

```
claimTicket   -> python3 tickets.py --claim <id> <agent> <machine> <operator>
completeStage -> python3 tickets.py --advance <id> <agent>
releaseTicket -> python3 tickets.py --release <id>
```

If fallback is disabled or the CLI also fails, a `TicketOperationError` is
thrown with details from both attempts.

### Implementation Files

| File | Purpose |
|------|---------|
| `src/sdk/agent-runner.ts` | AgentRunner class, error classes, result types |
| `src/sdk/config.ts` | `loadSdkConfig()`, `FORBIDDEN_GIT_ADD_PATTERNS` |

## Git Hooks

The repository uses [Husky](https://typicode.github.io/husky/) to enforce
two pre-commit validations automatically. Both hooks are installed when you
run `npm install` (via the `prepare` script).

### Blast Radius Validation (pre-commit)

A `pre-commit` hook validates that every staged file falls within the
current ticket's declared `file_paths` scope. This prevents accidental
changes to files outside the ticket boundary.

#### How It Works

1. **Resolve ticket ID** — reads `FORGEOS_TICKET_ID` environment variable,
   or falls back to the `[TICKET-ID]` pattern in the most recent commit
   message.
2. **Query the MCP server** — sends `GET /api/tickets/:id` to retrieve
   the ticket's `file_paths` array.
3. **Prefix match** — each staged file (`git diff --cached --name-only`)
   is checked against the allowed paths. A file matches if it equals an
   allowed path or starts with an allowed path followed by `/`.
4. **Verdict** — if any file is out of scope, the commit is rejected with
   a clear list of violating files and allowed paths.

#### Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| MCP server unreachable | WARNING printed, commit allowed |
| No ticket ID found | INFO printed, commit allowed |
| `file_paths` empty | WARNING printed, commit allowed |

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FORGEOS_TICKET_ID` | — | Override ticket ID (skips commit-message parsing) |
| `FORGEOS_MCP_URL` | `http://localhost:3011` | MCP server base URL for scope lookup |
| `FORGEOS_CURL_TIMEOUT` | `5` | Seconds before the API request times out |

#### Bypass

```bash
git commit --no-verify -m "your message"
```

Use `--no-verify` only for emergency commits. The hook is a safety net —
bypassing it means no scope validation occurs.

### Commit Message Convention (commit-msg)

The `commit-msg` hook enforces a commit message format. Every commit
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

Hooks are installed automatically when you run `npm install` (via the
`prepare` script). No manual setup is needed. If hooks are missing after
cloning, run:

```bash
npm run prepare
```

### Hook Files

| File | Hook | Purpose |
|------|------|---------|
| `.husky/pre-commit` | `pre-commit` | Delegates to `scripts/validate-scope.sh` for blast radius validation |
| `.husky/commit-msg` | `commit-msg` | Delegates to `scripts/validate-commit.sh` for message format validation |
| `scripts/validate-scope.sh` | — | Resolves ticket ID, queries MCP server, validates staged files against allowed paths |
| `scripts/validate-commit.sh` | — | Reads the first line and validates against the ticket ID regex |

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
│   ├── index.ts        # Barrel exports for pool, migrations, seed, import, file mutex
│   ├── pool.ts         # PostgreSQL connection pool, healthCheck, RLS helpers
│   ├── seed.ts         # Database seed: default project + admin agent with API key
│   ├── import.ts       # Filesystem ticket import: .github/tickets/*.json → PostgreSQL
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
├── sdk/
│   ├── agent-runner.ts # Agent-Runner wrapper
│   └── config.ts       # Zod-validated SDK configuration
├── types/
│   └── index.ts        # TypeScript interfaces matching the PostgreSQL schema
└── dashboard/
    ├── index.html      # Static dashboard
    ├── css/style.css
    └── js/app.js
```

### Scripts

```
scripts/
└── import-tickets.ts  # CLI entry point: seed + import pipeline
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

## Seed & Import

The server includes a seed script and a filesystem import tool for
bootstrapping the database with initial data and loading existing ticket
JSON files.

### Seed (`src/db/seed.ts`)

Creates the default "ForgeOS" project and an admin agent with a
cryptographically generated API key. The plaintext key is printed to
stdout exactly once — it cannot be recovered afterwards (only the
SHA-256 hash is stored in the `agents` table).

| Action | Details |
|--------|---------|
| Upsert project | Name: `ForgeOS`, repo URL, lease defaults (30 / 120 min) |
| Upsert admin agent | Role: `admin`, active, full permissions |
| API key | `fos_<64 hex>` (32 random bytes), printed once if newly generated |

Idempotent: uses `ON CONFLICT … DO UPDATE` so re-running is safe.

### Import (`src/db/import.ts`)

Reads `.github/tickets/*.json` files (excluding `ticket-schema.json`)
and upserts them into the `tickets` table. For each ticket:

1. Derives the current stage from the `.github/ticket-state/` directory tree.
2. Maps filesystem stage names to database enum values
   (e.g. `DOCS` → `DOCUMENTATION`, `VALIDATION` → `VALIDATOR`).
3. Validates and maps the `sdlc_flow` array.
4. Preserves the `history` array as `events` table rows with
   duplicate detection.
5. Produces a summary: `{ success, errors, skipped }`.

Idempotent: uses `ON CONFLICT (ticket_id) DO UPDATE`.

### CLI (`scripts/import-tickets.ts`)

Runs all three steps in sequence: **migrations → seed → import**.

```bash
# Default workspace (repo root, two levels above scripts/)
npx tsx scripts/import-tickets.ts

# Explicit workspace path
npx tsx scripts/import-tickets.ts /path/to/repo

# Via WORKSPACE_PATH env var
WORKSPACE_PATH=/path/to/repo npx tsx scripts/import-tickets.ts
```

Exit code is `0` on success, `1` if any ticket import errors occurred.

### Programmatic API

```typescript
import { seed, importTickets } from './db/index.js';

const { projectId, agentId, keyGenerated } = await seed();
const { success, errors, skipped } = await importTickets(workspacePath, projectId);
```

**`SeedResult`** — returned by `seed()`:

| Field          | Type      | Description                                              |
|----------------|-----------|----------------------------------------------------------|
| `projectId`    | `string`  | UUID of the created or updated project                   |
| `agentId`      | `string`  | UUID of the created or updated admin agent               |
| `keyGenerated` | `boolean` | `true` if a new API key was generated (first run only)   |

**`ImportSummary`** — returned by `importTickets()`:

| Field     | Type     | Description                                |
|-----------|----------|--------------------------------------------|
| `success` | `number` | Tickets successfully imported or updated   |
| `errors`  | `number` | Tickets that failed to import              |
| `skipped` | `number` | Tickets skipped (missing required fields)  |

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
  -p 3011:3011 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/forgeos" \
  -e ADMIN_API_KEY="<your-admin-key>" \
  -e WEBHOOK_SECRET="<your-webhook-secret>" \
  forgeos-server
```

The container exposes port **3011** and includes a built-in health check that
probes `/health` every 30 seconds (`HEALTHCHECK` instruction). Orchestrators
such as Docker Compose, Kubernetes, or ECS use this signal to detect and
restart unhealthy containers automatically.

### Key Dockerfile details

| Aspect | Detail |
|--------|--------|
| Base image | `node:22-alpine` (builder and runtime) |
| Build tool | `npm ci` for reproducible installs |
| Runtime user | `node` (non-root) |
| Health check | `curl -f http://localhost:3011/health` every 30 s |
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
| `mcp-server` | Built from local `Dockerfile` | 3011 (internal) | ForgeOS MCP server |

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
| `mcp-server` | `PORT` | `3011` |
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
