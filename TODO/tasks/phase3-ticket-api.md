# Phase 3 — Ticket API L3 Tickets

Source blocks: BLK-06-01 (MCP Tool Operations), BLK-06-02 (REST API Endpoints), BLK-06-03 (Real-time Streaming & Operational Features)

---

## FORGEOS-BE028: Implement tickets.next MCP Tool

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE020, FORGEOS-BE021, FORGEOS-BE006
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/tools/__init__.py, mcp-server/src/services/ticket_service.py, mcp-server/src/services/__init__.py
**Tags:** backend, mcp, tools, claim, skipLocked, phase3, BLK-06-01

### Description

Implement the `tickets.next` MCP tool that allows agents to claim the next available ticket matching their role. This tool uses the SKIP LOCKED claim queue from FORGEOS-BE006 to atomically select and lock an eligible ticket. The tool registers via the dynamic tool registration system (FORGEOS-BE020) with JSON Schema validation (FORGEOS-BE021). Create the shared ticket service layer that both MCP tools and REST endpoints will consume.

### Acceptance Criteria

- [ ] `tickets.next` MCP tool registered with the dynamic tool registry
- [ ] Tool accepts agent_role, machine_id, and operator as input parameters
- [ ] Input parameters validated against JSON Schema definitions
- [ ] Tool calls the claim queue to atomically claim the next READY ticket matching the agent role
- [ ] Returns claimed ticket data (ticket_id, title, type, stage, file_paths, acceptance_criteria) on success
- [ ] Returns structured MCP error response when no eligible tickets exist
- [ ] Ticket service layer created as shared module consumed by both MCP and REST layers

---

## FORGEOS-BE029: Implement tickets.claim MCP Tool

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE028
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/services/ticket_service.py
**Tags:** backend, mcp, tools, claim, phase3, BLK-06-01

### Description

Implement the `tickets.claim` MCP tool that allows agents to claim a specific ticket by ID. Unlike `tickets.next` which auto-selects, this tool targets a known ticket. The tool validates that the ticket exists, is in the READY stage, and the requesting agent's role matches the ticket's current SDLC stage. Uses the same service layer as `tickets.next`.

### Acceptance Criteria

- [ ] `tickets.claim` MCP tool registered with the dynamic tool registry
- [ ] Tool accepts ticket_id, agent_id, machine_id, and operator as input parameters
- [ ] Tool validates that the target ticket exists and is in READY stage
- [ ] Tool validates that the agent role matches the ticket's expected SDLC stage
- [ ] Concurrent claim attempts on the same ticket result in exactly one winner
- [ ] Returns claimed ticket data on success, MCP error on conflict or invalid state
- [ ] Lease expiry set according to configurable lease_duration_minutes

---

## FORGEOS-BE030: Implement tickets.advance MCP Tool

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE028, FORGEOS-BE010, FORGEOS-BE012
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/services/ticket_service.py, mcp-server/src/services/stage_engine.py
**Tags:** backend, mcp, tools, advance, sdlc, phase3, BLK-06-01

### Description

Implement the `tickets.advance` MCP tool that moves a ticket to its next SDLC stage. The tool enforces the SDLC flow order per ticket type (backend, frontend, fullstack, etc.) and uses SERIALIZABLE transaction isolation (FORGEOS-BE010) for state transition integrity. Creates an event history record (FORGEOS-BE012) for every transition. Implements the stage engine that validates transitions against the ticket's sdlc_flow.

### Acceptance Criteria

- [ ] `tickets.advance` MCP tool registered with the dynamic tool registry
- [ ] Tool accepts ticket_id, agent_id, and completion evidence as input
- [ ] Tool validates the agent currently holds the claim on the specified ticket
- [ ] Stage engine enforces SDLC flow order per ticket type (no stage skipping)
- [ ] State transition uses SERIALIZABLE transaction isolation for integrity
- [ ] Event history record created for every stage transition with agent, timestamp, and metadata
- [ ] Returns updated ticket data with new stage on success, MCP error on invalid transition

---

## FORGEOS-BE031: Implement tickets.rework MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE030
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/services/ticket_service.py
**Tags:** backend, mcp, tools, rework, phase3, BLK-06-01

### Description

Implement the `tickets.rework` MCP tool that returns a ticket to its implementation stage with rejection evidence. The tool enforces the maximum rework count (3 attempts). When rework_count reaches 3, the ticket is escalated rather than reworked. The rework operation releases the current claim, increments the rework counter, and moves the ticket back to the appropriate implementation stage.

