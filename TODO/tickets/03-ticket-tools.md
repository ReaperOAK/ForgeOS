# Ticket Tools — All 10 MCP Tools

## TASK-FOS-03-001: tickets.next — Find Next Available Ticket

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-FOS-02-001, TASK-FOS-01-002, TASK-FOS-02-002
**Files:** forgeos-server/src/tools/tickets-next.ts, forgeos-server/src/tools/index.ts

### Description
Implement the tickets.next MCP tool that returns the next available ticket for a given SDLC stage. Uses SELECT FOR UPDATE SKIP LOCKED to peek at the highest-priority unclaimed ticket without actually claiming it. Supports optional filters by ticket type and minimum priority. Returns the full ticket object or null with a descriptive message. This tool is read-only — it does not modify ticket state. Register the tool on the MCP server using registerTool() with Zod input schema validation.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.next' with Zod schema: stage (required enum), type (optional enum), priority (optional enum)
- [ ] Queries tickets table with WHERE stage=$1 AND status='READY' AND (claimed_by IS NULL OR lease_expiry < NOW())
- [ ] Orders results by priority DESC, created_at ASC and limits to 1
- [ ] Returns full ticket object as JSON text content, or {ticket: null, message: "No tickets available"}
- [ ] Optional type filter adds AND type=$2 to WHERE clause
- [ ] Optional priority filter adds AND priority >= $3 using enum ordering
- [ ] Query completes within 50ms (uses idx_tickets_claimable composite index)

---

## TASK-FOS-03-002: tickets.claim — Atomic Ticket Claiming

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-FOS-03-001, TASK-FOS-04-003
**Files:** forgeos-server/src/tools/tickets-claim.ts

### Description
Implement the tickets.claim MCP tool that atomically claims a specific ticket by ID. Uses the claim_ticket_by_id SQL function which performs SELECT FOR UPDATE SKIP LOCKED, checks for file_paths conflicts in file_locks table, updates the ticket with claimed_by/machine_id/operator/lease_expiry, inserts file locks for all file_paths, and records a CLAIMED event. Returns the claimed ticket with lease_expiry and list of acquired file locks, or an error if the ticket is already claimed, has file conflicts, or doesn't exist.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.claim' with Zod schema: ticket_id (string), agent_name (string), machine_id (string), operator (optional string), lease_minutes (int 5-120, default 30)
- [ ] Calls claim_ticket_by_id SQL function within a transaction
- [ ] Returns ALREADY_CLAIMED error if ticket is locked by another agent with active lease
- [ ] Returns FILE_CONFLICT error if any file in ticket's file_paths is locked by another active ticket
- [ ] On success, returns {ticket, lease_expiry, file_locks} with the claimed ticket and acquired locks
- [ ] Concurrent claims from different machines never result in double-assignment (verified by SKIP LOCKED)
- [ ] Claim event recorded in events table with agent_id, machine_id, operator, lease details
- [ ] Claim latency under 100ms at p99

---

## TASK-FOS-03-003: tickets.update — Update Ticket Metadata

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-update.ts

### Description
Implement the tickets.update MCP tool that updates metadata on a claimed ticket. Only the current claim owner can update a ticket. Merges the provided metadata object into the ticket's existing metadata JSONB field using PostgreSQL's || operator. Records an UPDATED event in the events table. Updates the ticket's updated_at timestamp automatically via the trigger.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.update' with Zod schema: ticket_id (string), metadata (record of unknown values)
- [ ] Validates caller is the current claim owner (claimed_by matches authenticated agent)
- [ ] Returns NOT_CLAIM_OWNER error if caller doesn't hold the claim
- [ ] Merges metadata into existing ticket.metadata using jsonb || operator (shallow merge)
- [ ] Records UPDATED event with the metadata payload in the events table
- [ ] Returns the updated ticket object as JSON text content
- [ ] updated_at field refreshes automatically via trg_tickets_updated_at trigger

---

## TASK-FOS-03-004: tickets.complete — Complete Stage and Advance

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-complete.ts, forgeos-server/src/sdlc/flows.ts, forgeos-server/src/sdlc/transitions.ts

