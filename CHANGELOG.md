# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Husky Pre-Commit Hook — Blast Radius Validation** — Pre-commit hook
  at `.husky/pre-commit` delegating to `scripts/validate-scope.sh`
  (TASK-FOS-06-002). Resolves the current ticket ID from the
  `FORGEOS_TICKET_ID` environment variable or the last commit message
  `[TICKET-ID]` pattern. Queries the MCP server REST API
  (`GET /api/tickets/:id`) to retrieve the ticket's `file_paths`, then
  validates each staged file against allowed paths using prefix matching.
  Out-of-scope files cause the commit to be rejected with a clear error
  listing violating files and allowed paths. Graceful degradation: if the
  MCP server is unreachable or no ticket context is available, the hook
  warns and allows the commit. Configurable via `FORGEOS_MCP_URL`,
  `FORGEOS_TICKET_ID`, and `FORGEOS_CURL_TIMEOUT` environment variables.
  Bypass with `git commit --no-verify`.

- **Seed Data and Filesystem Import Tool** — Database bootstrapping pipeline
  at `forgeos-server/src/db/seed.ts`, `forgeos-server/src/db/import.ts`, and
  `forgeos-server/scripts/import-tickets.ts` (TASK-FOS-01-003). Seed script
  creates the default "ForgeOS" project with repo URL and lease settings,
  plus an admin agent with a cryptographically generated API key (SHA-256
  hashed, plaintext printed once to stdout). Import tool reads
  `.github/tickets/*.json` files, derives current stage from
  `.github/ticket-state/` directories, maps filesystem stage names to
  database enum values, preserves ticket history as events, and uses
  `ON CONFLICT DO UPDATE` for idempotency. CLI entry point
  (`scripts/import-tickets.ts`) runs migrations → seed → import in
  sequence. 21 tests (6 seed + 15 import).

- **SSE Endpoint and REST API for Real-Time Updates** — Dashboard API routes
  under `/api/` (TASK-FOS-05-002). SSE endpoint (`GET /api/events`) sends an
  initial system snapshot (stage counts, 20 recent tickets) then listens on
  PostgreSQL `ticket_changes` NOTIFY channel and broadcasts `ticket-update`
  events to all connected clients with sub-1-second latency. Includes 30-second
  keep-alive and automatic reconnection on PG listener error. REST endpoints:
  `GET /api/tickets` (paginated with stage/type/status/priority/claimed_by
  filters, Zod-validated query params), `GET /api/tickets/:id` (full ticket
  with resolved dependency status), `GET /api/tickets/:id/history` (ordered
  event timeline), `GET /api/stages` (pipeline overview with count/claimed/ready
  per stage). REST endpoints require Bearer authentication; SSE endpoint is
  optionally authenticated. Proper HTTP status codes (200, 400, 401, 404, 500).
  All SQL queries parameterized. Route modules: `forgeos-server/src/api/routes/
  events.ts`, `tickets.ts`, `stages.ts`; router factory:
  `forgeos-server/src/api/index.ts`.

- **Initialize MCP Server with Python SDK** — Foundational Python MCP
  server at `mcp-server/` (FORGEOS-BE015). Built on the official MCP Python
  SDK (`mcp>=1.25`) using the FastMCP high-level API with decorator-based
  tool registration. Server starts with Streamable HTTP transport in
  stateless mode (`stateless_http=True`) for horizontal scaling. Includes:
  `pyproject.toml` with Hatch build system, project metadata, 5 runtime
  dependencies (`mcp`, `asyncpg`, `pydantic`, `pydantic-settings`, `uvicorn`),
  and dev tooling (`pytest`, `ruff`, `pyright`); `server.py` with
  `ServerConfig` (pydantic-settings, `FORGEOS_*` env prefix), lifespan-
  managed asyncpg connection pool with graceful degradation, structured
  JSON logging, 5-class domain error hierarchy (`ForgeOSError`,
  `TicketNotFoundError`, `TicketAlreadyClaimedError`, `ValidationError`,
  `DatabaseError`) mapping to JSON-RPC error codes, `raise_mcp_error()`
  and `tool_error_response()` helpers, and a `health_check` tool;
  `__main__.py` entry point for `python -m mcp_server`; `__init__.py`
  package metadata. Entry point: `forgeos-mcp` script or `python -m
  mcp_server`. 51 tests, 95% coverage, strict pyright type checking.

