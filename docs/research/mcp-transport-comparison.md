# MCP Transport Layer Comparison — Research Report

> **Ticket:** FORGEOS-RES002 | **Agent:** Research Analyst | **Date:** 2026-03-06  
> **Confidence:** HIGH (88%) | **Validity Window:** 6 months (until 2026-09-06)  
> **Protocol Revision Analyzed:** 2025-03-26  
> **SDK Version in ForgeOS:** `@modelcontextprotocol/sdk ^1.27.1`

---

## Executive Summary

This report evaluates the three MCP transport layer options — **stdio**, **HTTP+SSE** (deprecated), and **Streamable HTTP** — for ForgeOS's distributed multi-agent orchestration use case. The evaluation covers latency characteristics, throughput under concurrent agent load, reconnection semantics, proxy/load-balancer compatibility, and security posture.

**Recommendation:** **Streamable HTTP** is the optimal primary transport for ForgeOS distributed deployment (88% confidence). **stdio** should be retained as a fallback for local development and single-machine agent testing. **HTTP+SSE** (deprecated) should NOT be adopted — it offers no advantages over Streamable HTTP and is officially superseded.

**Bayesian Confidence Update:**
- *Prior:* 75% — Streamable HTTP is likely optimal based on ForgeOS already using it and it being the current spec standard.
- *Posterior:* 88% — Evidence strongly confirms Streamable HTTP's superiority for distributed use cases. Spec-level resumability, session management, batching support, and single-endpoint design make it the clear winner. The 12% uncertainty accounts for potential latency-sensitive edge cases where stdio might be preferable for co-located agents, and the relative immaturity of Streamable HTTP implementations in the ecosystem.

---

## Table of Contents

