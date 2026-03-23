# ProductManager Summary — CTO PRD Request

**Ticket:** CTO-prd (strategic request, non-SDLC)  
**Agent:** ProductManager  
**Date:** 2026-03-23T12:00:00Z  
**Confidence:** HIGH

---

## Deliverable

**PRD:** [docs/product/PRD-MCP-STANDALONE.md](../../docs/product/PRD-MCP-STANDALONE.md)

Title: *ForgeOS MCP Server — Production-Ready Standalone Distribution*

---

## Summary

Produced a comprehensive PRD covering 11 features across three priority tiers to make the ForgeOS MCP Server distributable as a standalone service.

### P0 Features (Must-Have)
1. **F1 — Durable Compile Queue:** Migrate in-memory queue to PostgreSQL-backed `prompt_compile_queue` table (migration 009 exists, service layer needs refactor)
2. **F2 — Extended Compile Triggers:** Add compilation hooks for BACKEND, FRONTEND, TODO stage transitions (plus rework)
3. **F3 — Agent Definitions Seeding:** Populate `agent_definitions` table with all 14 agents, enable DB-only lookup in prompt compiler
4. **F4 — Standalone Docker Compose:** `docker-compose.mcp.yml` with pre-built images for zero-clone setup
5. **F5 — One-Click VS Code Setup:** `vscode:mcp/install` badge + `.vscode/mcp.json` examples
6. **F6 — Production Hardening:** `/ready` probe, structured error responses, request timeouts

### P1 Features (Should-Have)
7. **F7 — npm Package:** `@forgeos/mcp-server` with dual client/server mode
8. **F8 — Published Docker Image:** ghcr.io CI pipeline with multi-arch builds
9. **F9 — MCP Registry Listing:** server.json + publication
10. **F10 — Rate Limiting:** Per-IP middleware on `/mcp`
11. **F11 — Comprehensive Error Handling:** All 22 tools audited

### Key Metrics
| Metric | Baseline | Target |
|---|---|---|
| Time-to-first-tool-call (Docker) | >15 min | ≤5 min |
| Compile job durability | 0% | 100% |
| Agent definitions seeded | 0 | 14 |
| Compile trigger stages | 1 | 4+ |

### Three User Personas Defined
- **Solo AI Developer** — wants 5-min setup
- **DevOps/Platform Engineer** — wants production guarantees
- **MCP Ecosystem Explorer** — wants one-click discovery

### Phased Delivery
- **Phase A (Sprint 1):** Fix internal gaps — F1, F2, F3
- **Phase B (Sprint 2):** Distribution — F4, F5, F6
- **Phase C (Sprint 3):** Ecosystem — F7–F11

---

## Decisions Made
- Dual distribution strategy: Docker Compose (full stack) + npm (client mode) — based on research finding that ForgeOS requires PostgreSQL
- API key auth for v1.0, OAuth deferred — 40% of MCP servers use API keys per Zuplo report
- Ollama is opt-in (`--profile ollama`) — core ticket tools work without it
- `vscode:mcp/install` URI scheme over VS Code extension marketplace — lower friction, community-standard

## Open Items for TODO Agent
- Verify `@forgeos` npm org availability
- Decompose F1–F11 into L3 tickets with file paths and acceptance criteria
- Determine pgvector availability in `postgres:17-alpine` vs custom image

## Upstream Context Used
- Research: [MCP-DISTRIBUTION-RESEARCH.md](../../.github/agent-output/Research/MCP-DISTRIBUTION-RESEARCH.md) — 92% posterior confidence, 16 sources
- Current server: 22 tools verified functional, graceful shutdown exists, pino logging, Zod validation
- Existing migrations: 009 (compile queue table), 010 (agent definitions table) — schema ready, service layer incomplete