### Description
Implement the tickets.complete MCP tool that marks the current stage as complete and advances the ticket to the next stage in its SDLC flow. Uses the advance_ticket SQL function. Requires completion evidence (artifacts, test_results, confidence). Also implement the SDLC flow engine: flows.ts defines SDLC_FLOWS mapping each of 10 ticket types to their ordered stage array, transitions.ts provides getNextStage(), getImplementationStage(), and isValidTransition() helper functions. On ticket reaching DONE, calls resolve_dependencies to unblock dependent tickets.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.complete' with Zod schema: ticket_id (string), evidence object (artifacts: string[], test_results: string, confidence: HIGH|MEDIUM|LOW, notes: optional string)
- [ ] Returns MISSING_EVIDENCE error if evidence object is missing required fields
- [ ] Calls advance_ticket SQL function which validates claim ownership and SDLC flow ordering
- [ ] Returns INVALID_TRANSITION error if trying to advance beyond the final stage
- [ ] On success, returns {ticket, previous_stage, new_stage, dependencies_unblocked}
- [ ] SDLC_FLOWS object defines correct stage arrays for all 10 ticket types matching Architecture §6.4
- [ ] getNextStage(type, currentStage) returns the correct next stage or null if at end
- [ ] When ticket reaches DONE, resolve_dependencies function unblocks dependent tickets by setting them to READY
- [ ] File locks released on stage advancement via advance_ticket SQL function
- [ ] STAGE_ADVANCED event recorded with evidence payload

---

## TASK-FOS-03-005: tickets.reject — Reject and Trigger Rework

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-reject.ts

### Description
Implement the tickets.reject MCP tool that rejects a ticket during a review stage (QA, Security, CI, Validation), sending it back for rework. Uses the reject_ticket SQL function. Increments rework_count; if rework_count >= max_reworks (default 3), the ticket moves to ESCALATED status instead of rework. On rework, the ticket returns to its implementation stage (first non-READY stage in the SDLC flow) with status READY. File locks are released on rejection.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.reject' with Zod schema: ticket_id (string), reason (string), evidence (optional record)
- [ ] Validates caller holds the claim on the ticket
- [ ] Calls reject_ticket SQL function which handles rework vs escalation logic
- [ ] Returns {ticket, rework_count, escalated: false, returned_to_stage} on rework
- [ ] Returns {ticket, rework_count, escalated: true, returned_to_stage} when rework_count >= max_reworks
- [ ] STAGE_REJECTED event recorded with reason, evidence, and rework_count
- [ ] File locks released on rejection via reject_ticket SQL function
- [ ] Escalated tickets have status ESCALATED and claimed_by set to NULL

---

## TASK-FOS-03-006: tickets.spawn — Create Child Ticket

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-spawn.ts

### Description
Implement the tickets.spawn MCP tool that creates a child ticket linked to the current ticket, enabling self-expanding workflows. The child ticket gets a generated ticket_id, inherits the parent's project context, and has parent_id set to the parent ticket_id. The child starts in BLOCKED status if it has dependencies, or READY if not. Records a SPAWNED event on the parent ticket.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.spawn' with Zod schema: parent_id (string), title (string, max 200), type (enum), priority (enum, default medium), acceptance_criteria (string array, min 1), file_paths (string array), description (optional string), depends_on (optional string array)
- [ ] Returns INVALID_SUBTASK error if title, type, or acceptance_criteria are missing/empty
- [ ] Returns TICKET_NOT_FOUND error if parent ticket doesn't exist
- [ ] Generated child ticket_id follows pattern: {parent_id}-SUB-{sequential_number}
- [ ] Child ticket has parent_id set, correct sdlc_flow based on type, and inherits project_id from parent
- [ ] If depends_on is empty, child starts in READY status; otherwise BLOCKED
- [ ] SPAWNED event recorded on parent ticket with child ticket_id in payload
- [ ] Returns {ticket: childTicket, parent_ticket_id} on success

---

## TASK-FOS-03-007: tickets.graph — Dependency Graph

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-001
**Files:** forgeos-server/src/tools/tickets-graph.ts

