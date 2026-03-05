# Phase 1 — Research L3 Tickets

Source blocks: BLK-01-01 (MCP Protocol Research), BLK-01-02 (PostgreSQL Distributed Patterns), BLK-01-03 (Gap Analysis & Technology Evaluation)

---

## FORGEOS-RES001: Research MCP Protocol Core Specification

**Type:** research
**Priority:** critical
**Dependencies:**
**Files:** docs/research/mcp-protocol-spec.md
**Tags:** research, mcp, phase1, BLK-01-01

### Description

Investigate the Model Context Protocol (MCP) specification in depth. Document the core protocol semantics including message format (JSON-RPC 2.0), tool registration and discovery mechanism, resource exposure model, prompt template system, and session lifecycle management (initialization, capability negotiation, operation, shutdown). Produce a comprehensive research report that the Architect agent can use to make architecture decisions.

### Acceptance Criteria

- [ ] MCP protocol message format (JSON-RPC 2.0 envelope) documented with request/response/notification examples
- [ ] Tool registration semantics analyzed: how tools are declared, discovered, and invoked
- [ ] Resource and prompt template models documented with relevance assessment for ForgeOS
- [ ] Session lifecycle phases documented: initialize, capability exchange, normal operation, shutdown
- [ ] Protocol versioning and capability negotiation mechanism described
- [ ] Research report delivered at docs/research/mcp-protocol-spec.md

---

## FORGEOS-RES002: Evaluate MCP Transport Layer Options

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/mcp-transport-comparison.md
**Tags:** research, mcp, transport, phase1, BLK-01-01

### Description

Compare MCP transport layer options: stdio (local), SSE (Server-Sent Events over HTTP), and Streamable HTTP. Evaluate each transport for latency characteristics, throughput under concurrent agent load, connection management complexity, firewall/proxy compatibility, and suitability for the ForgeOS distributed orchestration use case where agents may run on multiple machines.

### Acceptance Criteria

- [ ] Stdio transport evaluated: latency profile, use case fit (local agents), limitations for distributed deployment
- [ ] SSE transport evaluated: connection persistence, reconnection semantics, proxy compatibility, scalability
- [ ] Streamable HTTP transport evaluated: request/response model, stateless operation, load balancer compatibility
- [ ] Comparison matrix produced with columns: latency, throughput, complexity, distributed suitability, proxy-friendliness
- [ ] Recommendation for ForgeOS primary and fallback transport documented with justification
- [ ] Research report delivered at docs/research/mcp-transport-comparison.md

---

## FORGEOS-RES003: Evaluate MCP Python SDK Maturity

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/mcp-sdk-evaluation.md
**Tags:** research, mcp, sdk, python, phase1, BLK-01-01

### Description

Evaluate the official MCP Python SDK for maturity, stability, and fitness for production use in the ForgeOS platform. Assess API surface completeness, error handling robustness, async support, typing coverage, test coverage, release cadence, known issues, and community adoption. Identify gaps that may require custom implementation or workarounds.

### Acceptance Criteria

- [ ] SDK API surface cataloged: server creation, tool registration, transport setup, session management
- [ ] Async/await support assessed for compatibility with asyncio-based server architecture
- [ ] Error handling patterns evaluated: exception types, error propagation, retry semantics
- [ ] SDK release cadence, versioning stability, and breaking change history documented
- [ ] Known issues and limitations cataloged with severity assessment
- [ ] Gap analysis: features needed by ForgeOS not provided by SDK, with workaround proposals
- [ ] Research report delivered at docs/research/mcp-sdk-evaluation.md

---

## FORGEOS-RES004: MCP Protocol Adoption Risk Assessment

**Type:** research
**Priority:** medium
**Dependencies:** FORGEOS-RES001, FORGEOS-RES002, FORGEOS-RES003
**Files:** docs/research/mcp-risk-assessment.md
**Tags:** research, mcp, risk, phase1, BLK-01-01

### Description

Synthesize findings from RES001, RES002, and RES003 into a comprehensive risk assessment of adopting MCP as the agent communication protocol for ForgeOS. Evaluate protocol maturity risk, SDK stability risk, vendor lock-in risk, performance risk under load, and migration complexity. Produce a risk register with mitigation strategies and a go/no-go recommendation.

### Acceptance Criteria

- [ ] Risk register with at least 8 identified risks, each with likelihood, impact, and mitigation strategy
- [ ] Protocol maturity risk evaluated against production readiness requirements
- [ ] SDK dependency risk assessed with fallback strategy if SDK becomes unmaintained
- [ ] Performance risk under concurrent agent load assessed with estimated thresholds
- [ ] Vendor lock-in analysis: cost of switching away from MCP to alternative protocol
- [ ] Go/no-go recommendation with supporting evidence from RES001-RES003 findings
- [ ] Research report delivered at docs/research/mcp-risk-assessment.md

---

## FORGEOS-RES005: Research PostgreSQL Distributed Locking Patterns

