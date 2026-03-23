# Documentation — TASK-FOS-03-004

## Ticket
- **ID:** TASK-FOS-03-004
- **Title:** tickets.complete — Complete Stage and Advance
- **Type:** backend
- **Priority:** critical
- **Stage:** DOCS → VALIDATION

## Verdict: ✅ COMPLETE

**Confidence:** HIGH

## Documentation Changes

### 1. forgeos-server/README.md — tickets.complete section added
- Added `### tickets.complete — Complete Stage and Advance` section with:
  - Input schema table (6 fields with types, required flags, descriptions)
  - Output schema table (4 fields)
  - Error codes table (4 codes with conditions and descriptions)
  - MCP invocation example (JSON)
  - Example response (JSON)
  - Implementation files table (5 files with purposes)
- Updated `last_reviewed` to `2026-03-10T10:15:00Z`

### 2. docs/architecture/api/mcp-tool-definitions.md — section 4.3 updated
- Fixed stored function signature from `advance_ticket(p_ticket_id, p_evidence)` to
  `advance_ticket(p_ticket_id, p_agent_id, p_agent_name, p_evidence)` matching implementation
- Added behavioral description of `advance_ticket()` internals: claim validation,
  SDLC flow computation, file lock release, evidence JSONB merge, audit event
  emission, and `resolve_dependencies()` call on DONE
- Updated `last_reviewed` to `2026-03-10T10:15:00Z`

### 3. CHANGELOG.md — entry added
- Added `tickets.complete Tool Documentation` entry under `[Unreleased] > Added`

### 4. JSDoc/TSDoc — verified complete
- `tickets-complete.ts`: module-level doc, `ticketsCompleteSchema` doc, type alias,
  `ticketsCompleteHandler` with `@param`, `@returns`, `@example`, `@see` tags
- `flows.ts`: module-level doc, `SDLC_FLOWS` constant doc
- `transitions.ts`: module-level doc, `getNextStage()`, `getImplementationStage()`,
  `isValidTransition()` all documented with return semantics

## Evidence

| Criterion | Result |
|-----------|--------|
| API coverage | All public APIs have JSDoc/TSDoc |
| README updated | `tickets.complete` section added to forgeos-server/README.md |
| Readability | Active voice, tables, code blocks; Flesch-Kincaid ≤ 10 |
| Link integrity | All internal cross-references verified |
| Freshness | `last_reviewed` dates updated on both touched docs |
| Changelog | Entry added |
| Confidence | HIGH — docs match implementation exactly |

## Upstream Verdicts
- **QA:** PASS (62/62 tests, 100%/92% coverage)
- **Security:** PASS (0 critical/high, 4 INFO)
- **CI:** PASS (83/100 score, 0 critical, 3 warnings)

## Metadata
- **Agent:** Documentation
- **Machine:** pop-os
- **Operator:** Ticketer
- **Timestamp:** 2026-03-10T10:15:00Z
