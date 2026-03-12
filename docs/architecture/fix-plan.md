# ForgeOS MCP Server — Architecture Fix Plan

> **Author:** Architect  
> **Date:** 2026-03-12  
> **Upstream:** Research Analyst gap analysis (CTO-research.md), PRD (PRD-mcp-operational.md)  
> **Confidence:** HIGH (95%)  
> **Scope:** TypeScript MCP server (`forgeos-server/`) and Docker infrastructure (`infra/`)

---

## Table of Contents

1. [Fix 1: tsconfig.json](#fix-1-tsconfigjson)
2. [Fix 2: MCP Transport Pattern](#fix-2-mcp-transport-pattern)
3. [Fix 3: Middleware Stack](#fix-3-middleware-stack)
4. [Fix 4: Auth Bootstrap](#fix-4-auth-bootstrap)
5. [Fix 5: Migration Idempotency](#fix-5-migration-idempotency)
6. [Fix 6: Tool Registration](#fix-6-tool-registration)
7. [Fix 7: Event Type Enum](#fix-7-event-type-enum)
8. [Fix 8: Docker Configuration](#fix-8-docker-configuration)
9. [Fix 9: Database Seed Strategy](#fix-9-database-seed-strategy)
10. [Fix 10: Integration Smoke Test](#fix-10-integration-smoke-test)
11. [Implementation DAG](#implementation-dag)

---

## Fix 1: tsconfig.json

### Problem

`forgeos-server/tsconfig.json` does not exist. `npm run build` (`tsc`) fails. The Dockerfile `COPY ... tsconfig.json` fails. The entire system is unbuildable.

### Design

Create `forgeos-server/tsconfig.json` with the following exact contents:

```jsonc
{
  "compilerOptions": {
    // ── Output ──────────────────────────────────────────────
    "target": "ES2022",               // Node 22 supports ES2022 natively
    "module": "NodeNext",             // ES modules with .js extension resolution
    "moduleResolution": "NodeNext",   // Required for "module": "NodeNext"
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,              // Emit .d.ts for downstream consumers
    "declarationMap": true,           // Source maps for declarations
    "sourceMap": true,                // Debugging support

    // ── Strictness ──────────────────────────────────────────
    "strict": true,                   // All strict flags enabled
    "noUncheckedIndexedAccess": true,  // Prevent undefined access on arrays/records
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": false,    // Allow import/export = interop for Express types

    // ── Interop ─────────────────────────────────────────────
    "esModuleInterop": true,          // Required for express default import
    "skipLibCheck": true,             // Skip checking .d.ts in node_modules (faster builds)
    "resolveJsonModule": true,        // Allow importing package.json if needed

    // ── Type Augmentation ───────────────────────────────────
    // request-id.ts uses `declare global { namespace Express { ... } }`.
    // This works with @types/express because skipLibCheck avoids conflicts
    // between @types/express v5 and express v4 type patterns.

    // ── Misc ────────────────────────────────────────────────
    "isolatedModules": true,          // Needed for tsx and esbuild compat
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

### Rationale

| Decision | Why |
|----------|-----|
| `target: ES2022` | Node 22 LTS supports all ES2022 features natively including top-level await, `Array.at()`, etc. |
| `module/moduleResolution: NodeNext` | `package.json` has `"type": "module"`. All imports use `.js` extensions (e.g., `from './tools/index.js'`). NodeNext is the only correct resolution strategy for this pattern. |
| `strict: true` | Matches PRD requirement. May surface hidden type errors — these should be fixed, not suppressed. |
| `skipLibCheck: true` | `@types/express` is v5 but `express` is v4.21.2. Type definition version mismatch can cause spurious errors in `node_modules`. `skipLibCheck` prevents this without masking app-level errors. |
| `verbatimModuleSyntax: false` | The Express type augmentation in `request-id.ts` uses `declare global`, which requires module syntax interop. Setting this to `true` would break the augmentation. |
| `isolatedModules: true` | Enables compatibility with `tsx` (used for `npm run dev`) and potential esbuild use. |
| Exclude `*.test.ts` | Test files should not be compiled into `dist/`. Vitest handles them separately. |

### Files Modified

- **CREATE:** `forgeos-server/tsconfig.json`

### Acceptance Criteria

- `cd forgeos-server && npx tsc --noEmit` exits 0
- `cd forgeos-server && npm run build` produces `dist/index.js`
- `docker build -t forgeos-mcp forgeos-server/` exits 0

---

## Fix 2: MCP Transport Pattern

### Problem

In `forgeos-server/src/server.ts` lines 96-140, each HTTP request to `/mcp` creates a **new** `StreamableHTTPServerTransport` and calls `mcpServer.connect(transport)`. This is incorrect:

1. `McpServer.connect()` binds the transport. Calling it per-request overwrites the previous binding — race condition under concurrency.
2. Memory leak: transport instances are never closed.
3. Stateless mode (`sessionIdGenerator: undefined`) means a single transport should handle all requests.

### Design

Create **one** `StreamableHTTPServerTransport` at app initialization time. Connect it to the `McpServer` once. Route all `/mcp` requests through the same transport instance.

#### Exact Code Change in `server.ts`

Replace the MCP endpoint section (lines 93-140) with:

```typescript
  // ── MCP Endpoint ───────────────────────────────────
  const mcpServer = new McpServer({
    name: 'forgeos',
    version: '1.0.0',
  });

  registerTools(mcpServer);

  // Single transport instance for stateless Streamable HTTP mode.
  // sessionIdGenerator: undefined = no session tracking (stateless).
  // The transport handles session-less request/response correlation internally.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Connect once — binds tool handlers and protocol negotiation.
  // This is an async operation that must complete before requests arrive.
  // It is safe to call before app.listen() because Express queues requests.
  mcpServer.connect(transport).catch((err) => {
    logger.fatal({ err }, 'Failed to connect MCP transport — server cannot handle MCP requests');
    process.exit(1);
  });

  // Route ALL /mcp methods through the single transport.
  // StreamableHTTPServerTransport.handleRequest() dispatches based on HTTP method:
  //   POST = JSON-RPC request/notification
  //   GET  = SSE stream initiation (server→client notifications)
  //   DELETE = session termination (no-op in stateless mode)
  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      await transport.handleRequest(req, res, req.body as Record<string, unknown>);
    } catch (err) {
      logger.error({ err, method: req.method }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_ERROR', message: 'Internal server error' });
      }
    }
  });
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| `app.all('/mcp', ...)` instead of separate POST/GET/DELETE | The transport internally dispatches by HTTP method. A single route handler is cleaner and guarantees the same transport instance handles all methods. |
| `mcpServer.connect(transport).catch(...)` with `process.exit(1)` | Transport connect is async. If it fails, the server cannot function — fail fast. The `.catch()` prevents unhandled rejection during startup. |
| `req.body as Record<string, unknown>` third param | Required by `handleRequest` for POST methods. GET/DELETE pass `undefined` body — the transport handles this. Express's json middleware has already parsed the body. |

### Files Modified

- **EDIT:** `forgeos-server/src/server.ts` — replace lines 93-140

### Acceptance Criteria

- MCP `initialize` request to `POST /mcp` returns valid response
- Two concurrent MCP requests do not interfere with each other
- No memory leak: transport instance count remains 1

---

## Fix 3: Middleware Stack

### Problem

`server.ts` applies middleware in wrong order and is missing two critical middleware:

**Current (broken):**
```typescript
app.use(express.json());
app.use(requestLogger);     // references req.requestId — but it's undefined
app.use(authMiddleware);     // blocks /mcp, /events, /dashboard — no exemptions
// (no errorHandler)
// (no API router)
```

**Required** (per `middleware/index.ts` documented order):
1. `express.json()`
2. `requestIdMiddleware` — generates/extracts UUID correlation ID
3. `requestLogger` — logs with `req.requestId`
4. `authMiddleware` — with path exemptions
5. Route handlers (API router)
6. `errorHandler` — last, catches unhandled errors

### Design

#### Exact Code Change in `server.ts`

Replace the middleware section (lines 48-50) with:

```typescript
  // ── Middleware ──────────────────────────────────────
  // Mount order follows middleware/index.ts documentation:
  // 1. Body parsing
  // 2. Request ID (must precede logger)
  // 3. Request logger (uses req.requestId)
  // 4. Auth (with path exemptions)
  // 5. API router
  // 6. Error handler (must be last)
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use(requestLogger);
  app.use(authMiddleware);
```

Add imports at top of file:

```typescript
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { createApiRouter } from './api/index.js';
```

Mount API router after the dashboard static files and before the MCP endpoint:

```typescript
  // ── REST API ───────────────────────────────────────
  app.use('/api', createApiRouter());
```

Mount error handler as the **last** middleware, after all route handlers:

```typescript
  // ── Error Handler (must be last) ───────────────────
  app.use(errorHandler);

  return app;
```

#### Auth Path Exemptions

The current `authMiddleware` only exempts `/health`. Additional paths need exemption:

| Path | Exempt? | Reason |
|------|---------|--------|
| `/health` | YES | Already exempt. Health probes must work without auth. |
| `/dashboard` | YES | Static files for human operators. Auth at API layer. |
| `/api/events` | YES | SSE endpoint — already mounted without auth in `createApiRouter()` |
| `/mcp` | NO | MCP requests carry `Authorization: Bearer <key>`. Auth is required here. |
| `/events` | YES | Legacy SSE endpoint. Read-only, no auth needed. |

**Design:** Add `/dashboard` and `/events` to `PUBLIC_PATH_PREFIXES` in `middleware/auth.ts`:

```typescript
const PUBLIC_PATH_PREFIXES: readonly string[] = ['/health', '/dashboard', '/events'];
```

The `/api/events` SSE endpoint is already exempt because `createApiRouter()` mounts it without auth middleware (line 38 of `api/index.ts`).

### Files Modified

- **EDIT:** `forgeos-server/src/server.ts` — add imports, fix middleware order, mount API router, mount error handler
- **EDIT:** `forgeos-server/src/middleware/auth.ts` — add `/dashboard` and `/events` to public path prefixes

### Acceptance Criteria

- Every HTTP response includes `X-Request-ID` header
- `GET /health` returns 200 without auth
- `GET /dashboard` returns 200 without auth
- `POST /mcp` without Bearer token returns 401
- `GET /api/tickets` with valid Bearer token returns 200
- Unhandled errors return structured JSON, never raw stack traces

---

## Fix 4: Auth Bootstrap

### Problem

When the system starts fresh, the `agents` table is empty. Auth middleware blocks all requests. No agent can register because registration requires authentication. Chicken-and-egg.

### Design

**Solution: Admin API Key Environment Variable + Database Seed at Startup**

The system already has `ADMIN_API_KEY` in config. The solution has two parts:

#### Part A: Seed Script Integration

The `db/seed.ts` file already exists and creates an admin agent with a generated API key. The problem is it's never called during Docker startup.

**Design:** Add a `seed()` call in `index.ts` after migrations, before `createApp()`:

```typescript
  // ── 1.5. Seed initial data (if needed) ──────────────
  logger.info('Running database seed...');
  const seedResult = await seed();
  if (seedResult.keyGenerated) {
    // Print key exactly once — it cannot be recovered
    console.log('═'.repeat(60));
    console.log('  ADMIN API KEY (save this — shown only once):');
    console.log(`  ${seedResult.plaintextKey}`);
    console.log('═'.repeat(60));
  }
  logger.info({ projectId: seedResult.projectId, agentId: seedResult.agentId }, 'Seed complete');
```

**Issue with current `seed.ts`:** The `seed()` function doesn't return the plaintext key. It generates it internally and logs it but doesn't include it in `SeedResult`.

**Fix `seed.ts`:** Add `plaintextKey?: string` to `SeedResult`. Return the plaintext key when a new key is generated:

```typescript
export interface SeedResult {
  projectId: string;
  agentId: string;
  keyGenerated: boolean;
  plaintextKey?: string;  // Only present when keyGenerated is true
}
```

#### Part B: Admin API Key Fallback

The auth middleware should also accept the `ADMIN_API_KEY` env var as a valid bearer token. This provides a bootstrap path when no agents exist yet.

**Current behavior check:** Read `auth/keys.ts` to see if admin key fallback exists.

**Design:** In `validateApiKey()` (in `auth/keys.ts`), add a check BEFORE the database lookup:

```typescript
// Check admin API key first (bootstrap path)
const adminKey = process.env.ADMIN_API_KEY;
if (adminKey && token === adminKey) {
  return {
    id: '00000000-0000-0000-0000-000000000000',  // sentinel UUID
    name: 'admin',
    role: 'admin',
    permissions: ['*'],
  } satisfies AgentIdentity;
}
```

This allows `Authorization: Bearer forgeos_admin_CHANGE_ME_IMMEDIATELY` to work before any agents are seeded. The admin can then call `/api/admin` endpoints to register proper agents.

#### Security Considerations

- The admin API key must be changed from the default in production (already enforced by `config.ts` `superRefine`)
- The sentinel UUID (`00000000-...`) is distinguishable in logs
- The admin key should be rotated after initial agent registration

### Files Modified

- **EDIT:** `forgeos-server/src/index.ts` — add seed call after migrations
- **EDIT:** `forgeos-server/src/db/seed.ts` — return plaintext key in SeedResult
- **EDIT:** `forgeos-server/src/auth/keys.ts` — add admin API key fallback

### Acceptance Criteria

- Fresh system with empty DB: `ADMIN_API_KEY` bearer token authenticates
- `seed()` runs on startup, creates admin agent if not exists
- Plaintext API key printed to stdout on first run
- Subsequent startups do NOT regenerate the key

---

## Fix 5: Migration Idempotency

### Problem

Two migration execution paths:

1. **Docker `initdb.d`:** PostgreSQL auto-executes `001_initial.sql` on first container creation (raw SQL, no tracking).
2. **App `runMigrations()`:** The app reads the same file and tries to execute it again. Fails on `CREATE TYPE ticket_status AS ENUM (...)` because the type already exists (PostgreSQL has no `CREATE TYPE IF NOT EXISTS`).

### Design

**Solution: Remove the `initdb.d` volume mount. Let the app handle all migrations.**

#### Rationale

The app's `migrate.ts` has proper tracking (`schema_migrations` table), checksum verification, and transaction wrapping. The Docker `initdb.d` approach has none of these. Using both is fundamentally broken.

#### Exact Change in `infra/docker-compose.yml`

Remove this line from the `postgres` service `volumes` section:

```yaml
      # REMOVE this line:
      - ../forgeos-server/src/db/migrations:/docker-entrypoint-initdb.d:ro
```

The healthcheck script mount and data volume remain:

```yaml
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/healthchecks/check-postgres.sh:/usr/local/bin/check-postgres.sh:ro
```

#### Additional Safety: Make `001_initial.sql` Idempotent

Even with the volume mount removed, the migration SQL should be idempotent for robustness. PostgreSQL doesn't support `CREATE TYPE IF NOT EXISTS`, but we can guard with `DO $$ ... $$`:

```sql
-- Replace each CREATE TYPE with:
DO $$ BEGIN
  CREATE TYPE ticket_status AS ENUM (...);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

Apply this pattern to all 5 enum type definitions:
- `ticket_status`
- `ticket_stage`
- `ticket_type`
- `ticket_priority`
- `event_type`

All `CREATE TABLE` statements already use `IF NOT EXISTS` patterns or should be wrapped:

```sql
CREATE TABLE IF NOT EXISTS projects (...);
CREATE TABLE IF NOT EXISTS agents (...);
-- etc.
```

The `CREATE EXTENSION` statements already use `IF NOT EXISTS`.

Functions use `CREATE OR REPLACE FUNCTION` — already idempotent.

#### Also Fix `infra/docker-compose.dev.yml`

Check if `docker-compose.dev.yml` has the same `initdb.d` mount and remove it if present.

### Files Modified

- **EDIT:** `infra/docker-compose.yml` — remove `initdb.d` volume mount
- **EDIT:** `infra/docker-compose.dev.yml` — remove `initdb.d` volume mount (if present)
- **EDIT:** `forgeos-server/src/db/migrations/001_initial.sql` — wrap all `CREATE TYPE` in `DO $$ ... $$` exception handlers; add `IF NOT EXISTS` to all `CREATE TABLE`

### Acceptance Criteria

- `docker compose down -v && docker compose up` — server starts without migration errors
- Server restart (without volume wipe) — migrations skip (already applied)
- `schema_migrations` table shows `001_initial.sql` with correct checksum

---

## Fix 6: Tool Registration

### Problem

Two fully-implemented tools are not registered:
- `tickets.release` (`tools/tickets-release.ts`) — agents cannot release claims
- `tickets.stats` (`tools/tickets-stats.ts`) — no dashboard statistics

Additionally, `tickets.reject` uses a hardcoded agent name `'system'`, which means the reject SQL function always gets the wrong agent ID and throws `NOT_CLAIM_OWNER`.

### Design

#### Part A: Register Missing Tools

Add to `tools/index.ts`:

```typescript
import { ticketsReleaseSchema, ticketsReleaseHandler } from './tickets-release.js';
import { ticketsStatsSchema, ticketsStatsHandler } from './tickets-stats.js';
```

Add registrations inside `registerTools()`:

```typescript
  // ── tickets.release ──────────────────────────────────────────────────────
  server.tool(
    'tickets.release',
    'Release a claim on a ticket. Normal release requires claim ownership. Force release (admin) can release any claim.',
    ticketsReleaseSchema.shape,
    async (params) => ticketsReleaseHandler(params),
  );

  // ── tickets.stats ────────────────────────────────────────────────────────
  server.tool(
    'tickets.stats',
    'Get aggregate system statistics: per-stage counts, per-status counts, claim health, average time-in-stage, rework distribution.',
    ticketsStatsSchema.shape,
    async (params) => ticketsStatsHandler(params),
  );
```

#### Part B: Fix `tickets.reject` Agent Identity

The current code:
```typescript
const agentName = 'system';  // HARDCODED — always wrong
```

**Design:** Add `agent_name` to the Zod schema and use it:

```typescript
export const ticketsRejectSchema = z.object({
  ticket_id: z.string().min(1).describe('Human-readable ticket ID to reject'),
  agent_name: z.string().min(1).describe('Name of the agent performing the rejection'),
  reason: z.string().min(10).describe('Why the ticket was rejected (min 10 chars)'),
  evidence: z.record(z.unknown()).optional()
    .describe('Optional structured evidence supporting the rejection'),
});
```

Then in the handler, replace:
```typescript
const agentName = 'system';
```
with:
```typescript
const agentName = params.agent_name;
```

This ensures the reject function uses the actual agent performing the review (QA, Security, Validator, etc.), which matches the `claimed_by_name` for ownership validation.

#### Part C: Fix `tickets.update` Ownership Check

The current code checks `if (ticket.claimed_by === null)` but doesn't verify the caller IS the owner. The `ticketsUpdateSchema` already has an `agent_name` field.

**Design:** Add ownership verification in the handler after the claim check:

```typescript
// After checking ticket.claimed_by !== null:
if (ticket.claimed_by_name !== params.agent_name) {
  // Return NOT_CLAIM_OWNER error
}
```

Read the full handler to confirm `agent_name` exists in the schema. If not, add it.

### Files Modified

- **EDIT:** `forgeos-server/src/tools/index.ts` — add imports and registrations for `tickets.release` and `tickets.stats`
- **EDIT:** `forgeos-server/src/tools/tickets-reject.ts` — add `agent_name` to schema, use it instead of `'system'`
- **EDIT:** `forgeos-server/src/tools/tickets-update.ts` — add ownership verification

### Acceptance Criteria

- `tools/list` returns 9 tools (7 existing + release + stats)
- `tickets.reject` with correct `agent_name` succeeds
- `tickets.reject` with wrong `agent_name` returns `NOT_CLAIM_OWNER`
- `tickets.update` from non-owner agent returns `NOT_CLAIM_OWNER`
- `tickets.release` releases a claim when called by the owner

---

## Fix 7: Event Type Enum

### Problem

TypeScript defines `EventType` with 15 values including `HEARTBEAT` and `COMPLETED`. The SQL enum `event_type` only has 13 values. Inserting `HEARTBEAT` or `COMPLETED` events throws:

```
ERROR: invalid input value for enum event_type: "HEARTBEAT"
```

### Design

Create a new migration `002_add_event_types.sql`:

```sql
-- =============================================================================
-- Migration 002: Add HEARTBEAT and COMPLETED event types
-- =============================================================================
-- Adds event types referenced by TypeScript EventType but missing from
-- the PostgreSQL event_type enum.
--
-- ALTER TYPE ... ADD VALUE is NOT transactional in PostgreSQL.
-- Each ADD VALUE must be a separate statement outside a transaction block.
-- The migrate.ts runner wraps each migration in BEGIN/COMMIT, so we use
-- DO blocks with exception handling instead.
-- =============================================================================

-- PostgreSQL 12+ supports ADD VALUE IF NOT EXISTS
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'HEARTBEAT';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'COMPLETED';
```

**IMPORTANT CAVEAT:** `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in PostgreSQL < 12. Since we target PostgreSQL 17, `ADD VALUE IF NOT EXISTS` is supported and is idempotent.

**HOWEVER:** The `migrate.ts` runner wraps each migration in `BEGIN ... COMMIT`. `ALTER TYPE ... ADD VALUE` fails inside transactions.

**Fix:** Modify the migration runner to detect `ALTER TYPE ... ADD VALUE` statements and execute them outside a transaction. Alternatively, restructure this migration to use a different approach.

**Simplest approach:** Modify `migrate.ts` to NOT wrap migrations in a transaction if the filename contains `_no_tx` suffix, or if the SQL contains `ALTER TYPE`:

```typescript
// In the pending migration execution loop:
const isTransactional = !sql.includes('ALTER TYPE') || !sql.includes('ADD VALUE');

if (isTransactional) {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations ...', [file, checksum]);
  await client.query('COMMIT');
} else {
  // ALTER TYPE ADD VALUE cannot run in a transaction
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations ...', [file, checksum]);
}
```

**Alternative (preferred):** Name the file `002_add_event_types.notx.sql` and check the filename:

```typescript
const needsTransaction = !file.includes('.notx.');
```

This is more explicit and doesn't require SQL parsing.

### Files Modified

- **CREATE:** `forgeos-server/src/db/migrations/002_add_event_types.notx.sql`
- **EDIT:** `forgeos-server/src/db/migrate.ts` — skip transaction wrapping for `.notx.` migrations

### Acceptance Criteria

- Migration runs without error on fresh DB
- Migration runs without error on DB that already has the enum values
- Inserting a `HEARTBEAT` event succeeds
- Inserting a `COMPLETED` event succeeds

---

## Fix 8: Docker Configuration

### Problem

Three Docker issues:
1. `DATABASE_URL` in `infra/docker-compose.yml` has no password
2. `infra/secrets/db_password` file doesn't exist
3. No `.env.example` for `infra/` directory

### Design

#### Part A: Fix DATABASE_URL

Replace in `infra/docker-compose.yml`:

```yaml
# BEFORE:
DATABASE_URL: "postgresql://forgeos@postgres:5432/forgeos"

# AFTER:
DATABASE_URL: "postgresql://forgeos:${DB_PASSWORD:-forgeos_dev}@postgres:5432/forgeos"
```

Same change in `infra/docker-compose.dev.yml`.

The `DB_PASSWORD` env var defaults to `forgeos_dev` for local development. In production, it should be set from the Docker secret.

#### Part B: Create Secrets Infrastructure

```bash
mkdir -p infra/secrets
echo "forgeos_dev" > infra/secrets/db_password
```

Add to `.gitignore`:

```
infra/secrets/
```

The Docker Compose `secrets.db_password.file` path is `./secrets/db_password` — this is relative to the compose file location (`infra/`), so the path resolves to `infra/secrets/db_password`. This is correct.

#### Part C: Create `infra/.env.example`

```bash
# ForgeOS Infrastructure — Environment Variables
# Copy to .env and edit for your environment.

# Database password (must match infra/secrets/db_password content)
DB_PASSWORD=forgeos_dev

# Admin API key for the MCP server (change in production)
ADMIN_API_KEY=forgeos_admin_CHANGE_ME_IMMEDIATELY

# pgAdmin login credentials
PGADMIN_EMAIL=admin@forgeos.local
PGADMIN_PASSWORD=admin
```

#### Part D: Fix Healthcheck Script Paths

The compose file references:
```yaml
test: ["CMD", "sh", "/usr/local/bin/check-postgres.sh"]
```
and mounts:
```yaml
- ./docker/healthchecks/check-postgres.sh:/usr/local/bin/check-postgres.sh:ro
```

Files confirmed to exist at `infra/docker/healthchecks/check-postgres.sh` and `check-mcp.sh`. No fix needed here.

The MCP server healthcheck references:
```yaml
test: ["CMD", "sh", "/app/check-mcp.sh"]
```
and mounts:
```yaml
- ./docker/healthchecks/check-mcp.sh:/app/check-mcp.sh:ro
```

This path is correct — the MCP server container's `WORKDIR` is `/app`.

### Files Modified

- **EDIT:** `infra/docker-compose.yml` — fix `DATABASE_URL` to include `${DB_PASSWORD}`
- **EDIT:** `infra/docker-compose.dev.yml` — fix `DATABASE_URL` to include `${DB_PASSWORD}`
- **CREATE:** `infra/secrets/db_password` — contains `forgeos_dev`
- **CREATE:** `infra/.env.example`
- **EDIT:** `.gitignore` — add `infra/secrets/`

### Acceptance Criteria

- `docker compose -f infra/docker-compose.yml config` validates without errors
- `docker compose up` starts PostgreSQL with password auth working
- MCP server connects to PostgreSQL without auth failure

---

## Fix 9: Database Seed Strategy

### Problem

No seed data is loaded during Docker startup. The `agents` table starts empty, blocking all authenticated operations.

### Design

The existing `db/seed.ts` is well-designed. It needs to be:
1. Called during startup (Fix 4 handles this)
2. Extended with sample ticket data for testing/demo

#### Seed Data Specification

**Phase 1: Bootstrap (called by `seed.ts` at startup)**

| Entity | Data |
|--------|------|
| Project | name: `ForgeOS`, repo_url: `https://github.com/Ticketer/ForgeOS` |
| Admin Agent | name: `admin`, role: `admin`, permissions: `["*"]` |

Already implemented in `seed.ts`.

**Phase 2: Optional Demo Data (separate script)**

Create `forgeos-server/src/db/seed-demo.ts` for optional demo/test data:

```sql
-- Demo project (if not exists)
INSERT INTO projects (name, description, repo_url)
VALUES ('ForgeOS', 'ForgeOS Orchestration Engine', 'https://github.com/Ticketer/ForgeOS')
ON CONFLICT (name) DO NOTHING;

-- Demo agents (common SDLC roles)
INSERT INTO agents (name, role, permissions) VALUES
  ('backend-agent', 'backend', '["tickets.claim","tickets.complete","tickets.update","tickets.extend"]'::jsonb),
  ('frontend-agent', 'frontend', '["tickets.claim","tickets.complete","tickets.update","tickets.extend"]'::jsonb),
  ('qa-agent', 'qa', '["tickets.claim","tickets.reject","tickets.complete","tickets.extend"]'::jsonb),
  ('security-agent', 'security', '["tickets.claim","tickets.reject","tickets.complete","tickets.extend"]'::jsonb)
ON CONFLICT (name, role) DO NOTHING;

-- Demo ticket in READY state
INSERT INTO tickets (ticket_id, project_id, title, description, type, priority, status, stage, sdlc_flow, acceptance_criteria)
SELECT
  'DEMO-001',
  p.id,
  'Demo Backend Task',
  'A sample ticket for smoke testing the MCP server lifecycle.',
  'backend'::ticket_type,
  'medium'::ticket_priority,
  'READY'::ticket_status,
  'BACKEND'::ticket_stage,
  ARRAY['BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE']::ticket_stage[],
  ARRAY['Compiles without errors', 'Tests pass']
FROM projects p WHERE p.name = 'ForgeOS'
ON CONFLICT (ticket_id) DO NOTHING;
```

**Invocation:** `npm run seed:demo` (add script to `package.json`):
```json
"seed:demo": "tsx src/db/seed-demo.ts"
```

### Files Modified

- **CREATE:** `forgeos-server/src/db/seed-demo.ts`
- **EDIT:** `forgeos-server/package.json` — add `seed:demo` script

### Acceptance Criteria

- `npm run seed:demo` creates demo agents and ticket
- Demo ticket appears in `tickets.next` for stage `BACKEND`
- Demo agents can authenticate and claim tickets

---

## Fix 10: Integration Smoke Test

### Design

Create `forgeos-server/scripts/smoke-test.sh` — a shell script that validates the full stack.

```bash
#!/usr/bin/env bash
# ForgeOS MCP Server — Integration Smoke Test
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - curl and jq installed
#   - Run from the repository root
#
# Usage:
#   bash forgeos-server/scripts/smoke-test.sh
#
# Exit code 0 = all checks pass, non-zero = failure

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0
BASE_URL="http://localhost:3000"

pass() { echo -e "${GREEN}✓ $1${NC}"; ((PASS++)); }
fail() { echo -e "${RED}✗ $1${NC}"; ((FAIL++)); }

# ── Step 1: Start Docker services ─────────────────────────────────
echo "Step 1: Starting Docker services..."
cd infra
docker compose down -v 2>/dev/null || true
docker compose up -d --build

# ── Step 2: Wait for health check ─────────────────────────────────
echo "Step 2: Waiting for services to become healthy..."
TIMEOUT=90
ELAPSED=0
until curl -sf "$BASE_URL/health" > /dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $TIMEOUT ]; then
    fail "Health check did not pass within ${TIMEOUT}s"
    docker compose logs mcp-server
    exit 1
  fi
done
pass "Health check passed (${ELAPSED}s)"

# ── Step 3: Verify health response ────────────────────────────────
echo "Step 3: Verifying health response..."
HEALTH=$(curl -sf "$BASE_URL/health")
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
  pass "Health endpoint returns ok"
else
  fail "Health endpoint returned: $HEALTH"
fi

# ── Step 4: Get admin API key from logs ───────────────────────────
echo "Step 4: Retrieving admin API key..."
# The seed prints the key to stdout on first run
ADMIN_KEY="${ADMIN_API_KEY:-forgeos_admin_CHANGE_ME_IMMEDIATELY}"
AUTH_HEADER="Authorization: Bearer $ADMIN_KEY"

# ── Step 5: MCP Initialize ───────────────────────────────────────
echo "Step 5: Testing MCP initialize..."
MCP_INIT=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "smoke-test", "version": "1.0.0" }
    }
  }')

if echo "$MCP_INIT" | jq -e '.result.serverInfo.name == "forgeos"' > /dev/null 2>&1; then
  pass "MCP initialize succeeded"
else
  fail "MCP initialize failed: $MCP_INIT"
fi

# ── Step 6: List tools ────────────────────────────────────────────
echo "Step 6: Listing MCP tools..."
MCP_TOOLS=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }')

TOOL_COUNT=$(echo "$MCP_TOOLS" | jq '.result.tools | length')
if [ "$TOOL_COUNT" -eq 9 ]; then
  pass "All 9 tools registered"
else
  fail "Expected 9 tools, got $TOOL_COUNT"
  echo "$MCP_TOOLS" | jq '.result.tools[].name'
fi

# ── Step 7: Seed demo data ─────────────────────────────────────
echo "Step 7: Seeding demo ticket..."
# Insert a demo ticket via SQL (using psql in the postgres container)
docker exec forgeos-postgres psql -U forgeos -d forgeos -c "
  INSERT INTO tickets (ticket_id, project_id, title, type, priority, status, stage, sdlc_flow)
  SELECT 'SMOKE-001', p.id, 'Smoke Test Ticket', 'backend', 'medium', 'READY', 'BACKEND',
    ARRAY['BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE']::ticket_stage[]
  FROM projects p WHERE p.name = 'ForgeOS'
  ON CONFLICT (ticket_id) DO NOTHING;
" 2>/dev/null
pass "Demo ticket seeded"

# ── Step 8: tickets.next ──────────────────────────────────────────
echo "Step 8: Testing tickets.next..."
MCP_NEXT=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "tickets.next",
      "arguments": { "stage": "BACKEND" }
    }
  }')

if echo "$MCP_NEXT" | jq -e '.result.content[0].text' | grep -q "SMOKE-001" 2>/dev/null; then
  pass "tickets.next found SMOKE-001"
else
  fail "tickets.next did not find SMOKE-001: $MCP_NEXT"
fi

# ── Step 9: REST API ─────────────────────────────────────────────
echo "Step 9: Testing REST API..."
API_TICKETS=$(curl -sf "$BASE_URL/api/tickets" -H "$AUTH_HEADER")
if echo "$API_TICKETS" | jq -e 'type == "array"' > /dev/null 2>&1; then
  pass "REST /api/tickets returns array"
else
  fail "REST /api/tickets failed: $API_TICKETS"
fi

API_STAGES=$(curl -sf "$BASE_URL/api/stages" -H "$AUTH_HEADER")
if echo "$API_STAGES" | jq -e 'type' > /dev/null 2>&1; then
  pass "REST /api/stages returns data"
else
  fail "REST /api/stages failed: $API_STAGES"
fi

# ── Step 10: Dashboard ────────────────────────────────────────────
echo "Step 10: Testing dashboard..."
DASH_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/dashboard/")
if [ "$DASH_STATUS" = "200" ]; then
  pass "Dashboard returns 200"
else
  fail "Dashboard returned $DASH_STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════"

# Cleanup
cd ..
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

### Files Modified

- **CREATE:** `forgeos-server/scripts/smoke-test.sh`

### Acceptance Criteria

- Script exits 0 when all fixes are applied
- Script exits non-zero and reports failures when any fix is missing

---

## Implementation DAG

Task dependency graph for ticket decomposition. Nodes are independent work units. Edges indicate "must complete before."

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRITICAL PATH (Phase 1)                       │
│                                                                  │
│  Fix 1: tsconfig.json ─────┐                                    │
│                             ├──► Fix 8: Docker Config ──────┐   │
│  Fix 8A: secrets/db_pass ──┘                                │   │
│                                                              │   │
│  Fix 5: Migration Idem. ───────────────────────────────────► │   │
│                                                              │   │
│  Fix 2: MCP Transport ────┐                                 │   │
│                            ├──► Fix 3: Middleware Stack ──► ALL  │
│  Fix 3: Middleware Stack ──┘                                 │   │
│                                                              │   │
│  Fix 4: Auth Bootstrap ───────────────────────────────────► │   │
│                                                              │   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    PARALLEL GROUP (Phase 2)                       │
│  (All depend on Phase 1 completion)                              │
│                                                                  │
│  Fix 6: Tool Registration ──┐                                   │
│                              ├──► Fix 10: Smoke Test            │
│  Fix 7: Event Type Enum ────┤                                   │
│                              │                                   │
│  Fix 9: Database Seed ──────┘                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Parallelization Groups

| Group | Fixes | Can Parallel? | Dependencies |
|-------|-------|:---:|---|
| **G1** | Fix 1 (tsconfig) | Independent | None |
| **G2** | Fix 5 (migration idempotency) | Independent | None |
| **G3** | Fix 8A (secrets/db_password/.env) | Independent | None |
| **G4** | Fix 2 (MCP transport) | Independent | None |
| **G5** | Fix 3 (middleware) + Fix 4 (auth bootstrap) | Depends on G4 | Fix 2 changes server.ts; Fix 3 also changes server.ts |
| **G6** | Fix 6 (tool reg) + Fix 7 (enum) + Fix 9 (seed) | Parallel within, depends on G1-G5 | All Phase 1 must be done |
| **G7** | Fix 8B (docker-compose DATABASE_URL) | Depends on G1, G3 | Needs tsconfig for Docker build, needs secrets |
| **G8** | Fix 10 (smoke test) | Depends on all | End-to-end validation |

### Critical Path

```
Fix 1 → Fix 8 → Fix 3 → Fix 10
         ↑
Fix 5 ───┘
```

Estimated total: 6-8 engineering hours across all fixes.

---

## Well-Architected Assessment

| Pillar | Score | Notes |
|--------|:---:|-------|
| **Operational Excellence** | 7/10 | Health checks exist. Structured logging via pino. Missing: structured startup logs for seed output, no readiness probe distinct from liveness. |
| **Security** | 6/10 | API key auth with SHA-256 hashing is solid. ADMIN_API_KEY default is flagged in production. Missing: rate limiting middleware not mounted, no CORS configuration. |
| **Reliability** | 7/10 | PostgreSQL stored functions use `FOR UPDATE` locking. Lease expiry and reconciliation loop exist. Missing: graceful MCP transport shutdown, connection retry on pool exhaustion. |
| **Performance** | 8/10 | Single-transport MCP pattern eliminates per-request overhead. PostgreSQL indexes are comprehensive. Connection pool (20) is adequate for < 20 agents. |
| **Cost Optimization** | 9/10 | Minimal infrastructure: single PostgreSQL + single Node process. Docker resource limits set. No unnecessary services. |
| **Sustainability** | 7/10 | TypeScript strict mode catches errors early. Zod schemas provide runtime validation. Migration runner is well-designed. Missing: automated integration tests in CI. |

---

## Anti-Pattern Checks

| Anti-Pattern | Status | Notes |
|--------------|:---:|-------|
| Big Ball of Mud | CLEAR | Clear module boundaries: tools/, middleware/, api/, db/ |
| Golden Hammer | CLEAR | PostgreSQL is appropriate for ACID ticket state; not over-applied |
| Distributed Monolith | FLAG | Two servers (TS + Python) with different schemas. Decision needed: pick one. |
| God Service | CLEAR | McpServer delegates to individual tool handlers |
| Chatty Services | CLEAR | No inter-service communication — single server architecture |
| Shared Database | FLAG | If both servers exist, they'd share PostgreSQL with conflicting schemas |

**Recommendation:** The TypeScript server should be the canonical server. The Python server should be deprecated or converted to an SDK-only component. This decision is tracked as an ADR candidate for a future ticket.

---

## ADR: TypeScript Server as Canonical MCP Server

**Status:** PROPOSED  
**Context:** Two MCP servers exist with incompatible schemas and tool sets. Maintaining both doubles the engineering burden.  
**Decision:** The TypeScript MCP server (`forgeos-server/`) is the canonical server. The Python MCP server (`mcp-server/`) should not be deployed or maintained as a server.  
**Consequences:**
- All tool development happens in TypeScript
- Agent SDK targets TypeScript server on port 3000
- Python `mcp-server/` code can be archived or repurposed as reference
- Schema migration ownership belongs to `forgeos-server/src/db/migrations/`

---

## Fitness Functions

| Metric | Target | Measurement |
|--------|--------|-------------|
| Build time (`npm run build`) | < 30s | CI pipeline |
| Docker build time | < 120s | CI pipeline |
| Startup to healthy | < 60s | `docker compose up` to health check pass |
| MCP `tools/list` response | < 100ms p50 | Smoke test timing |
| Tool count at `tools/list` | = 9 | Automated assertion |
| Migration idempotency | Zero errors on re-run | Restart test |
| Auth bootstrap | Admin key works on fresh DB | Smoke test |
