# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Role-Based Claim Restrictions** (FORGEOS-BE055) — Role-stage
  authorization at `mcp-server/src/mcp_server/auth/authorization.py` that
  enforces agents can only claim tickets matching their role's SDLC stage.
  `RoleStagePolicy` maps all 14 agent roles to authorized stages (e.g.
  `backend` → `BACKEND`, `qa` → `QA`). `check_role_stage_authorization()`
  validates role-stage match before claim; mismatches raise
  `RoleStageMismatchError` (HTTP 403) with descriptive error including
  agent role, ticket stage, and authorized stage. Operator role can claim
  on behalf of any agent role via `role_override` parameter. Admin and
  operator roles bypass checks when no override is specified. Policy is
  configurable via constructor overrides and runtime `add_role()` /
  `remove_role()` mutations. Integrated into `TicketService.claim_next()`
  and `claim_by_id()` for both MCP and REST paths. 60 role-stage
  authorization tests, 99% coverage on authorization module.

- **Ticket List REST Endpoint** (FORGEOS-BE034) — `GET /api/tickets` REST
  endpoint at `mcp-server/src/mcp_server/api/routes/tickets.py` with Pydantic
  response schemas at `mcp-server/src/mcp_server/api/schemas.py`. Supports
  filtering by `stage`, `type`, `priority`, `claimed_by`, and `machine_id`
  query parameters. Offset-based pagination via `limit` (default 50, max 200)
  and `offset`. Returns `TicketListResponse` with `tickets` array and
  `PaginationMeta` (`total`, `limit`, `offset`). Enum validation at the API
  boundary returns `400 Bad Request` for invalid filter values. Database
  unavailability returns `503`. `TicketRepository.list_tickets()` uses
  `COUNT(*) OVER()` window function for single-query total count. Route
  mounted in `HTTPTransport.create_app()` with late-binding repo getter
  for degraded-mode support.

- **GitHub Webhook Signature Verification** (FORGEOS-BE060) — HMAC-SHA256
  signature verification for inbound GitHub webhooks at
  `mcp-server/src/mcp_server/webhooks/signature.py` and
  `mcp-server/src/mcp_server/webhooks/github_handler.py`. Verifies the
  `X-Hub-Signature-256` header against the computed HMAC of the request body
  using `hmac.compare_digest()` for constant-time comparison. Secret loaded
  from `GITHUB_WEBHOOK_SECRET` environment variable (never hardcoded).
  Rejects missing signatures with 401 and invalid signatures with 403.
  Extracts GitHub event type from `X-GitHub-Event` header.
  Domain errors: `GitHubSignatureError`, `GitHubSignatureMissingError`.
  Integrated into the webhook receiver at `transport/webhooks.py`.
  100% test coverage (46/46 statements), 40 tests passing.

- **Sync and Validate MCP Tools** (FORGEOS-BE033) — Two MCP tools at
  `mcp-server/src/mcp_server/tools/ticket_tools.py` backed by the
  `SyncEngine` at `mcp-server/src/mcp_server/services/sync_engine.py`.
  `tickets.sync` releases expired leases (via FORGEOS-BE009 lease cleanup),
  evaluates the dependency graph for all BLOCKED tickets, and moves newly
  unblocked tickets to READY. Returns a `SyncResult` summary with released
  and unblocked counts, ticket IDs, and any errors. `tickets.validate`
  performs a full integrity check: verifies each ticket's stage is valid,
  stage belongs to its own `sdlc_flow`, and `sdlc_flow` matches the
  expected flow for the ticket type. Returns a `ValidateResult` with a list
  of `IntegrityError` objects (empty = clean). Frozen dataclasses with
  `__slots__` for all result types. Partial-success semantics for sync
  (errors are recorded but processing continues). Average cyclomatic
  complexity A (2.45). 96/100 CI quality score.

- **Ticket Advance MCP Tool** (FORGEOS-BE030) — `tickets.advance` MCP tool at
  `mcp-server/src/mcp_server/tools/ticket_tools.py` that moves a ticket to its
  next SDLC stage. Pure-domain stage engine at
  `mcp-server/src/mcp_server/services/stage_engine.py` validates transitions
  against the ticket's `sdlc_flow` — no stage skipping, no reordering.
  `TicketService.advance_ticket()` at
  `mcp-server/src/mcp_server/services/ticket_service.py` uses SERIALIZABLE
  transaction isolation for state integrity. Validates the calling agent holds
  the active claim. Creates an `event_history` record of type `STAGE_ADVANCED`
  for every transition. Clears the claim on advance so the ticket is available
  for the next agent. Returns previous stage, new stage, and updated status.
  `InvalidTransitionError` and `ClaimValidationError` exceptions for domain
  error handling. `AdvanceTicketResult` frozen dataclass with `to_dict()`. 77
  tests with 100% coverage on `stage_engine.py` and ~98% on tool/service.

