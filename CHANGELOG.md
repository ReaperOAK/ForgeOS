# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