### Acceptance Criteria

- [ ] `tickets.rework` MCP tool registered with the dynamic tool registry
- [ ] Tool accepts ticket_id, agent_id, and rejection_reason as input parameters
- [ ] Tool validates the requesting agent holds the claim on the ticket
- [ ] Rework count incremented and checked against maximum of 3
- [ ] When rework_count < 3, ticket moves back to implementation stage per its type
- [ ] When rework_count >= 3, ticket moves to ESCALATED state
- [ ] Rejection reason recorded in event history with full context
- [ ] Current claim released on successful rework

---

## FORGEOS-BE032: Implement tickets.release and tickets.status Tools

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE028
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/services/ticket_service.py
**Tags:** backend, mcp, tools, release, status, phase3, BLK-06-01

### Description

Implement two MCP tools: `tickets.release` to voluntarily release a claim before completion, and `tickets.status` to query the current state of a ticket or all tickets. `tickets.release` moves the ticket back to READY and clears the claim. `tickets.status` supports querying by ticket_id for detail or by filters (stage, type, priority) for listing.

### Acceptance Criteria

- [ ] `tickets.release` MCP tool registered and accepts ticket_id and agent_id
- [ ] Release validates the requesting agent holds the active claim
- [ ] Released ticket moves back to READY stage with claim cleared
- [ ] Release creates an event history record with release reason
- [ ] `tickets.status` MCP tool registered and accepts optional ticket_id or filter parameters
- [ ] Status with ticket_id returns full ticket detail including history and current claim
- [ ] Status with filters returns a paginated list of matching tickets

---

## FORGEOS-BE033: Implement tickets.sync and tickets.validate Tools

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE028, FORGEOS-BE013, FORGEOS-BE009
**Files:** mcp-server/src/tools/ticket_tools.py, mcp-server/src/services/ticket_service.py, mcp-server/src/services/sync_engine.py
**Tags:** backend, mcp, tools, sync, validate, dependencies, phase3, BLK-06-01

### Description

Implement two MCP tools: `tickets.sync` for dependency resolution and `tickets.validate` for integrity checking. `tickets.sync` evaluates all ticket dependencies, releases expired leases (FORGEOS-BE009), and moves newly unblocked tickets to READY. `tickets.validate` performs a full integrity check: every ticket exists in exactly one stage directory equivalent, stage field matches, SDLC flows are valid, and no orphans exist.

### Acceptance Criteria

- [ ] `tickets.sync` MCP tool registered and callable
- [ ] Sync releases all expired leases using the lease detection from FORGEOS-BE009
- [ ] Sync evaluates dependency graph for all non-DONE tickets
- [ ] Tickets with all dependencies in DONE are moved to READY stage
- [ ] Sync returns a summary of changes made (released, unblocked, errors)
- [ ] `tickets.validate` MCP tool registered and callable
- [ ] Validate checks each ticket exists in exactly one stage, stage field matches, and SDLC flow is valid
- [ ] Validate returns a list of integrity errors (empty list means clean)

---

## FORGEOS-BE034: Implement Ticket List REST Endpoint

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE028, FORGEOS-BE017
**Files:** mcp-server/src/api/routes/tickets.py, mcp-server/src/api/routes/__init__.py, mcp-server/src/api/__init__.py, mcp-server/src/api/schemas.py
**Tags:** backend, rest, api, tickets, list, filtering, phase3, BLK-06-02

### Description

Implement the `GET /api/tickets` REST endpoint for listing tickets with filtering and pagination. The endpoint shares the ticket service layer created in FORGEOS-BE028. Supports filtering by stage, type, priority, claimed_by, and machine_id. Implement cursor-based or offset-based pagination. Create Pydantic response/request schemas. Mount the ASGI API routes on the HTTP transport from FORGEOS-BE017.

### Acceptance Criteria

- [ ] GET /api/tickets endpoint returns a paginated list of tickets
- [ ] Filtering supported by query parameters: stage, type, priority, claimed_by, machine_id
- [ ] Pagination via offset/limit or cursor with total count in response
- [ ] Response schema defined with Pydantic models (TicketListResponse, TicketSummary)
- [ ] API routes mounted on the existing HTTP/SSE transport server
- [ ] Empty filter returns all tickets; invalid filter values return 400 Bad Request

---