- **Retry Logic and Dead-Letter Handling** (FORGEOS-BE067) — Background
  notification processor at
  `mcp-server/src/mcp_server/notifications/processor.py` with configurable
  exponential-backoff retries and dead-letter handling at
  `mcp-server/src/mcp_server/notifications/queue.py`. `NotificationProcessor`
  runs as an asyncio background task, polling the queue on a configurable
  interval (default 5 s) and dispatching notifications through
  `ChannelDispatcher`. Failed deliveries retry with a schedule-based backoff
  (1 min, 5 min, 15 min, 1 hour) up to a configurable max (default 5).
  Notifications exceeding max retries move to `dead_letter` status.
  `replay_dead_letter()` allows administrators to reset dead-lettered
  notifications to `pending` for redelivery. `ProcessorConfig` frozen
  dataclass controls `poll_interval_seconds`, `batch_size`,
  `backoff_schedule`, and `max_retries`. Graceful shutdown via `stop()`.
  88 tests with 96% coverage.

- **High-Level Ticket Operations API** (FORGEOS-BE045) — Ergonomic async
  API for ticket lifecycle actions at
  `agent-sdk/src/forgeos_sdk/operations.py` with Pydantic v2 data models at
  `agent-sdk/src/forgeos_sdk/models.py`. `TicketOperations` class wraps MCP
  tool calls (`tickets.next`, `tickets.claim`, `tickets.complete`,
  `tickets.reject`, `tickets.release`, `tickets.status`) with typed inputs
  and model outputs. Methods: `claim_next(role)`, `claim(ticket_id)`,
  `advance(ticket_id, evidence)`, `rework(ticket_id, reason)`,
  `release(ticket_id)`, `get_ticket(ticket_id)`. Data models: `Ticket`,
  `Evidence` (with validation), `Claim`, `OperationResult`. All operations
  are async and raise `ToolCallError` on failure. Added Ticket Operations
  section to `agent-sdk/README.md`.

- **Per-Agent Rate Limiting** (FORGEOS-BE042) — Sliding window rate
  limiting middleware at `mcp-server/src/mcp_server/middleware/rate_limiter.py`.
  Tracks requests per agent identity and per machine using an in-memory
  sliding window algorithm. Write operations (claim, advance, reject, release)
  enforce stricter limits (30/min) than read operations (120/min). Responses
  include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
  headers. Rate-limited requests return HTTP 429 with `Retry-After` header
  (JSON-RPC format for MCP paths, standard JSON for REST). Health endpoints
  bypass rate limiting. `RateLimitConfig` frozen dataclass, `SlidingWindowLimiter`
  engine, `RateLimitMiddleware` Starlette integration. 34 tests with 96%
  coverage.

- **Operator Machine-Scoped Permissions** (FORGEOS-BE056) — Operator-machine
  binding enforcement at `mcp-server/src/mcp_server/auth/authorization.py`
  with service orchestration at
  `mcp-server/src/mcp_server/services/operator_service.py`. Operators can only
  perform REST operations on machines they are registered to via the
  `operator_machine_bindings` table (many-to-many). Admin operators bypass all
  binding checks. UPSERT-based `add_binding()` for idempotent registration,
  `remove_binding()` for deletion, `list_bindings()` for enumeration.
  `require_operator_machine_access()` enforces binding or raises
  `MachineScopeError` (HTTP 403). `OperatorMachineBinding` frozen dataclass
  with `__slots__`. Service-layer wrappers: `bind_operator_to_machine()`,
  `unbind_operator_from_machine()`, `get_operator_bindings()`,
  `validate_operator_machine_access()`. Structured logging for all
  authorization decisions. 41 tests passing.

- **Notification Channel Configuration** (FORGEOS-BE066) — Configurable
  notification channels at `mcp-server/src/mcp_server/notifications/channels.py`
  and `config.py`. Supports webhook (generic HTTP POST) and Slack (Block Kit
  formatted incoming webhooks) delivery types. `ChannelStore` provides CRUD
  operations for the `notification_channels` PostgreSQL table with UUID primary
  keys, JSONB config, and text-array event filters. `ChannelDispatcher` routes
  notifications to all enabled channels whose event filter matches the event
  type; delivery failures are isolated per-channel and never block queue
  processing. `ChannelEnvConfig` loader bootstraps channels from
  `FORGEOS_CHANNEL_*` environment variables (JSON format) without database
  access. `ChannelType` enum, `DeliveryResult` class, `WebhookDelivery` and
  `SlackDelivery` protocol implementations. Alembic migration 006 creates the
  `notification_channels` table and `channel_type` enum. 62 tests with 93%
  coverage.

- **Webhook HTTP Receiver Endpoint** (FORGEOS-BE059) — Inbound webhook
  endpoint at `mcp-server/src/mcp_server/transport/webhooks.py` exposing
  `POST /api/webhooks/{source}` for external system integration. Validates
  Content-Type, parses JSON, and runs source-specific payload validation via
  `WebhookService` at `mcp-server/src/mcp_server/services/webhook_service.py`.
  Two built-in sources: `github` (requires `action` field, reads
  `X-GitHub-Event` header) and `custom` (requires `event_type` field).
  Returns 202 Accepted immediately and dispatches processing as a background
  `asyncio.Task`. Handler registry maps (source, event_type) pairs to async
  handlers with per-source default fallbacks. Domain types: `WebhookEvent`
  frozen dataclass, `WebhookSource` enum, `WebhookHandler` type alias.
  Error hierarchy: `WebhookValidationError`, `UnknownSourceError`. 48 tests
  with 98% coverage. Added Webhook Receiver section to `mcp-server/README.md`.

