# FORGEOS-ARCH010 — Architect Summary

## Ticket
- **ID:** FORGEOS-ARCH010
- **Title:** Design Error Catalog and API Standards
- **Stage:** ARCHITECT → DOCS
- **Agent:** Architect on pop-os (ReaperOAK)

## Deliverables

### Primary Artifact
- `docs/architecture/api/error-catalog.md` — Comprehensive error catalog and API standards document

### Contents Delivered

1. **Standard Error Response Format** — `ErrorResponse` schema with `error`, `message`, `details`, `ticket_id`, `timestamp`. Production vs development behavior documented.

2. **Error Code Taxonomy** — 20 error codes organized into 6 categories:
   - Claim (2): ALREADY_CLAIMED, NOT_CLAIM_OWNER
   - State (3): INVALID_TRANSITION, LEASE_EXPIRED, LEASE_TOO_LONG
   - Validation (5): TICKET_NOT_FOUND, MISSING_EVIDENCE, INVALID_SUBTASK, FILE_CONFLICT, VALIDATION_ERROR
   - Auth (2): UNAUTHORIZED, FORBIDDEN
   - Rate Limit (1): RATE_LIMITED
   - System (7): INTERNAL_ERROR, DB_UNAVAILABLE, SERVICE_TIMEOUT, DEPENDENCY_BLOCKED, IDEMPOTENT_REPLAY, CONCURRENT_MODIFICATION, LEASE_CONFLICT

3. **Each Error Code Includes:** Numeric code (1001–6007), string code, HTTP status mapping, human-readable message template, trigger conditions, recovery action, retryable flag, details schema.

4. **Validation Error Format** — Extended `ValidationErrorResponse` schema with field-level `FieldError[]` details.

5. **Pagination Contract** — Offset-based (`page` + `page_size`), max 100 per page, standard envelope with `total`, `page`, `page_size`, `total_pages`.

6. **Filtering Syntax** — Query parameter filters with operators: eq, in, gt, gte, lt, lte, ne, like. Bracket syntax for non-equality. Filterable fields per endpoint.

7. **Idempotency Key Contract** — `Idempotency-Key` header (UUID v4), 24-hour dedup window, PostgreSQL-backed `idempotency_keys` table schema, replay semantics with `Idempotent-Replayed` header.

8. **Rate Limiting Policy** — Token bucket algorithm. 5 tiers: per-agent (120/min), per-machine (300/min), per-endpoint-mutating (30/min), per-endpoint-read (120/min), global (1000/min). Standard `X-RateLimit-*` headers. 429 response format documented.

9. **Machine-Readable Error Reference** — Complete JSON catalog suitable for code generation and SDK error handling.

10. **Implementation Guide** — PostgreSQL error mapping, HTTP status mapping, extension guide, client error handling pattern.

11. **4 ADRs** — Offset-based pagination, token bucket rate limiting, numeric+string error codes, idempotency key TTL.

## Context Map
- **Primary files:** `docs/architecture/api/error-catalog.md` (created)
- **Secondary files analyzed:** `forgeos-server/src/types/index.ts` (ForgeOSErrorCode enum, ErrorResponse interface), `forgeos-server/src/middleware/error-handler.ts` (HTTP_STATUS_MAP, PG_ERROR_MAP), `forgeos-server/src/middleware/validation.ts` (ValidationErrorResponse), `docs/architecture/api/openapi-spec.yaml` (existing schemas)
- **Established patterns followed:** Existing ForgeOSErrorCode enum naming, ErrorResponse envelope, Zod-based validation middleware pattern

## Well-Architected Assessment
| Pillar | Score | Notes |
|--------|-------|-------|
| Operational Excellence | 9/10 | Error codes enable structured logging and monitoring |
| Security | 8/10 | Production mode hides internal details, auth error codes defined |
| Reliability | 9/10 | Idempotency keys, retry semantics, retryable flags |
| Performance | 8/10 | Token bucket rate limiting, pagination limits |
| Cost Optimization | 9/10 | PostgreSQL-based (no additional infra), periodic cleanup |
| Sustainability | 9/10 | Extension guide, machine-readable catalog, client patterns |

## Acceptance Criteria Verification
- ✅ Error code catalog with 20 error codes organized by 6 categories
- ✅ Each error code has: numeric code, string code, HTTP status mapping, message template
- ✅ Pagination contract defined: offset-based, page size limits, response envelope
- ✅ Filtering syntax defined: field operators (eq, in, gt, lt, etc.), combination logic
- ✅ Idempotency key contract: header name, key format, deduplication window, response semantics
- ✅ Rate limiting policy: per-agent, per-machine, per-endpoint limits with 429 response format
- ✅ Error catalog document delivered at docs/architecture/api/error-catalog.md

## Evidence
- **Artifacts:** `docs/architecture/api/error-catalog.md`
- **Test results:** N/A — architecture deliverable, no runtime tests
- **Confidence:** HIGH — Catalog is comprehensive, covers all existing codes plus 6 new codes needed for complete coverage, aligns with established codebase patterns