## FORGEOS-BE035: Implement Ticket Detail and History Endpoints

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE034, FORGEOS-BE012
**Files:** mcp-server/src/api/routes/tickets.py, mcp-server/src/api/schemas.py
**Tags:** backend, rest, api, tickets, detail, history, phase3, BLK-06-02

### Description

Implement `GET /api/tickets/:id` for ticket detail and `GET /api/tickets/:id/history` for the event log. The detail endpoint returns the full ticket with current claim info, acceptance criteria, and dependencies. The history endpoint returns the event sourcing log (FORGEOS-BE012) as a timeline of all state changes for the ticket.

### Acceptance Criteria

- [ ] GET /api/tickets/:id returns full ticket detail with current claim and dependency status
- [ ] Response includes resolved dependency information (which deps are DONE vs pending)
- [ ] GET /api/tickets/:id/history returns chronological event log for the ticket
- [ ] History entries include event_type, agent, machine, timestamp, and metadata
- [ ] Non-existent ticket_id returns 404 Not Found with descriptive message
- [ ] Response schemas defined with Pydantic models (TicketDetailResponse, HistoryEntry)

---

## FORGEOS-BE036: Implement Ticket Claim REST Endpoint

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE029, FORGEOS-BE034
**Files:** mcp-server/src/api/routes/tickets.py, mcp-server/src/api/schemas.py
**Tags:** backend, rest, api, tickets, claim, phase3, BLK-06-02

### Description

Implement `POST /api/tickets/:id/claim` REST endpoint for claiming a specific ticket via the dashboard or external integrations. The endpoint delegates to the same ticket service layer used by the MCP `tickets.claim` tool. Accepts agent_id, machine_id, and operator in the request body.

### Acceptance Criteria

- [ ] POST /api/tickets/:id/claim accepts agent_id, machine_id, and operator in request body
- [ ] Endpoint delegates to the shared ticket service (same logic as MCP tickets.claim)
- [ ] Returns 200 with claimed ticket data on success
- [ ] Returns 409 Conflict when ticket is already claimed by another agent
- [ ] Returns 400 Bad Request when ticket is not in READY stage
- [ ] Returns 404 Not Found when ticket_id does not exist
- [ ] Request body validated with Pydantic schema (ClaimRequest)

---

## FORGEOS-BE037: Implement Ticket Advance and Rework REST Endpoints

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE030, FORGEOS-BE031, FORGEOS-BE034
**Files:** mcp-server/src/api/routes/tickets.py, mcp-server/src/api/schemas.py
**Tags:** backend, rest, api, tickets, advance, rework, phase3, BLK-06-02

### Description

Implement `POST /api/tickets/:id/advance` and `POST /api/tickets/:id/rework` REST endpoints. These delegate to the same service layer as MCP tools `tickets.advance` (FORGEOS-BE030) and `tickets.rework` (FORGEOS-BE031). Advance accepts completion evidence; rework accepts rejection reason.

### Acceptance Criteria

- [ ] POST /api/tickets/:id/advance accepts agent_id and evidence in request body
- [ ] Advance endpoint delegates to the shared ticket service advance logic
- [ ] Returns 200 with updated ticket on success, 400/409 on invalid state or agent mismatch
- [ ] POST /api/tickets/:id/rework accepts agent_id and rejection_reason in request body
- [ ] Rework endpoint delegates to the shared ticket service rework logic
- [ ] Returns 200 with reworked ticket on success, 409 when rework_count >= 3 (escalated)
- [ ] Both endpoints create event history records

---

## FORGEOS-BE038: Implement Pipeline Overview and Health Endpoints

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE034
**Files:** mcp-server/src/api/routes/pipeline.py, mcp-server/src/api/routes/health.py, mcp-server/src/api/schemas.py
**Tags:** backend, rest, api, pipeline, health, phase3, BLK-06-02

### Description

Implement `GET /api/stages` for a pipeline overview showing ticket counts per stage, and `GET /api/health` for server health status. The stages endpoint returns an aggregated view suitable for a Kanban-style dashboard. The health endpoint returns server uptime, database connection status, and active session count.

### Acceptance Criteria

- [ ] GET /api/stages returns per-stage ticket counts and summary statistics
- [ ] Response includes stage name, ticket count, active claims count, and blocked count per stage
- [ ] GET /api/health returns server status, uptime, database connectivity, and active MCP sessions
- [ ] Health endpoint returns 200 when healthy, 503 when database is unreachable
- [ ] Both endpoints are lightweight and cacheable (no expensive queries)
- [ ] Response schemas defined with Pydantic models (PipelineResponse, HealthResponse)