### Description
Implement the tickets.graph MCP tool that returns the full ticket dependency DAG for visualization. Queries all tickets (optionally filtered by stage, type, or status), builds nodes (tickets) and edges (from depends_on relationships), and computes the critical path (longest path through the DAG). Must return within 500ms for up to 500 tickets.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.graph' with Zod schema: filter (optional object with stage, type, status enums)
- [ ] Returns {nodes: Ticket[], edges: {from: string, to: string}[], critical_path: string[]}
- [ ] Nodes are full ticket objects; edges derived from each ticket's depends_on array
- [ ] Critical path is computed as the longest path through the DAG from any root to any leaf
- [ ] Optional filters narrow the node set by stage, type, or status
- [ ] Query completes within 500ms for up to 500 tickets
- [ ] Graph structure is valid — no cycles detected (DAG invariant preserved)

---

## TASK-FOS-03-008: tickets.release — Release Claim

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-release.ts

### Description
Implement the tickets.release MCP tool that releases a claim on a ticket, returning it to READY status. Uses the release_ticket SQL function. Normal release requires the caller to be the claim owner; forced release (admin only) can release any claim. Clears claimed_by, machine_id, operator, and lease_expiry. Releases all file locks associated with the ticket. Records a RELEASED or FORCE_RELEASED event.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.release' with Zod schema: ticket_id (string), reason (optional string), force (boolean, default false)
- [ ] Returns NOT_CLAIM_OWNER error if caller isn't the claim owner and force=false
- [ ] Force release requires admin role; returns FORBIDDEN if non-admin attempts force=true
- [ ] On success, ticket status returns to READY with claimed_by/machine_id/lease_expiry set to NULL
- [ ] All file locks for the ticket are released (released_at set to NOW())
- [ ] RELEASED or FORCE_RELEASED event recorded with reason in payload
- [ ] Returns {ticket, released_file_locks: string[]} on success

---

## TASK-FOS-03-009: tickets.extend — Extend Lease Duration

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-03-002
**Files:** forgeos-server/src/tools/tickets-extend.ts

### Description
Implement the tickets.extend MCP tool that extends the lease on a claimed ticket to prevent expiry during long operations. Uses the extend_lease SQL function. Validates that the caller is the claim owner, that the requested duration doesn't exceed the system's max_lease_minutes config (default 120), and updates lease_expiry to NOW() + duration. Records a LEASE_EXTENDED event.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.extend' with Zod schema: ticket_id (string), duration_minutes (int 5-120, default 30)
- [ ] Returns NOT_CLAIM_OWNER error if caller doesn't hold the claim
- [ ] Returns LEASE_TOO_LONG error if duration_minutes exceeds max_lease_minutes from system_config
- [ ] Updates lease_expiry to NOW() + duration_minutes interval
- [ ] LEASE_EXTENDED event recorded with new_expiry and extension_minutes in payload
- [ ] Returns {ticket, new_lease_expiry: ISO8601 string} on success

---

## TASK-FOS-03-010: tickets.stats — Dashboard Statistics

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-FOS-03-001
**Files:** forgeos-server/src/tools/tickets-stats.ts

### Description
Implement the tickets.stats MCP tool that returns aggregate system statistics for dispatcher decision-making and dashboard display. Queries the tickets and events tables to compute per-stage ticket counts, per-status ticket counts, claim health breakdown (healthy/expiring_soon/expired), average time-in-stage per stage, rework count distribution, total tickets, and total done tickets. May cache results for up to 5 seconds to reduce load.

### Acceptance Criteria
- [ ] Tool registered as 'tickets.stats' with Zod schema: time_range_hours (optional number)
- [ ] Returns stages object mapping each TicketStage to ticket count
- [ ] Returns statuses object mapping each TicketStatus to ticket count
- [ ] Returns claims object with healthy (>5min remaining), expiring_soon (<5min remaining), and expired counts
- [ ] Returns avg_stage_duration mapping each stage to average seconds spent
- [ ] Returns rework_distribution mapping rework_count values to number of tickets
- [ ] Returns total_tickets and total_done counts
- [ ] Response time under 200ms for up to 500 tickets
