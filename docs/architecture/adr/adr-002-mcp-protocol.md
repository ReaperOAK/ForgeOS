---
title: "ADR-002: MCP as Agent Communication Protocol"
ticket: FORGEOS-ARCH003
type: architecture
subtype: adr
author: Architect
date: 2026-03-06T00:00:00Z
status: ACCEPTED
audience: All engineers, architects, and operators working on ForgeOS
purpose: Document the decision to adopt MCP (Model Context Protocol) as the primary agent-to-orchestrator communication protocol
last_reviewed: 2026-03-06T18:00:00Z
diataxis_quadrant: explanation
tags: [architecture, adr, mcp, protocol, phase1]
---

# ADR-002: MCP as Agent Communication Protocol

> **Ticket:** FORGEOS-ARCH003 | **Agent:** Architect | **Date:** 2026-03-06  
> **Status:** ACCEPTED  
> **Confidence:** HIGH (92%)  
> **Deciders:** Architecture team  
> **Evidence Base:** FORGEOS-RES001, FORGEOS-RES002, FORGEOS-RES003, FORGEOS-RES010

---

## Table of Contents

1. [Title](#1-title)
2. [Status](#2-status)
3. [Context](#3-context)
4. [Decision](#4-decision)
5. [Alternatives Considered](#5-alternatives-considered)
6. [AI Agent Interaction Fitness Assessment](#6-ai-agent-interaction-fitness-assessment)
7. [Transport Decision](#7-transport-decision)
8. [Maturity Risk and Mitigation](#8-maturity-risk-and-mitigation)
9. [Consequences](#9-consequences)
10. [Fitness Functions](#10-fitness-functions)
11. [Decision Validation](#11-decision-validation)
12. [References](#12-references)
13. [Glossary](#13-glossary)

---

## 1. Title

**MCP (Model Context Protocol) as Primary Agent-to-Orchestrator Communication Protocol**

## 2. Status

**ACCEPTED** — 2026-03-06

## 3. Context

### 3.1 Problem Statement

ForgeOS is a distributed multi-agent orchestration platform where autonomous AI agents (Backend, Frontend, QA, Security, etc.) communicate with a centralized server to claim tickets, report progress, and advance through SDLC stages. The platform requires a communication protocol that:

1. **Supports distributed deployment** — Agents run on multiple machines across networks
2. **Provides tool semantics** — Agents discover, invoke, and receive structured results from server-side operations (claim, complete, reject, spawn tickets)
3. **Enables dynamic discovery** — New tools can be added without redeploying all agent clients
4. **Handles session lifecycle** — Capability negotiation, lease management, graceful disconnect
5. **Integrates with LLM hosts** — Agents are powered by LLMs in host applications (VS Code, CLI, custom)
6. **Scales to 10-100 concurrent agents** — Not high-throughput microservice scale, but multi-agent coordination

### 3.2 Current State

ForgeOS has already implemented an MCP-based architecture:

- **10 MCP tools** registered via `@modelcontextprotocol/sdk ^1.27.1`: `tickets.next`, `tickets.claim`, `tickets.update`, `tickets.complete`, `tickets.reject`, `tickets.spawn`, `tickets.graph`, `tickets.release`, `tickets.extend`, `tickets.stats`
- **Streamable HTTP transport** at `/mcp` endpoint (stateless mode)
- **835 lines of type definitions** in `forgeos-server/src/types/index.ts` with Zod schema validation
- **PostgreSQL 17 backend** with stored functions, RLS, and LISTEN/NOTIFY
- **Express server** with auth middleware and structured logging (Pino)

### 3.3 Decision Drivers

| Driver | Priority | Description |
|--------|----------|-------------|
| AI-native tool semantics | Critical | Protocol must natively support tool discovery, invocation, progress, and structured results |
| Distributed suitability | Critical | Agents on multiple machines must reach the server over standard HTTP |
| Migration cost | High | Existing MCP implementation represents significant engineering investment |
| Schema enforcement | High | All tool inputs and outputs must be validated against schemas |
| Debugging ease | Medium | JSON-readable wire format preferred for multi-agent development |
| Streaming/progress | Medium | Long-running tool calls need progress reporting |
| Ecosystem maturity | Medium | SDK stability and community support matter for long-term maintenance |
| Browser support | Low | Dashboard needs are served by existing REST/SSE endpoints |

### 3.4 Research Foundation

This decision is grounded in three completed research reports:

| Report | Ticket | Confidence | Key Finding |
|--------|--------|------------|-------------|
| [MCP Protocol Core Specification](../../research/mcp-protocol-spec.md) | FORGEOS-RES001 | 92% | MCP's tool-centric design maps directly to ForgeOS ticket operations; JSON-RPC 2.0 foundation is mature |
| [MCP Transport Layer Comparison](../../research/mcp-transport-comparison.md) | FORGEOS-RES002 | 88% | Streamable HTTP scored 8.65/10, outperforming stdio (3.30) and deprecated HTTP+SSE (5.40) |
| [MCP vs gRPC vs REST Comparison](../../research/protocol-comparison.md) | FORGEOS-RES010 | 89% | MCP scored 8.00/10, outperforming gRPC (6.05) and REST (5.63) for ForgeOS's use case |
| [MCP Python SDK Evaluation](../../research/mcp-sdk-evaluation.md) | FORGEOS-RES003 | 82% | Python SDK is production-grade with caveats; pin to v1.x, plan for v2 migration |

---

## 4. Decision

**Adopt MCP (Model Context Protocol) as the primary communication protocol for all agent-to-orchestrator interactions in ForgeOS.**

Specifically:

1. **Protocol:** MCP over JSON-RPC 2.0 (spec revision 2025-03-26)
2. **Primary transport:** Streamable HTTP (stateless mode, single `/mcp` endpoint)
3. **Fallback transport:** stdio for local development and testing
4. **SDK (server):** `@modelcontextprotocol/sdk ^1.27.1` (TypeScript, Node.js)
5. **SDK (future agents):** `mcp >=1.25,<2` (Python) for Python-based agent clients
6. **Supplementary protocol:** REST for dashboard, health checks, and external integrations (coexists on same Express server)
7. **Not adopted:** gRPC, custom WebSocket protocol, HTTP+SSE (deprecated by MCP spec)

### 4.1 Justification Summary

MCP is selected because it is the **only protocol purpose-built for AI agent communication**, providing:

- **Native tool discovery and invocation** via `tools/list` and `tools/call`
- **JSON Schema-based input validation** matching ForgeOS's existing Zod-based schemas
- **Capability negotiation** at session initialization for role-based access
- **Progress reporting** via `notifications/progress` for long-running operations
- **Resource exposure** via `resources/read` for context passing
- **Transport flexibility** with Streamable HTTP for production and stdio for development

These features would need to be custom-built on top of gRPC or REST, adding development cost without proportional benefit.

---

## 5. Alternatives Considered

### 5.1 Alternative 1: gRPC

**Summary:** High-performance RPC framework using Protocol Buffers (binary serialization) over HTTP/2. Created by Google, widely used in microservice architectures.

| Criterion | Score | Assessment |
|-----------|-------|------------|
| AI agent interaction fitness | 4.5/10 | No native tool discovery, progress reporting, or capability negotiation. Requires building these from scratch using custom services and interceptors |
| Distributed suitability | 8/10 | Excellent — HTTP/2 multiplexing, connection pooling, deadline propagation |
| Streaming support | 9/10 | Best-in-class — unary, server-streaming, client-streaming, bidirectional |
| Schema enforcement | 10/10 | Protobuf IDL provides compile-time schema enforcement with code generation |
| Latency | 9/10 | Binary serialization + HTTP/2 yields 2-10x lower latency than JSON/HTTP |
| Throughput | 10/10 | 50K-200K RPS per instance; far exceeds ForgeOS needs |
| Debugging ease | 4/10 | Binary wire format requires specialized tooling (grpcurl, Bloom RPC) |
| Browser support | 3/10 | Requires gRPC-Web proxy (Envoy or grpc-web) for browser clients |
| Migration cost | 2/10 | 16-26 developer-days to replace existing MCP infrastructure |
| Learning curve | 5/10 | Protobuf IDL, code generation pipeline, gRPC interceptors are significant additions |
| **Weighted total** | **6.05/10** | |

**Why not selected:**

1. **No AI-agent primitives:** gRPC provides generic RPC. ForgeOS would need to build tool discovery, progress reporting, capability negotiation, and resource exposure as custom gRPC services — effectively reimplementing MCP's feature set on a different transport.
2. **Disproportionate performance:** gRPC's throughput advantage (50K+ RPS) is >100x ForgeOS's projected needs (~100s of RPS). The engineering cost of protobuf schema management, code generation pipelines, and gRPC-Web proxy outweighs zero performance benefit at this scale.
3. **Browser incompatibility:** ForgeOS dashboard requires a gRPC-Web proxy, adding operational complexity.
4. **Binary debugging burden:** During multi-agent development, JSON-readable messages are significantly more productive for debugging agent/server interactions.
5. **Massive migration cost:** Replacing existing MCP implementation (10 tools, 835 lines of types, Zod schemas, Express integration) with gRPC requires 16-26 developer-days (source: FORGEOS-RES010 §13).

**When to reconsider gRPC:**
- ForgeOS scales to >1,000 concurrent agents with >10,000 RPS
- Protobuf compile-time schema enforcement becomes critical beyond runtime Zod validation
- Service mesh deployment requires gRPC-native communication

### 5.2 Alternative 2: REST (HTTP/JSON)

**Summary:** Resource-oriented architectural style using HTTP verbs (GET, POST, PUT, DELETE) with JSON payloads. The most widely adopted API paradigm.

| Criterion | Score | Assessment |
|-----------|-------|------------|
| AI agent interaction fitness | 3.5/10 | No native tool semantics. Operations must be mapped to HTTP verb + URL conventions. No dynamic discovery, no progress reporting, no capability negotiation |
| Distributed suitability | 8/10 | Standard HTTP — fully compatible with all infrastructure |
| Streaming support | 4/10 | Requires bolting on SSE or WebSocket (separate protocol layer) |
| Schema enforcement | 5/10 | OpenAPI provides specification but not runtime enforcement without additional tooling |
| Latency | 7/10 | Standard HTTP latency, equivalent to MCP |
| Throughput | 6/10 | Equivalent to MCP (both JSON over HTTP) |
| Debugging ease | 9/10 | Excellent — curl, Postman, browser DevTools, every HTTP library |
| Browser support | 9/10 | Native — fetch API, XMLHttpRequest |
| Migration cost | 4/10 | Moderate — would require redesigning 10 tools as REST endpoints |
| Learning curve | 10/10 | Universal knowledge — every developer knows REST |
| **Weighted total** | **5.63/10** | |

**Why not selected:**

1. **No tool semantics:** REST is resource-oriented, not operation-oriented. Mapping `tickets.claim(ticket_id, agent, machine)` to `POST /api/v1/tickets/{id}/claim` loses the uniform `tools/call` interface and requires AI agents to understand HTTP verb+URL patterns instead of tool names.
2. **No dynamic discovery:** REST's API spec is static (OpenAPI at `/openapi.json`). MCP's `tools/list` provides runtime tool discovery — if ForgeOS adds a new tool, agents discover it at the next `tools/list` call without client updates.
3. **No progress reporting:** REST provides no built-in mechanism for reporting progress on long-running operations. MCP's `notifications/progress` with `progressToken` handles this natively.
4. **No capability negotiation:** REST has no session initialization with capability negotiation. Role-based tool visibility would need custom middleware vs. MCP's built-in initialize handshake.
5. **No batching:** REST lacks native request batching. Agents making multiple calls require multiple round-trips. MCP supports JSON-RPC batching for multi-tool operations in a single HTTP request.

**When REST is appropriate (and already used):**
- Dashboard health checks (`GET /health`)
- SSE event streaming (`GET /events`)
- Static file serving (`GET /dashboard/*`)
- Future external API for third-party integrations

### 5.3 Alternative 3: Custom WebSocket Protocol

**Summary:** A bespoke binary or JSON protocol over WebSocket connections, designed specifically for ForgeOS.

| Criterion | Score | Assessment |
|-----------|-------|------------|
| AI agent interaction fitness | 6/10 | Can be designed to fit, but requires defining all semantics from scratch |
| Distributed suitability | 6/10 | WebSocket connections are stateful; sticky sessions required for load balancing |
| Streaming support | 9/10 | Full bidirectional streaming over persistent connections |
| Schema enforcement | 3/10 | No standard — must build custom validation layer |
| Latency | 8/10 | Sub-millisecond after connection establishment; persistent connection avoids handshake |
| Throughput | 7/10 | Good for persistent connections; limited by single-connection model per agent |
| Debugging ease | 3/10 | Custom protocol requires custom debugging tools |
| Browser support | 7/10 | Native WebSocket API available in all browsers |
| Migration cost | 1/10 | Maximum cost — entire protocol, SDK, and server must be designed and built |
| Learning curve | 2/10 | Custom protocol requires extensive documentation and team training |
| Security | 4/10 | Must design authentication/authorization from scratch |
| **Weighted total** | **4.15/10** | |

**Why not selected:**

1. **Maximum engineering cost:** Designing a custom protocol requires defining message formats, error codes, session management, tool schemas, progress reporting, capability negotiation, reconnection semantics, and security model — all of which MCP already provides.
2. **No ecosystem:** No SDKs, no client libraries, no community, no test tools, no documentation beyond what the team writes.
3. **Sticky session requirement:** WebSocket connections are stateful, requiring sticky session load balancing. This conflicts with ForgeOS's stateless scaling model.
4. **Maintenance burden:** Every protocol feature must be maintained by the ForgeOS team. MCP's features are maintained by Anthropic and the open-source community.
5. **NIH anti-pattern:** Building a custom protocol when a purpose-built standard (MCP) exists is a classic "Not Invented Here" mistake.

**When custom WebSocket might be considered:**
- ForgeOS requires ultra-low-latency bidirectional communication (<1ms) that MCP cannot provide
- MCP is abandoned by its maintainers and no suitable alternative exists

---

## 6. AI Agent Interaction Fitness Assessment

This section assesses how well each protocol supports the specific interaction patterns of ForgeOS AI agents.

### 6.1 Tool Invocation

ForgeOS agents perform operations like `tickets.claim`, `tickets.complete`, `tickets.reject`. Each protocol handles this differently:

| Pattern | MCP | gRPC | REST | WebSocket |
|---------|-----|------|------|-----------|
| Uniform invocation | `tools/call` with name + args | Separate RPC per tool | Separate URL + verb per endpoint | Custom message type per operation |
| Input schema | JSON Schema (auto from Zod) | Protobuf IDL | OpenAPI (manual) | Custom (build from scratch) |
| Structured error | `isError` flag + error content | gRPC status codes | HTTP status codes | Custom error format |
| Tool metadata | Annotations (readOnly, destructive) | Custom metadata fields | OpenAPI extensions | Custom |

**Winner: MCP** — Purpose-built for tool invocation with uniform `tools/call` semantics.

### 6.2 Tool Discovery

When ForgeOS adds a new tool (e.g., `tickets.archive`), each protocol handles discovery differently:

| Pattern | MCP | gRPC | REST | WebSocket |
|---------|-----|------|------|-----------|
| Runtime discovery | `tools/list` → live tool catalog | gRPC reflection (opt-in) | `GET /openapi.json` (static) | Custom discovery message |
| Change notification | `notifications/tools/list_changed` | Not built-in | External mechanism | Custom |
| Schema per tool | Inline JSON Schema | Proto file compilation | External OpenAPI spec | Custom |

**Winner: MCP** — Real-time tool discovery with change notifications is unmatched.

### 6.3 Context Passing

Agents need ticket state, dependency graphs, and agent output summaries:

| Pattern | MCP | gRPC | REST | WebSocket |
|---------|-----|------|------|-----------|
| Data retrieval | `resources/read(uri)` | Custom GetXxx RPCs | `GET /resource/{id}` | Custom request |
| URI-based addressing | Built-in (`forgeos://tickets/ID`) | Not built-in | REST URLs (similar) | Custom |
| Subscription | `resources/subscribe` | Server-streaming RPC | SSE/WebSocket addon | Native streaming |

**Winner: MCP** — URI-based resource model with subscription is cleanest for context passing.

### 6.4 Session Management

ForgeOS agents negotiate capabilities at session start:

| Pattern | MCP | gRPC | REST | WebSocket |
|---------|-----|------|------|-----------|
| Capability negotiation | `initialize` handshake | Custom unary RPC | Custom endpoint | Custom message |
| Session identity | `Mcp-Session-Id` header | Metadata headers | Cookie/token | Connection ID |
| Graceful shutdown | `close` notification | Channel shutdown | N/A (stateless) | Close frame |

**Winner: MCP** — Protocol-level capability negotiation designed for agent role differentiation.

### 6.5 Progress Reporting

Long-running operations (e.g., `tickets.graph` building dependency DAG) need progress updates:

| Pattern | MCP | gRPC | REST | WebSocket |
|---------|-----|------|------|-----------|
| Built-in progress | `notifications/progress` with token | Custom server-stream | Polling or SSE addon | Custom messages |
| Percentage reporting | `progress`/`total` fields | Custom fields | Custom | Custom |
| Cancellation | `notifications/cancelled` | `context.cancel()` | Custom DELETE | Custom message |

**Winner: MCP** — Native progress reporting with cancellation is purpose-built for long-running tool calls.

### 6.6 Fitness Summary

| Protocol | Tool Invocation | Discovery | Context | Sessions | Progress | **Total** |
|----------|----------------|-----------|---------|----------|----------|-----------|
| MCP | 9.5 | 10 | 9 | 9 | 9.5 | **9.4** |
| gRPC | 7 | 5 | 6 | 4 | 6 | **5.6** |
| REST | 6 | 4 | 7 | 3 | 3 | **4.6** |
| WebSocket | 5 | 2 | 5 | 5 | 6 | **4.6** |

**MCP's AI agent interaction fitness (9.4/10) significantly outperforms all alternatives.** This validates MCP's core thesis: a protocol designed for AI agent communication outperforms general-purpose protocols adapted for the same purpose.

---

## 7. Transport Decision

### 7.1 Primary: Streamable HTTP (Stateless Mode)

**Decision:** Use Streamable HTTP as the primary MCP transport for all production agent-to-server communication.

**Evidence (FORGEOS-RES002):**

| Transport | Weighted Score | Rank |
|-----------|---------------|------|
| Streamable HTTP | 8.65/10 | 1st |
| HTTP+SSE (deprecated) | 5.40/10 | 2nd |
| stdio | 3.30/10 | 3rd |

**Configuration:**
- Single endpoint: `POST /mcp`, `GET /mcp`, `DELETE /mcp`
- Stateless mode: `sessionIdGenerator: undefined` — maximizes horizontal scaling
- No sticky sessions required — any request can be served by any server instance
- Standard HTTP load balancing (round-robin or least-connections)

**Rationale:**
1. Already implemented and tested in `forgeos-server/src/server.ts`
2. Stateless mode enables true horizontal scaling with standard load balancers
3. Single endpoint simplifies proxy/firewall configuration
4. OAuth 2.1 framework available when auth upgrade is needed
5. Resumability via `Last-Event-ID` for SSE streams when needed

### 7.2 Fallback: stdio

**Decision:** Support stdio as a secondary transport for local development and testing.

**Use cases:**
- Developer testing agents on local machine without network setup
- CI/CD pipeline tool invocations in ephemeral environments
- IDE integration debugging

**Implementation:** `@modelcontextprotocol/sdk` provides `StdioServerTransport`. ForgeOS can offer a `--transport=stdio` flag for local-mode server startup.

### 7.3 Not Adopted: HTTP+SSE

**Decision:** Do not implement HTTP+SSE support. It is deprecated by the MCP specification (2025-03-26) and offers no advantages over Streamable HTTP.

---

## 8. Maturity Risk and Mitigation

### 8.1 Risk Assessment

MCP is a younger protocol than gRPC (2016) and REST (2000). This introduces maturity risk:

| Risk | Severity | Likelihood | Impact |
|------|----------|------------|--------|
| MCP spec breaking change (2.0) | MEDIUM | LOW (spec stabilizing, semver) | SDK migration required; API contracts may change |
| Anthropic reduces MCP investment | MEDIUM | LOW (growing ecosystem, LF Projects) | Community can maintain open spec; SDKs are open source |
| MCP ecosystem stagnates | LOW | LOW (VS Code, Cursor, JetBrains adopted) | REST fallback covers external integration needs |
| SDK regression or critical bug | MEDIUM | LOW (active maintenance, 53+ releases) | Pin SDK version; monitor changelogs |
| Competing AI protocol emerges | MEDIUM | VERY LOW (MCP has first-mover advantage) | Evaluate and potentially migrate if superior |

### 8.2 Mitigation Strategy: REST Fallback Layer

**Decision:** Maintain a REST fallback capability within the same Express server.

ForgeOS already implements REST endpoints alongside MCP:

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `POST /mcp` | MCP | Agent tool invocations (primary path) |
| `GET /mcp` | MCP | Server-initiated SSE stream (optional) |
| `DELETE /mcp` | MCP | Session termination |
| `GET /health` | REST | Health checks, monitoring |
| `GET /events` | REST/SSE | Real-time event stream for dashboard |
| `GET /dashboard/*` | REST | Static dashboard files |

**If MCP becomes untenable,** the migration path is:
1. Expose each MCP tool as a REST endpoint (e.g., `POST /api/v1/tickets/{id}/claim`)
2. Add `GET /api/v1/openapi.json` for tool discovery (static, replacing dynamic `tools/list`)
3. Replace MCP progress reporting with SSE event stream
4. Update agent clients to use HTTP REST instead of MCP JSON-RPC

**Estimated migration effort:** 5-8 developer-days (source: FORGEOS-RES010 §13) — significantly less than the 16-26 days required for gRPC migration. The REST endpoints share the same Express server, auth middleware, and database layer.

### 8.3 SDK Version Pinning Strategy

| Component | Current Version | Pin Range | Migration Trigger |
|-----------|----------------|-----------|-------------------|
| TypeScript SDK (server) | `^1.27.1` | `>=1.27,<2` | Monitor v2.0 pre-releases; plan migration when v2 reaches RC |
| Python SDK (future agents) | Not yet used | `>=1.25,<2` | Same trigger as TypeScript |

**Refresh triggers:**
- New MCP specification revision (currently 2025-03-26)
- Major SDK version bump (v2.0)
- ForgeOS agent count exceeds 500 concurrent
- New AI communication protocol gains significant adoption

---

## 9. Consequences

### 9.1 Positive Consequences

1. **AI-native tool semantics:** Agents discover and invoke tools via a standardized protocol designed for LLM-driven interactions. No custom glue code for tool discovery, schema validation, or progress reporting.

2. **Zero migration cost:** ForgeOS's existing MCP implementation (10 tools, type definitions, Streamable HTTP transport, auth middleware) continues without changes. This decision validates and ratifies existing engineering investment.

3. **Dynamic tool evolution:** New tools can be added to the server and immediately discovered by agents via `tools/list`. No client redeployment, no proto file regeneration, no OpenAPI spec updates.

4. **Structured progress reporting:** Long-running operations naturally report progress via `notifications/progress`, improving agent and operator visibility into pipeline state.

5. **Transport flexibility:** Streamable HTTP for production, stdio for development. Same protocol, different transports — agent code doesn't change.

6. **Schema validation:** Zod schemas define tool inputs with rich validation rules. The MCP SDK auto-converts these to JSON Schema for protocol compliance, providing both compile-time (TypeScript) and runtime type safety.

7. **Growing ecosystem:** MCP adoption by VS Code, Cursor, JetBrains, and other IDE vendors creates a network effect. Agent clients built for ForgeOS can potentially work with other MCP servers, and vice versa.

8. **JSON readability:** JSON-RPC wire format is human-readable, simplifying debugging during multi-agent development. Standard tools (curl, jq, browser DevTools) work without specialized software.

### 9.2 Negative Consequences

1. **Ecosystem maturity:** MCP is younger than gRPC and REST. Breaking changes in spec revisions could require migration effort. **Mitigated by:** SDK version pinning, REST fallback capability, active community monitoring.

2. **Performance ceiling:** JSON serialization over HTTP has higher overhead than protobuf/HTTP/2. At extreme scale (>10,000 RPS), MCP may become a bottleneck. **Mitigated by:** ForgeOS's projected scale is 10-100 agents (~100s RPS), well within MCP's capacity. gRPC migration path documented if scaling demands change.

3. **No bidirectional streaming:** MCP supports server-push (SSE) but not client-push or bidirectional streaming. **Mitigated by:** ForgeOS's architecture uses PostgreSQL LISTEN/NOTIFY for event distribution; bidirectional streaming is not currently needed. Future WebSocket MCP transport (if standardized) would address this.

4. **Single SDK vendor dependency:** The TypeScript and Python SDKs are maintained primarily by Anthropic. **Mitigated by:** Both SDKs are MIT-licensed open source with growing contributor bases (100+ contributors across repos). The protocol spec is open and could be implemented by others.

5. **Limited client-side tooling:** gRPC has richer generated client libraries with compile-time type safety. MCP clients construct JSON-RPC messages manually or use SDK helpers. **Mitigated by:** The MCP SDK provides `ClientSession` with typed methods for all protocol operations.

6. **Vendor association:** MCP is associated with Anthropic, which may create perception issues with organizations using other LLM providers. **Mitigated by:** MCP is an open protocol (not vendor-locked), adopted by multi-vendor IDE platforms (VS Code is Microsoft, JetBrains is independent).

---

## 10. Fitness Functions

Measurable thresholds to validate this decision over time:

| Metric | Threshold | Measurement Method | Review Frequency |
|--------|-----------|-------------------|------------------|
| Agent tool call round-trip latency (p99) | < 200ms (LAN), < 500ms (WAN) | Server-side Pino request logging | Monthly |
| Tool call success rate | > 99.5% | Event table analysis (success vs error events) | Weekly |
| Agent reconnection time | < 5s (stateless: N/A) | Client-side metrics | Monthly |
| MCP SDK upgrade effort per minor version | < 2 hours | Engineering time tracking | Per release |
| Time to add a new MCP tool | < 4 hours (including schema + tests) | Engineering time tracking | Per new tool |
| Number of agent clients unable to connect | 0 | Support tickets / monitoring | Continuous |
| REST fallback switchover time | < 8 developer-days | Validated via estimation | Annual review |

**Decision reversal trigger:** If ≥2 fitness functions consistently fail for >30 days, initiate a protocol re-evaluation using the latest RES010 scoring matrix.

---

## 11. Decision Validation

### 11.1 Context Map

**Primary files (directly affected by this decision):**

| File | Impact |
|------|--------|
| `forgeos-server/src/server.ts` | MCP endpoint configuration — validates Streamable HTTP transport choice |
| `forgeos-server/src/tools/index.ts` | MCP tool registration — validates tool semantics decision |
| `forgeos-server/src/tools/tickets-*.ts` | Individual tool implementations — operate via MCP JSON-RPC |
| `forgeos-server/src/types/index.ts` | Type definitions with Zod schemas — MCP auto-converts to JSON Schema |
| `forgeos-server/package.json` | SDK dependency (`@modelcontextprotocol/sdk ^1.27.1`) — version pinning strategy |

**Secondary files (indirectly affected):**

| File | Impact |
|------|--------|
| `forgeos-server/src/middleware/auth.ts` | Auth middleware applied before MCP tools — future OAuth 2.1 upgrade path |
| `forgeos-server/src/db/pool.ts` | Database access layer used by MCP tools — no direct protocol impact |
| `.github/agent-runner.py` | Legacy two-commit protocol — being replaced by MCP tools |
| `.github/tickets.py` | Legacy ticket state machine — being replaced by MCP tools |

**Established patterns validated:**

| Pattern | Validation |
|---------|-----------|
| MCP JSON-RPC tools | `server.tool()` registration with Zod schemas — continues as-is |
| Stateless HTTP transport | `sessionIdGenerator: undefined` — confirmed as optimal for scaling |
| Express server hosting | MCP and REST coexist on same Express instance — validated |

### 11.2 Well-Architected Framework Assessment

| Pillar | Score | Assessment |
|--------|-------|------------|
| **Operational Excellence** | 8/10 | JSON-readable wire format aids debugging; MCP progress reporting enables monitoring; structured logging via Pino |
| **Security** | 7/10 | MCP spec includes OAuth 2.1 framework; current API key auth is adequate; upgrade path clear |
| **Reliability** | 8/10 | Stateless Streamable HTTP with HTTP retries; PostgreSQL ACID guarantees; REST fallback documented |
| **Performance** | 7/10 | JSON/HTTP adequate for projected scale; fitness functions define thresholds; gRPC migration path if needed |
| **Cost Optimization** | 9/10 | Zero migration cost (existing implementation); single Express server; no additional infrastructure |
| **Sustainability** | 8/10 | Open protocol with growing community; MIT license; no vendor lock-in; documented fallback |

### 11.3 Anti-Pattern Check

| Anti-Pattern | Status | Evidence |
|--------------|--------|----------|
| Big Ball of Mud | ✅ Clear | MCP provides structured tool boundaries with validated schemas |
| Golden Hammer | ✅ Clear | MCP is used specifically for agent communication; REST retained for dashboard/health; not forced onto all interfaces |
| Distributed Monolith | ✅ Clear | Modular monolith architecture ([ADR-001](adr-001-postgresql.md)); no distributed coupling |
| God Service | ✅ Clear | 10 discrete tools with single responsibilities |
| NIH Syndrome | ✅ Clear | Adopting an established open protocol rather than building custom |
| Resume-Driven Development | ✅ Clear | MCP selected based on scored evaluation, not technology novelty |

---

## 12. References

### 12.1 Internal Research

| Reference | Path | Relevance |
|-----------|------|-----------|
| [FORGEOS-RES001: MCP Protocol Core Specification](../../research/mcp-protocol-spec.md) | `docs/research/mcp-protocol-spec.md` | Protocol semantics, JSON-RPC format, tool/resource/prompt primitives |
| [FORGEOS-RES002: MCP Transport Layer Comparison](../../research/mcp-transport-comparison.md) | `docs/research/mcp-transport-comparison.md` | Transport scoring (Streamable HTTP: 8.65/10) |
| [FORGEOS-RES003: MCP Python SDK Evaluation](../../research/mcp-sdk-evaluation.md) | `docs/research/mcp-sdk-evaluation.md` | Python SDK maturity (82% confidence) |
| [FORGEOS-RES010: MCP vs gRPC vs REST Comparison](../../research/protocol-comparison.md) | `docs/research/protocol-comparison.md` | Protocol scoring (MCP: 8.00/10) |
| [FORGEOS-ARCH001: System Component Architecture](../system-components.md) | `docs/architecture/system-components.md` | Overall architecture, component boundaries |

### 12.2 External Sources

| Source | Type | URL |
|--------|------|-----|
| MCP Specification (2025-03-26) | Official spec | https://modelcontextprotocol.io/specification/2025-03-26 |
| gRPC Documentation | Official docs | https://grpc.io/docs/ |
| Protocol Buffers Language Guide | Official docs | https://protobuf.dev/programming-guides/proto3/ |
| OpenAPI Specification 3.1 | Standard | https://spec.openapis.org/oas/v3.1.0 |
| Fielding's REST Dissertation | Academic | https://www.ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm |
| OAuth 2.1 IETF Draft | Standard | https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-12 |

---

## 13. Glossary

| Term | Definition |
|------|------------|
| **ADR** | Architecture Decision Record — a document that captures a significant architectural decision, its context, and consequences |
| **gRPC** | Google Remote Procedure Call — a high-performance RPC framework using Protocol Buffers over HTTP/2 |
| **JSON-RPC 2.0** | A stateless, lightweight remote procedure call protocol using JSON as the data format |
| **MCP** | Model Context Protocol — an open, transport-agnostic protocol for AI agent communication, built on JSON-RPC 2.0 |
| **OAuth 2.1** | An authorization framework that defines how clients obtain access tokens from an authorization server |
| **Pino** | A low-overhead structured JSON logger for Node.js |
| **Protobuf** | Protocol Buffers — Google's language-neutral binary serialization format used by gRPC |
| **RLS** | Row-Level Security — a PostgreSQL feature that restricts which rows a query can access based on the current session |
| **SSE** | Server-Sent Events — a standard for servers to push real-time updates to clients over HTTP |
| **Streamable HTTP** | The current MCP transport standard using a single HTTP endpoint for request/response and optional SSE streaming |
| **stdio** | Standard input/output — a local inter-process communication transport where messages are exchanged via stdin/stdout |
| **Zod** | A TypeScript-first schema validation library that provides both compile-time types and runtime validation |

---

*Architecture Decision Record authored by Architect agent for FORGEOS-ARCH003.*  
*All claims grounded in research reports with evidence weights.*  
*Confidence: HIGH (92%). Next review: when MCP spec revision changes or agent count exceeds 500.*
