# Phase 1 — Architecture L3 Tickets

Source blocks: BLK-02-01 (System Architecture & ADRs), BLK-02-02 (Database Schema Design), BLK-02-03 (API Contract Design), BLK-02-04 (Non-Functional Requirements & Fitness Functions)

---

## FORGEOS-ARCH001: Design System Component Architecture

**Type:** architecture
**Priority:** critical
**Dependencies:** FORGEOS-RES001, FORGEOS-RES005, FORGEOS-RES009
**Files:** docs/architecture/system-components.md
**Tags:** architecture, components, phase1, BLK-02-01

### Description

Produce the high-level system component architecture for the ForgeOS distributed orchestration platform. Create component diagrams showing the 6 major components (MCP Server, PostgreSQL, Git, Agent Clients, Dashboard, Webhook Processor), their interfaces, communication protocols, and boundary definitions. Define the component interaction patterns and data flow overview.

### Acceptance Criteria

- [ ] System component diagram created with all 6 major components and their interfaces
- [ ] Component boundaries clearly defined: what each component owns and its responsibilities
- [ ] Inter-component communication protocols specified (MCP, REST, WebSocket, SQL, Git)
- [ ] Data flow overview diagram showing how a ticket operation traverses components
- [ ] Deployment topology diagram showing single-machine and multi-machine configurations
- [ ] Component dependency graph with startup order and health check dependencies
- [ ] Architecture document delivered at docs/architecture/system-components.md

---

## FORGEOS-ARCH002: ADR — PostgreSQL as Primary State Store

**Type:** architecture
**Priority:** high
**Dependencies:** FORGEOS-RES005, FORGEOS-RES006, FORGEOS-RES007
**Files:** docs/architecture/adr/adr-001-postgresql.md
**Tags:** architecture, adr, postgresql, phase1, BLK-02-01

### Description

Author an Architecture Decision Record (ADR) documenting the decision to use PostgreSQL as the primary mutable state store for ForgeOS, replacing filesystem-based state directories. Evaluate alternatives (SQLite, Redis, etcd, CockroachDB), document trade-offs, and justify the selection based on distributed locking capabilities, ACID guarantees, and operational maturity.

### Acceptance Criteria

- [ ] ADR follows standard format: Title, Status, Context, Decision, Consequences
- [ ] At least 4 alternatives evaluated: SQLite, Redis, etcd, CockroachDB
- [ ] Evaluation criteria defined: ACID support, distributed locking, operational complexity, ecosystem
- [ ] PostgreSQL selection justified with evidence from RES005, RES006, RES007 findings
- [ ] Consequences documented: positive (locking, ACID), negative (operational overhead, hosting)
- [ ] Migration impact assessed: what changes when moving from files to PostgreSQL
- [ ] ADR delivered at docs/architecture/adr/adr-001-postgresql.md

---

## FORGEOS-ARCH003: ADR — MCP as Agent Communication Protocol

**Type:** architecture
**Priority:** high
**Dependencies:** FORGEOS-RES001, FORGEOS-RES002, FORGEOS-RES010
**Files:** docs/architecture/adr/adr-002-mcp-protocol.md
**Tags:** architecture, adr, mcp, protocol, phase1, BLK-02-01

### Description

Author an Architecture Decision Record documenting the decision to adopt MCP (Model Context Protocol) as the primary agent-to-platform communication protocol. Evaluate alternatives (gRPC, REST-only, custom WebSocket protocol), document trade-offs including maturity risk, and justify the selection based on AI-native tool semantics.

### Acceptance Criteria

- [ ] ADR follows standard format: Title, Status, Context, Decision, Consequences
- [ ] At least 3 alternatives evaluated: gRPC, REST-only, custom WebSocket protocol
- [ ] AI agent interaction fitness assessed for each alternative
- [ ] MCP selection justified with evidence from RES001, RES002, RES010 findings
- [ ] Maturity risk acknowledged with mitigation strategy (REST fallback layer)
- [ ] Transport decision documented: primary transport selection with fallback
- [ ] Consequences documented: positive (AI-native, tool semantics), negative (maturity, ecosystem)
- [ ] ADR delivered at docs/architecture/adr/adr-002-mcp-protocol.md