- **Comprehensive Audit Logging** (FORGEOS-BE058) — Append-only audit trail
  for all authenticated MCP tool calls and REST API requests at
  `mcp-server/src/mcp_server/services/audit_service.py`,
  `mcp-server/src/mcp_server/repositories/audit_repo.py`, and
  `mcp-server/src/mcp_server/middleware/audit_middleware.py`. Each entry
  records identity (agent/operator/admin), operation, target resource,
  result (success/failure), source machine, and JSONB metadata (HTTP status,
  duration). `AuditMiddleware` (Starlette) auto-logs every authenticated
  request; `AuditService` provides explicit logging for tool handlers.
  `AuditRepository` enforces append-only semantics — no UPDATE or DELETE.
  Alembic migration 006 creates the `audit_log` table with indexes on
  `identity_id`, `identity_type`, `operation`, and `timestamp`. Query and
  count methods support filters by identity, operation, and time range with
  a 1000-row limit cap. 49 tests with 92% coverage. Added Audit Logging
  section to `mcp-server/README.md`.

- **Ticket Tools — `tickets.release` and `tickets.status`** (FORGEOS-BE032) —
  Two MCP tools at `mcp-server/src/mcp_server/tools/ticket_tools.py`.
  `tickets.release` allows an agent to voluntarily release a claimed ticket
  back to READY, validating claim ownership and creating an event history
  record. `tickets.status` supports two modes: single-ticket detail (full
  ticket data with history and active claim) and filtered listing (by stage,
  type, priority with pagination). Service layer at
  `mcp-server/src/mcp_server/services/ticket_service.py` provides
  `release_ticket()`, `get_ticket_status()`, and `list_tickets()` methods.
  Repository layer adds `list_filtered()` query builder with parameterized
  SQL. Domain types: `ReleaseResult`, `TicketDetail`, `TicketListResult`
  (frozen dataclasses with `__slots__`). 80 tests with 100% pass rate.

- **Ticket Tools — `tickets.claim` MCP Tool** (FORGEOS-BE029) — MCP tool
  handler at `mcp-server/src/mcp_server/tools/ticket_tools.py` that allows
  agents to claim a specific ticket by ID. Accepts `ticket_id`, `agent_id`,
  `machine_id`, `operator`, and optional `lease_duration_minutes` as input
  parameters, validated against JSON Schema. Delegates to
  `TicketService.claim_by_id()` at
  `mcp-server/src/mcp_server/services/ticket_service.py`, which resolves
  the agent role to an SDLC stage via `AgentRoleMap`, validates role-stage
  authorization via `check_role_stage_authorization()`, and calls
  `ClaimQueue.claim_by_id()` for atomic claiming with `SELECT FOR UPDATE
  SKIP LOCKED`. Returns claimed ticket data (ticket_id, title, type, stage,
  file_paths, acceptance_criteria) on success, or structured MCP error when
  the ticket is not claimable, a claim conflict occurs, or the agent role is
  invalid. Concurrent claim attempts on the same ticket result in exactly
  one winner. 105 ticket_tools tests and 210 claim-related tests with 100%
  coverage.

- **Ticket Tools — `tickets.next` MCP Tool** (FORGEOS-BE028) — MCP tool
  handler at `mcp-server/src/mcp_server/tools/ticket_tools.py` that allows
  agents to claim the next available ticket matching their role. Accepts
  `agent_role`, `machine_id`, and `operator` as input parameters, validated
  against JSON Schema. Delegates to the new shared `TicketService` at
  `mcp-server/src/mcp_server/services/ticket_service.py`, which resolves
  the agent role to an SDLC stage via `AgentRoleMap` and calls the SKIP
  LOCKED `ClaimQueue` for atomic claiming. Returns claimed ticket data
  (ticket_id, title, type, stage, file_paths, acceptance_criteria) on
  success, or structured MCP error response when no eligible ticket exists.
  `NextTicketResult` frozen dataclass wraps claim output.
  `register_ticket_tools()` integrates with the dynamic `ToolRegistry`.
  TYPE_CHECKING guard prevents runtime circular imports between tools and
  services. 52 tests with 100% coverage.

