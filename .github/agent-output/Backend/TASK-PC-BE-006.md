# Backend Stage Summary — TASK-PC-BE-006

## Scope
- Stage: `BACKEND`
- Ticket: `TASK-PC-BE-006`
- Title: Add Freshness Gate to Claim Path
- Date (UTC): `2026-03-15T20:48:00Z`

## Artifacts
- `forgeos-server/src/tools/tickets-claim.ts` (modified — schema + handler)
- `forgeos-server/src/__tests__/tickets-claim-freshness.test.ts` (created)

## Acceptance Criteria Evidence

### AC1 — fresh: hash matches → freshness_status 'fresh', no recompile queued
- `evaluatePromptFreshness` returns `{freshnessStatus:'fresh', staleReason:null, shouldInvalidateCache:false}`
- Handler sets `output.prompt_packet.freshness_status = 'fresh'`
- `queueCompileTicketPrompt` is NOT called
- ✅ Verified by 5 tests in `AC1 — fresh prompt (hash matches)` describe block

### AC2 — missing compiled prompt → freshness_status 'missing', compile trigger invoked
- `evaluatePromptFreshness` returns missing evaluation
- Handler calls `queueCompileTicketPrompt(ticket_id, 'claim-missing-compiled-prompt')`
- `prompt_packet.freshness_status === 'missing'`, `stale_reason === 'not_compiled'`
- ✅ Verified by 5 tests in `AC2 — missing compiled prompt` describe block

### AC3 — hash mismatch → freshness_status 'stale' with hash_mismatch reason, recompile triggered
- `evaluatePromptFreshness` returns stale evaluation with `hash_mismatch` reason
- Handler calls `queueCompileTicketPrompt(ticket_id, 'claim-stale-compiled-prompt')`
- `prompt_packet.freshness_status === 'stale'`, `stale_reason === 'hash_mismatch'`
- ✅ Verified by 5 tests in `AC3 — stale compiled prompt (hash mismatch)` describe block

### AC4 — strict/permissive policy configuration
- Added `freshness_policy: z.enum(['strict', 'permissive']).default('permissive')` to `ticketsClaimSchema`
- **Permissive** (default): recompile queued silently, no `freshness_warning` in response, no `logger.warn`
- **Strict**: when stale/missing, additionally:
  - Calls `logger.warn` with `ticket_id`, `freshness_status`, `stale_reason`
  - Returns `freshness_warning` string in the JSON response body
  - Still queues recompile in background
- Strict + fresh: no warning emitted
- ✅ Verified by 12 tests across AC4a–AC4d describe blocks

## Validation Gates

1. `npx vitest run src/__tests__/tickets-claim-freshness.test.ts`: **37/37 PASS**
2. `npx tsc --noEmit`: **PASS** (0 errors)
3. `npx eslint src/tools/tickets-claim.ts src/services/context-hash.ts --max-warnings=0`: **PASS** (0 warnings)

## Coverage
- New code added in `tickets-claim.ts`: `freshness_policy` schema field + policy branch in handler
- Test file covers: fresh/stale/missing freshness states, strict/permissive behavior, schema validation, context hash pass-through (**37 tests, well above 80% minimum**)

## TDD Trace
- **RED:** Created test file with AC1–AC4 assertions against unimplemented `freshness_policy` field — schema parse returned 'permissive' by default causing strict tests to fail.
- **GREEN:** Added `freshness_policy` to `ticketsClaimSchema` + implemented strict-mode warning branch in handler.
- **REFACTOR:** Verified no `any` types, no console.log, no unhandled promises, no TODO comments.

## Implementation Notes
- `context-hash.ts` required **no changes** — exports were already sufficient.
- Policy behavior uses spread `{ ...output, freshness_warning }` at return time to avoid TypeScript strict-mode excess-property error on `TicketsClaimOutput`.
- Strict mode does NOT block the claim — it surfaces the warning while still returning the ticket to the agent.

## Confidence
- `HIGH`