- **Custom PostgreSQL container with init scripts** — Self-contained
  PostgreSQL 17 Alpine image at `infra/docker/postgres/` (FORGEOS-DO002).
  Dockerfile bundles an init script (`init.sql`) that creates `uuid-ossp`
  and `pgcrypto` extensions, a least-privilege `forgeos_user` application
  role (NOSUPERUSER, NOCREATEDB, NOCREATEROLE, CONNECTION LIMIT 40), schema
  permissions with default privilege grants for future objects, and
  database-level timeouts (statement 30 s, lock 10 s, idle-txn 5 min).
  Includes a dual healthcheck script (`pg-healthcheck.sh`) that verifies
  both connectivity (`pg_isready`) and query execution (`SELECT 1`).
  Development-tuned PostgreSQL configuration: `shared_buffers=128MB`,
  `work_mem=8MB`, `max_connections=50`, `wal_level=replica`, slow query
  logging at 500 ms. Read-only init scripts (444) and execute-only
  healthcheck (555) for runtime immutability.

- **Environment configuration profiles** — Typed, profile-aware configuration
  system for the ForgeOS platform (FORGEOS-DO004). Three files provide complete
  environment management: `infra/.env.template` (canonical reference for 30+
  variables across 9 categories), `infra/.env.test` (pre-configured test values
  for CI), and `infra/config/settings.py` (frozen `Config` dataclass with
  aggregate validation, profile-aware defaults per environment, production
  enforcement for secrets, and zero external dependencies). A single
  `ENVIRONMENT` variable (`development` | `test` | `production`) drives all
  profile-specific behaviour. `infra/README.md` updated with full variable
  reference, usage examples, and validation instructions.

- **`tickets.graph` MCP tool** — Dependency graph visualization tool
  (TASK-FOS-03-007). Returns the full ticket dependency DAG with nodes
  (complete ticket objects), edges (from `depends_on` relationships), and
  the critical path (longest path from any root to any leaf). Supports
  optional filtering by stage, type, or status. Uses Kahn's BFS algorithm
  (O(V+E)) for cycle detection and topological ordering with dynamic
  programming for critical path computation. Parameterized SQL queries,
  structured pino logging, and Zod schema validation. Performance target:
  < 500 ms for up to 500 tickets
  (`forgeos-server/src/tools/tickets-graph.ts`,
  `forgeos-server/src/tools/index.ts`).

- **`tickets.stats` MCP tool** — Dashboard statistics aggregator returning
  per-stage ticket counts, per-status ticket counts, claim health breakdown
  (healthy/expiring_soon/expired), average time-in-stage per stage, rework
  count distribution, total tickets, and total done. Accepts optional
  `time_range_hours` filter. Six parameterized SQL queries execute in parallel
  via `Promise.all()` for sub-200 ms response time. All-time results cached
  for 5 seconds. Structured error handling with pino logging
  (`forgeos-server/src/tools/tickets-stats.ts`).

- **File-Level Mutex Implementation** — Concurrent file lock management
  module at `forgeos-server/src/db/file-mutex.ts` (TASK-FOS-04-003).
  Provides `acquireFileLocks`, `checkFileConflicts`, `releaseFileLocks`,
  `getActiveLocksForTicket`, and `getActiveLockForFile` functions backed
  by the `file_locks` PostgreSQL table with a partial unique index for
  database-level mutual exclusion. Uses `INSERT ... ON CONFLICT DO NOTHING`
  for atomic lock acquisition with automatic conflict detection and
  rollback. Emits `FILE_LOCKED` / `FILE_UNLOCKED` audit events.
  `FileConflictError` class (HTTP 409) provides structured conflict
  details. 21 tests, 100% statement/function/line coverage, 94% branch
  coverage.