- **Expired Lease Detection and Release** (FORGEOS-BE009) — Background cleanup
  task at `mcp-server/src/mcp_server/locking/lease_cleanup.py` that periodically
  scans for expired ticket leases and releases them, making associated tickets
  available for reclaim. `LeaseCleanupTask` runs a configurable scan interval
  (default 30 s) with batch processing (default 100 leases). Each expired lease
  is released atomically: claim fields cleared, status/stage reset to READY,
  and an `event_history` record inserted for audit. Structured logging includes
  `ticket_id`, `agent_id`, and time since last heartbeat. Domain types:
  `LeaseCleanupConfig` (frozen dataclass), `ExpiredLease`, `LeaseRelease`,
  `LeaseCleanupError`. Standalone functions `find_expired_leases`,
  `release_expired_lease`, and `scan_and_release_expired` for single-cycle use.
  Async context manager support. 38 tests with 99% coverage. Added Expired
  Lease Cleanup section to `mcp-server/README.md`.

- **Machine Registration and Verification** (FORGEOS-BE052) — Machine identity
  registration and verification at `mcp-server/src/mcp_server/auth/machine_auth.py`
  with `MachineService` orchestration at
  `mcp-server/src/mcp_server/services/machine_service.py`. Each machine running
  agents registers with a unique `machine_id` (hostname or UUID). Two modes:
  `AUTO` (unknown machines self-register) and `STRICT` (unknown machines
  rejected with 403). UPSERT-based registration for concurrency safety,
  fire-and-forget `last_seen_at` updates, frozen `MachineIdentity` dataclass
  with `__slots__`, and input validation (255-char cap). `MachineService`
  wraps low-level functions with a configured pool and default mode. 50 tests
  with 100% coverage. Added Machine Registration section to
  `mcp-server/README.md`.

- **MCP Server Database Wiring** (FORGEOS-BE018) — Wired the MCP server
  to the PostgreSQL database layer via `mcp_server.dependencies.Dependencies`,
  a frozen dataclass container holding the connection pool and four repository
  instances (`TicketRepository`, `ClaimRepository`, `EventRepository`,
  `AuditRepository`). Server lifespan (`_app_lifespan`) creates the container
  on startup and drains/closes it on shutdown. `AppContext` dataclass exposes
  typed property accessors (`ticket_repo`, `claim_repo`, `event_repo`,
  `db_pool`) for tool handlers — no direct pool access. Degraded mode: when
  `FORGEOS_DB_REQUIRED` is false (default), the server starts without a
  database and database-dependent tools return error responses. Health check
  MCP tool verifies database connectivity through the pool. 25 tests with
  81% coverage.

- **Auth Middleware for MCP and REST** (FORGEOS-BE054) — Unified Starlette
  middleware at `mcp_server/middleware/auth_middleware.py` that authenticates
  both MCP tool calls and REST API requests through a single credential
  pipeline. Extracts API keys from `X-API-Key` or `Authorization: Bearer`
  headers, validates via `mcp_server.auth.agent_auth`, and populates a
  per-request `AuthContext` (frozen dataclass with `identity_type`,
  `identity_id`, `role`, `machine_id`, `agent_name`, `permissions`) via
  `contextvars` for async-safe downstream access. Health and readiness
  endpoints (`/health`, `/healthz`, `/ready`, `/readiness`, `/livez`,
  `/readyz`) are excluded from authentication. Returns MCP-style JSON-RPC
  error for `/mcp` paths and standard HTTP 401 for REST paths. 52 tests
  with ~95% coverage.

- **MCP Client Connection Manager** (FORGEOS-BE044) — Connection lifecycle
  management for the ForgeOS Agent SDK at
  `agent-sdk/src/forgeos_sdk/client.py` and `transport.py`. `ForgeOSClient`
  connects to MCP servers via stdio (local), SSE, or Streamable HTTP
  (remote) transports. Automatic reconnection with exponential backoff
  (initial 1 s, max 30 s, jitter). Session initialization performs the MCP
  `initialize` handshake and captures server capabilities. Session
  resumption sends the previous session ID on reconnect (HTTP transports).
  Clean shutdown cancels pending reconnections and closes transport.
  `ForgeOSClient.from_env()` factory reads `FORGEOS_` environment variables.
  Async context manager support. `ConnectionState` enum tracks lifecycle
  (`DISCONNECTED`, `CONNECTING`, `CONNECTED`, `RECONNECTING`). Transport
  abstraction via `MCPTransport` ABC with `StdioTransport`, `SSETransport`,
  and `StreamableHttpTransport` implementations. `create_transport()` factory
  function. 76 tests with 92% coverage.

- **SDK Error Handling and Configuration** (FORGEOS-BE046) — Extended the
  agent SDK exception hierarchy with four ticket-domain exceptions:
  `ClaimConflictError` (claim blocked by another agent),
  `LeaseExpiredError` (expired claim lease with timestamp),
  `InvalidTransitionError` (invalid SDLC stage transition with from/to
  stages), and `NetworkError` (connection failure with optional
  `retry_after` hint). Added optional `FORGEOS_API_KEY` environment
  variable to `SDKConfig` with blank-value validation. 70 tests with
  97% coverage on changed files.

- **Agent SDK Configuration and Exceptions** (FORGEOS-BE043) — SDK project
  scaffolding with `SDKConfig` (pydantic-settings, `FORGEOS_` prefix),
  `TransportType` enum, and exception hierarchy (`ForgeOSError`,
  `ConnectionError`, `ConfigurationError`, `AuthenticationError`,
  `ToolCallError`). 44 tests with 100% coverage.

