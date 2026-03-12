# L2 Execution Blocks — Phase 1: MCP-Only Cutover

> **L1 Capability:** MCP-Only Cutover  
> **Priority:** CRITICAL (P0)  
> **Phase Dependency:** None (unblocks Phases 2, 3, 4)

---

## BLK-INT-01: Instruction File Rewrites

**Scope:** Rewrite all 6 `.github/instructions/*.instructions.md` files to remove filesystem ticket-state references. Replace with MCP-only workflow definitions.  
**Files:** 6 instruction files  
**Estimated Effort:** M (medium)  
**Tickets:** 6 (one per file)

---

## BLK-INT-02: Agent File Rewrites

**Scope:** Rewrite all 14 `.github/agents/*.agent.md` files to use MCP-only boot sequences. Remove filesystem ticket reads/writes, update tool loadouts.  
**Files:** 14 agent files + `agents.md`  
**Estimated Effort:** L (large — 15 files, each requiring careful rewrite)  
**Tickets:** 3 (batch by agent category: infra agents, implementation agents, review agents)

---

## BLK-INT-03: New MCP Tools for Cutover

**Scope:** Implement 3 new MCP tools on the ForgeOS server: `tickets.get`, `tickets.list`, `tickets.payload`. Includes PostgreSQL stored functions, Zod schemas, tool handlers, and REST API endpoints.  
**Files:** `forgeos-server/src/tools/`, `forgeos-server/src/db/`  
**Estimated Effort:** M  
**Tickets:** 4 (one per tool + stored functions)

---

## BLK-INT-04: ForgeOS Orchestrator Loop

**Scope:** Build persistent orchestrator process: poll READY tickets → determine agent → inject context → dispatch. Replace stateless Ticketer dispatcher model.  
**Files:** `forgeos-server/src/`, agent-sdk  
**Estimated Effort:** L  
**Tickets:** 2 (orchestrator core + agent SDK updates)

---

## BLK-INT-05: Migration, Testing & Security

**Scope:** Write migration script (filesystem → PostgreSQL), integration tests for MCP-only workflow, security review for new tools.  
**Files:** scripts/, tests/  
**Estimated Effort:** M  
**Tickets:** 4 (migration script, integration tests, security review, documentation)
