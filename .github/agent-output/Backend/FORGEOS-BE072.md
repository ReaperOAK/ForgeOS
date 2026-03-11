# FORGEOS-BE072 — BACKEND Summary

## Ticket
**ID:** FORGEOS-BE072  
**Title:** Implement Database-to-Filesystem Export  
**Stage:** BACKEND → QA  
**Agent:** Backend on pop-os (reaperoak)  
**Completed:** 2026-03-11T16:00:00+00:00  

## Files Created / Modified

| File | Action |
|------|--------|
| `mcp-server/src/mcp_server/migration/exporter.py` | Created |
| `mcp-server/src/mcp_server/migration/__init__.py` | Modified (exports) |
| `mcp-server/tests/test_exporter.py` | Created |

## Implementation

### exporter.py

**ExportConfig** — frozen dataclass with `tickets_dir`, `ticket_state_dir`,
`backup_dir` (optional, auto-generated if None), `dry_run` flag.

**ExportDatabaseReader** — runtime-checkable Protocol requiring
`read_all_tickets() -> list[dict[str, Any]]` returning full ticket records
from PostgreSQL.

**ExportStats** — mutable dataclass tracking: `total_read`, `exported`,
`backed_up`, `errors`, `active_claims`, `stage_distribution` (dict).

**ExportResult** — contains stats, errors, warnings, with `summary()` method
producing a human-readable report including stage distribution and error list.

**TicketExporter** — main orchestrator class:
1. Reads all tickets from DB via `ExportDatabaseReader.read_all_tickets()`
2. Backs up existing `.github/tickets/` and `.github/ticket-state/` files
   (non-destructive — copies to timestamped backup directory)
3. Converts each DB record back to filesystem JSON schema via
   `_to_filesystem_json()`, reversing the stage mapping
   (`DB_TO_STAGE_DIR` from transformers.py)
4. Writes master ticket JSON to `.github/tickets/<ticket_id>.json`
5. Writes state copy to `.github/ticket-state/<STAGE>/<ticket_id>.json`
6. Tracks active claims (claimed_by, machine_id, operator, lease_expiry)
7. Reports progress via optional `ProgressCallback`
8. Produces `ExportResult` with full summary

### Key Design Decisions

- **Reuses `DB_TO_STAGE_DIR`** from `transformers.py` for DB→FS stage mapping
  (DOCUMENTATION→DOCS, VALIDATOR→VALIDATION, etc.)
- **Protocol-based DB reader** — same pattern as `DatabaseWriter` in importer.py,
  enabling easy testing with in-memory fakes
- **Non-destructive backup** — `shutil.copy2` preserves metadata; auto-generated
  timestamped backup directory when `backup_dir` is None
- **JSON output uses `indent=2, default=str`** — matching existing ticket JSON style
- **Handles both `claimed_by` and `claimed_by_name`** field names from DB records
- **`depends_on` mapped back to `dependencies`** key to match filesystem schema

## TDD Evidence

| Cycle | RED (failing test) | GREEN (pass) | REFACTOR |
|-------|--------------------|--------------|----------|
| 1 | ExportConfig defaults + frozen | Implemented dataclass | — |
| 2 | ExportResult summary format | Implemented summary() | Extracted stage distribution |
| 3 | _to_filesystem_json conversion | Implemented field mapping | Split stage/claim handling |
| 4 | _resolve_fs_stage mapping | Implemented using DB_TO_STAGE_DIR | — |
| 5 | _backup_existing | Implemented backup logic | Auto-dir generation |
| 6 | Full export run (single ticket) | Implemented run() | — |
| 7 | Multiple tickets + claims | Verified claim counting | — |
| 8 | Dry run mode | Skip file writes on dry_run | — |
| 9 | Non-destructive backup E2E | Verified backup + overwrite | — |
| 10 | DB read failure | Early return with error | — |
| 11 | Schema compliance | All required fields present | — |
| 12 | DOCUMENTATION→DOCS mapping | Verified state dir creation | — |

## Coverage

```
Name                                   Stmts   Miss  Cover   Missing
--------------------------------------------------------------------
src/mcp_server/migration/exporter.py     144      6    96%   206-210, 343
--------------------------------------------------------------------
```

**32 tests, 96% coverage** — exceeds 80% threshold.

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Export reads all tickets from PostgreSQL and generates .github/tickets/*.json files | ✅ |
| 2 | Each ticket JSON file matches original JSON schema | ✅ (22 schema fields verified) |
| 3 | State copies placed in correct .github/ticket-state/<STAGE>/ directory | ✅ |
| 4 | Export handles active claims (claimed_by, machine_id, operator, lease_expiry) | ✅ |
| 5 | Export is non-destructive (existing files backed up) | ✅ |
| 6 | Export summary report generated | ✅ (stage distribution, claim count) |
| 7 | Exported files can be consumed by original tickets.py without modification | ✅ (schema-compliant) |

## Confidence
**HIGH** — All 7 acceptance criteria met, 32 tests pass at 96% coverage,
no regressions in existing 49 migration tests.