---

## FORGEOS-BE039: Implement WebSocket Ticket State Streaming

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE034, FORGEOS-BE012
**Files:** mcp-server/src/api/routes/websocket.py, mcp-server/src/services/event_broadcaster.py
**Tags:** backend, websocket, streaming, realtime, phase3, BLK-06-03

### Description

Implement the WebSocket endpoint at `/ws/tickets` that streams real-time ticket state changes to connected dashboard clients. Create an event broadcaster service that subscribes to ticket state change events from the event sourcing subsystem (FORGEOS-BE012) and pushes them to all connected WebSocket clients. Handle connection lifecycle including authentication, keep-alive pings, and clean disconnection.

### Acceptance Criteria

- [ ] WebSocket endpoint at /ws/tickets accepts client connections
- [ ] Event broadcaster subscribes to ticket state change events from the event subsystem
- [ ] State changes are broadcast to all connected WebSocket clients in real-time
- [ ] WebSocket messages use a defined JSON format with event_type, ticket_id, and payload
- [ ] Keep-alive ping/pong mechanism prevents idle disconnections
- [ ] Clean disconnection handling removes client from broadcast list

---

## FORGEOS-BE040: Implement Filtered WebSocket Subscriptions

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE039
**Files:** mcp-server/src/api/routes/websocket.py, mcp-server/src/services/event_broadcaster.py
**Tags:** backend, websocket, filtering, subscriptions, phase3, BLK-06-03

### Description

Extend the WebSocket streaming from FORGEOS-BE039 to support client-side filter subscriptions. Clients can subscribe to filtered streams (by stage, type, agent, or ticket_id) to receive only relevant events. Implement subscription management: clients send subscribe/unsubscribe messages to control their filter set.

### Acceptance Criteria

- [ ] Clients can send subscribe messages with filter criteria (stage, type, agent_id, ticket_id)
- [ ] Clients can send unsubscribe messages to remove filters
- [ ] Filtered clients receive only events matching their subscription criteria
- [ ] Multiple simultaneous filters are combined with OR logic (any match passes)
- [ ] Default behavior (no subscription) receives all events
- [ ] Backpressure management drops oldest events for slow consumers after buffer limit

---

## FORGEOS-BE041: Implement Idempotency Keys for Operations

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE028, FORGEOS-BE030
**Files:** mcp-server/src/middleware/idempotency.py, mcp-server/src/middleware/__init__.py
**Tags:** backend, idempotency, reliability, phase3, BLK-06-03

### Description

Implement idempotency keys for claim and advance operations to prevent duplicate processing from retries. Clients include an idempotency key header or parameter. The server stores the key and its result; replayed requests return the cached result without re-executing. Keys expire after a configurable TTL.

### Acceptance Criteria

- [ ] Idempotency key accepted as header (Idempotency-Key) or request parameter
- [ ] First request with a key executes normally and caches the result
- [ ] Subsequent requests with the same key return the cached result without re-execution
- [ ] Idempotency records stored in PostgreSQL with ticket_id, key, result, and created_at
- [ ] Keys expire after a configurable TTL (default 24 hours)
- [ ] Missing idempotency key on claim/advance operations is allowed but logged as a warning

---

## FORGEOS-BE042: Implement Per-Agent Rate Limiting

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE028, FORGEOS-BE022
**Files:** mcp-server/src/middleware/rate_limiter.py
**Tags:** backend, ratelimit, security, phase3, BLK-06-03

### Description

Implement per-agent and per-machine rate limiting for MCP tool calls and REST API endpoints. Use a sliding window algorithm backed by PostgreSQL or in-memory storage. Different rate limits apply based on operation type: claim operations are more restrictive than status queries. Rate limit headers are included in responses.

### Acceptance Criteria

- [ ] Rate limiter tracks requests per agent identity and per machine
- [ ] Sliding window algorithm enforces configurable limits per time window
- [ ] Claim/advance operations have stricter limits than read operations (status, list)
- [ ] Rate limit exceeded returns MCP error or HTTP 429 with Retry-After header
- [ ] Rate limit headers included in responses (X-RateLimit-Limit, X-RateLimit-Remaining)
- [ ] Rate limits configurable via environment variables or server configuration
