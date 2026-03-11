# FORGEOS-BE036 — QA Complete

## Verdict: PASS

## Summary

All 7 acceptance criteria verified. Implementation follows thin-controller + factory pattern consistent with existing routes. 19 claim-specific tests pass. Combined coverage with all ticket API tests: `routes/tickets.py` 93%, `schemas.py` 100%, total 96%. No regressions introduced — 5 pre-existing failures in unrelated modules (correlation, webhook, server config).

## Test Results

| Metric | Value |
|--------|-------|
| Claim tests (test_ticket_claim_api.py) | 19/19 passed |
| Combined ticket API tests | 77/77 passed |
| Full suite | 2468 passed, 5 failed (pre-existing) |
| Coverage: routes/tickets.py | 93% |
| Coverage: schemas.py | 100% |
| Coverage: combined | 96% |
| Lint (ruff) | 0 errors, 0 warnings |

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | POST accepts agent_id, machine_id, operator | PASS | `ClaimRequest` Pydantic model validates body; `TestClaimRequestSchema::test_required_fields` |
| 2 | Delegates to shared ticket service | PASS | Calls `ticket_service.claim_by_id()` — same service as MCP handler; `test_returns_200_with_claim_details` asserts `mock_service.claim_by_id.assert_called_once_with(...)` |
| 3 | Returns 200 with claimed ticket data | PASS | `TestClaimEndpointSuccess::test_returns_200_with_claim_details` — response includes ticket_id, stage, file_paths, acceptance_criteria |
| 4 | Returns 409 on already claimed | PASS | `test_returns_409_when_not_eligible` (NoEligibleTicketError → 409), `test_returns_409_on_claim_error` (ClaimError → 409) |
| 5 | Returns 400 on bad request / not READY | PASS | `test_returns_400_on_missing_body_fields`, `test_returns_400_on_empty_body`, `test_returns_400_on_unknown_agent_role` (ValueError → 400) |
| 6 | Returns 404 when ticket doesn't exist | PASS | `TestClaimEndpoint404::test_returns_404_when_ticket_not_found` — repo returns None → 404 |
| 7 | Request body validated with Pydantic ClaimRequest | PASS | `TestClaimRequestSchema` validates model; `test_returns_400_on_missing_body_fields` exercises ValidationError → 400 |

## Bonus Coverage (DELETE endpoint)

| Scenario | Test | Status |
|----------|------|--------|
| 200 on successful release | `test_returns_200_on_successful_release` | PASS |
| Release with reason | `test_release_with_reason` | PASS |
| 400 when agent_id missing | `test_returns_400_when_agent_id_missing` | PASS |
| 404 when ticket not found | `test_returns_404_when_ticket_not_found` | PASS |
| 409 when not claim owner | `test_returns_409_when_not_claim_owner` | PASS |
| 503 when service unavailable | `test_returns_503_when_service_is_none` | PASS |

## Pre-Existing Failures (Not Introduced by BE036)

| Test | Module | Issue |
|------|--------|-------|
| `test_all_public_symbols_exported` | test_correlation.py | Module export mismatch |
| `test_github_valid_signature_returns_202` | test_github_handler.py | Webhook signature validation |
| `test_github_no_secret_configured_skips_verification` | test_github_handler.py | Webhook signature validation |
| `test_main_updates_server_settings` | test_server.py | CLI argparse SystemExit |
| `test_github_with_event_header` | test_webhook_endpoint.py | Webhook validation |

## Architecture Review

- **Thin controller**: Route handler validates input, delegates to `TicketService`, maps domain errors to HTTP codes
- **Factory pattern**: `create_claim_endpoint(service_getter, repo_getter)` — consistent with existing route patterns
- **Error mapping**: `NoEligibleTicketError`/`ClaimError` → 409, `TicketNotFoundError` → 404, `ValueError` → 400, `Exception` → 500
- **Transport wiring**: `ticket_service_ref` in `http.py` with deferred binding via `app.state`

## Defects Found

None.

## Confidence

**HIGH** — All 7 ACs verified with passing tests, coverage >93%, no regressions caused by this ticket, clean lint.
