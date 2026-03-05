<!-- last_reviewed: 2026-03-06T14:00:00Z -->
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
