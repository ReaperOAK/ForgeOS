# Phase 2 — MCP Server L3 Tickets

Source blocks: BLK-04-01 (MCP Server Framework & Transport), BLK-04-02 (Tool Registration & Session Management), BLK-04-03 (Server Observability & Operations)

---

## FORGEOS-BE015: Initialize MCP Server with Python SDK

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-ARCH009, FORGEOS-ARCH003
**Files:** mcp-server/src/server.py, mcp-server/src/__init__.py, mcp-server/pyproject.toml, mcp-server/README.md
**Tags:** backend, mcp, server, sdk, phase2, BLK-04-01

### Description

Set up the foundational MCP server using the official Python MCP SDK (mcp package). Initialize the project structure with pyproject.toml (dependencies, scripts, metadata), create the main server module with the bootstrap sequence (configuration loading, SDK initialization, server start), and configure basic error handling following MCP protocol error semantics. The server must start, accept initialize requests, and respond with its capability list.

### Acceptance Criteria

- [ ] pyproject.toml defines project metadata, dependencies (mcp, asyncpg, pydantic), and entry point script
- [ ] Server module initializes the MCP SDK Server instance with a name and version
- [ ] Server responds to MCP initialize requests with its supported capabilities
- [ ] Basic error handling returns MCP-compliant error responses (error code, message)
- [ ] Server can be started via `python -m mcp_server` or the defined entry point
- [ ] README documents how to install dependencies and start the server locally

---

## FORGEOS-BE016: Implement stdio Transport for Local Agents

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015
**Files:** mcp-server/src/transport/stdio.py, mcp-server/src/transport/__init__.py
**Tags:** backend, mcp, transport, stdio, phase2, BLK-04-01

### Description

Implement the stdio transport layer for local agent communication. The stdio transport reads JSON-RPC messages from stdin and writes responses to stdout, making it suitable for agents running on the same machine as the MCP server. Configure the transport with proper stream handling, message framing, and clean shutdown on EOF/SIGTERM.

### Acceptance Criteria

- [ ] stdio transport reads newline-delimited JSON-RPC messages from stdin
- [ ] Responses are written to stdout as newline-delimited JSON
- [ ] Transport handles partial reads and message buffering correctly
- [ ] Clean shutdown on stdin EOF or SIGTERM signal
- [ ] Transport can be selected via command-line argument or environment variable
- [ ] An agent can connect via stdio, send an initialize request, and receive a response

---

## FORGEOS-BE017: Implement SSE/HTTP Transport for Remote Agents

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE015
**Files:** mcp-server/src/transport/sse.py, mcp-server/src/transport/http.py
**Tags:** backend, mcp, transport, sse, http, remote, phase2, BLK-04-01

### Description

Implement the SSE (Server-Sent Events) and/or Streamable HTTP transport layer for remote agent communication. This enables agents running on different machines to connect to the MCP server over the network. Configure the HTTP server (using an ASGI framework like Starlette or FastAPI), implement the SSE endpoint for server-to-client streaming, and handle connection lifecycle (connect, reconnect, timeout).

### Acceptance Criteria

- [ ] HTTP server accepts connections on a configurable host and port
- [ ] SSE endpoint streams server-to-client notifications and responses
- [ ] Client-to-server requests are handled via HTTP POST to a messages endpoint
- [ ] Transport handles client disconnection and reconnection gracefully
- [ ] Connection timeout closes idle connections after a configurable period
- [ ] Remote agent can connect, send initialize request, and receive server capabilities

---

## FORGEOS-BE018: Wire MCP Server to Database Layer

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015, FORGEOS-BE013
**Files:** mcp-server/src/server.py, mcp-server/src/dependencies.py
**Tags:** backend, mcp, database, wiring, phase2, BLK-04-01

### Description

Wire the MCP server to the PostgreSQL database layer via the repository data access layer from BE013. Implement server startup hooks that initialize the connection pool and repository instances, and shutdown hooks that drain connections. Provide a dependency injection mechanism (or module-level factory) so that tool handlers can access repositories without direct pool management.

### Acceptance Criteria

- [ ] Server startup initializes the asyncpg connection pool and all repository instances
- [ ] Server shutdown closes the connection pool after draining active connections
- [ ] Repository instances are accessible to tool handlers via dependency injection or factory function
- [ ] Database connection failure during startup produces a clear error message and exits with non-zero code
- [ ] Server health check verifies database connectivity through the pool
- [ ] No direct pool access in tool handlers; all database access is through repositories

---

