# Phase 1 — MCP-Only Cutover: Migration, Testing and Security (L3 Tickets)

Source blocks: BLK-INT-05 (Migration, Testing and Security)

---

# TASK-INT-BE017: Filesystem to PostgreSQL Migration Script

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-BE014
**Files:** forgeos-server/scripts/migrate-filesystem.ts
**Tags:** intelligence, cutover, phase1, migration, BLK-INT-05

## Description

Create a one-time migration script that reads existing ticket JSON from .github/tickets/ and .github/ticket-state/ directories and inserts them into the PostgreSQL tickets table. Preserves all ticket history, stage, dependencies, and metadata. Handles duplicate detection (skip if ticket already exists in DB).

## Acceptance Criteria

- [ ] Script reads all .json files from .github/tickets/ directory
- [ ] Script determines current stage from .github/ticket-state/ directory location
- [ ] Inserts tickets into PostgreSQL with full history preservation
- [ ] Skips tickets that already exist in database (idempotent)
- [ ] Reports migration summary: migrated count, skipped count, error count
- [ ] Handles malformed JSON gracefully (logs error, continues)
- [ ] Dry-run mode (--dry-run) previews changes without writing
- [ ] Integration test: seed fixture tickets then verify migration correctness

---

# TASK-INT-BE018: Integration Tests for MCP-Only Workflow

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE011, TASK-INT-BE012, TASK-INT-BE013, TASK-INT-BE015
**Files:** forgeos-server/src/__tests__/integration/mcp-workflow.test.ts
**Tags:** intelligence, cutover, phase1, testing, BLK-INT-05

## Description

Write end-to-end integration tests for the MCP-only ticket workflow. Test the full lifecycle: create ticket, claim via orchestrator, retrieve payload, advance through stages, handle rework, complete to DONE. Verify all MCP tools work together correctly.

## Acceptance Criteria

- [ ] Test full lifecycle: READY then BACKEND then QA then SECURITY then CI then DOCS then VALIDATION then DONE
- [ ] Test tickets.get returns correct ticket data at each stage
- [ ] Test tickets.list filters correctly by stage and type
- [ ] Test tickets.payload includes upstream summary from previous stage
- [ ] Test orchestrator dispatches READY tickets to correct agents
- [ ] Test reject_ticket sends ticket to rework with evidence preserved
- [ ] Test concurrent claims on same ticket (only one succeeds)
- [ ] All tests use isolated test database with cleanup

---

# TASK-INT-SEC001: Security Review for Cutover MCP Tools

**Type:** security
**Priority:** high
**Dependencies:** TASK-INT-BE011, TASK-INT-BE012, TASK-INT-BE013, TASK-INT-BE015
**Files:** .github/agent-output/Security/TASK-INT-SEC001.md
**Tags:** intelligence, cutover, phase1, security, BLK-INT-05

## Description

Security review of all Phase 1 MCP tools and orchestrator. Focus areas: input validation (SQL injection via ticket IDs), authentication for tool access, authorization (agents can only access their claimed tickets), lease mechanism security, rate limiting for ticket operations.

## Acceptance Criteria

- [ ] All MCP tool inputs validated against injection attacks (SQL, NoSQL)
- [ ] Ticket ID format validation prevents path traversal in any filesystem fallback
- [ ] Claim mechanism prevents unauthorized ticket access
- [ ] Lease expiry cannot be extended beyond maximum (configurable cap)
- [ ] Rate limiting configured for ticket operations (prevent abuse)
- [ ] No sensitive data (credentials, API keys) exposed in MCP tool responses
- [ ] Security review report written to agent-output directory

---

# TASK-INT-DOC001: MCP-Only Cutover Documentation

**Type:** docs
**Priority:** medium
**Dependencies:** TASK-INT-BE015, TASK-INT-BE016, TASK-INT-BE017
**Files:** docs/operations/mcp-cutover-guide.md, docs/architecture/intelligence-architecture.md
**Tags:** intelligence, cutover, phase1, documentation, BLK-INT-05

## Description

Document the MCP-only cutover: migration procedure, new MCP tools, orchestrator configuration, agent SDK updates. Update the architecture document with Phase 1 implementation details. Create operations guide for running the migration.

## Acceptance Criteria

- [ ] Cutover operations guide: step-by-step migration from filesystem to MCP
- [ ] Migration guide: how to run migrate-filesystem.ts, rollback procedures
- [ ] MCP tool reference: tickets.get, tickets.list, tickets.payload specifications
- [ ] Orchestrator configuration: env vars, polling interval, lease duration
- [ ] Agent SDK migration guide: old API to new API mapping
- [ ] Architecture doc updated with Phase 1 implementation reality
- [ ] All code examples verified and tested
