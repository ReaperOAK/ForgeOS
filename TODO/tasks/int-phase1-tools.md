# Phase 1 — MCP-Only Cutover: New MCP Tools and Orchestrator (L3 Tickets)

Source blocks: BLK-INT-03 (New MCP Tools), BLK-INT-04 (Orchestrator Loop)

---

# TASK-INT-BE011: Implement tickets.get MCP Tool

**Type:** backend
**Priority:** critical
**Files:** forgeos-server/src/tools/tickets-get.ts
**Tags:** intelligence, cutover, phase1, mcp-tool, BLK-INT-03

## Description

Implement the tickets.get MCP tool. Returns full ticket JSON for a given ticket_id. Queries the tickets table. Returns claimed_by, stage, dependencies, acceptance_criteria, history. This replaces filesystem reads of .github/tickets/{id}.json.

## Acceptance Criteria

- [ ] MCP tool tickets.get accepts ticket_id (string, required)
- [ ] Returns full ticket JSON matching database schema
- [ ] Returns 404-equivalent error for non-existent ticket IDs
- [ ] Includes ticket history array
- [ ] Includes current claim information (claimed_by, lease_expiry)
- [ ] Zod schema validates ticket_id format
- [ ] Unit test with seeded ticket verifies all fields returned

---

# TASK-INT-BE012: Implement tickets.list MCP Tool

**Type:** backend
**Priority:** critical
**Files:** forgeos-server/src/tools/tickets-list.ts
**Tags:** intelligence, cutover, phase1, mcp-tool, BLK-INT-03

## Description

Implement the tickets.list MCP tool. Returns filtered list of tickets by stage, type, priority, or assignee. Supports pagination. Replaces filesystem scans of .github/ticket-state/ directories. Used by orchestrator loop to find READY tickets.

## Acceptance Criteria

- [ ] MCP tool tickets.list accepts optional filters: stage, type, priority, claimed_by
- [ ] Returns array of ticket summary objects (id, title, stage, type, priority, claimed_by)
- [ ] Supports pagination with limit (default 50) and offset
- [ ] Supports ordering by created_at, priority, or stage
- [ ] Returns empty array when no tickets match (not an error)
- [ ] Zod schemas validate all filter parameters
- [ ] Unit test: seed 10 tickets then verify filtering by stage and type

---

# TASK-INT-BE013: Implement tickets.payload MCP Tool

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-BE011
**Files:** forgeos-server/src/tools/tickets-payload.ts
**Tags:** intelligence, cutover, phase1, mcp-tool, BLK-INT-03

## Description

Implement the tickets.payload MCP tool. Returns the full delegation context for an agent working on a specific ticket. Includes: ticket JSON, upstream stage summary, relevant memory entries, file scope, acceptance criteria. This is the primary context delivery mechanism replacing filesystem-based summary handoff.

## Acceptance Criteria

- [ ] MCP tool tickets.payload accepts ticket_id (string, required)
- [ ] Returns ticket JSON (full ticket data)
- [ ] Returns upstream_summary (previous stage agent output, or null if first stage)
- [ ] Returns file_scope (list of files the agent may modify)
- [ ] Returns acceptance_criteria (testable criteria list)
- [ ] Returns relevant memory entries from activeContext.md (if available)
- [ ] Returns agent assignment info (claimed_by, stage, deadline)
- [ ] Zod schema validates ticket_id format
- [ ] Unit test: seeded ticket with upstream summary verifies payload assembly

---

# TASK-INT-BE014: PostgreSQL Stored Functions for Cutover Operations

**Type:** backend
**Priority:** critical
**Files:** forgeos-server/src/db/migrations/002-cutover-functions.sql
**Tags:** intelligence, cutover, phase1, database, BLK-INT-03

## Description

Create stored functions for atomic ticket operations: claim_ticket (atomic claim with lease), advance_ticket (stage transition with validation), reject_ticket (rework with evidence). These replace the filesystem-based state machine with database-enforced atomicity.

## Acceptance Criteria

- [ ] claim_ticket(ticket_id, agent, machine, operator, lease_minutes) function created
- [ ] claim_ticket enforces lease expiry check (expired claims are reclaimable)
- [ ] claim_ticket is atomic (SELECT FOR UPDATE prevents race conditions)
- [ ] advance_ticket(ticket_id, agent) validates current stage and moves to next
- [ ] advance_ticket enforces SDLC flow order (cannot skip stages)
- [ ] reject_ticket(ticket_id, agent, reason) increments rework_count, records rejection
- [ ] reject_ticket enforces max 3 reworks (raises exception beyond limit)
- [ ] All functions include audit trail entries in ticket history
- [ ] Unit tests for each function with concurrent access scenarios

---

# TASK-INT-BE015: Implement ForgeOS Orchestrator Loop

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-BE011, TASK-INT-BE012, TASK-INT-BE014
**Files:** forgeos-server/src/services/orchestrator.ts
**Tags:** intelligence, cutover, phase1, orchestrator, BLK-INT-04

## Description

Implement the ForgeOS orchestrator loop as a persistent server-side process. Replaces the stateless Ticketer dispatcher. Polls for READY tickets on a configurable interval (default 10s). For each READY ticket, determines the correct agent, creates a claim via stored function, and emits dispatch event. Monitors lease expiry and reclaims abandoned tickets.

## Acceptance Criteria

- [ ] Orchestrator runs as persistent process within the MCP server
- [ ] Polls tickets.list for READY tickets every 10 seconds (configurable via env)
- [ ] Determines correct agent from ticket type and SDLC flow
- [ ] Claims ticket via claim_ticket stored function (atomic)
- [ ] Emits SSE dispatch event with ticket_id, agent, and claim details
- [ ] Monitors lease expiry and releases abandoned claims
- [ ] Graceful shutdown on SIGTERM (completes current dispatch cycle)
- [ ] Unit test: mock READY tickets then verify dispatch events emitted
- [ ] Integration test: concurrent claims verify only one succeeds

---

# TASK-INT-BE016: Update Agent SDK for Cutover MCP Tools

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE011, TASK-INT-BE012, TASK-INT-BE013
**Files:** agent-sdk/src/forgeos_sdk/client.py, agent-sdk/src/forgeos_sdk/models.py
**Tags:** intelligence, cutover, phase1, agent-sdk, BLK-INT-04

## Description

Update the ForgeOS Agent SDK (Python) to add client wrappers for the 3 new cutover MCP tools: tickets.get, tickets.list, tickets.payload. Add Pydantic models for ticket, payload, and list response types. This allows agents to call the new tools via the SDK.

## Acceptance Criteria

- [ ] client.tickets_get(ticket_id) wraps tickets.get MCP tool
- [ ] client.tickets_list(filters) wraps tickets.list MCP tool
- [ ] client.tickets_payload(ticket_id) wraps tickets.payload MCP tool
- [ ] Pydantic models: Ticket, TicketPayload, TicketListResponse match MCP schemas
- [ ] Error handling follows existing SDK patterns (raises typed exceptions)
- [ ] Unit tests for each new method with mocked MCP responses
- [ ] README updated with cutover tool usage examples
