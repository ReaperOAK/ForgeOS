# ProductManager Summary — CTO-prd

## Metadata

| Field | Value |
|-------|-------|
| **Ticket** | CTO-prd |
| **Agent** | Product Manager |
| **Stage** | PM |
| **Date** | 2026-03-12T00:00:00Z |
| **Confidence** | HIGH (90%) |
| **Upstream** | `.github/agent-output/Research/CTO-research.md` |

---

## What Was Produced

**PRD:** `docs/product/PRD-mcp-operational.md`

A focused product requirements document defining what "the MCP server works" means for ForgeOS, derived from the Research Analyst's gap analysis of 15 blocking issues.

---

## Key Decisions

1. **Scope: TypeScript server only.** The Python MCP server (`mcp-server/`) is explicitly out of scope. The two servers have incompatible schemas and tool names — unifying them is a separate effort.

2. **Three priority tiers defined:**
   - **P0 (7 features):** System must compile, build, start, accept connections, authenticate agents, and execute the core claim→work→advance lifecycle. These are hard blockers.
   - **P1 (6 features):** All 9 tools functional, REST API mounted, structured errors, lease management, SDK integration, dashboard live data.
   - **P2 (4 features):** Concurrent safety, crash recovery, structured logging, accurate health checks.

3. **12 success criteria** defined with explicit verification methods. A verification script sequence (Steps 1–12) validates all P0 features end-to-end.

4. **3 user personas** scoped: AI Agent (primary — MCP protocol), Human Operator (dashboard + CLI), DevOps (Docker + health checks).

5. **NFRs quantified:** Startup < 60s, p99 tool latency < 500ms, zero data loss on graceful shutdown, structured JSON logging.

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| PRD | `docs/product/PRD-mcp-operational.md` |
| Summary | `.github/agent-output/ProductManager/CTO-prd.md` |

---

## Discovery Matrix

| Category | Questions Asked | Answered |
|----------|----------------|----------|
| WHO (users) | 3 personas identified | 3/3 |
| WHAT (problems) | 10 specific problems enumerated | 10/10 |
| HOW (success) | 12 success criteria defined | 12/12 |
| SCOPE (boundaries) | 9 out-of-scope items listed | 9/9 |

---

## Assumptions Requiring Validation

| # | Assumption | Status |
|---|-----------|--------|
| A1 | TypeScript code is structurally sound (only wiring broken) | Supported by Research evidence |
| A2 | SQL stored functions work correctly | Needs functional test |
| A3 | MCP SDK ^1.27.1 supports stateless Streamable HTTP | Needs verification |
| A6 | Agent SDK `mcp>=1.25` has `streamablehttp_client` | Needs verification |

---

## Recommendations for Next Stage

This PRD is ready for **Architect** and **TODO** decomposition:

1. **Architect** should produce ADRs for: the MCP transport pattern fix, the auth bootstrap mechanism, and the migration deduplication strategy.
2. **TODO** should decompose P0 features into 7 actionable tickets (one per P0 feature), each with file paths and acceptance criteria from this PRD.
3. P1 and P2 features should become a second wave of tickets after P0 is verified.

---

## Confidence: HIGH (90%)

- 10% uncertainty due to A3 and A6 (MCP SDK transport compatibility unverified at runtime).
- All problem statements backed by Research Analyst filesystem evidence.
- All acceptance criteria are mechanically verifiable (commands + assertions).
