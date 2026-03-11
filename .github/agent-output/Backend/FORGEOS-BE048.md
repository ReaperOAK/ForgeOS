# FORGEOS-BE048 — BACKEND Summary

## Ticket
- **Title:** Implement Summary Handoff Helpers
- **Type:** backend
- **Stage Completed:** BACKEND → QA

## Artifacts
- `agent-sdk/src/forgeos_sdk/summary.py` — New module with summary handoff helpers
- `agent-sdk/tests/test_summary.py` — 28 tests, 100% coverage
- `agent-sdk/src/forgeos_sdk/__init__.py` — Updated exports

## Implementation

### Module: `summary.py`
Provides three public functions for agent summary file I/O:

1. **`read_upstream_summary(ticket_id, current_stage, sdlc_flow, *, workspace_root)`** — Reads the previous stage agent's summary from `.github/agent-output/{AgentName}/{ticket-id}.md`. Returns content as string or `None` if no upstream summary exists.

2. **`write_summary(ticket_id, agent_name, content, *, workspace_root)`** — Writes the current agent's summary to the correct output directory. Creates the directory if it does not exist. Uses UTF-8 encoding.

3. **`delete_upstream_summary(ticket_id, current_stage, sdlc_flow, *, workspace_root)`** — Deletes the previous stage summary after processing. Returns `True` if deleted, `False` if not found.

### Supporting Constants
- `STAGE_TO_AGENT` — Maps SDLC stages to agent output directory names (e.g. `"CI"` → `"CIReviewer"`, `"DOCS"` → `"Documentation"`).
- `AGENT_OUTPUT_DIR` — Workspace-relative path `.github/agent-output`.

### Internal Helpers
- `_previous_stage()` — Finds the preceding stage in a given SDLC flow
- `_upstream_agent()` — Resolves the agent name for the upstream stage
- `_summary_path()` — Builds the canonical file path for a summary

## TDD Evidence
- **RED:** Tests written first — `ModuleNotFoundError` confirmed before implementation.
- **GREEN:** All 28 tests pass after implementation.
- **REFACTOR:** Fixed `typing.Sequence` → `collections.abc.Sequence` per ruff UP035, removed unused `pytest` import per ruff F401.

## Coverage
- **28 tests**, **100% line coverage** (58/58 statements covered)
- Covers: all 9 stage mappings, upstream resolution across backend/frontend/fullstack flows, missing file handling, string workspace_root, directory creation, UTF-8 encoding, file deletion

## Lint
- `ruff check` — All checks passed (zero errors, zero warnings)

## Acceptance Criteria Verification
| # | Criterion | Status |
|---|-----------|--------|
| 1 | `read_upstream_summary(ticket_id)` reads previous agent's summary | ✅ |
| 2 | `write_summary(ticket_id, content)` writes current agent's summary | ✅ |
| 3 | `delete_upstream_summary(ticket_id)` removes previous stage summary | ✅ |
| 4 | Summary directory structure follows `.github/agent-output/{AgentName}/{ticket-id}.md` | ✅ |
| 5 | Functions handle missing files gracefully (return `None` or `False`) | ✅ |
| 6 | Agent name derived from claim context via `STAGE_TO_AGENT` mapping | ✅ |

## Confidence
**HIGH** — All acceptance criteria met, 100% test coverage, zero lint errors.
