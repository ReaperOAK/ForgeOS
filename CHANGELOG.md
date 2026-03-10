# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **`tickets.update` MCP Tool — API Reference Update** (TASK-FOS-03-003) —
  Added `tickets.update` subsection to `forgeos-server/README.md` with input
  schema, error codes, handler workflow, response format, and MCP invocation
  example. Fixed `docs/architecture/api/mcp-tool-definitions.md` section 4.6:
  removed undocumented `LEASE_EXPIRED` error code (not present in
  implementation), added missing `message` field to output schema, added
  handler workflow steps, request/response examples, and error response
  schema with timestamps. Implementation file JSDoc verified accurate.

- **tickets.extend Tool Documentation** (TASK-FOS-03-009) — Corrected and
  expanded reference documentation for the `tickets.extend` MCP tool. Fixed
  6 inaccuracies in `docs/architecture/api/mcp-tool-definitions.md` section 4.9:
  added missing `agent_name` required parameter, corrected `duration_minutes`
  range from 1–480 to 5–120 with `.default(30)`, corrected stored function
  signature from 2-parameter to 4-parameter form (`p_ticket_id`, `p_agent_id`,
  `p_agent_name`, `p_duration_minutes`), removed non-existent `TICKET_NOT_FOUND`
  and `LEASE_EXPIRED` error codes, corrected MCP registration description
  string. Added handler workflow (6-step), request/response examples
  (success + two error cases), and implementation file link. New
  `tickets.extend` subsection in `forgeos-server/README.md` with input
  parameters, handler behavior, error codes, response format, and MCP
  invocation example.

- **Dashboard JavaScript Architecture Documentation** (TASK-FOS-05-004) —
  Created `docs/architecture/dashboard-javascript.md` covering the two-module
  architecture (`app.js` + `pipeline.js`), shared `window.ForgeOS` API surface,
  SSE event dispatch with handler registry, Kanban rendering with granular
  DOM updates, lease countdown timers, filter system with URL sync, keyboard
  navigation (WCAG 2.2 AA), operator workbench, claims monitor, and
  multi-machine status. Added comprehensive JSDoc comments to all public
  functions in both `app.js` (2370 lines) and `pipeline.js` (774 lines).

- **Dependency Graph & Search Interface Design Docs** (FORGEOS-UID003) — Added
  freshness-tracking frontmatter (`last_reviewed`, `reviewed_by`, `diataxis:
  reference`) to the mockup specification and both component specs
  (dependency-graph, search-bar). Resolved CI-W001/W002 by adding a Rendering
  Specification subsection with `<mark class="search-highlight">` element,
  token-to-CSS mapping table (`--search-highlight-bg`, `--search-highlight-text`),
  CSS rule example, and disambiguation note separating graph highlight tokens
  from search highlight tokens. Addressed CI-S001 by designating search-bar.md
  §1 Keyboard Navigation as the canonical source with cross-reference note.
  Specification covers interactive DAG visualization (D3.js force-directed
  layout), global search with type-ahead, filter chips, result highlighting,
  responsive breakpoints, and WCAG 2.1 AA accessibility.

- **Core Tables Migration Documentation** (FORGEOS-BE002) — Documented
  `machines`, `operators`, and `claims` tables in
  `docs/database/schema-reference.md` with full column references, ON DELETE
  behaviors, design rationale, 7 new indexes (including 2 partial indexes for
  active claims and expired leases), trigger documentation for
  `trg_machines_last_seen`, `tickets.created_by` column, and updated entity
  relationship diagram. Enhanced `upgrade()` and `downgrade()` docstrings in
  the Alembic migration file. Added migration to Running Migrations table.

- **Event History & Audit Tables Documentation** (FORGEOS-BE003) — Documented
  `event_history` and `stage_transitions` tables in `docs/database/schema-reference.md`
  with full column references, immutability triggers, design rationale, 11 new
  indexes, 2 stored trigger functions, updated entity relationship diagram, and
  Alembic migration instructions. Enhanced `upgrade()` and `downgrade()` docstrings
  in the migration file. Updated `docs/architecture/event-sourcing-schema.md` §13
  with implementation status note linking to the actual Alembic migration.

- **System Health Dashboard Design Specs** (FORGEOS-UID005) — Documentation review
  of the System Health Dashboard mockup and component specification. Added
  freshness-tracking frontmatter (`last_reviewed`, `reviewed_by`, `diataxis`)
  to `docs/uiux/mockups/FORGEOS-UID005.md` and
  `docs/uiux/components/health-panel.md`. Specification covers four health panels
  (Database, MCP Server, Webhooks, Alerts), ten TypeScript component interfaces,
  responsive breakpoints (desktop ≥1024 px, tablet 768–1023 px, mobile <768 px),
  WCAG 2.1 AA accessibility checklist, health-specific design-token extensions,
  and Stitch screenshots for all panels.