- **Middleware Stack — Logging, Error Handling, Validation** — Express
  middleware pipeline for the ForgeOS MCP server (TASK-FOS-02-003). Includes:
  request ID middleware (`request-id.ts`) generating UUID v4 correlation IDs
  via `X-Request-ID` header; structured JSON request logging (`logging.ts`)
  with pino, measuring duration via `process.hrtime.bigint()`; error handling
  middleware (`error-handler.ts`) mapping PostgreSQL SQLSTATE codes to 14
  ForgeOS error codes with structured `ErrorResponse` JSON, production stack
  trace suppression, and `withErrorHandling<T>` wrapper for MCP tool handlers;
  Zod-based request validation (`validation.ts`) with `validateBody`,
  `validateQuery`, and `validateParams` factory functions returning 400
  responses with field-level error details. 72 tests, 96%+ coverage across
  all middleware files. README updated with Middleware section documenting
  mount order, request flow, error classification, PG error code mapping,
  and validation response format.

- **Database Migration Tooling Evaluation** — Comprehensive research report at
  `docs/research/migration-tooling.md` (FORGEOS-RES012). Evaluates 5 database
  migration tools for ForgeOS (TypeScript/Node.js + PostgreSQL): Alembic,
  Flyway, custom migration runner, node-pg-migrate, and graphile-migrate.
  Weighted comparison matrix across 7 dimensions (language alignment, rollback
  safety, CI integration, JSON migration, PostgreSQL features, community
  health, migration cost). Recommends **phased approach** at 87% confidence:
  Phase 1 — enhance current custom runner with down-migration support (~200
  LOC, 9-15 hours); Phase 2 — migrate to **node-pg-migrate** (score 8.70/10)
  when schema complexity warrants it. Alembic rejected (Python mismatch in
  TypeScript project), Flyway rejected (paywalled rollback, Java dependency).
  Includes rollback safety assessment, CI integration patterns with pipeline
  examples, JSON-to-PostgreSQL data migration compatibility scoring,
  contradiction analysis resolving 3 industry claims, risk register, and
  Bayesian confidence update (60% to 87%).

- **Web Framework and ORM Evaluation** — Comprehensive research report at
  `docs/research/framework-evaluation.md` (FORGEOS-RES011). Evaluates three
  Python web frameworks (FastAPI, Flask, Litestar) and two database access
  approaches (SQLAlchemy async, asyncpg raw) for the ForgeOS Python MCP
  server. Weighted comparison matrices across 8 framework dimensions and
  7 database dimensions. Recommends **FastAPI** (88% confidence) for native
  Starlette/ASGI alignment with MCP Python SDK and **SQLAlchemy async +
  asyncpg driver** (85% confidence) for Alembic migration tooling and hybrid
  query approach. Includes contradiction analysis resolving 4 apparent
  conflicts, 14-risk assessment, Bayesian confidence update (70% → 88%),
  license compatibility matrix, recommended dependency tree, and repository
  health scores for all evaluated libraries.

- **MCP Protocol Adoption Risk Assessment** — Comprehensive risk assessment
  at `docs/research/mcp-risk-assessment.md` (FORGEOS-RES004). Synthesizes
  findings from RES001 (Protocol Spec, 92%), RES002 (Transport Layer, 88%),
  and RES003 (SDK Evaluation, 82%) into a 12-risk register across five
  categories: protocol maturity, SDK dependency, performance under load,
  vendor lock-in, and operational concerns. Each risk includes likelihood,
  impact, mitigation strategy, and residual risk. Go/No-Go recommendation:
  **GO** at 87% confidence (weighted decision matrix score 8.40/10). Includes
  SDK fallback strategy (fork, minimal reimplementation, or protocol migration),
  vendor lock-in analysis (~410 LOC MCP-specific code, 3-5 week switch cost
  with abstraction layer), performance thresholds (comfortable to 50 agents,
  scale at 100+), Bayesian confidence update (70% → 87%), and contradiction
  analysis resolving 4 apparent conflicts in upstream evidence.