## FORGEOS-BE019: Implement Request Lifecycle with Correlation IDs

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE015
**Files:** mcp-server/src/middleware/correlation.py, mcp-server/src/middleware/__init__.py
**Tags:** backend, mcp, correlation, tracing, phase2, BLK-04-01

### Description

Implement request lifecycle tracking with correlation IDs for the MCP server. Each incoming request (MCP tool call or REST request) receives a unique correlation ID that is propagated through all downstream operations (database queries, event recording, logging). The correlation ID is included in responses, error messages, and log entries for end-to-end traceability.

### Acceptance Criteria

- [ ] Every incoming request is assigned a UUID correlation ID
- [ ] Correlation ID is stored in a context variable accessible throughout the request lifecycle
- [ ] Correlation ID is included in all log messages produced during request handling
- [ ] Correlation ID is returned in MCP tool call responses and error messages
- [ ] Error responses include the correlation ID for debugging reference
- [ ] Correlation IDs propagate through database operations to event_history records

---

## FORGEOS-BE020: Implement Dynamic Tool Registration System

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015, FORGEOS-ARCH009
**Files:** mcp-server/src/tools/registry.py, mcp-server/src/tools/__init__.py
**Tags:** backend, mcp, tools, registry, phase2, BLK-04-02

### Description

Implement the dynamic tool registration system that allows ticket operations to be registered as MCP tools. Each tool is registered with a name, description, and JSON Schema defining its input parameters. The registry exposes registered tools to MCP clients during capability negotiation. Tools are implemented as async handler functions that receive validated input and return structured results.

### Acceptance Criteria

- [ ] ToolRegistry class allows registering tools with name, description, input schema, and handler
- [ ] Registered tools are reported in the MCP server's tools/list response
- [ ] Tool handlers are async functions accepting validated input parameters
- [ ] Registry prevents duplicate tool name registration (raises error)
- [ ] Tool input schemas follow JSON Schema draft 2020-12 format
- [ ] Registry provides a lookup method to resolve tool name to handler and schema

---

## FORGEOS-BE021: Implement Tool Input JSON Schema Validation

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE020
**Files:** mcp-server/src/tools/validation.py
**Tags:** backend, mcp, tools, validation, jsonschema, phase2, BLK-04-02

### Description

Implement JSON Schema validation for MCP tool input parameters. Before a tool handler is invoked, the input arguments are validated against the tool's registered JSON Schema. Validation errors produce clear, structured error responses following MCP error semantics, including the specific validation failure (missing field, wrong type, invalid value).

### Acceptance Criteria

- [ ] Tool inputs are validated against the registered JSON Schema before handler invocation
- [ ] Validation errors include the specific field path and failure reason
- [ ] Error responses follow MCP protocol error format with INVALID_PARAMS code
- [ ] Type coercion is NOT performed; inputs must match schema types exactly
- [ ] Missing required fields produce a clear error listing all missing fields
- [ ] Validation performance is acceptable (< 1ms for typical tool inputs)

---

## FORGEOS-BE022: Implement Agent Session Lifecycle Management

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015, FORGEOS-BE011
**Files:** mcp-server/src/sessions/manager.py, mcp-server/src/sessions/__init__.py
**Tags:** backend, mcp, sessions, lifecycle, phase2, BLK-04-02

### Description

Implement agent session management for the MCP server. Each connecting agent establishes a session that tracks its identity (agent name, role, machine_id), connection state, and associated claims. Sessions support heartbeat tracking (is the agent still connected?), timeout handling (auto-cleanup after disconnect), and resumption after transient disconnects.

### Acceptance Criteria

- [ ] Session is created on MCP initialize request with agent identity metadata
- [ ] Session stores agent_name, role, machine_id, connected_at, and last_heartbeat timestamps
- [ ] Session heartbeat updates last_heartbeat and extends session timeout
- [ ] Timed-out sessions trigger cleanup: release associated claims, close connection
- [ ] Session resumption allows reconnecting agents to reclaim their previous session by ID
- [ ] Session manager tracks all active sessions and provides listing for admin/monitoring

---

## FORGEOS-BE023: Implement Concurrent Session Handling

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE022
**Files:** mcp-server/src/sessions/concurrent.py
**Tags:** backend, mcp, sessions, concurrency, phase2, BLK-04-02

### Description

Implement concurrent session handling for the MCP server to support multiple agents connected simultaneously. Ensure session state is thread-safe (or async-safe), session operations do not block other sessions, and resource cleanup on session termination does not affect other active sessions. Implement session limits to prevent resource exhaustion.