---

## FORGEOS-ARCH004: ADR — Dual-Mode Migration Strategy

**Type:** architecture
**Priority:** high
**Dependencies:** FORGEOS-RES009, FORGEOS-RES012
**Files:** docs/architecture/adr/adr-003-migration-strategy.md
**Tags:** architecture, adr, migration, phase1, BLK-02-01

### Description

Author an Architecture Decision Record documenting the dual-mode migration strategy for ForgeOS: the filesystem ticket system builds its own replacement while continuing to operate. Document the phased cutover plan, rollback mechanisms, data integrity verification during migration, and the criteria for switching from filesystem-primary to database-primary mode.

### Acceptance Criteria

- [ ] ADR follows standard format: Title, Status, Context, Decision, Consequences
- [ ] Dual-mode operation defined: filesystem and database running in parallel during migration
- [ ] Phased cutover plan with at least 3 phases: shadow mode, dual-write, database-primary
- [ ] Rollback mechanism defined for each migration phase
- [ ] Data integrity verification strategy: how to confirm filesystem and database are in sync
- [ ] Cutover criteria defined: measurable conditions for promoting database to primary
- [ ] Risk assessment: what happens if migration fails at each phase
- [ ] ADR delivered at docs/architecture/adr/adr-003-migration-strategy.md

---

## FORGEOS-ARCH005: Design Core Database Schema

**Type:** architecture
**Priority:** critical
**Dependencies:** FORGEOS-ARCH001, FORGEOS-ARCH002
**Files:** docs/architecture/database-schema.md
**Tags:** architecture, database, schema, phase1, BLK-02-02

### Description

Design the complete PostgreSQL schema for the ForgeOS platform. Define all tables (tickets, claims, lease_heartbeats, stage_transitions, agents, machines, operators, file_locks), their columns, data types, relationships, primary keys, foreign keys, unique constraints, and NOT NULL constraints. Produce an ER diagram and document the rationale for schema design decisions.

### Acceptance Criteria

- [ ] All tables defined with columns, data types, and constraints: tickets, claims, lease_heartbeats, stage_transitions, agents, machines, operators, file_locks
- [ ] Primary keys, foreign keys, and unique constraints documented per table
- [ ] JSONB columns identified for flexible fields: dependencies, file_paths, acceptance_criteria, tags
- [ ] ER diagram showing all table relationships
- [ ] Data type rationale documented: why TEXT vs VARCHAR, TIMESTAMPTZ vs TIMESTAMP, etc.
- [ ] Schema supports all SDLC operations: claim, advance, rework, sync, validate
- [ ] Migration path from ticket JSON structure to relational schema documented
- [ ] Schema document delivered at docs/architecture/database-schema.md

---

## FORGEOS-ARCH006: Design Database Index and Performance Strategy

**Type:** architecture
**Priority:** medium
**Dependencies:** FORGEOS-ARCH005
**Files:** docs/architecture/database-indexes.md
**Tags:** architecture, database, indexes, performance, phase1, BLK-02-02

### Description

Design the indexing strategy for the ForgeOS PostgreSQL schema. Define primary indexes, composite indexes (stage + claimed_by for claim queries), GIN indexes on JSONB columns (dependencies, file_paths), partial indexes for active claims, and covering indexes for hot query paths. Document expected query patterns and their index utilization.

### Acceptance Criteria

- [ ] Primary and unique indexes defined for all tables
- [ ] Composite index on (stage, claimed_by) designed for claim queue queries
- [ ] GIN indexes on JSONB columns: dependencies array, file_paths array, tags array
- [ ] Partial indexes designed for active claims (WHERE claimed_by IS NOT NULL)
- [ ] Top 10 query patterns documented with EXPLAIN plan expectations
- [ ] Index maintenance considerations: bloat, REINDEX, auto-vacuum impact
- [ ] Index strategy document delivered at docs/architecture/database-indexes.md

---

## FORGEOS-ARCH007: Design Event Sourcing Audit Trail Schema

**Type:** architecture
**Priority:** medium
**Dependencies:** FORGEOS-ARCH005, FORGEOS-RES008
**Files:** docs/architecture/event-sourcing-schema.md
**Tags:** architecture, database, event-sourcing, audit, phase1, BLK-02-02