- **Quality attributes and performance targets** — Comprehensive quality
  attributes document at `docs/architecture/quality-attributes.md`
  (FORGEOS-ARCH011). Defines latency targets (p50/p95/p99 for 14 operations,
  claim p99 ≤ 100ms), throughput targets (50+ concurrent agents, 1000+ active
  tickets, 200 ops/s mixed workload), availability targets (99.9% SLA,
  RTO < 5 min, RPO < 1 min), 15 correctness invariants across 5 categories
  (claim, state transition, dependency, data integrity, concurrency safety),
  vertical and horizontal scaling paths (up to 100+ agents with PgBouncer),
  resource utilization budgets (memory, CPU, connection pool, storage, network),
  5 quality attribute scenarios (SEI/CMU format), 15 fitness functions, monitoring
  and observability plan, and ADR-011 (correctness-first prioritization). Includes
  latency breakdown budget, scaling decision matrix, and derivation notes.

- **Event sourcing audit trail schema** — Comprehensive event sourcing design
  at `docs/architecture/event-sourcing-schema.md` (FORGEOS-ARCH007). Defines
  enhanced hybrid model: mutable `tickets` table as primary state source with
  append-only `events` table as complete audit trail. Adds 5 new columns
  (sequence_number, aggregate_version, correlation_id, causation_id,
  schema_version), 2 new event types (DONE, REWORKED) for 15 total, per-type
  JSONB payload schemas, two-level sequence numbering (global BIGSERIAL +
  per-ticket INTEGER with UNIQUE constraint), PL/pgSQL replay function for
  time-travel debugging, integrity verification function, three-layer
  immutability enforcement (app + RLS + trigger), event-based LISTEN/NOTIFY
  trigger on `ticket_events` channel, 9 indexes, monthly range partition
  strategy for archival, and Migration 002 DDL. Includes ADR-004, fitness
  functions, DAG task graph, and Well-Architected assessment (8.7/10).
  Schema reference updated with new columns, enum values, indexes, triggers,
  and stored functions.

- **Database index and performance strategy** — Comprehensive indexing strategy
  document at `docs/architecture/database-indexes.md` (FORGEOS-ARCH006).
  Covers 31 indexes across 7 tables: 12 explicit B-tree, 4 GIN (arrays and
  JSONB), 3 partial indexes for hot paths, plus implicit PK/UNIQUE. Documents
  top 10 query patterns with EXPLAIN plan expectations, index sizing
  projections (~764 MB at 100K tickets), maintenance strategy (auto-vacuum
  tuning, REINDEX CONCURRENTLY via pg_cron), anti-patterns, and ADR-004
  (partial indexes, GIN operator class, composite index decisions). Includes
  Well-Architected pillar assessment and 10 fitness functions.

- **Local development Docker Compose documentation** — Comprehensive setup
  guide at `infra/README.md` (FORGEOS-DO001). Covers three-service stack
  (PostgreSQL, MCP Server, pgAdmin), development overlay with hot-reload,
  VS Code debugger attachment, environment variables, secrets management,
  common operations (logs, rebuild, psql access, database reset), and
  troubleshooting. Root README updated with quick-start Docker section.

- **`tickets.next` MCP tool** — Find the next available ticket for a given
  SDLC stage (peek, not claim). Accepts `stage` (required), `type` (optional),
  and `priority` (optional) filters. Returns the highest-priority unclaimed
  ticket as JSON or a null result with descriptive message. Uses parameterized
  SQL with the `idx_tickets_claimable` composite index for sub-50 ms queries.
  Validated via Zod schema with structured pino logging
  (`forgeos-server/src/tools/tickets-next.ts`,
  `forgeos-server/src/tools/index.ts`).

