# L2 Execution Blocks — Phase 4: Drop-In Initialization

> **L1 Capability:** Drop-In Initialization  
> **Priority:** HIGH (P1)  
> **Phase Dependency:** Phase 2 (indexing) + Phase 3 (context storage)

---

## BLK-INT-14: Init MCP Tools & Orientation Loop

**Scope:** Implement `init.index` and `init.orient` MCP tools. Build auto-discovery heuristics. Construct orientation loop. REST endpoint + SSE events for progress.  
**Files:** `forgeos-server/src/tools/`, `forgeos-server/src/api/`  
**Estimated Effort:** M  
**Tickets:** 3 (init.index tool, init.orient tool, orientation progress API)

---

## BLK-INT-15: Drop-In Testing & Documentation

**Scope:** Integration tests for drop-in flow (index → orient → generate). Performance benchmarks (< 120s for 10K files). Documentation for drop-in usage.  
**Files:** `forgeos-server/src/__tests__/`, `docs/`  
**Estimated Effort:** S  
**Tickets:** 3 (integration tests, performance tests, documentation)