### Description

Design the event sourcing schema for the ForgeOS ticket audit trail, replacing the in-JSON history array. Define the event_history table structure, event types, payload schemas per event type, sequence numbering, and the mechanism for reconstructing ticket state from events. Integrate findings from RES008 feasibility assessment.

### Acceptance Criteria

- [ ] Event history table designed: event_id, ticket_id, event_type, payload, agent, machine_id, timestamp, sequence_number
- [ ] All event types cataloged: CREATED, CLAIMED, RELEASED, ADVANCED, REWORKED, ESCALATED, DONE (minimum)
- [ ] Payload schema defined per event type (what data each event carries)
- [ ] Sequence numbering strategy: per-ticket monotonic sequence for ordering guarantees
- [ ] State reconstruction pattern documented: how to rebuild current ticket state from events
- [ ] LISTEN/NOTIFY integration point identified for real-time event streaming
- [ ] Event archival strategy for old events (partition by month, or retention policy)
- [ ] Schema document delivered at docs/architecture/event-sourcing-schema.md

---

## FORGEOS-ARCH008: Design REST API OpenAPI Specification

**Type:** architecture
**Priority:** high
**Dependencies:** FORGEOS-ARCH001
**Files:** docs/architecture/api/openapi-spec.yaml
**Tags:** architecture, api, rest, openapi, phase1, BLK-02-03

### Description

Design the complete OpenAPI 3.1 specification for the ForgeOS REST API. Define all endpoints for ticket operations (list, get, claim, advance, rework, release), stage pipeline overview, health checks, and WebSocket connection for real-time updates. Include request/response schemas, authentication headers, and error response models.

### Acceptance Criteria

- [ ] OpenAPI 3.1 spec with all REST endpoints: GET /api/tickets, GET /api/tickets/:id, POST /api/tickets/:id/claim, POST /api/tickets/:id/advance, POST /api/tickets/:id/rework, POST /api/tickets/:id/release
- [ ] GET /api/tickets supports query filters: stage, type, priority, claimed_by with pagination
- [ ] GET /api/tickets/:id/history endpoint for event log retrieval
- [ ] GET /api/stages endpoint for pipeline stage overview
- [ ] GET /api/health endpoint with readiness and liveness semantics
- [ ] Request and response schemas defined with JSON Schema for all endpoints
- [ ] Error response model: status code, error code, message, details
- [ ] WebSocket /ws/tickets contract defined for real-time ticket state streaming
- [ ] OpenAPI spec delivered at docs/architecture/api/openapi-spec.yaml

---

## FORGEOS-ARCH009: Design MCP Tool Definition Schemas

**Type:** architecture
**Priority:** high
**Dependencies:** FORGEOS-ARCH001, FORGEOS-RES001, FORGEOS-RES003
**Files:** docs/architecture/api/mcp-tool-definitions.md
**Tags:** architecture, api, mcp, tools, phase1, BLK-02-03

### Description

Design the MCP tool definitions for all ticket operations exposed to AI agents via the MCP server. Define tool schemas (name, description, input JSON Schema, output format) for: tickets.next, tickets.claim, tickets.advance, tickets.rework, tickets.release, tickets.status, tickets.sync, tickets.validate. Ensure schemas are compatible with the MCP Python SDK tool registration API.

### Acceptance Criteria

- [ ] MCP tool definition for tickets.next: claim next available ticket for agent role, input schema with agent_role filter
- [ ] MCP tool definition for tickets.claim: claim specific ticket by ID, input schema with ticket_id and agent identity
- [ ] MCP tool definition for tickets.advance: move ticket to next SDLC stage, input schema with evidence payload
- [ ] MCP tool definition for tickets.rework: send ticket back to implementation stage, input schema with rejection reason
- [ ] MCP tool definition for tickets.release: release a claim, input schema with ticket_id
- [ ] MCP tool definition for tickets.status: query ticket state, input schema supporting single and batch queries
- [ ] MCP tool definition for tickets.sync: trigger dependency resolution, output schema with sync results
- [ ] All tool schemas use JSON Schema for input validation, compatible with MCP SDK tool registration
- [ ] Tool definitions document delivered at docs/architecture/api/mcp-tool-definitions.md