### Acceptance Criteria

- [ ] Multiple agents can maintain simultaneous active sessions without interference
- [ ] Session state access is async-safe using appropriate synchronization primitives
- [ ] Session termination (timeout or disconnect) only affects the terminated session's resources
- [ ] Maximum concurrent sessions is configurable (default: 50)
- [ ] New connection attempts beyond the limit receive a clear rejection with retry guidance
- [ ] Session manager performance does not degrade with increasing concurrent sessions (O(1) lookup)

---

## FORGEOS-BE024: Implement Structured JSON Logging

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015
**Files:** mcp-server/src/observability/logging.py, mcp-server/src/observability/__init__.py
**Tags:** backend, observability, logging, structured, phase2, BLK-04-03

### Description

Implement structured JSON logging for the MCP server. All log output must be machine-parseable JSON with consistent fields: timestamp, level, message, correlation_id, module, and optional context fields. Configure log levels per module. Ensure no PII (personally identifiable information) or secrets appear in any log output. Replace any print() statements with structured logger calls.

### Acceptance Criteria

- [ ] All log output is valid JSON with fields: timestamp, level, message, logger, correlation_id
- [ ] Log levels are configurable per module via environment variable (LOG_LEVEL)
- [ ] No PII, secrets, API keys, or passwords appear in log output
- [ ] Correlation ID from request context is automatically included in all log messages
- [ ] Log format is consistent across all server modules (single formatter configuration)
- [ ] Structured logger is importable as a shared utility for all server modules

---

## FORGEOS-BE025: Implement Health Check and Readiness Probes

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE015, FORGEOS-BE011
**Files:** mcp-server/src/observability/health.py
**Tags:** backend, observability, health, readiness, phase2, BLK-04-03

### Description

Implement health check and readiness probe endpoints for the MCP server. The health check reports overall server status including database connectivity, connection pool health, and active session count. The readiness probe indicates whether the server is ready to accept new requests (database connected, pool initialized, not shutting down). These endpoints are used by Docker health checks and monitoring systems.

### Acceptance Criteria

- [ ] Health check endpoint returns JSON with server status, database status, pool stats, and uptime
- [ ] Readiness probe returns 200 when server is fully initialized and accepting requests
- [ ] Readiness probe returns 503 during startup initialization or shutdown draining
- [ ] Database connectivity is verified via a lightweight query (SELECT 1)
- [ ] Health check includes connection pool saturation metrics
- [ ] Both endpoints respond within 500ms even under load

---

## FORGEOS-BE026: Implement Graceful Shutdown with Request Draining

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE015
**Files:** mcp-server/src/lifecycle/shutdown.py, mcp-server/src/lifecycle/__init__.py
**Tags:** backend, lifecycle, shutdown, graceful, phase2, BLK-04-03

### Description

Implement graceful shutdown for the MCP server. On receiving SIGTERM or SIGINT, the server stops accepting new connections, waits for in-flight requests to complete (up to a configurable timeout), closes all agent sessions cleanly, flushes pending events to the database, and then exits. If in-flight requests exceed the timeout, they are cancelled with appropriate error responses.

### Acceptance Criteria

- [ ] Server handles SIGTERM and SIGINT signals to initiate graceful shutdown
- [ ] New connections are rejected with a shutdown-in-progress message during draining
- [ ] In-flight requests are allowed to complete up to the shutdown timeout (default: 30 seconds)
- [ ] Requests exceeding the timeout are cancelled with a server-shutting-down error
- [ ] All agent sessions are closed and their claims released during shutdown
- [ ] Database connection pool is closed after all pending operations complete

---

## FORGEOS-BE027: Implement Metrics Collection Points

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE024
**Files:** mcp-server/src/observability/metrics.py
**Tags:** backend, observability, metrics, monitoring, phase2, BLK-04-03

### Description

Implement metrics collection points throughout the MCP server for monitoring integration. Track request counts (by tool name), request latency (p50, p95, p99), active connections, claim operations (success/failure counts), database query duration, and pool utilization. Metrics should be collectible via a /metrics endpoint or structured log output.

### Acceptance Criteria

- [ ] Request counter tracks total requests by tool name and status (success/error)
- [ ] Request latency histogram tracks p50, p95, p99 per tool name
- [ ] Active session gauge tracks current connected agent count
- [ ] Claim metrics track successful claims, failed claims, and expired leases per interval
- [ ] Database query duration is tracked per operation type (read/write)
- [ ] Metrics are exposed via a /metrics endpoint or structured JSON log line on configurable interval