**Type:** research
**Priority:** critical
**Dependencies:**
**Files:** docs/research/pg-distributed-locking.md
**Tags:** research, postgresql, locking, phase1, BLK-01-02

### Description

Research PostgreSQL distributed locking mechanisms for the ForgeOS ticket claim system. Investigate SELECT FOR UPDATE SKIP LOCKED for fair queue semantics (replacing git-push-based claim racing), advisory locks (pg_advisory_xact_lock, pg_advisory_lock) for file-path-based mutex, and row-level locking patterns for concurrent state transitions. Include PoC SQL snippets demonstrating each pattern.

### Acceptance Criteria

- [ ] SELECT FOR UPDATE SKIP LOCKED pattern documented with queue semantics analysis and SQL examples
- [ ] Advisory lock strategies evaluated: transaction-scoped vs session-scoped, keying strategy for file paths
- [ ] Row-level locking patterns for atomic claim + state transition documented
- [ ] Deadlock scenarios identified with prevention/detection strategies
- [ ] PoC SQL snippets included for claim queue, file mutex, and state transition patterns
- [ ] Comparison with current git-push-based locking: improvements and trade-offs
- [ ] Research report delivered at docs/research/pg-distributed-locking.md

---

## FORGEOS-RES006: Research PostgreSQL Connection Pooling Strategies

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/pg-connection-pooling.md
**Tags:** research, postgresql, pooling, phase1, BLK-01-02

### Description

Evaluate connection pooling strategies for the ForgeOS PostgreSQL deployment. Compare PgBouncer (external pooler) vs asyncpg application-level pooling vs SQLAlchemy async pool. Assess pool sizing for expected concurrent agent load, connection lifecycle management, transaction routing in pooled mode, and impact on advisory lock semantics.

### Acceptance Criteria

- [ ] PgBouncer evaluated: transaction vs session pooling modes, advisory lock compatibility, operational overhead
- [ ] asyncpg application-level pool evaluated: pool sizing, connection health checks, async integration
- [ ] SQLAlchemy async pool evaluated: ORM integration benefits, pool configuration options
- [ ] Advisory lock compatibility assessed for each pooling strategy (session-scoped locks + pooling conflicts)
- [ ] Pool sizing recommendations for 10, 50, and 100 concurrent agent scenarios
- [ ] Recommendation with justification for ForgeOS pooling strategy
- [ ] Research report delivered at docs/research/pg-connection-pooling.md

---

## FORGEOS-RES007: Research PostgreSQL Transaction Isolation Levels

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/pg-transaction-isolation.md
**Tags:** research, postgresql, transactions, phase1, BLK-01-02

### Description

Analyze PostgreSQL transaction isolation levels (READ COMMITTED, REPEATABLE READ, SERIALIZABLE) for ForgeOS ticket operations. Determine appropriate isolation level for each operation type: ticket claiming (contention-heavy), state advancement (consistency-critical), dependency resolution (read-heavy), and bulk sync operations. Document serialization failure handling and retry patterns.

### Acceptance Criteria

- [ ] READ COMMITTED analyzed for claim operations: phantom read risks, concurrent claim safety
- [ ] REPEATABLE READ analyzed for state transitions: snapshot isolation benefits and trade-offs
- [ ] SERIALIZABLE analyzed for dependency resolution: serialization failure rates, retry cost
- [ ] Isolation level recommendation per operation type with justification
- [ ] Serialization failure handling pattern documented with exponential backoff strategy
- [ ] Performance impact of each isolation level assessed with expected contention scenarios
- [ ] Research report delivered at docs/research/pg-transaction-isolation.md

---

## FORGEOS-RES008: Assess Event Sourcing Feasibility in PostgreSQL

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/pg-event-sourcing.md
**Tags:** research, postgresql, event-sourcing, phase1, BLK-01-02

### Description

Assess the feasibility of using event sourcing patterns in PostgreSQL for the ForgeOS ticket audit trail. Evaluate append-only event table design, event replay for state reconstruction, LISTEN/NOTIFY for real-time event streaming, and JSONB vs normalized event storage. Compare with current JSON history array approach in ticket files.

### Acceptance Criteria

- [ ] Event sourcing table design proposed: event_id, aggregate_id, event_type, payload, timestamp, sequence
- [ ] Append-only write pattern evaluated for PostgreSQL (INSERT-only, no UPDATE/DELETE on events)
- [ ] Event replay mechanism assessed: reconstructing ticket state from event stream
- [ ] LISTEN/NOTIFY evaluated for real-time event propagation to dashboard and webhook processor
- [ ] JSONB vs normalized columns compared for event payload storage
- [ ] Storage growth projections for 1K, 10K, 100K tickets with full event history
- [ ] Feasibility verdict with recommendation for ForgeOS
- [ ] Research report delivered at docs/research/pg-event-sourcing.md

---

## FORGEOS-RES009: Current System Gap Analysis

