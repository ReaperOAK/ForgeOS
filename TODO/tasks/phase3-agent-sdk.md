# Phase 3 — Agent SDK L3 Tickets

Source blocks: BLK-07-01 (Agent SDK Core), BLK-07-02 (SDK Extensions & Migration Shim)

---

## FORGEOS-BE043: Create forgeos-agent-sdk Package Structure

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015, FORGEOS-BE017
**Files:** agent-sdk/pyproject.toml, agent-sdk/src/forgeos_sdk/__init__.py, agent-sdk/src/forgeos_sdk/client.py, agent-sdk/README.md
**Tags:** backend, sdk, package, agent, phase3, BLK-07-01

### Description

Create the Python package structure for `forgeos-agent-sdk`, the client library that agents use to interact with the MCP server. Set up pyproject.toml with metadata, dependencies (mcp client SDK, pydantic), and entry points. Create the base client class stub with connection configuration. The package depends on the MCP server (FORGEOS-BE015) and SSE/HTTP transport (FORGEOS-BE017) being available.

### Acceptance Criteria

- [ ] pyproject.toml defines package metadata, version, dependencies (mcp, pydantic, httpx)
- [ ] Package installable via pip install -e . for local development
- [ ] Base client class created with constructor accepting server_url, transport_type, and identity config
- [ ] Configuration loadable from environment variables (FORGEOS_SERVER_URL, FORGEOS_AGENT_ID, FORGEOS_TRANSPORT)
- [ ] Package exports clean public API via __init__.py (ForgeOSClient, exceptions)
- [ ] README documents installation, basic usage, and configuration

---

## FORGEOS-BE044: Implement MCP Client Connection Manager

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE043, FORGEOS-BE022
**Files:** agent-sdk/src/forgeos_sdk/client.py, agent-sdk/src/forgeos_sdk/transport.py
**Tags:** backend, sdk, connection, mcp, reconnection, phase3, BLK-07-01

### Description

Implement the MCP client connection management within the agent SDK. Support connecting to the MCP server via stdio (local) and SSE/HTTP (remote) transports. Implement automatic reconnection with exponential backoff on connection loss. Handle MCP session initialization (initialize handshake), session resumption after disconnect, and clean shutdown.

### Acceptance Criteria

- [ ] Client connects to MCP server via stdio transport for local agents
- [ ] Client connects to MCP server via SSE/HTTP transport for remote agents
- [ ] Transport selection via configuration (environment variable or constructor parameter)
- [ ] Automatic reconnection with exponential backoff (initial 1s, max 30s, jitter)
- [ ] Session initialization sends MCP initialize request and processes server capabilities
- [ ] Session resumption attempts to reattach to previous session on reconnect
- [ ] Clean shutdown sends disconnect notification and closes transport

---

## FORGEOS-BE045: Implement High-Level Ticket Operations API

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE044, FORGEOS-BE028
**Files:** agent-sdk/src/forgeos_sdk/operations.py, agent-sdk/src/forgeos_sdk/models.py
**Tags:** backend, sdk, operations, tickets, api, phase3, BLK-07-01

### Description

Implement the high-level Python API that agents use for ticket operations. Create methods: `claim_next(role)`, `claim(ticket_id)`, `advance(ticket_id, evidence)`, `rework(ticket_id, reason)`, `release(ticket_id)`, `get_ticket(ticket_id)`, and `heartbeat(ticket_id)`. Each method calls the corresponding MCP tool via the client connection. Define Pydantic models for Ticket, Claim, and operation responses.

### Acceptance Criteria

- [ ] claim_next(role) calls tickets.next MCP tool and returns a Ticket model
- [ ] claim(ticket_id) calls tickets.claim MCP tool and returns a Ticket model
- [ ] advance(ticket_id, evidence) calls tickets.advance and returns updated Ticket
- [ ] rework(ticket_id, reason) calls tickets.rework and returns updated Ticket
- [ ] release(ticket_id) calls tickets.release and returns confirmation
- [ ] get_ticket(ticket_id) calls tickets.status and returns Ticket model
- [ ] All methods are async (async def) and usable in asyncio event loops
- [ ] Pydantic models define Ticket, Claim, OperationResult with proper field types

---

## FORGEOS-BE046: Implement SDK Error Handling and Configuration

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE044
**Files:** agent-sdk/src/forgeos_sdk/exceptions.py, agent-sdk/src/forgeos_sdk/config.py
**Tags:** backend, sdk, errors, config, phase3, BLK-07-01

### Description

Implement structured exception hierarchy and centralized configuration for the agent SDK. Define exception classes: `ForgeOSError` (base), `ClaimConflictError`, `LeaseExpiredError`, `InvalidTransitionError`, `NetworkError`, `AuthenticationError`. Implement configuration class loading from environment variables with validation and sensible defaults.

### Acceptance Criteria

