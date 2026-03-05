# MCP Server Core Tickets

## TASK-FOS-02-001: MCP Server Scaffold and Project Setup

**Type:** backend
**Priority:** critical
**Dependencies:**
**Files:** forgeos-server/package.json, forgeos-server/tsconfig.json, forgeos-server/src/index.ts, forgeos-server/src/server.ts

### Description
Initialize the ForgeOS MCP server project. Create package.json with all required dependencies: @modelcontextprotocol/server, @modelcontextprotocol/node, pg, zod (v4), express, @types/express, @types/pg, typescript, tsx, @octokit/webhooks, d3 (CDN — no npm install needed for dashboard). Create tsconfig.json with TypeScript strict mode enabled (strict: true, all strict flags). Create the entry point (index.ts) that boots Express, creates the MCP server via factory function, sets up Streamable HTTP transport with session management, registers the health endpoint, and starts listening on configurable PORT (default 3000). Create server.ts as the MCP server factory function that will later register all tools. Implement graceful shutdown that drains in-flight requests on SIGTERM/SIGINT.

### Acceptance Criteria
- [ ] package.json includes @modelcontextprotocol/server, @modelcontextprotocol/node, pg, zod, express as production dependencies
- [ ] package.json includes typescript, @types/express, @types/pg, tsx as dev dependencies
- [ ] package.json has scripts: build (tsc), dev (tsx watch), start (node dist/index.js), migrate, seed, import
- [ ] tsconfig.json has strict: true, target ES2022, module NodeNext, outDir dist, rootDir src
- [ ] index.ts boots Express app, creates MCP server from factory, and listens on PORT env var (default 3000)
- [ ] Streamable HTTP transport configured with session ID generator and session map for stateful sessions
- [ ] GET /health endpoint returns {status: "ok", uptime: N, timestamp: ISO8601} (DB check added later)
- [ ] Graceful shutdown handler on SIGTERM/SIGINT closes server and pool connections
- [ ] Server logs startup message with port number using structured JSON logging

---

## TASK-FOS-02-002: TypeScript Type Definitions

**Type:** backend
**Priority:** critical
**Dependencies:**
**Files:** forgeos-server/src/types/index.ts, forgeos-server/src/types/tools.ts, forgeos-server/src/types/events.ts

### Description
Define all shared TypeScript interfaces and type aliases for ForgeOS as specified in Architecture §4.1. This includes: domain model types (Ticket, TicketEvent, Agent, FileLock, Session, Project), enum-like union types (TicketStatus, TicketStage, TicketType, TicketPriority, EventType), MCP tool input/output types for all 10 tools (TicketsNextInput/Output, TicketsClaimInput/Output, etc.), authentication types (AgentIdentity, ApiKeyRecord), SSE event types (SSETicketEvent), error types (ForgeOSError enum, ErrorResponse), and SDLC flow type helpers. All types must be exported and usable across the codebase.

### Acceptance Criteria
- [ ] TicketStatus type includes: READY, BLOCKED, CLAIMED, IN_PROGRESS, DONE, FAILED, ESCALATED
- [ ] TicketStage type includes all 13 stages: READY through DONE including PRODUCT_MANAGER and UI_DESIGN
- [ ] TicketType type includes all 10 types: backend, frontend, fullstack, infra, security, docs, research, architecture, product, design
- [ ] Ticket interface has all 28 fields matching Architecture §4.1 (id, ticket_id, project_id, title, description, type, priority, status, stage, sdlc_flow, claimed_by, claimed_by_name, machine_id, operator, lease_expiry, lease_duration_minutes, depends_on, file_paths, acceptance_criteria, tags, rework_count, max_reworks, metadata, parent_id, source_task_file, created_at, updated_at, completed_at)
- [ ] All 10 MCP tool input/output type pairs defined (TicketsNextInput/Output through TicketsStatsOutput)
- [ ] ForgeOSError enum includes all 13 error codes from Architecture §4.4
- [ ] ErrorResponse interface includes error, message, details, ticket_id, timestamp fields
- [ ] All types exported from index.ts barrel file

---

## TASK-FOS-02-003: Middleware Stack — Logging, Error Handling, Validation

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-02-001, TASK-FOS-02-002
**Files:** forgeos-server/src/middleware/logging.ts, forgeos-server/src/middleware/error-handler.ts, forgeos-server/src/middleware/request-id.ts

### Description
Implement the Express middleware stack as specified in Architecture §4.3. Request ID middleware generates or extracts X-Request-ID header for correlation across logs. Structured logging middleware logs every request/response with: timestamp, method, path, status code, duration_ms, request_id, agent_name (if authenticated), and user_agent. Error handling middleware catches all unhandled errors, maps PostgreSQL error codes to ForgeOSError codes, and returns structured ErrorResponse JSON. Include a withErrorHandling wrapper function for MCP tool handlers that catches errors and returns them as structured MCP text content responses.

### Acceptance Criteria
- [ ] Request ID middleware generates UUID v4 for X-Request-ID if not present in request headers
- [ ] Logging middleware emits JSON-structured log lines with timestamp, method, path, statusCode, durationMs, requestId
- [ ] Logging middleware measures request duration using process.hrtime or performance.now
- [ ] Error handler middleware catches errors, maps pg error codes to ForgeOSError enum values, returns ErrorResponse JSON
- [ ] Error handler never leaks stack traces in production (NODE_ENV=production)
- [ ] withErrorHandling<T> wrapper function catches errors in MCP tool handlers and returns {content: [{type: "text", text: JSON.stringify(errorResponse)}]}
- [ ] All middleware functions are exported and can be mounted on Express app in correct order
