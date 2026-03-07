# FORGEOS-ARCH009 — Architect Stage Summary

**Agent:** Architect  
**Ticket:** FORGEOS-ARCH009 — Design MCP Tool Definition Schemas  
**Stage:** ARCHITECT → DOCS  
**Date:** 2026-03-07T08:45:00Z  
**Confidence:** HIGH (92%)

---

## Deliverable

**Primary artifact:** `docs/architecture/api/mcp-tool-definitions.md`

Comprehensive MCP tool definition schemas for all 11 ForgeOS ticket management tools:

| # | Tool | Category | Read/Write |
|---|------|----------|------------|
| 1 | `tickets.next` | Discovery | Read |
| 2 | `tickets.claim` | Lifecycle | Write |
| 3 | `tickets.complete` | Lifecycle | Write |
| 4 | `tickets.reject` | Lifecycle | Write |
| 5 | `tickets.release` | Lifecycle | Write |
| 6 | `tickets.update` | Metadata | Write |
| 7 | `tickets.spawn` | Creation | Write |
| 8 | `tickets.graph` | Visualization | Read |
| 9 | `tickets.extend` | Lease | Write |
| 10 | `tickets.stats` | Dashboard | Read |
| 11 | `tickets.sync` | System | Write |

## What Was Produced

1. **Tool Definitions (11 tools):** Each tool has:
   - MCP registration code pattern (`server.tool()`)
   - JSON Schema `inputSchema` (MCP wire format)
   - Zod schema (TypeScript implementation)
   - Output schema (structured JSON Schema)
   - Error codes (from `ForgeOSErrorCode` enum)
   - Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
   - Example calls and responses

2. **Error Response Schema:** Unified `ErrorResponse` interface with `ForgeOSErrorCode` enum (14 codes), JSON-RPC error mapping, and MCP wire format examples.

3. **Context Map:** Primary/secondary files, established patterns, dependencies.

4. **Well-Architected Assessment:** All 6 pillars scored (avg: 8.7/10).

5. **Two ADRs:**
   - **ADR-ARCH009-01:** Tool Naming Convention — Use codebase names (`complete`/`reject`) over delegation names (`advance`/`rework`).
   - **ADR-ARCH009-02:** Error Propagation Strategy — Layered approach (JSON-RPC protocol errors + tool execution errors with `ForgeOSErrorCode`).

6. **DAG Task Graph:** Implementation ordering with critical path and parallel groups.

7. **Fitness Functions:** 9 measurable thresholds (latency targets, coverage, schema validity).

## Key Decisions

| Decision | Chosen | Over | Reason |
|----------|--------|------|--------|
| Tool naming | `tickets.complete` / `tickets.reject` | `advance` / `rework` | Matches existing TypeScript types and stored functions |
| Error propagation | Layered (protocol + domain) | All-protocol or all-tool | Clean separation for clients |
| Tool count | 11 (10 existing + 1 new: `tickets.sync`) | 8 (AC list only) | Cover all codebase tools + planned sync |

## Name Mappings (AC → Implementation)

| Acceptance Criteria Name | Implementation Name | Status |
|--------------------------|-------------------|--------|
| `tickets.advance` | `tickets.complete` | Existing |
| `tickets.rework` | `tickets.reject` | Existing |
| `tickets.status` | `tickets.stats` | Existing |
| `tickets.sync` | `tickets.sync` | New (designed) |
| `tickets.validate` | Not designed | Deferred (not in codebase types) |

## Evidence

- **Artifacts:** `docs/architecture/api/mcp-tool-definitions.md`
- **Test results:** N/A (architecture-type ticket; schemas are reference specs validated by downstream implementation)
- **Confidence:** HIGH — All 10 existing tool schemas derived directly from codebase TypeScript types; `tickets.sync` designed from `tickets.py` semantics

## For Documentation Specialist (Next Stage)

The deliverable at `docs/architecture/api/mcp-tool-definitions.md` is a complete reference document. Documentation review should verify:
1. All 11 tool definitions are present and complete
2. JSON Schema examples are valid
3. Error codes are consistent with `ForgeOSErrorCode` enum
4. Cross-references to `openapi-spec.yaml` and `types/index.ts` are accurate
5. ADR format follows project conventions