---

## FORGEOS-ARCH010: Design Error Catalog and API Standards

**Type:** architecture
**Priority:** medium
**Dependencies:** FORGEOS-ARCH008
**Files:** docs/architecture/api/error-catalog.md
**Tags:** architecture, api, errors, standards, phase1, BLK-02-03

### Description

Design the error code catalog and API standards for the ForgeOS platform. Define error code taxonomy (claim conflicts, lease expiry, validation failures, dependency blocks), pagination contract for list endpoints, filtering syntax, idempotency key semantics for mutating operations, and rate limiting policy per agent/machine.

### Acceptance Criteria

- [ ] Error code catalog with at least 20 error codes organized by category (claim, state, validation, auth, system)
- [ ] Each error code has: numeric code, string code, HTTP status mapping, human-readable message template
- [ ] Pagination contract defined: cursor-based vs offset-based, page size limits, response envelope
- [ ] Filtering syntax defined for list endpoints: field operators (eq, in, gt, lt), combination logic
- [ ] Idempotency key contract: header name, key format, deduplication window, response semantics
- [ ] Rate limiting policy: per-agent, per-machine, per-endpoint limits with 429 response format
- [ ] Error catalog document delivered at docs/architecture/api/error-catalog.md

---

## FORGEOS-ARCH011: Define Quality Attributes and Performance Targets

**Type:** architecture
**Priority:** medium
**Dependencies:** FORGEOS-ARCH001
**Files:** docs/architecture/quality-attributes.md
**Tags:** architecture, quality, performance, phase1, BLK-02-04

### Description

Define measurable quality attributes and performance targets for the ForgeOS distributed orchestration platform. Specify latency targets (p50, p95, p99 for claim, advance, sync operations), throughput targets (concurrent agents, tickets per second), availability goals (uptime SLA, recovery objectives), and correctness invariants (concurrent claim safety, state transition integrity).

### Acceptance Criteria

- [ ] Latency targets defined: p50, p95, p99 for claim (<100ms p99), advance, sync, and status operations
- [ ] Throughput targets defined: max concurrent agents (50+), max active tickets (1000+), operations per second
- [ ] Availability targets defined: uptime SLA (99.9%), RTO (<5 min), RPO (<1 min)
- [ ] Correctness invariants documented: exactly-once claim guarantee, no phantom state transitions, dependency integrity
- [ ] Scalability targets: horizontal scaling path for MCP server, vertical scaling for PostgreSQL
- [ ] Resource utilization budgets: memory per agent session, CPU per operation, connection pool sizing
- [ ] Quality attributes document delivered at docs/architecture/quality-attributes.md

---

## FORGEOS-ARCH012: Design Fitness Functions and Verification Plan

**Type:** architecture
**Priority:** medium
**Dependencies:** FORGEOS-ARCH011
**Files:** docs/architecture/fitness-functions.md
**Tags:** architecture, fitness-functions, testing, phase1, BLK-02-04

### Description

Design fitness functions and a verification plan for each quality attribute defined in ARCH011. For each performance target and correctness invariant, specify how it will be measured, what tooling is needed, acceptable thresholds, and how regressions will be detected. Include the zero-downtime migration fitness function that verifies the migration does not interrupt ongoing operations.

### Acceptance Criteria

- [ ] Fitness function defined for claim latency: benchmark setup, measurement tool, acceptable range, regression threshold
- [ ] Fitness function defined for concurrent claim safety: test scenario (N agents claiming simultaneously), expected outcome
- [ ] Fitness function defined for state transition integrity: property-based test specification
- [ ] Fitness function defined for dependency resolution correctness: test scenario with complex dependency graphs
- [ ] Fitness function for zero-downtime migration: what to measure during cutover, acceptable degradation
- [ ] Verification tooling recommendations: load testing (locust/k6), property testing (hypothesis), monitoring (prometheus)
- [ ] CI integration plan: which fitness functions run on every PR, which run nightly
- [ ] Fitness functions document delivered at docs/architecture/fitness-functions.md