- **Concurrent Session Handling** (FORGEOS-BE023) — Async-safe concurrent
  session manager at `mcp-server/src/mcp_server/sessions/concurrent.py`.
  Allows multiple agents to maintain simultaneous active sessions without
  interference. Uses `asyncio.Lock` for all mutable state access and a
  `dict` for O(1) session lookup. Enforces a configurable maximum session
  limit (default 50) with `MaxSessionsExceededError` providing current/max
  counts and retry guidance. Session termination only affects the terminated
  session's resources. Background cleanup loop expires idle and disconnected
  sessions. `ConcurrentSessionConfig` frozen dataclass controls
  `max_concurrent_sessions`, `session_timeout_seconds`,
  `cleanup_interval_seconds`, and `resumption_window_seconds`. Public API:
  `ConcurrentSessionManager`, `ConcurrentSessionConfig`,
  `MaxSessionsExceededError`. 22 tests with 88% coverage.

- **Agent Session Lifecycle Management** (FORGEOS-BE022) — Per-agent session
  tracking for the MCP server at `mcp-server/src/mcp_server/sessions/manager.py`.
  Each connecting agent establishes a session with identity metadata
  (agent_name, role, machine_id), heartbeat tracking, and timeout handling.
  `SessionManager` provides `create_session()`, `heartbeat()`,
  `disconnect_session()`, `resume_session()`, `close_session()`,
  `list_sessions()`, `add_claim()`, `remove_claim()`, and configurable
  cleanup callbacks for expired sessions. Three lifecycle states (ACTIVE,
  DISCONNECTED, EXPIRED) with async background cleanup loop. Thread-safe
  via `threading.Lock`. `SessionConfig` controls timeout (default 300s),
  cleanup interval (30s), and resumption window (120s). Custom exceptions:
  `SessionNotFoundError`, `SessionExpiredError`, `SessionResumeError`.
  58 tests with 98% coverage.

- **Tool Input JSON Schema Validation** (FORGEOS-BE021) — JSON Schema
  validation for MCP tool input parameters at
  `mcp-server/src/mcp_server/tools/validation.py`. Validates tool arguments
  against the tool's registered JSON Schema (Draft 2020-12) before handler
  invocation. Collects all validation errors in a single pass and reports
  them with JSONPath-style field paths (`$.user.name`, `$.tags[0]`) and
  descriptive messages. Error responses follow MCP protocol semantics with
  `INVALID_PARAMS` code (`-32602`). No type coercion — inputs must match
  schema types exactly. Compiled validators are cached per tool name for
  sub-millisecond validation of typical inputs. Public API:
  `validate_tool_input()`, `compile_validator()`,
  `build_validation_error_data()`, `FieldError`, `ToolInputValidationError`,
  `McpValidationErrorData`. 42 tests with 100% coverage.

- **Notification Event Queue** (FORGEOS-BE064) — Async notification delivery
  system at `mcp_server/notifications/queue.py` using PostgreSQL
  `FOR UPDATE SKIP LOCKED` for atomic dequeue. Provides `NotificationQueue`
  with `enqueue()`, `dequeue()`, `mark_delivered()`, `mark_failed()`,
  `get_by_id()`, `get_dead_letters()`, and `count_by_status()`. Five-state
  lifecycle: `pending → processing → delivered | failed → dead_letter`.
  Exponential backoff retry (base 60 s, factor 2, cap 3600 s, max 5 attempts).
  `Notification` frozen dataclass, `NotificationStatus` enum, and
  `InvalidTransitionError` for illegal transitions. Alembic migration 004
  (`20260310_000000_004_notification_queue.py`) creates `notification_status`
  enum, `notification_queue` table with partial index on pending rows, and
  auto-update trigger. 44 tests with 94% coverage.

- **Connection Pool Health Monitoring** (FORGEOS-BE014) — Background health
  monitor for the asyncpg connection pool (`mcp_server/db/health.py`). Provides
  `PoolHealthMonitor` with configurable check interval and max connection
  lifetime, periodic database ping to detect dead connections, automatic stale
  connection recycling when `max_lifetime` is exceeded, and wait-time tracking
  for connection acquisition. Exposes pool health as a frozen `HealthReport`
  dataclass with `to_dict()` for JSON serialization in the `/health` endpoint.
  Reports total, active, idle, and waiting connection counts, pool saturation
  percentage, and average wait time. 56 tests with 96% coverage.

- **Per-Operation Transaction Isolation** (FORGEOS-BE010) — Maps ForgeOS
  operations to PostgreSQL transaction isolation levels at
  `mcp_server/locking/transaction_config.py`. Claim and read operations use
  `READ COMMITTED` (with `SKIP LOCKED` for non-blocking semantics); state
  transitions (advance, rework) use `SERIALIZABLE` to prevent concurrent
  state corruption. `transactional()` async context manager sets the isolation
  level per transaction, with automatic retry on serialization failure
  (SQLSTATE `40001`) using exponential back-off (default 3 retries, 50 ms
  base delay). Enum-based `IsolationLevel` and `OperationType`, frozen
  `OperationIsolation` dataclass with justification strings, `PoolLike`
  Protocol for dependency injection. 49 tests with 100% coverage.

