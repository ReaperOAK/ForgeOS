# TASK-INT-BE047 — Update Agent SDK with Init Tool Schemas

## Stage: BACKEND | Agent: Backend | Machine: reaperoak

## Summary

Added `init_index` and `init_orient` tool definitions to the Agent SDK with corresponding Pydantic models.

## Artifacts

| File | Action |
|------|--------|
| `agent-sdk/src/forgeos_sdk/models.py` | Added `IndexResult` and `OrientationResult` models |
| `agent-sdk/src/forgeos_sdk/operations.py` | Added `init_index(root_path, force)` and `init_orient(root_path)` methods |
| `agent-sdk/src/forgeos_sdk/__init__.py` | Exported new models in public API |
| `agent-sdk/tests/test_operations.py` | Added 13 unit tests (7 for init_index, 6 for init_orient) |

## Models Added

- **IndexResult**: `total_files`, `indexed`, `skipped`, `symbols_found`, `imports_found`
- **OrientationResult**: `project_name`, `package_manager`, `frameworks`, `languages`, `entry_points`, `test_framework`, `build_system`

## Methods Added

- `init_index(root_path, *, force=False) -> IndexResult` — calls `init.index` MCP tool
- `init_orient(root_path) -> OrientationResult` — calls `init.orient` MCP tool

## TDD Evidence

- RED: Wrote 13 tests covering return types, tool call arguments, optional params, error handling, coroutine checks, and defaults
- GREEN: Implemented models and methods to pass all tests
- REFACTOR: Followed existing code patterns exactly (same `_call_tool` + `model_validate` pattern)

## Test Results

- 86 operations tests passed, 0 failed
- 385 total SDK tests passed, 0 failed (full backward compatibility)

## Confidence: HIGH