1. [Research Question and Methodology](#1-research-question-and-methodology)
2. [Transport Option 1: stdio](#2-transport-option-1-stdio)
3. [Transport Option 2: HTTP+SSE (Deprecated)](#3-transport-option-2-httpsse-deprecated)
4. [Transport Option 3: Streamable HTTP](#4-transport-option-3-streamable-http)
5. [Weighted Comparison Matrix](#5-weighted-comparison-matrix)
6. [Contradictions and Resolution](#6-contradictions-and-resolution)
7. [Recommendation for ForgeOS](#7-recommendation-for-forgeos)
8. [Risk Assessment](#8-risk-assessment)
9. [Sources and Evidence Chain](#9-sources-and-evidence-chain)

---

## 1. Research Question and Methodology

### Research Question

> Which MCP transport layer option (stdio, HTTP+SSE, Streamable HTTP) is optimal for ForgeOS's distributed multi-agent orchestration, where agents may run on multiple machines and coordinate through a centralized ForgeOS MCP server?

### Success Criteria

- Each transport evaluated across ≥5 dimensions (latency, throughput, reconnection, proxy compatibility, security)
- Quantitative comparison matrix with weighted scores
- Clear recommendation with confidence level and justification
- Contradictions documented and resolved

### Falsification Criteria

- Evidence that stdio or HTTP+SSE outperforms Streamable HTTP for distributed multi-agent use cases would change the recommendation
- Evidence that Streamable HTTP has critical reliability issues under concurrent load would lower confidence

### Prior Belief

**75% confidence** that Streamable HTTP is optimal because:
1. ForgeOS already implements it (`forgeos-server/src/server.ts` uses `StreamableHTTPServerTransport`)
2. It is the current MCP spec standard (2025-03-26 revision), replacing deprecated HTTP+SSE
3. HTTP-based protocols are inherently proxy/LB-friendly

### Methodology

1. **Official MCP specification** (weight 1.0) — Primary source for transport semantics
2. **ForgeOS codebase analysis** (weight 1.0) — Current implementation evidence
3. **HTTP/SSE standards** (weight 1.0) — RFC-level protocol characteristics
4. **MCP SDK source** (weight 0.9) — Implementation-level behavior
5. **Architecture best practices** (weight 0.7) — Distributed systems principles

---

## 2. Transport Option 1: stdio

**Source:** [MCP Specification — Transports § stdio](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (weight: 1.0)

### 2.1 Architecture

```
┌──────────────────────┐      ┌──────────────────────┐
│    MCP Client        │      │    MCP Server         │
│  (parent process)    │──────│  (child subprocess)   │
│                      │stdin │                       │
│                      │◄─────│                       │
│                      │stdout│                       │
└──────────────────────┘      └──────────────────────┘
```

- Client launches MCP server as a **subprocess**
- Server reads JSON-RPC from **stdin**, writes to **stdout**
- Messages are **newline-delimited** (no embedded newlines in messages)
- `stderr` available for logging (not protocol messages)

### 2.2 Latency Profile

| Metric | Value | Evidence |
|--------|-------|----------|
| Round-trip latency | **<1ms** (sub-millisecond) | IPC via OS pipes; no network stack, no TCP handshake, no TLS negotiation |
| Connection setup | **<10ms** | Process spawn time only |
| Message overhead | **Minimal** | Raw newline-delimited JSON, no HTTP framing |
| Serialization cost | **JSON only** | Same as all MCP transports |

**Assessment:** stdio has the **lowest possible latency** of any MCP transport. Pipe-based IPC avoids the entire network stack. This makes it ideal for latency-sensitive local operations.

### 2.3 Throughput Under Concurrent Agent Load

| Dimension | Assessment | Impact |
|-----------|-----------|--------|
| Concurrency model | **1:1 client-to-server** | Each agent needs its own server subprocess |
| Horizontal scaling | **Not possible** | Cannot distribute across machines |
| Resource per agent | **Full process per agent** | Memory: ~50-100MB per Node.js process |
| Connection multiplexing | **None** | Single pipe pair per session |
| Batch support | **Yes** (JSON-RPC batching) | Can batch multiple requests in one message |
| Backpressure | **OS pipe buffers** | Default 64KB buffer; blocks on full |

**Assessment:** stdio throughput is **excellent for single-agent scenarios** but **does not scale horizontally**. With 10 concurrent agents, you need 10 server subprocesses, each with independent state. This fundamentally conflicts with ForgeOS's centralized state model (PostgreSQL-backed ticket system).

**Quantitative estimate:** A single stdio pipe can handle ~10,000-50,000 JSON-RPC messages/second (limited by JSON parsing, not I/O). However, scaling to N agents requires N processes with N independent database connections.

### 2.4 Reconnection Semantics

| Aspect | Behavior |
|--------|----------|
| Connection loss | **Process death = session death** |
| Auto-reconnect | **Not supported** — client must spawn a new subprocess |
| Message replay | **Not supported** — no event IDs, no resumability |
| State recovery | **Full re-initialization required** — new `initialize` handshake |
| Graceful shutdown | Client closes stdin → server exits → SIGTERM → SIGKILL |

**Assessment:** stdio has **no reconnection capability**. If the server process crashes, all in-flight requests are lost. The client must start an entirely new subprocess and re-initialize. This is acceptable for development but problematic for production distributed systems where partial failures are expected.

### 2.5 Proxy/Load-Balancer Compatibility

| Dimension | Support |
|-----------|---------|
| HTTP proxy | ❌ Not applicable — no network |
| Reverse proxy (nginx, HAProxy) | ❌ Not applicable |
| Load balancer | ❌ Not applicable |
| Firewall traversal | ❌ Not applicable — local only |
| Container networking | ⚠️ Requires sidecar pattern |
| Service mesh | ❌ Not compatible |

**Assessment:** stdio is **fundamentally incompatible** with network infrastructure. It operates entirely within a single host. Deploying stdio-based MCP in Kubernetes or Docker Swarm requires the sidecar pattern (MCP server as a sidecar container communicating via shared stdin/stdout), which adds complexity without benefit.

### 2.6 Security Posture

| Aspect | Assessment |
|--------|-----------|
| Network exposure | **None** — no listening sockets |
| Authentication | **OS-level** — process ownership, file permissions |
| Encryption | **Not needed** — data never leaves the host |
| DNS rebinding | **Not vulnerable** — no network interface |
| Credential management | **Environment variables** — spec recommends this |
| Attack surface | **Minimal** — only the parent process can communicate |

**Assessment:** stdio has the **strongest security posture** by default because there is zero network exposure. The MCP spec explicitly states that stdio implementations SHOULD NOT follow the HTTP authorization specification — instead, they should retrieve credentials from the environment. This makes stdio **inherently secure** for local deployment but provides **no distributed authentication**.

### 2.7 Use Case Fit

| Use Case | Fitness |
|----------|---------|
| Local development/testing | ★★★★★ Ideal |
| IDE integrations (VS Code, Cursor) | ★★★★★ Standard approach |
| Single-machine agent deployment | ★★★★☆ Good, but resource-heavy |
| Multi-machine distributed agents | ★☆☆☆☆ Not designed for this |
| CI/CD pipeline tool invocation | ★★★★☆ Works well for ephemeral runs |
| ForgeOS distributed orchestration | ★★☆☆☆ Fundamentally mismatched |

### 2.8 Limitations for ForgeOS

1. **No distributed deployment:** ForgeOS agents run on multiple machines. stdio requires co-location.
2. **No shared state:** Each subprocess has independent state. ForgeOS needs centralized PostgreSQL-backed state.
3. **No load balancing:** Cannot distribute agent load across multiple ForgeOS server instances.
4. **No reconnection:** Agent crashes require full restart with no message recovery.
5. **Resource multiplication:** N agents = N server processes = N×memory footprint.

---

## 3. Transport Option 2: HTTP+SSE (Deprecated)

**Source:** [MCP Specification 2024-11-05 — Transports § HTTP with SSE](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports) (weight: 1.0)  
**Status:** **DEPRECATED** as of protocol revision 2025-03-26. Replaced by Streamable HTTP.

### 3.1 Architecture

```
┌──────────────────────┐                    ┌──────────────────────┐
│    MCP Client        │───── HTTP POST ───▶│    MCP Server        │
│                      │                    │                      │
│                      │◀──── SSE Stream ───│ Endpoint: /sse       │
│                      │                    │ Messages: /messages  │
└──────────────────────┘                    └──────────────────────┘
```

- Server provides **two endpoints**: SSE endpoint for server→client messages, POST endpoint for client→server messages
- Client first connects to SSE endpoint, receives `endpoint` event with the POST URL
- All subsequent client messages go via HTTP POST to the received endpoint
- Server messages stream back via the SSE connection

### 3.2 Latency Profile

| Metric | Value | Evidence |
|--------|-------|----------|
| Round-trip latency | **1-5ms** (local), **10-100ms** (network) | HTTP request/response cycle + SSE delivery |
| Connection setup | **50-200ms** | TCP handshake + TLS + SSE stream establishment |
| SSE delivery latency | **<1ms** (after stream established) | Push-based, no polling |
| Message overhead | **HTTP headers + SSE framing** | ~200-500 bytes per message |

**Assessment:** Moderate latency. The SSE stream provides low-latency server-to-client push, but client-to-server communication always requires a full HTTP POST request. The initial connection setup is slower due to the two-endpoint handshake.

### 3.3 Throughput Under Concurrent Agent Load

| Dimension | Assessment | Impact |
|-----------|-----------|--------|
| Concurrency model | **Many-to-one** | Multiple agents can connect to one server |
| Horizontal scaling | **Limited** | SSE streams are stateful; sticky sessions needed |
| Connection per agent | **1 SSE stream + N POST requests** | SSE consumes a server connection slot |
| Connection limit | **OS-dependent** | Typically ~10K concurrent SSE connections per server |
| Batch support | **No** | Each client message is an individual POST |
| Backpressure | **HTTP-level** | Server can return 429/503 |

**Assessment:** Better than stdio for concurrent agents — a single server process can handle multiple agents. However, SSE streams are long-lived, consuming server connection resources. Under high agent load (>1000 concurrent agents), connection exhaustion becomes a concern. Load balancing is complicated by the need for sticky sessions (SSE stream must stay on the same backend).

### 3.4 Reconnection Semantics

| Aspect | Behavior |
|--------|----------|
| SSE auto-reconnect | **Yes** — `EventSource` API has built-in reconnection |
| Reconnection delay | **Configurable** via `retry` field in SSE |
| Message replay | **Not supported** — no event IDs in spec |
| Endpoint rediscovery | **Required** — must re-establish SSE and receive new `endpoint` event |
| Session continuity | **Lost** — no session management in protocol |

**Assessment:** HTTP+SSE has basic reconnection via the `EventSource` built-in retry mechanism, but **no protocol-level resumability**. When an SSE connection drops, the client must re-establish the SSE connection, wait for a new `endpoint` event, and start fresh. Any in-flight server-to-client messages are lost. This is a significant gap for production systems.

### 3.5 Proxy/Load-Balancer Compatibility

| Dimension | Support |
|-----------|---------|
| HTTP proxy | ✅ POST requests work normally |
| Reverse proxy | ⚠️ SSE streams need special configuration (no buffering) |
| Load balancer | ⚠️ Requires sticky sessions for SSE stream affinity |
| Firewall traversal | ✅ Standard HTTP/HTTPS ports |
| Connection timeouts | ⚠️ SSE streams may be killed by proxies (default 60s timeout) |
| WebSocket fallback | ❌ No WebSocket support in spec |

**Assessment:** HTTP+SSE has **mixed proxy compatibility**. The POST endpoint works with any proxy, but the SSE stream requires:
- `X-Accel-Buffering: no` (nginx)
- `Cache-Control: no-cache`
- Disabled chunked transfer encoding buffering
- Extended or disabled connection timeouts
- Sticky session configuration on load balancers

Many enterprise proxies and CDNs (Cloudflare, AWS ALB) have SSE-specific limitations or require explicit configuration. This creates operational friction.

### 3.6 Security Posture

| Aspect | Assessment |
|--------|-----------|
| Network exposure | **Full** — HTTP endpoints exposed on network |
| Authentication | **Not specified** — no auth framework in 2024-11-05 spec |
| Encryption | **TLS recommended** — standard HTTPS |
| DNS rebinding | **Vulnerable** — spec warns, requires Origin validation |
| CORS | **Required** — SSE crosses origin boundaries |
| Attack surface | **Moderate** — two endpoints to protect |

**Assessment:** HTTP+SSE has a standard HTTP security posture but notably **lacks a protocol-level authorization framework**. The 2024-11-05 spec only mentions Origin header validation as a security measure. The OAuth 2.1 authorization framework was added in the 2025-03-26 revision alongside Streamable HTTP. This means HTTP+SSE deployments must implement custom authentication.

### 3.7 Why Deprecated

The MCP specification (2025-03-26) explicitly deprecates HTTP+SSE in favor of Streamable HTTP. Key reasons:

1. **Two-endpoint complexity:** Requires separate SSE and POST endpoints; the `endpoint` event handshake adds unnecessary coupling
2. **No resumability:** Lost connections lose all pending server messages
3. **No session management:** No protocol-level session tracking
4. **No batching in responses:** Server can only send one message per SSE event
5. **No authorization framework:** Spec didn't define auth; left to implementers
6. **Sticky session requirement:** Makes horizontal scaling operationally complex

---

## 4. Transport Option 3: Streamable HTTP

**Source:** [MCP Specification 2025-03-26 — Transports § Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) (weight: 1.0)

### 4.1 Architecture

```
┌──────────────────────┐                    ┌──────────────────────┐
│    MCP Client        │── HTTP POST /mcp ─▶│    MCP Server        │
│                      │◀─ JSON or SSE ─────│                      │
│                      │                    │ Single endpoint:     │
│   (optional)         │── HTTP GET /mcp ──▶│   /mcp               │
│                      │◀─ SSE Stream ──────│                      │
│                      │                    │                      │
│   (terminate)        │── HTTP DELETE /mcp▶│                      │
└──────────────────────┘                    └──────────────────────┘
```

- Server provides a **single HTTP endpoint** (e.g., `/mcp`)
- Client sends all messages via **HTTP POST**
- Server responds with either `application/json` (simple response) or `text/event-stream` (SSE stream for multiple messages)
- Client MAY listen for server-initiated messages via **HTTP GET** (opens SSE stream)
- Session management via `Mcp-Session-Id` header (optional)
- Session termination via **HTTP DELETE**

### 4.2 Latency Profile

| Metric | Value | Evidence |
|--------|-------|----------|
| Round-trip latency | **1-5ms** (local), **10-100ms** (network) | HTTP POST/response cycle |
| Connection setup | **50-150ms** | TCP + TLS + initialize handshake |
| Streaming latency | **<1ms** (after SSE established) | Push-based via SSE within POST response |
| Stateless mode latency | **+2-5ms** per request | New transport instance per request (ForgeOS current model) |
| Message overhead | **HTTP headers** | ~200-500 bytes, but amortized with keep-alive |

**Assessment:** Comparable latency to HTTP+SSE for individual requests. The key difference is that Streamable HTTP can return **streaming SSE responses** within a single POST request, allowing the server to send progress updates, intermediate results, and the final response in one HTTP transaction. In stateless mode (ForgeOS's current configuration), each request creates a new transport instance, adding ~2-5ms overhead — inconsequential for ticket operations but worth noting.

**ForgeOS codebase evidence:**
```typescript
// forgeos-server/src/server.ts — stateless transport
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — new transport per request
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

### 4.3 Throughput Under Concurrent Agent Load

| Dimension | Assessment | Impact |
|-----------|-----------|--------|
| Concurrency model | **Many-to-one, stateless** | Any agent can POST to any server instance |
| Horizontal scaling | **Excellent** | Standard HTTP load balancing; no sticky sessions needed in stateless mode |
| Connection per agent | **Ephemeral HTTP connections** | No persistent connection required |
| Connection limit | **HTTP server limit** | Node.js: ~10K-100K concurrent connections |
| Batch support | **Yes** (JSON-RPC batching) | Multiple requests in single POST body |
| Backpressure | **HTTP-level** | Standard 429/503 responses |
| Connection pooling | **HTTP keep-alive** | Reuse TCP connections across requests |
| Multiple streams | **Yes** | Client can maintain multiple SSE streams |

**Assessment:** Streamable HTTP has the **highest throughput potential** of the three transports for distributed multi-agent systems. Key advantages:

1. **Stateless mode enables true horizontal scaling:** With `sessionIdGenerator: undefined` (ForgeOS's current config), any request can be served by any backend instance. A simple round-robin load balancer distributes agent requests evenly.

2. **Batching reduces round trips:** Agents can batch multiple tool calls (e.g., `tickets.claim` + `tickets.update`) in a single POST.

3. **No persistent connections required:** In stateless mode, agents don't maintain SSE streams, only making HTTP requests when needed. This means the server's connection count stays low even with many agents.

4. **Optional SSE for push scenarios:** When agents need server-initiated messages (e.g., lease expiry warnings), they can open an SSE stream via GET.

**Quantitative estimate (stateless mode):**
- Single ForgeOS server instance: ~5,000-10,000 concurrent agent requests/second
- With 3 load-balanced instances: ~15,000-30,000 concurrent agent requests/second
- Each agent operation (claim/update/complete) is a single HTTP request: 5-50ms

### 4.4 Reconnection Semantics

| Aspect | Behavior |
|--------|----------|
| Connection loss (POST) | **Automatic** — next POST creates new connection |
| Connection loss (SSE/GET) | **Resumable** — via `Last-Event-ID` header |
| Message replay | **Supported** — server can replay missed events using event IDs |
| Session recovery | **Supported** — via `Mcp-Session-Id` header |
| Stateless mode recovery | **Trivial** — no session to recover, just resend request |
| Graceful shutdown | HTTP DELETE with `Mcp-Session-Id` |

**Assessment:** Streamable HTTP has the **best reconnection story** of all transports:

1. **Stateless mode (ForgeOS current):** Reconnection is a non-issue. Each request is independent. If a request fails, the agent simply retries. No session state to recover.

2. **Stateful mode (optional):** If ForgeOS enables `sessionIdGenerator`, the protocol supports full session recovery:
   - SSE streams are resumable via `Last-Event-ID` header
   - Event IDs are globally unique within a session
   - Server can replay missed messages per-stream
   - If session expires, server returns 404, and client re-initializes

3. **SSE resumability spec compliance:**
   ```
   Client opens GET /mcp → receives SSE events with IDs
   Connection drops
   Client reopens GET /mcp with Last-Event-ID: <last-id>
   Server replays missed events from that stream's cursor
   ```

### 4.5 Proxy/Load-Balancer Compatibility

| Dimension | Support |
|-----------|---------|
| HTTP proxy | ✅ Standard HTTP POST/GET/DELETE |
| Reverse proxy (nginx) | ✅ Works out of the box for POST; SSE needs `X-Accel-Buffering: no` |
| Load balancer (L7) | ✅ Round-robin in stateless mode; sticky sessions in stateful mode |
| Load balancer (L4) | ✅ TCP-level load balancing works |
| AWS ALB/NLB | ✅ ALB handles SSE with proper timeouts; NLB for TCP |
| Cloudflare | ✅ SSE supported with proper configuration |
| Firewall traversal | ✅ Standard HTTP/HTTPS ports (80/443) |
| WebSocket upgrade | ❌ Not supported (HTTP-only) |
| gRPC compatibility | ❌ Not applicable |
| API gateway | ✅ Standard REST-like endpoints |
| CDN caching | ⚠️ POST not cacheable; GET responses may be cacheable |

**Assessment:** Streamable HTTP has **excellent proxy/LB compatibility**, significantly better than HTTP+SSE because:

1. **Single endpoint:** Load balancers only need to route to one path (`/mcp`), not manage separate SSE and POST endpoints.
2. **Stateless mode eliminates sticky sessions:** In ForgeOS's stateless mode, any request can go to any backend. This is the simplest possible LB configuration.
3. **Standard HTTP methods:** POST, GET, DELETE are universally supported by all proxies, API gateways, and WAFs.
4. **Accept header negotiation:** Server can return `application/json` for simple responses (proxy-friendly) or `text/event-stream` for streaming (requires buffering disable).

**ForgeOS-specific consideration:** The `/events` SSE endpoint in `server.ts` (separate from MCP) uses PostgreSQL LISTEN/NOTIFY for real-time ticket change broadcasting. This endpoint would still need SSE-compatible proxy configuration regardless of transport choice.

### 4.6 Security Posture

| Aspect | Assessment |
|--------|-----------|
| Network exposure | **Full** — HTTP endpoint exposed |
| Authentication | **OAuth 2.1** — protocol-level authorization framework |
| Encryption | **TLS required** — HTTPS for all auth endpoints |
| DNS rebinding | **Mitigated** — Origin header validation MUST be implemented |
| PKCE | **Required** — for all OAuth clients |
| Dynamic client registration | **Supported** — RFC 7591 |
| Token management | **Bearer tokens** — in Authorization header on every request |
| Session security | **Cryptographic session IDs** — UUID/JWT recommended |
| Localhost binding | **SHOULD** — local servers bind to 127.0.0.1 only |
| Third-party auth | **Supported** — delegated authorization flow |

**Assessment:** Streamable HTTP has the **strongest security framework** of all MCP transports:

1. **OAuth 2.1 integration:** The MCP authorization spec (2025-03-26) defines a complete OAuth 2.1 flow with PKCE. This wasn't available for HTTP+SSE.
2. **Per-request authentication:** Bearer tokens MUST be included in every HTTP request, even within a session.
3. **Server metadata discovery:** `.well-known/oauth-authorization-server` endpoint for automatic auth configuration.
4. **Dynamic client registration:** Agents can auto-register with ForgeOS server without manual credential distribution.

**ForgeOS current security:** ForgeOS uses custom API key authentication (`authMiddleware` in `middleware/auth.ts`). This could be enhanced to full OAuth 2.1 as the MCP spec recommends, providing standardized agent authentication.

### 4.7 ForgeOS Codebase Evidence

ForgeOS already implements Streamable HTTP transport at the `/mcp` endpoint with the following configuration:

| Aspect | Current Implementation | Spec Compliance |
|--------|----------------------|-----------------|
| POST handler | ✅ `app.post('/mcp', ...)` | ✅ Compliant |
| GET handler | ✅ `app.get('/mcp', ...)` | ✅ Compliant |
| DELETE handler | ✅ `app.delete('/mcp', ...)` | ✅ Compliant |
| Session management | `sessionIdGenerator: undefined` (stateless) | ✅ Valid (sessions optional) |
| Transport class | `StreamableHTTPServerTransport` | ✅ Official SDK class |
| Error handling | Try/catch with 500 fallback | ✅ Compliant |
| SSE push | Separate `/events` endpoint (PostgreSQL LISTEN/NOTIFY) | ⚠️ Out-of-band (not via MCP transport) |

---

## 5. Weighted Comparison Matrix

### 5.1 Evaluation Criteria and Weights

| Criterion | Weight | Rationale |
|-----------|--------|-----------|
| Distributed suitability | 0.25 | ForgeOS's primary need: multi-machine agent coordination |
| Proxy/LB compatibility | 0.20 | Production deployment requires standard infrastructure |
| Throughput (concurrent agents) | 0.15 | Multiple agents operate simultaneously |
| Reconnection/resilience | 0.15 | Production systems must handle partial failures |
| Security posture | 0.10 | Agent authentication and authorization required |
| Latency | 0.10 | Tool calls should be responsive but are not ultra-latency-critical |
| Implementation complexity | 0.05 | Lower complexity reduces maintenance burden |

### 5.2 Scored Matrix

| Criterion | Weight | stdio | HTTP+SSE (deprecated) | Streamable HTTP |
|-----------|--------|-------|----------------------|-----------------|
| Distributed suitability | 0.25 | 1/10 | 6/10 | 9/10 |
| Proxy/LB compatibility | 0.20 | 0/10 | 5/10 | 9/10 |
| Throughput (concurrent) | 0.15 | 3/10 | 6/10 | 9/10 |
| Reconnection/resilience | 0.15 | 2/10 | 4/10 | 8/10 |
| Security posture | 0.10 | 8/10 | 5/10 | 9/10 |
| Latency | 0.10 | 10/10 | 7/10 | 7/10 |
| Implementation complexity | 0.05 | 9/10 | 4/10 | 7/10 |
| **Weighted Total** | **1.00** | **3.30** | **5.40** | **8.65** |

### 5.3 Score Justifications

**stdio scores:**
- Distributed: 1/10 — fundamentally local-only
- Proxy/LB: 0/10 — not applicable
- Throughput: 3/10 — excellent per-process but doesn't scale
- Reconnection: 2/10 — process death = total loss
- Security: 8/10 — minimal attack surface, but no distributed auth
- Latency: 10/10 — sub-millisecond IPC
- Complexity: 9/10 — simplest to implement

**HTTP+SSE scores:**
- Distributed: 6/10 — works remotely but requires two endpoints
- Proxy/LB: 5/10 — SSE streams need special proxy config; sticky sessions required
- Throughput: 6/10 — persistent SSE connections limit scalability
- Reconnection: 4/10 — SSE auto-reconnect but no message replay
- Security: 5/10 — HTTP-based but no protocol-level auth framework
- Latency: 7/10 — standard HTTP with SSE push
- Complexity: 4/10 — two-endpoint design adds complexity

**Streamable HTTP scores:**
- Distributed: 9/10 — designed for distributed deployment; stateless option
- Proxy/LB: 9/10 — single endpoint, standard HTTP, stateless mode needs no sticky sessions
- Throughput: 9/10 — stateless scaling, batching, connection pooling
- Reconnection: 8/10 — resumability via event IDs, session recovery
- Security: 9/10 — full OAuth 2.1 framework
- Latency: 7/10 — HTTP overhead but acceptable for ticket ops
- Complexity: 7/10 — single endpoint, well-defined spec

---

## 6. Contradictions and Resolution

### 6.1 Contradictions Found

| # | Contradiction | Classification | Resolution | Confidence Impact |
|---|--------------|---------------|------------|------------------|
| 1 | "Clients SHOULD support stdio whenever possible" (spec) vs. ForgeOS needs distributed deployment | **Contextual** | The spec targets general MCP clients (IDE integrations). ForgeOS is a purpose-built distributed system; the "whenever possible" qualifier acknowledges that stdio is not always suitable. ForgeOS should support stdio for local dev but not as the primary transport. | None |
| 2 | HTTP+SSE has built-in reconnection (EventSource) while Streamable HTTP POST requests don't auto-retry | **Methodological** | Different reconnection models. SSE auto-reconnect is for long-lived streams; Streamable HTTP's stateless POST model doesn't need it — failed requests are simply retried. Streamable HTTP's GET-based SSE streams also support auto-reconnect PLUS resumability via `Last-Event-ID`. Net: Streamable HTTP's reconnection is superior. | +5% confidence in Streamable HTTP |
| 3 | ForgeOS uses stateless Streamable HTTP but has a separate `/events` SSE endpoint for push notifications | **Contextual** | These serve different purposes. The MCP `/mcp` endpoint handles tool invocations. The `/events` endpoint broadcasts PostgreSQL LISTEN/NOTIFY events. This dual approach is valid — MCP could eventually subsume the push functionality if ForgeOS enables session-based transport. | None |
| 4 | stdio has "best security" (no network exposure) but "worst distributed suitability" | **Genuine** | This is a real tradeoff. Security and distributability are inversely correlated for stdio. For ForgeOS, distributability is weighted higher (0.25) than security (0.10) because the system must be distributed, and HTTP-based security (OAuth 2.1, TLS) is mature enough for production use. | None |

### 6.2 Evidence Against Recommendation

Actively searched for evidence that Streamable HTTP is NOT optimal:

1. **Latency:** stdio is 10x faster for local operations. However, ForgeOS tool calls are database-backed (5-50ms per query), so the 1-5ms HTTP overhead is <10% of total latency. Not material.

2. **Complexity:** Streamable HTTP requires HTTP server infrastructure. However, ForgeOS already has this (`express` + `@modelcontextprotocol/sdk`), so marginal complexity is zero.

3. **SSE compatibility concerns:** Some older enterprise proxies don't support SSE well. However, ForgeOS's stateless mode doesn't require SSE streams — it only uses standard HTTP POST/response. SSE is optional.

4. **Ecosystem maturity:** Streamable HTTP is newer (2025-03-26) than stdio. Some MCP client implementations may not yet support it. However, the `@modelcontextprotocol/sdk` fully supports it, and backwards compatibility with HTTP+SSE is documented in the spec.

**Conclusion:** No evidence found that would change the recommendation. The latency advantage of stdio is real but immaterial for ForgeOS's use case.

---

## 7. Recommendation for ForgeOS

### 7.1 Primary Transport: Streamable HTTP

**Confidence: 88% (HIGH)**

**Recommendation:** Continue using Streamable HTTP as the primary transport for all ForgeOS distributed agent-to-server communication.

**Justification:**
1. **Already implemented and working** — ForgeOS server has a compliant Streamable HTTP transport at `/mcp`
2. **Optimal for distributed deployment** — Stateless mode enables horizontal scaling with standard load balancers
3. **Best proxy/LB compatibility** — Single endpoint, standard HTTP methods
4. **Protocol-level security** — OAuth 2.1 framework available when needed
5. **Resumability** — Event ID-based message replay for SSE streams
6. **Future-proof** — Current MCP spec standard; old HTTP+SSE is deprecated
7. **Weighted score: 8.65/10** — Highest of all three transports

### 7.2 Fallback Transport: stdio

**Recommendation:** Support stdio as a secondary transport for local development and testing.

**Use cases:**
- Developer testing agents on local machine without network setup
- CI/CD pipeline tool invocations in ephemeral environments
- IDE integration for agent debugging

**Implementation approach:** The `@modelcontextprotocol/sdk` provides `StdioServerTransport` out of the box. ForgeOS could offer a `--transport=stdio` flag for local-mode server startup.

### 7.3 Do NOT Adopt: HTTP+SSE

**Recommendation:** Do not implement HTTP+SSE support. It is deprecated and offers no advantages over Streamable HTTP.

**Exception:** If ForgeOS needs to support MCP clients using the old 2024-11-05 protocol revision, the Streamable HTTP backwards compatibility guide in the spec documents how to handle this. The spec's recommendation is to accept the old POST format but respond using the new Streamable HTTP semantics.

### 7.4 Configuration Recommendations

| Aspect | Current | Recommended | Rationale |
|--------|---------|-------------|-----------|
| Session mode | Stateless | **Stateless** (keep) | Maximizes scaling, simplifies LB |
| Session mode (future) | — | Consider stateful for push | When agents need server-initiated messages |
| SSE push | Separate `/events` endpoint | Keep for now; consider MCP GET stream | Current approach works; MCP-native push is cleaner long-term |
| Auth | Custom API key | **Upgrade to OAuth 2.1** | Aligns with MCP spec; enables dynamic registration |
| Origin validation | Unknown | **MUST implement** | Spec requirement to prevent DNS rebinding |
| Batching | Not used | **Enable** | Reduces round trips for multi-tool agent operations |

---

## 8. Risk Assessment

### 8.1 Risks of Recommending Streamable HTTP

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| SSE streaming issues with enterprise proxies | Low (20%) | Medium | Stateless mode avoids SSE entirely; configure proxies when SSE needed |
| SDK breaking changes | Low (15%) | High | Pin SDK version; monitor changelog; `^1.27.1` semver protects against major breaks |
| Protocol revision breaking changes | Very Low (5%) | High | Spec has backwards compatibility guidelines; version negotiation in protocol |
| Latency insufficient for real-time use cases | Low (10%) | Low | ForgeOS ops are DB-backed (5-50ms); HTTP overhead is marginal |
| Ecosystem fragmentation (competing protocols) | Medium (25%) | Medium | MCP is backed by Anthropic/LF Projects; growing adoption reduces risk |

### 8.2 What Could Make This Recommendation Wrong in 6 Months

1. **WebSocket-based MCP transport** gains traction — would offer better bidirectional streaming than SSE. However, this would be additive, not replacing Streamable HTTP.
2. **ForgeOS adds latency-critical operations** (e.g., real-time collaborative editing) — would favor WebSocket or stdio-like transports. However, current ticket operations are not latency-critical.
3. **Major SDK regression** — could temporarily degrade Streamable HTTP support. Mitigated by version pinning.
4. **A competitor protocol** (e.g., from OpenAI) emerges and gains critical mass — could make MCP less relevant. However, MCP's Linux Foundation governance and growing ecosystem reduce this risk.

---

## 9. Sources and Evidence Chain

| # | Source | Type | Weight | Recency | URL/Path |
|---|--------|------|--------|---------|----------|
| 1 | MCP Specification — Transports (2025-03-26) | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic/transports |
| 2 | MCP Specification — Transports (2024-11-05, deprecated) | Official spec | 1.0 | 2024-11-05 | https://modelcontextprotocol.io/specification/2024-11-05/basic/transports |
| 3 | MCP Specification — Authorization (2025-03-26) | Official spec | 1.0 | 2025-03-26 | https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization |
| 4 | ForgeOS Server Codebase (`server.ts`) | Primary source | 1.0 | 2026-03-05 | `forgeos-server/src/server.ts` |
| 5 | ForgeOS Server Codebase (`package.json`) | Primary source | 1.0 | 2026-03-05 | `forgeos-server/package.json` |
| 6 | FORGEOS-RES001 — MCP Protocol Core Specification | Internal research | 0.9 | 2026-03-05 | `docs/research/mcp-protocol-spec.md` |
| 7 | `@modelcontextprotocol/sdk` npm package | Official SDK | 0.9 | 2026 | https://www.npmjs.com/package/@modelcontextprotocol/sdk |
| 8 | SSE Standard (WHATWG HTML Living Standard) | Standard | 1.0 | Living | https://html.spec.whatwg.org/multipage/server-sent-events.html |
| 9 | OAuth 2.1 IETF Draft | Standard | 1.0 | 2024 | https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-12 |
| 10 | RFC 7591 — Dynamic Client Registration | Standard | 1.0 | 2015 (stable) | https://datatracker.ietf.org/doc/html/rfc7591 |
| 11 | RFC 8414 — OAuth 2.0 Server Metadata | Standard | 1.0 | 2018 (stable) | https://datatracker.ietf.org/doc/html/rfc8414 |

**Validity Window:** This analysis is valid for 6 months (until 2026-09-06).  
**Refresh Triggers:** New MCP spec revision, major SDK version bump (v2.x), ForgeOS architecture changes requiring real-time bidirectional communication, emergence of a WebSocket MCP transport option.

---

*Report generated by Research Analyst agent for ticket FORGEOS-RES002.*