- **File-Level Advisory Lock Mutex** (FORGEOS-BE007) — PostgreSQL advisory lock
  mutex for file-level concurrency control (`mcp_server/locking/file_mutex.py`).
  Provides `FileMutex` with blocking (`acquire`) and non-blocking (`try_acquire`)
  modes, deterministic CRC32-based int64 path hashing with "FORG" namespace,
  observability via `file_locks` table, and conflict detection. Exports
  `FileLockRecord`, `LockAcquireResult`, and `FileConflictError` domain types.
  48 tests with 100% coverage. README documentation added.

- **Ticket Claim Queue with SKIP LOCKED** (FORGEOS-BE006) -- Distributed ticket
  claim queue at `mcp-server/src/mcp_server/locking/claim_queue.py` using
  PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` for fair, non-blocking claim
  semantics. Provides `ClaimQueue` with three async methods: `claim_next()`
  (claim next eligible ticket by stage), `claim_by_id()` (claim a specific
  ticket with file-conflict detection), and `claim_for_role()` (role-based
  stage resolution via `AgentRoleMap`). Returns frozen `ClaimResult` dataclass
  with full ticket metadata. Custom error hierarchy: `ClaimError` (409),
  `NoEligibleTicketError` (404), `LeaseExpiredError` (410). Role-to-stage
  mapping covers all 12 agent roles and 10 ticket types. Stored-function
  delegation keeps all locking logic in PL/pgSQL. Added Ticket Claim Queue
  section to `mcp-server/README.md` with quick-start, method reference,
  data classes, error handling, and design constraints.

- **Health Check and Readiness Probes** (FORGEOS-BE025) — `HealthChecker` class with
  aggregated health reports (status, version, uptime, database pool saturation),
  readiness state machine (`STARTING` / `READY` / `DRAINING`), health status
  classification (`HEALTHY` / `DEGRADED` / `UNHEALTHY`), and database connectivity
  checks with pool metrics. Includes 25 tests at 91% coverage.
- **Repository Pattern Data Access Layer** (FORGEOS-BE013) — Three repository
  classes in `mcp-server/src/mcp_server/repositories/` implementing the
  repository pattern for all database access. `TicketRepository` provides
  `get_by_id`, `list_by_stage`, `list_by_type`, `create`, `update_stage`, and
  `count_by_stage`. `ClaimRepository` provides `create_claim` (atomic via
  `UPDATE … WHERE claimed_by IS NULL`), `release_claim`, `get_active_claim`,
  and `list_expired_claims`. `EventRepository` provides `append_event`,
  `get_events_by_ticket`, `get_events_by_agent`, and
  `get_events_by_timerange`. All repositories accept an asyncpg pool via
  constructor injection, use parameterized SQL exclusively, and return frozen
  dataclasses (`TicketRow`, `ClaimInfo`, `EventRow`). 14 public methods across
  3 classes. 82 tests with 100% coverage and 100% mutation score. Added
  Repository Pattern section to `mcp-server/README.md` with quick-start,
  method reference tables, data classes, and design constraints.

- **Dependency Graph D3.js Visualization** (TASK-FOS-05-003) — Interactive
  force-directed dependency graph at `forgeos-server/src/dashboard/js/graph.js`
  (1554 LOC). Renders ticket DAG with status-based node coloring
  (DONE/READY/BLOCKED/CLAIMED/ESCALATED), priority-based node sizing
  (critical=24px to low=10px radius), directed edges with arrowhead markers,
  and critical-path highlighting via longest-path analysis. Interactive
  features: click-to-open ticket detail panel, zoom/pan via scroll wheel and
  drag, debounced search-by-ID with node centering, hover tooltips, and canvas
  minimap. Real-time updates via SSE with pulse animations and toast
  notifications. Respects `prefers-reduced-motion` by running simulation to
  completion without animation. WCAG 2.2 AA compliant with ARIA labels, focus
  management, and keyboard navigation. Responsive layout with mobile-optimized
  radii and bottom-sheet detail view.

- **Agent-Runner SDK** (TASK-FOS-06-003) — TypeScript wrapper for the
  two-commit Git protocol at `forgeos-server/src/sdk/agent-runner.ts`.
  `AgentRunner` class provides `claimTicket()`, `completeStage()`,
  `releaseTicket()`, `pushWork()`, `validateGitAddPatterns()`, and
  `validateScope()`. Calls MCP tools over HTTP first; automatically falls
  back to `tickets.py` CLI when the server is unreachable
  (`FORGEOS_FALLBACK_ENABLED`). Git safety guards reject `git add .`,
  `git add -A`, `git add --all`, and `git add -a` via
  `ForbiddenGitAddError`. Scope enforcement via `ScopeViolationError`
  ensures staged files stay within ticket `file_paths`. Zod-validated SDK
  configuration in `src/sdk/config.ts`. 32 tests (81% coverage).

- **Event Sourcing Subsystem** (FORGEOS-BE012) — Append-only event store at
  `mcp-server/src/mcp_server/events/` implementing the FORGEOS-ARCH007
  architecture specification. Provides `EventType` enum with 15 lifecycle
  event types and 3 aliases, `Event` frozen dataclass with 14 fields
  (immutable records with monotonic sequencing), pluggable `EventStoreBackend`
  protocol with `InMemoryEventBackend` default, and `EventStore` with
  `append_event`, `get_events_by_ticket/type/agent`, `replay_ticket_events`,
  and `reconstruct_ticket_state`. 53 tests, 97% coverage. Added Event
  Sourcing section to `mcp-server/README.md` documenting event types, fields,
  API reference, backend architecture, and design constraints.

- **Dynamic Tool Registration System** (FORGEOS-BE020) — Runtime MCP tool
  registry at `mcp-server/src/mcp_server/tools/registry.py`. `ToolRegistry`
  class provides `register()` (imperative), `tool()` (decorator),
  `register_all_on()` (FastMCP bridge), plus `get()`, `list_tools()`,
  `list_names()` for lookup. Input schemas validated against JSON Schema
  draft 2020-12 (type: object, no $ref, required ⊆ properties).
  `ToolDefinition` frozen dataclass, `ToolHandler` protocol,
  `DuplicateToolError` / `ToolNotFoundError` exceptions. 37 tests at
  96% coverage. Added Dynamic Tool Registration section to
  `mcp-server/README.md` with quick-start, schema validation, lookup,
  error handling, and public API reference.

- **SSE and Streamable HTTP Transport** (FORGEOS-BE017) — Dual transport layer
  for remote agent communication (`mcp_server/transport/sse.py`,
  `mcp_server/transport/http.py`). SSE transport provides server-to-client
  streaming via Server-Sent Events with client-to-server HTTP POST, connection
  tracking (per-session metadata, idle timeout sweep, max connection limiting),
  and operational endpoints (`/health`, `/connections`). Streamable HTTP
  transport provides the default stateless HTTP POST protocol with optional SSE
  upgrade, configurable session mode (stateful or stateless for horizontal
  scaling), and mount-path support. Both transports use Pydantic `BaseSettings`
  for environment-based configuration (`FORGEOS_SSE_*` / `FORGEOS_HTTP_*`),
  Starlette ASGI composition, and structured logging. Documented transport
  selection, configuration variables, endpoints, connection lifecycle, and API
  reference in `mcp-server/README.md`.

- **Database Seed Script** (FORGEOS-BE005) — Standalone Python CLI at
  `database/seed.py` that imports ticket JSON files from `.github/tickets/`
  (or a custom source) into the PostgreSQL `tickets` table.  Features
  include multi-field validation against the ticket schema, JSON-to-DB
  stage mapping (e.g. `DOCS` to `DOCUMENTATION`), upsert semantics that
  skip duplicates with a warning, `--dry-run` mode for validation without
  writes, configurable `--source` (file or directory) and `--database-url`,
  and structured logging with per-ticket import/skip/fail reporting.
  Sample data at `database/seed_data/sample_tickets.json` provides 7
  representative tickets across 6 types for development environments.
  68 tests with 95 percent coverage.

- **Tri-Modal Backward Compatibility Bridge** (TASK-FOS-07-004) — Added
  `FORGEOS_MODE` environment variable to `.github/tickets.py` enabling three
  operational modes for gradual migration from filesystem to MCP server:
  `"filesystem"` (default, preserves existing behavior), `"dual"` (writes to
  both filesystem and MCP, logs divergences), and `"mcp"` (MCP-only). New
  `MCPClient` class provides HTTP JSON-RPC communication with the ForgeOS MCP
  Server for `tickets.claim`, `tickets.complete`, and `tickets.release`
  operations. Mode-aware dispatch functions (`dispatch_claim`,
  `dispatch_advance`, `dispatch_release`) route operations based on
  `FORGEOS_MODE`. In dual mode, shadow comparison logs divergences at WARNING
  level without failing the operation. MCP unreachability in dual mode falls
  back to filesystem-only with a warning.

- **Agent API Key Authentication** (FORGEOS-BE051) — API key validation,
  generation, and identity resolution for MCP agents
  (`mcp_server/auth/agent_auth.py`). Keys use `fgos_` prefix with 256-bit
  entropy, stored as SHA-256 hashes with prefix-indexed lookups. Validation
  flow: format check → in-memory rate limiting (60 req/min token bucket) →
  prefix DB lookup → constant-time hash comparison (`hmac.compare_digest`) →
  revocation/expiry/agent-status checks. Returns `AgentIdentity` dataclass
  with `agent_id`, `agent_name`, `role`, and `permissions`. Includes
  `create_api_key_for_agent()` for key provisioning, `revoke_api_key()` for
  revocation, and structured audit logging for all auth events. Added
  Authentication section to `mcp-server/README.md` with authentication flow
  diagram, key storage schema, rate limiting configuration, key management
  examples, audit log events, and public API reference.

- **asyncpg Connection Pool** (FORGEOS-BE011) — Production-grade asyncpg
  connection pool for the Python MCP server (`mcp_server/db/pool.py`). Provides
  `ConnectionPool` with async lifecycle management (`initialize()` / `close()`),
  async context manager for connection acquisition (`acquire()`), health-check
  ping (`ping()`), and pool metrics exposure (`stats()` → `PoolStats`). Pool
  configuration loaded from environment variables (`DATABASE_URL`, `POOL_MIN`,
  `POOL_MAX`, `POOL_IDLE_TIMEOUT`, `POOL_COMMAND_TIMEOUT`) via
  `PoolConfig(BaseSettings)`. Idle connections recycled after configurable
  timeout (default 300 s). Fails fast on initialization if database is
  unreachable. 100% test coverage (81 statements, 25 tests). Added Connection
  Pool section to `mcp-server/README.md` with configuration, usage examples,
  API reference, and error handling.

- **Database Indexes and Constraints** (FORGEOS-BE004) — Alembic migration
  003 implementing the index strategy from FORGEOS-ARCH006. Adds 6 new indexes
  (composite B-tree on tickets stage/type/priority, status/stage, stage/claimed_by,
  parent_id; partial B-tree for active claims; FK coverage for file_locks),
  upgrades 2 existing indexes (idx_tickets_claimable with stage leading column,
  idx_claims_active to UNIQUE partial), and adds 2 CHECK constraints
  (lease_duration_minutes > 0, max_reworks >= 0). Full downgrade support
  restores prior index definitions.

- **Structured JSON Logging** (FORGEOS-BE024) — Production-grade structured
  logging module for the Python MCP server (`mcp_server/observability/`). All
  log output is machine-parseable JSON with consistent fields: `timestamp`,
  `level`, `message`, `logger`, and `correlation_id`. Features include
  `StructuredJsonFormatter` (single-line JSON output), `SensitiveDataFilter`
  (redacts passwords, tokens, API keys, DSN credentials from log records),
  `contextvars`-based correlation ID propagation for async request tracing,
  configurable log levels via `FORGEOS_LOG_LEVEL` environment variable, and
  zero external dependencies (stdlib `logging` only). 96% test coverage with
  35 tests. Added Observability section to `mcp-server/README.md` covering
  log schema, configuration, correlation IDs, redaction, and public API.

- **Graceful Shutdown with Request Draining** (FORGEOS-BE026) — Added
  `GracefulShutdownManager` in `mcp-server/src/mcp_server/lifecycle/shutdown.py`
  providing signal-driven (SIGTERM/SIGINT) graceful shutdown for the MCP server.
  Features: thread-safe in-flight request tracking, configurable drain timeout
  (default 30 s), LIFO cleanup callback registry, database pool closure, and a
  `request_scope()` context manager for middleware integration. Includes
  `ShutdownConfig` (validated dataclass), `ShutdownState` enum
  (RUNNING → DRAINING → SHUTDOWN), and `ShutdownError` for rejected requests.
  Added `Graceful Shutdown` section to `mcp-server/README.md` documenting
  configuration, environment variables, lifecycle, and API reference.

- **Operator Workbench and Claims Monitor — UI Design Documentation**
  (FORGEOS-UID004) — Complete mockup specification and component documentation
  for the Operator Workbench dashboard. Includes 7 React components
  (ClaimsMonitorTable, LeaseCountdownTimer, OperatorActionButton,
  ConfirmationModal, MachineStatusCard, AuthUserBadge, OperatorActivityLog),
  4 screens (Claims Monitor, Operator Actions, Machine Status, Activity Log),
  WCAG 2.2 AA accessibility compliance, Mermaid interaction flow diagrams,
  TypeScript interface definitions, responsive breakpoints (mobile/tablet/
  desktop), ForgeOS design token integration, and Google Stitch AI-generated
  screenshot references. Component specs with cross-linked navigation and
  freshness frontmatter added.

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

- **Operator Workbench and Claims Monitor — UI Design Documentation**
  (FORGEOS-UID004) — Complete mockup specification and component documentation
  for the Operator Workbench dashboard. Includes 7 React components
  (ClaimsMonitorTable, LeaseCountdownTimer, OperatorActionButton,
  ConfirmationModal, MachineStatusCard, AuthUserBadge, OperatorActivityLog),
  4 screens (Claims Monitor, Operator Actions, Machine Status, Activity Log),
  WCAG 2.2 AA accessibility compliance, Mermaid interaction flow diagrams,
  TypeScript interface definitions, responsive breakpoints (mobile/tablet/
  desktop), ForgeOS design token integration, and Google Stitch AI-generated
  screenshot references. Component specs with cross-linked navigation and
  freshness frontmatter added.

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
