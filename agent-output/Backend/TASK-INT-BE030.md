# TASK-INT-BE030 — Update Agent SDK for Code Graph Tools

## Stage: BACKEND

## Summary

Added 3 code graph MCP tool wrappers to the ForgeOS Agent SDK plus corresponding Pydantic response models. Follows the existing `tickets.*` pattern established in TASK-INT-BE016.

## Files Modified

- `agent-sdk/src/forgeos_sdk/models.py` — Added 6 Pydantic models: `AffectedSymbol`, `BlastRadiusResult`, `SymbolMatch`, `SymbolSearchResult`, `ImportEntry`, `ImportChainResult`
- `agent-sdk/src/forgeos_sdk/operations.py` — Added 3 async methods: `code_blast_radius()`, `code_search_symbols()`, `code_get_imports()`
- `agent-sdk/src/forgeos_sdk/__init__.py` — Exported all 6 new models
- `agent-sdk/tests/test_operations.py` — Added 20 unit tests across 3 test classes

## TDD Evidence

- **RED**: Wrote tests for `code_blast_radius`, `code_search_symbols`, `code_get_imports` checking return types, tool call arguments, optional params, error handling, and async coroutine status.
- **GREEN**: Implemented the 3 operations and 6 models — all 20 new tests pass.
- **REFACTOR**: Followed existing patterns exactly (same `_call_tool` mechanism, model_validate, optional param omission).

## Test Results

- 73 operations tests passed (53 existing + 20 new)
- 372 total SDK tests passed, 0 failed
- All existing tests unchanged — backward compatible

## Acceptance Criteria Verification

| AC | Status |
|----|--------|
| 1. `code_blast_radius(file_path, max_depth)` → `BlastRadiusResult` | PASS |
| 2. `code_search_symbols(name_pattern, kind, file_path)` → `SymbolSearchResult` | PASS |
| 3. `code_get_imports(file_path, max_depth)` → `ImportChainResult` | PASS |
| 4. Pydantic models in `models.py` | PASS — 6 models added |
| 5. Uses existing transport layer (`_call_tool`) | PASS |
| 6. Unit tests for all 3 methods | PASS — 20 tests |
| 7. Backward compatible | PASS — 372/372 tests green |

## Confidence: HIGH