- **tickets.spawn Tool Documentation** — Corrected and expanded reference
  documentation for the `tickets.spawn` MCP tool (TASK-FOS-03-006). Fixed
  6 inaccuracies in `docs/architecture/api/mcp-tool-definitions.md` section 4.7:
  `title.minLength` 5→1, `acceptance_criteria` item `minLength` 5→1,
  `priority` default changed from "parent's priority" to `medium`,
  Zod `priority` changed from `.optional()` to `.default('medium')`,
  removed undocumented `NOT_CLAIM_OWNER` and `FILE_CONFLICT` error codes.
  Added child ID generation pattern, initial status logic table, events
  recorded table, and implementation link. New `tickets.spawn` subsection
  in `forgeos-server/README.md` with input parameters, error codes, and
  MCP invocation example.

- **tickets.complete Tool Documentation** — Added complete reference
  documentation for the `tickets.complete` MCP tool (TASK-FOS-03-004).
  New `tickets.complete` section in `forgeos-server/README.md` with input/output
  schemas, error codes, MCP invocation example, and implementation file map.
  Fixed stored function signature in `docs/architecture/api/mcp-tool-definitions.md`
  from 2-parameter to 4-parameter form matching actual implementation. Added
  behavioral description of `advance_ticket()` internals.

- **System Health Dashboard Design Specification** — Complete mockup and
  component specification for the System Health Dashboard view
  (FORGEOS-UID005). Mockup covers 4 health panels — Database (connection
  pool gauge, P50/P99 latency, slow queries), MCP Server (uptime, connected
  agents, requests/min sparkline), Webhooks (success rate donut, pending
  queue, failed deliveries), and Alerts (severity-coded, dismissable).
  Component spec defines 10 TypeScript interfaces (PanelHeader,
  HealthPanelGrid, HealthStatusBanner, SlowQueriesTable, UptimeDisplay,
  TrendIndicator, RetryButton, CountBadge, StatusIndicator, MetricCard)
  with CSS grid layout, responsive breakpoints (mobile/tablet/desktop),
  WCAG-compliant accessibility (ARIA roles, keyboard navigation, contrast
  ratios), and health-specific design token extensions for gauges,
  sparklines, alerts, and donut charts. Stitch screenshot references
  included for desktop and mobile variants.

- **`tickets.release` MCP Tool — API Reference Update** — Updated
  `docs/architecture/api/mcp-tool-definitions.md` section 4.5 to match
  the implementation in `forgeos-server/src/tools/tickets-release.ts`
  (TASK-FOS-03-008). Added missing `agent_name` required parameter.
  Corrected output schema from `released: boolean` to
  `released_file_locks: string[]`. Updated stored function signature to
  five parameters (`p_ticket_id`, `p_agent_id`, `p_agent_name`, `p_reason`,
  `p_force`). Added handler workflow (5-step), three request/response
  examples, and error response schema with timestamps.

- **Database Migration CI Pipeline Documentation** — Enhanced inline YAML
  comments in `.github/workflows/database-ci.yml` explaining trigger path
  filters, concurrency control, minimal permissions, ephemeral service
  container credentials, `PIPESTATUS` error handling, schema validation
  inventory (7 tables, 5 enums, 20 indexes, 3 triggers, 1 function), and
  output variable usage. Created `docs/operations/database-migration-ci.md`
  as a Diataxis Reference document covering pipeline steps, troubleshooting,
  and a how-to guide for adding new migrations (FORGEOS-DO006).

### Changed

- **Root Documentation Updates** — Updated README.md, agents.md, and
  copilot-instructions.md to reflect the MCP-based architecture and
  PostgreSQL backend (TASK-FOS-07-003). README.md now includes a Quick Start
  section (`git clone`, `make setup`, `make up`, dashboard link), describes
  the distributed MCP server + PostgreSQL 17 architecture, lists
  `forgeos-server/`, `mcp-server/`, and `infra/` in the repository structure,
  and links to the live Kanban dashboard at http://localhost:3000/dashboard.
  agents.md Required Boot Sequence includes MCP server connectivity check
  (step 8). agents.md Required Lifecycle section documents 8 MCP tools
  (`tickets.next`, `tickets.claim`, `tickets.advance`, `tickets.release`,
  `tickets.extend`, `tickets.reject`, `tickets.graph`, `tickets.stats`)
  with CLI fallback. copilot-instructions.md Repository Structure includes
  `forgeos-server/` directory tree and Architecture section describes MCP
  server, PostgreSQL, Python MCP server, and real-time dashboard.