- **REST API OpenAPI 3.1 specification** — Complete OpenAPI 3.1.0 spec for the
  ForgeOS REST API at `docs/architecture/api/openapi-spec.yaml`
  (FORGEOS-ARCH008). Defines 9 endpoints: ticket list with pagination and
  filters, ticket detail, claim, advance, rework, release, event history,
  pipeline stage overview, and health check. Includes WebSocket contract for
  real-time ticket state streaming, dual authentication (Bearer + API key),
  structured error model with 14 machine-readable error codes, and full schema
  alignment with TypeScript types (28-field Ticket, 14-field TicketEvent,
  5 enums). Cross-referenced with database schema (FORGEOS-ARCH005) and
  system architecture (FORGEOS-ARCH001).

- **Docker Compose stack** — Production-ready `docker-compose.yml` with three
  services: `postgres` (PostgreSQL 17 Alpine with healthcheck, persistent
  volume, auto-applied migrations), `pgbouncer` (transaction mode, 50 pool
  size, 200 max connections), and `mcp-server` (built from Dockerfile,
  connects through PgBouncer). Uses Docker file-based secrets for the
  database password. All services restart automatically
  (`forgeos-server/docker-compose.yml`, `forgeos-server/secrets/.gitkeep`).
- **Husky commit-msg hook** — Validates that every commit message starts
  with a ticket ID in `[TICKET-ID]` format
  (`forgeos-server/.husky/commit-msg`,
  `forgeos-server/scripts/validate-commit.sh`). Rejects non-matching
  messages with a clear error showing valid CLAIM and WORK commit
  formats. Bypass with `git commit --no-verify` for emergencies.
- **Dockerfile** — Multi-stage Docker build for the ForgeOS MCP server
  (`forgeos-server/Dockerfile`). Builder stage compiles TypeScript with
  `npm ci`; runtime stage runs as non-root `node` user on Alpine with a
  built-in `HEALTHCHECK` on `/health`. Image expected under 200 MB.
- **.dockerignore** — Build-context exclusion rules that prevent
  `node_modules`, `.git`, `dist`, secrets, and env files from entering the
  image while allowing `README.md` and `.env.example` through.
- **Environment configuration** — Zod-validated config loader (`src/config.ts`)
  with typed `AppConfig` export, `Object.freeze()` immutability, sensible
  defaults (PORT=3000, LOG_LEVEL=info, DEFAULT_LEASE_MINUTES=30), production
  validation for security-critical variables (`WEBHOOK_SECRET`, `ADMIN_API_KEY`),
  and a comprehensive `.env.example` template documenting all 12 environment
  variables.
- **Database schema** — Initial PostgreSQL migration (`001_initial.sql`) with
  7 tables (projects, agents, sessions, tickets, file_locks, events,
  system_config), 5 enum types, 18+ indexes (B-tree, GIN, partial), Row-Level
  Security policies, 10 stored functions (claim, advance, reject, release,
  extend lease, resolve dependencies, release expired claims, notify), and
  triggers for auto-updated timestamps and real-time SSE via `pg_notify`.
- **Database connection pool** (`src/db/pool.ts`) — Lazily-initialized
  `pg.Pool` singleton with configurable max connections (20), idle timeout
  (30 s), and connection timeout (10 s). Includes `healthCheck()` for
  connectivity verification, `setSessionContext()` for PostgreSQL RLS
  session variables, `queryWithRLS()` and `transactionWithRLS()` helpers
  with automatic rollback and slow-query logging (> 1 s threshold).
  Structured pino log events for connection errors, pool exhaustion, and
  client lifecycle.
- **Migration runner** (`src/db/migrate.ts`) — Tracks applied migrations in a
  `schema_migrations` table with SHA-256 checksum verification. Reads `.sql`
  files in lexicographic order, skips already-applied migrations (idempotent),
  and rolls back on failure. Runnable via `npm run migrate` or CLI.
- **Database barrel exports** (`src/db/index.ts`) — Re-exports pool, health
  check, RLS helpers, and migration runner from the `db` module.
- **Schema reference documentation** (`docs/database/schema-reference.md`) —
  Complete reference for all database objects, indexes, functions, and
  relationships.