**Type:** research
**Priority:** critical
**Dependencies:**
**Files:** docs/research/system-gap-analysis.md
**Tags:** research, gap-analysis, migration, phase1, BLK-01-03

### Description

Perform a detailed gap analysis of the current ForgeOS file-based system (tickets.py, agent-runner.py, todo_visual.py) against the distributed platform requirements. Map every current capability to its distributed equivalent, identify gaps that create migration risk, and document features that have no current equivalent (new capabilities). Produce a gap matrix suitable for architecture planning.

### Acceptance Criteria

- [ ] Complete capability inventory of tickets.py: sync, claim, advance, rework, parse, validate, status
- [ ] Complete capability inventory of agent-runner.py: two-commit protocol, git locking, lease management
- [ ] Complete capability inventory of todo_visual.py: terminal dashboard, HTML dashboard, dependency graph
- [ ] Gap matrix mapping each current capability to distributed equivalent with gap severity rating
- [ ] New capabilities not in current system identified: real-time events, file mutex, auth, webhooks
- [ ] Migration risk assessment per capability: which gaps are blocking, which are additive
- [ ] Research report delivered at docs/research/system-gap-analysis.md

---

## FORGEOS-RES010: MCP vs gRPC vs REST Protocol Comparison

**Type:** research
**Priority:** high
**Dependencies:**
**Files:** docs/research/protocol-comparison.md
**Tags:** research, protocol, comparison, phase1, BLK-01-03

### Description

Produce a comparative analysis of MCP, gRPC, and REST as the agent communication protocol for ForgeOS. Evaluate each protocol on: latency, throughput, streaming support, schema enforcement, tooling ecosystem, learning curve, debugging ease, and suitability for AI agent interaction patterns (tool calls, context exchange, session management).

### Acceptance Criteria

- [ ] MCP evaluated: strengths (AI-native design, tool semantics), weaknesses (maturity, ecosystem size)
- [ ] gRPC evaluated: strengths (performance, schema enforcement), weaknesses (complexity, browser support)
- [ ] REST evaluated: strengths (simplicity, tooling), weaknesses (chattiness, no native streaming)
- [ ] Comparison matrix with at least 8 evaluation dimensions scored and weighted
- [ ] AI agent interaction pattern fitness assessed: tool invocation, context passing, session management
- [ ] Decision recommendation with primary and fallback protocol selection
- [ ] Research report delivered at docs/research/protocol-comparison.md

---

## FORGEOS-RES011: Web Framework and ORM Evaluation

**Type:** research
**Priority:** medium
**Dependencies:**
**Files:** docs/research/framework-evaluation.md
**Tags:** research, framework, orm, python, phase1, BLK-01-03

### Description

Evaluate Python web frameworks and ORM/query builder options for the ForgeOS REST API layer. Compare FastAPI vs Flask vs Litestar for async support, validation, OpenAPI generation, and middleware ecosystem. Compare SQLAlchemy (async) vs asyncpg (raw) vs Tortoise ORM for database access patterns required by ForgeOS.

### Acceptance Criteria

- [ ] FastAPI evaluated: async native, Pydantic validation, automatic OpenAPI, dependency injection
- [ ] Flask evaluated: maturity, extension ecosystem, async limitations, community size
- [ ] Litestar evaluated: performance, async native, validation, comparison with FastAPI
- [ ] SQLAlchemy async evaluated: ORM features, migration integration (Alembic), query builder flexibility
- [ ] asyncpg raw evaluated: performance, control, maintenance burden of raw SQL
- [ ] Framework recommendation with justification based on ForgeOS requirements
- [ ] ORM recommendation with justification for ForgeOS query patterns
- [ ] Research report delivered at docs/research/framework-evaluation.md

---

## FORGEOS-RES012: Database Migration Tooling Evaluation

**Type:** research
**Priority:** medium
**Dependencies:**
**Files:** docs/research/migration-tooling.md
**Tags:** research, migration, alembic, phase1, BLK-01-03

### Description

Evaluate database migration tooling for the ForgeOS PostgreSQL schema. Compare Alembic (SQLAlchemy-based), Flyway, custom migration scripts, and yoyo-migrations. Assess auto-generation capability, rollback safety, CI integration, multi-environment support, and suitability for the ForgeOS dual-mode migration from JSON files to PostgreSQL.

### Acceptance Criteria

- [ ] Alembic evaluated: auto-generation, revision chaining, async support, SQLAlchemy integration
- [ ] Flyway evaluated: version-based migrations, Java dependency trade-off, PostgreSQL support
- [ ] Custom migration script approach evaluated: flexibility vs maintenance burden
- [ ] Migration rollback safety assessed for each tool: up/down script reliability
- [ ] CI integration patterns documented for each tool: how migrations run in CI pipeline
- [ ] JSON-to-PostgreSQL data migration strategy compatibility assessed per tool
- [ ] Recommendation with justification for ForgeOS migration tooling
- [ ] Research report delivered at docs/research/migration-tooling.md