### Added

- **Agent Registration and Identity Management** — Admin API endpoints
  for agent lifecycle management (TASK-FOS-04-002). `POST /api/admin/agents`
  creates agent records with generated API keys (plaintext shown once).
  `GET /api/admin/agents` returns paginated agent list (no key hashes).
  `POST /api/admin/agents/:id/revoke` revokes an agent’s API key.
  `DELETE /api/admin/agents/:id` soft-deletes an agent.
  `POST /api/admin/agents/:id/sessions` manages MCP session association.
  All endpoints require `admin.manage_keys` permission. Implementation in
  `forgeos-server/src/auth/registration.ts` (6 functions, 3 Zod schemas,
  3 error classes) and `forgeos-server/src/api/routes/admin.ts` (5 routes).
  30/30 tests passing, tsc strict clean.

- **Container Health Checks and Monitoring Stack** — Health check scripts and
  optional Prometheus + Grafana monitoring for all ForgeOS Docker containers
  (FORGEOS-DO008). PostgreSQL health check verifies connection via pg_isready,
  query execution via SELECT 1, and required extensions. MCP server health
  check verifies the /health endpoint returns HTTP 200 with status ok. Both
  scripts are POSIX-compatible, use configurable environment variables with
  safe defaults, and exit with code 0 (healthy) or 1 (unhealthy). Optional
  monitoring overlay adds Prometheus v2.51.0 and Grafana 11.0.0 with 8 alert
  rules across 4 groups, resource limits, and pre-provisioned dashboards.

- **PostgreSQL Backup and Restore Scripts** — Automated database backup
  and restore tooling at `infra/scripts/` (FORGEOS-DO007). `backup.sh`
  (353 lines) creates timestamped `pg_dump` backups in custom and SQL
  formats with gzip compression, SHA-256 checksum sidecar files, and
  configurable retention-based rotation (default 7 days). Supports local,
  Docker container (`docker exec`), and remote PostgreSQL instances via
  `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` environment variables.
  `restore.sh` (492 lines) validates backup file existence, format
  detection (custom vs SQL), checksum verification, and requires explicit
  database-name confirmation before applying. Provides `--list` (archive
  TOC), `--dry-run` (schema-only trial), and post-restore row-count
  verification. `infra/Makefile` exposes 7 convenience targets: `backup`,
  `backup-sql`, `backup-list`, `restore`, `restore-list`, `restore-dry-run`,
  and `backup-verify`. Comprehensive strategy document at
  `docs/operations/backup-strategy.md` covers backup frequency, 30-day
  retention policy, WAL archiving guidance, point-in-time recovery (PITR),
  and disaster recovery procedures.

- **Dashboard Design System and Layout Specification** — Foundational design
  token system and responsive dashboard layout for ForgeOS (FORGEOS-UID001).
  Design tokens (`docs/uiux/design-tokens.json`) define dark and light themes
  with 24 semantic color tokens each, Inter and JetBrains Mono typography,
  4 px-grid spacing scale, 4 responsive breakpoints (768/1024/1440 px),
  elevation shadows, 8-layer z-index stack, and transition presets with
  reduced-motion support. Layout specification (`docs/uiux/layout-spec.md`)
  defines a 56 px top-bar shell with 48 px filter bar and scrollable main
  content area housing 11 SDLC Kanban columns, responsive behaviour matrix,
  40+ component hierarchy, and WCAG 2.2 AA accessibility annotations. Mockup
  document (`docs/uiux/mockups/FORGEOS-UID001.md`) covers 6 Stitch screens,
  8 component specifications (TicketCard, StageColumn, FilterBar,
  TicketDetailSlideOver, StatusDot, Badge, CountdownTimer,
  CollapsibleSection), 4 user-flow diagrams, and a 10-item accessibility
  checklist.

- **Alembic Migration Framework** — PostgreSQL schema management for ForgeOS
  MCP server (FORGEOS-BE001). Initializes Alembic with async `asyncpg` support
  via `alembic/env.py`, `DATABASE_URL` environment variable as the single
  connection source, and a timestamped migration template
  (`alembic/script.py.mako`). Initial migration (revision 001) creates 5 enum
  types (`ticket_status`, `ticket_type`, `ticket_priority`,
  `sdlc_stage`, `agent_type`), 7 tables (`tickets`, `ticket_events`,
  `agents`, `agent_assignments`, `sdlc_transitions`, `system_config`,
  `audit_log`), auto-update triggers, and B-tree / GIN / partial indexes.
  `DatabaseConfig` pydantic-settings model with URL-format converters for
  asyncpg and psycopg2, async and sync engine factories, and migration helper
  utilities for enum DDL, trigger DDL, and index DDL. Includes comprehensive
  NumPy-style docstrings on all 16 public exports. 101 tests, 100% coverage
  on new code.

