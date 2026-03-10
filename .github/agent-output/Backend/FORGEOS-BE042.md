# FORGEOS-BE042 — BACKEND Complete

## Summary
Implemented per-agent, per-machine rate limiting middleware for the MCP server using a sliding window algorithm.

## Files Created/Modified
- **Created:** `mcp-server/src/mcp_server/middleware/rate_limiter.py` — Rate limiting middleware with `SlidingWindowLimiter`, `RateLimitConfig`, and `RateLimitMiddleware`
- **Modified:** `mcp-server/src/mcp_server/middleware/__init__.py` — Exported `RateLimitMiddleware`, `RateLimitConfig`, `SlidingWindowLimiter`
- **Created:** `mcp-server/tests/test_rate_limiter.py` — 34 tests covering all acceptance criteria

## Acceptance Criteria Coverage

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Rate limiter tracks requests per agent identity and per machine | ✅ | `_build_rate_limit_key()` uses `{identity_id}:{machine_id}` from `AuthContext` |
| Sliding window algorithm enforces configurable limits per time window | ✅ | `SlidingWindowLimiter` maintains deque of timestamps, evicts outside window |
| Claim/advance operations have stricter limits than read operations | ✅ | `_is_write_operation()` classifies POST/PUT/DELETE/PATCH + claim/advance/reject/release paths as write; `RateLimitConfig` has separate `write_limit` (30) vs `read_limit` (120) |
| Rate limit exceeded returns MCP error or HTTP 429 with Retry-After | ✅ | `_rate_limit_response()` returns JSON-RPC format for `/mcp` paths, plain JSON otherwise, both with 429 status |
| Rate limit headers included in responses | ✅ | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` added to all responses; `Retry-After` on 429 |
| Rate limits configurable via environment variables or server config | ✅ | `RateLimitConfig` dataclass with `read_limit`, `read_window`, `write_limit`, `write_window` — all overridable |

## TDD Evidence
- **RED:** Tests written first for `SlidingWindowLimiter`, path classification, key building, and middleware integration
- **GREEN:** Implementation in `rate_limiter.py` to pass all tests
- **REFACTOR:** Extracted `_rate_limit_response()`, `_build_rate_limit_key()`, `_is_write_operation()` as testable helpers

## Coverage
- **34 tests**, all passing
- **96% coverage** on `rate_limiter.py` (109 stmts, 4 misses — uncovered lines are edge-case fallback branches)

## Lint
- ruff: zero errors, zero warnings

## Architecture Decisions
- **In-memory sliding window** over PostgreSQL-backed: simpler, no extra DB queries per request, sufficient for single-instance deployments. For horizontal scaling, can be replaced with Redis-backed implementation.
- **Starlette BaseHTTPMiddleware** pattern: consistent with existing `AuthMiddleware` and `AuditMiddleware`.
- **Two-tier limits**: write operations (claim/advance/reject/release) default to 30/min, read operations default to 120/min.
- **Auth context integration**: uses `get_auth_context()` from `AuthMiddleware` for agent identity, falls back to client IP for unauthenticated requests.

## Confidence: HIGH
