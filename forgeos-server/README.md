<!-- last_reviewed: 2026-03-07T10:00:00Z -->
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

| Method   | Path         | Auth     | Description                                |
|----------|--------------|----------|--------------------------------------------|
| `GET`    | `/health`    | Public   | Health check with DB connectivity status   |
| `POST`   | `/mcp`       | Bearer   | MCP Streamable HTTP — tool invocation      |
| `GET`    | `/mcp`       | Bearer   | MCP SSE-based transport (server-to-client) |
| `DELETE` | `/mcp`       | Bearer   | MCP session teardown                       |
| `GET`    | `/events`    | Public   | SSE stream of real-time ticket changes     |
| `GET`    | `/dashboard` | Public   | Static dashboard UI                        |

### Authentication

Non-public endpoints require an `Authorization: Bearer <api-key>` header.
The key is hashed with SHA-256 and looked up in the `agents` table.
The admin key (`ADMIN_API_KEY`) bypasses the database lookup.

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
├── db/
│   ├── pool.ts         # PostgreSQL connection pool, healthCheck, RLS helpers
│   ├── migrate.ts      # Migration runner
│   └── migrations/     # SQL migration files (applied in filename order)
├── middleware/
│   ├── auth.ts         # Bearer token authentication middleware
│   └── logging.ts      # Pino structured logger, request correlation IDs
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
