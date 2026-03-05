# FORGEOS-RES002 — Research Summary: MCP Transport Layer Comparison

> **Agent:** Research Analyst | **Date:** 2026-03-06  
> **Stage:** RESEARCH → DOCS | **Confidence:** HIGH (88%)

## Research Question

Which MCP transport layer option (stdio, HTTP+SSE, Streamable HTTP) is optimal for ForgeOS distributed multi-agent orchestration?

## Key Findings

### Weighted Comparison Matrix

| Criterion | Weight | stdio | HTTP+SSE (deprecated) | Streamable HTTP |
|-----------|--------|-------|----------------------|-----------------|
| Distributed suitability | 0.25 | 1/10 | 6/10 | **9/10** |
| Proxy/LB compatibility | 0.20 | 0/10 | 5/10 | **9/10** |
| Throughput (concurrent) | 0.15 | 3/10 | 6/10 | **9/10** |
| Reconnection/resilience | 0.15 | 2/10 | 4/10 | **8/10** |
| Security posture | 0.10 | 8/10 | 5/10 | **9/10** |
| Latency | 0.10 | **10/10** | 7/10 | 7/10 |
| Implementation complexity | 0.05 | 9/10 | 4/10 | 7/10 |
| **Weighted Total** | **1.00** | **3.30** | **5.40** | **8.65** |

### Transport Evaluations

**stdio (score: 3.30/10):**
- Sub-millisecond latency (best of all), simplest security (no network exposure)
- Cannot distribute across machines, no LB, no reconnection, fundamental mismatch with ForgeOS distributed architecture
- **Verdict:** Good for local dev/testing only

**HTTP+SSE — Deprecated (score: 5.40/10):**
- Two-endpoint design (SSE + POST), requires sticky sessions for LB
- No protocol-level auth, no resumability, no message replay
- **Verdict:** Do not adopt — deprecated, replaced by Streamable HTTP

**Streamable HTTP (score: 8.65/10):**
- Single endpoint (`/mcp`), stateless mode enables horizontal scaling with simple round-robin LB
- Resumability via event IDs + `Last-Event-ID`, OAuth 2.1 authorization framework
- JSON-RPC batching reduces round trips, already implemented in ForgeOS
- **Verdict:** Optimal primary transport for ForgeOS

## Recommendation

| Role | Transport | Justification |
|------|-----------|---------------|
| **Primary** | Streamable HTTP | Already implemented, best distributed suitability, proxy-friendly, OAuth 2.1 support |
| **Fallback** | stdio | Local development, CI/CD pipelines, IDE debugging |
| **Do NOT adopt** | HTTP+SSE | Deprecated, no advantages over Streamable HTTP |

## Configuration Recommendations

1. **Keep stateless mode** (`sessionIdGenerator: undefined`) — maximizes scaling
2. **Enable JSON-RPC batching** — reduces round trips for multi-tool agent operations
3. **Upgrade auth to OAuth 2.1** — aligns with MCP spec, enables dynamic client registration
4. **Implement Origin validation** — spec-required security measure
5. **Consider stateful sessions later** — when agents need server-initiated push

## Bayesian Update

- **Prior:** 75% confidence Streamable HTTP is optimal
- **Posterior:** 88% confidence — protocol spec, codebase evidence, and distributed systems analysis strongly confirm
- **Delta:** +13% — resumability, OAuth 2.1, single-endpoint design, and stateless scaling clinched it. 12% uncertainty for latency-sensitive edge cases and ecosystem maturity.

## Contradictions

4 contradictions found, all resolved:
1. Spec says "support stdio whenever possible" — contextual: targets IDE clients, not distributed systems
2. HTTP+SSE has EventSource auto-reconnect — Streamable HTTP's resumability is strictly superior
3. ForgeOS dual SSE endpoints (/mcp GET + /events) — valid separation of concerns
4. stdio "best security" vs "worst distributed" — genuine tradeoff; distributed weighted higher for ForgeOS

## Artifacts

- **Full report:** `docs/research/mcp-transport-comparison.md`
- **Sources:** 11 references (6 official specs, 2 codebase, 1 internal research, 2 standard RFCs)
- **Validity:** 6 months (until 2026-09-06)
- **Refresh triggers:** New MCP spec revision, SDK v2.x, WebSocket transport emergence

## Evidence Quality

- Sources consulted: 11 — 6 official specs (weight 1.0), 2 codebase (1.0), 1 internal (0.9), 2 RFCs (1.0)
- All sources within validity window
- Contradictions: 4 found, 4 resolved
- Disconfirming evidence actively sought: stdio latency advantage real but immaterial for ForgeOS