- [ ] Base ForgeOSError exception with error_code and details attributes
- [ ] ClaimConflictError raised when claim fails due to another agent holding the ticket
- [ ] LeaseExpiredError raised when an operation fails because the claim lease has expired
- [ ] InvalidTransitionError raised for invalid SDLC stage transitions
- [ ] NetworkError raised for connection failures with retry hint
- [ ] AuthenticationError raised for invalid or expired credentials
- [ ] Configuration class loads FORGEOS_SERVER_URL, FORGEOS_AGENT_ID, FORGEOS_TRANSPORT, FORGEOS_API_KEY from env
- [ ] Configuration validates required fields and provides clear error messages for missing values

---

## FORGEOS-BE047: Implement Background Lease Heartbeat in SDK

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE045, FORGEOS-BE008
**Files:** agent-sdk/src/forgeos_sdk/heartbeat.py, agent-sdk/src/forgeos_sdk/operations.py
**Tags:** backend, sdk, heartbeat, lease, background, phase3, BLK-07-02

### Description

Implement automatic lease heartbeat in the agent SDK. When an agent claims a ticket, a background asyncio task periodically sends heartbeat calls to extend the lease. The heartbeat interval is configurable (default: every 5 minutes for a 30-minute lease). Heartbeat integrates with the server-side lease heartbeat mechanism (FORGEOS-BE008). The heartbeat task is automatically started on claim and stopped on advance/release/rework.

### Acceptance Criteria

- [ ] Background asyncio task sends periodic heartbeat to extend the active lease
- [ ] Heartbeat interval configurable (default: lease_duration / 6, e.g., 5 min for 30 min lease)
- [ ] Heartbeat automatically started when claim_next() or claim() succeeds
- [ ] Heartbeat automatically stopped when advance(), release(), or rework() is called
- [ ] Heartbeat failure (network error, lease already expired) raises LeaseExpiredError
- [ ] Heartbeat runs as a non-blocking background task that does not interfere with agent work

---

## FORGEOS-BE048: Implement Summary Handoff Helpers

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE045
**Files:** agent-sdk/src/forgeos_sdk/summary.py
**Tags:** backend, sdk, summary, handoff, phase3, BLK-07-02

### Description

Implement summary handoff helper methods in the agent SDK. Provide `read_upstream_summary(ticket_id)` to read the previous stage agent's summary from `.github/agent-output/{PreviousAgent}/{ticket-id}.md`, and `write_summary(ticket_id, content)` to write the current agent's summary. Helpers map agent roles to directory names and handle file I/O with proper encoding.

### Acceptance Criteria

- [ ] read_upstream_summary(ticket_id) reads the previous stage agent's summary file
- [ ] Method correctly maps agent roles to output directory names (e.g., Backend → Backend/)
- [ ] Returns summary content as string or None if no upstream summary exists
- [ ] write_summary(ticket_id, content) writes summary to the correct agent output directory
- [ ] Write creates the agent output directory if it does not exist
- [ ] Both methods use UTF-8 encoding and handle missing files gracefully

---

## FORGEOS-BE049: Implement Filesystem Fallback Mode

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE045
**Files:** agent-sdk/src/forgeos_sdk/fallback.py, agent-sdk/src/forgeos_sdk/client.py
**Tags:** backend, sdk, fallback, filesystem, migration, phase3, BLK-07-02

### Description

Implement a filesystem fallback mode that allows agents to operate when the MCP server is unavailable. In fallback mode, the SDK delegates operations to the existing `tickets.py` CLI. This enables a gradual migration from filesystem to MCP-based operations. The mode is controlled by a feature flag (environment variable FORGEOS_MODE=mcp|filesystem|auto).

### Acceptance Criteria

- [ ] Fallback mode delegates claim/advance/rework/status to tickets.py CLI subprocess calls
- [ ] Mode selection via FORGEOS_MODE environment variable (mcp, filesystem, auto)
- [ ] Auto mode attempts MCP connection first, falls back to filesystem on connection failure
- [ ] Fallback operations parse tickets.py stdout for result data
- [ ] Fallback mode is transparent to calling agent code (same API surface)
- [ ] Mode switch logged at startup indicating which backend is active

---

## FORGEOS-BE050: Implement agent-runner.py Integration Hooks

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE049, FORGEOS-BE047
**Files:** agent-sdk/src/forgeos_sdk/runner_hooks.py, agent-sdk/src/forgeos_sdk/__init__.py
**Tags:** backend, sdk, agentrunner, integration, git, phase3, BLK-07-02

### Description

Implement integration hooks that connect the agent SDK to the existing `agent-runner.py` two-commit protocol. The SDK manages ticket state via MCP while `agent-runner.py` continues to handle git operations (git add, git commit, git push). Provide hook points: `pre_claim()`, `post_claim()`, `pre_commit()`, `post_commit()` that `agent-runner.py` can call at appropriate lifecycle stages.

### Acceptance Criteria

- [ ] pre_claim() hook performs MCP claim before git CLAIM commit
- [ ] post_claim() hook verifies MCP claim succeeded and returns ticket data
- [ ] pre_commit() hook validates MCP lease is still active before git WORK commit
- [ ] post_commit() hook calls MCP advance after successful git push
- [ ] Hooks are optional — agent-runner.py works without them in filesystem mode
- [ ] Hook interface documented with usage examples for agent-runner.py integration