- **Development Tooling and Makefile** — Developer ergonomics tooling for the
  ForgeOS platform (FORGEOS-DO003). Root `Makefile` provides 23 self-documenting
  targets covering the full development lifecycle: service management (`up`,
  `down`, `restart`, `ps`, `logs`), database operations (`migrate`, `seed`,
  `db-shell`, `db-reset`), build (`build`, `build-server`), quality (`test`,
  `test-watch`, `test-coverage`, `lint`, `typecheck`, `format`), and setup /
  cleanup (`setup`, `clean`, `clean-all`). `make help` auto-extracts
  descriptions from all targets. `infra/scripts/setup.sh` checks 7
  prerequisites (Docker, Docker Compose, Node.js >= 22, npm, Python 3, Git,
  Make) with version validation, creates `.env` from template, installs
  Node.js dependencies, and provisions default Docker secrets.
  `infra/scripts/seed.sh` wraps the TypeScript seed module with Docker and
  local execution modes, service readiness checks, bounded DB wait loop, and
  optional ticket JSON import.

- **GitHub Actions CI Workflow for MCP Server** — Continuous integration
  pipeline at `.github/workflows/mcp-server-ci.yml` (FORGEOS-DO005). Triggers
  on push to `main` and pull requests with path filters for `forgeos-server/`,
  `mcp-server/`, and the workflow file itself. Six parallel jobs: TypeScript
  lint and type check (Node.js 22, `npm run lint` + `npm run typecheck`),
  TypeScript tests with coverage (Vitest + PostgreSQL 17 Alpine service
  container), Python lint and type check (ruff + pyright), Python tests with
  coverage (pytest + PostgreSQL 17 Alpine service container), Docker build
  verification (multi-stage build, no push), and a CI gate aggregation job
  that fails the pipeline if any upstream job fails. Uses concurrency control
  (`cancel-in-progress: true`), minimal permissions (`contents: read`),
  deterministic installs (`npm ci`, `pip install -e ".[dev]"`), dependency
  caching (npm, pip, Docker GHA layer cache), health-checked PostgreSQL
  service containers with `pg_isready`, and 7-day coverage artifact retention.
  All individual job timeouts under 10 minutes. CI gate job produces a
  GitHub Step Summary with pass/fail status.

- **Dashboard Design System and Layout Specification** — Foundational design
  token system and responsive dashboard layout for ForgeOS (FORGEOS-UID001).
  Design tokens (`docs/uiux/design-tokens.json`) define dark and light themes
  with 24 semantic color tokens each, Inter and JetBrains Mono typography,
  4 px-grid spacing scale, 4 responsive breakpoints (768/1024/1440 px),
  elevation shadows, 8-layer z-index stack, and transition presets with
  reduced-motion support. Layout specification (`docs/uiux/layout-spec.md`)
  defines a 56 px top-bar shell with 48 px filter bar and scrollable main
  content area housing 11 SDLC Kanban columns, responsive behaviour matrix,
  40+ component hierarchy, and WCAG 2.2 AA accessibility annotations. Mockup
  document (`docs/uiux/mockups/FORGEOS-UID001.md`) covers 6 Stitch screens,
  8 component specifications (TicketCard, StageColumn, FilterBar,
  TicketDetailSlideOver, StatusDot, Badge, CountdownTimer,
  CollapsibleSection), 4 user-flow diagrams, and a 10-item accessibility
  checklist.

- **Webhook State Recovery Endpoint** — GitHub push webhook receiver and
  ghost commit recovery system at `forgeos-server/src/webhooks/`
  (TASK-FOS-06-004). `POST /api/webhooks/github` accepts GitHub push
  event payloads, verifies HMAC-SHA256 signatures using `WEBHOOK_SECRET`,
  parses commit messages to extract ticket operations (CLAIM and WORK
  patterns via regex), and reconciles database state with Git state.
  Four reconciliation rules: (1) Git CLAIM without DB claim creates
  claim, (2) Git WORK without DB advance advances ticket, (3) expired
  lease without Git commit releases claim, (4) ambiguous state logs
  warning for admin. Recovery endpoint (`POST /api/webhooks/github/recover`)
  replays reconciliation from missed commits. Periodic sweep releases
  expired claims at configurable interval (default 300 s). All operations
  are idempotent. Three modules: `github.ts` (router factory, HMAC
  verification), `parser.ts` (pure commit message parsing), and
  `reconciliation.ts` (state reconciliation engine). 72 tests, 94.88%
  coverage.

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
