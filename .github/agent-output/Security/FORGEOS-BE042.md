# FORGEOS-BE042 — Security Review

## Verdict: PASS

**Confidence: HIGH**

## Summary

Reviewed per-agent rate limiting middleware (`mcp-server/src/mcp_server/middleware/rate_limiter.py`). Performed STRIDE threat model across all trust boundaries, OWASP Top 10 compliance check, dependency audit, secret scan, and input validation review. No critical or high findings. Two medium/low findings documented with risk acceptance.

---

## STRIDE Threat Model

### Trust Boundaries Identified

1. **Client → RateLimitMiddleware** — HTTP request ingress
2. **RateLimitMiddleware → AuthMiddleware (ContextVar)** — identity derivation via `get_auth_context()`
3. **RateLimitMiddleware → Application** — allowed requests forwarded downstream

### Threat Analysis

| Category | Threat | Score (I×L) | Severity | Disposition |
|----------|--------|-------------|----------|-------------|
| **Spoofing** | Machine-ID header spoofing: `X-Machine-Id` is client-controlled. An authenticated agent could vary this header to create separate rate-limit buckets per fabricated machine_id, bypassing per-identity limits. | 4×3=12 | Medium | ACCEPTED — requires valid API key (DB-validated); system is for trusted agents, not public-facing. Per-machine tracking is an intentional design choice. |
| **Spoofing** | Unauthenticated key fallback: when AuthContext is None, key falls back to `anon:{client_ip}`. Behind a reverse proxy without X-Forwarded-For, all anonymous clients share one bucket. | 2×2=4 | Low | ACCEPTED — anonymous access is already restricted by AuthMiddleware; rate limiter is defense-in-depth. |
| **Tampering** | In-memory deque — no external persistence to tamper with. Response headers set server-side. | 2×1=2 | Low | N/A |
| **Repudiation** | Rate limit exceeded events logged via structured logger with key, limit, is_write, retry_after. Adequate audit trail. | 1×1=1 | Low | N/A |
| **Info Disclosure** | Rate limit headers expose limit values and remaining count. This is standard practice per RFC draft-ietf-httpapi-ratelimit-headers. No PII in logs. | 2×2=4 | Low | ACCEPTED — by design. |
| **DoS** | Memory growth: `_buckets` dict never prunes empty/expired entries. With many unique keys over time, memory grows unboundedly. | 3×2=6 | Low | ACCEPTED — bounded agent population in controlled deployment; single-instance design documented. |
| **DoS** | Deque eviction is lazy (on access only). Stale buckets for keys that are never accessed again persist. | 2×2=4 | Low | ACCEPTED — same rationale as above. |
| **Elevation of Privilege** | Rate limiter does not affect permissions — only request counts. No privilege escalation surface. | 1×1=1 | Low | N/A |

---

## OWASP Top 10 Checklist

| # | Category | Status | Notes |
|---|----------|--------|-------|
| A01 | Broken Access Control | ✅ PASS | Rate limiter is complementary to AuthMiddleware. Health endpoints excluded appropriately. No bypass of auth. |
| A02 | Cryptographic Failures | ✅ N/A | No cryptography in this module. No secrets stored or processed. |
| A03 | Injection | ✅ PASS | No DB queries, no command execution. Keys are f-strings used only as dict keys — no injection surface. |
| A04 | Insecure Design | ✅ PASS | Machine-ID spoofing noted (STRIDE). Design is acceptable for trusted-agent deployment model. Two-tier limits (write=30, read=120) provide adequate separation. |
| A05 | Security Misconfiguration | ✅ PASS | Defaults are reasonable. `RateLimitConfig` is frozen dataclass (immutable). Configuration injection documented. |
| A06 | Vulnerable Components | ✅ PASS | Uses `starlette.middleware.base.BaseHTTPMiddleware` — standard, maintained dependency. No new external deps introduced. |
| A07 | Auth Failures | ✅ N/A | Auth handled by upstream `AuthMiddleware` with DB-backed API key validation. Rate limiter trusts established `AuthContext`. |
| A08 | Data Integrity | ✅ PASS | In-memory deque in single-threaded async context — GIL + event loop ensure safe access. No deserialization of untrusted data. |
| A09 | Logging Failures | ✅ PASS | Structured logging via `get_logger("rate_limiter")`. Rate limit exceeded logged with operational metadata. No PII or credentials in log output. |
| A10 | SSRF | ✅ N/A | No outbound requests made by this middleware. |

---

## LLM Top 10

Not applicable — this middleware does not interact with LLM/AI features.

---

## Dependency Audit

No new dependencies introduced by this ticket. The module uses:
- `starlette` (existing dependency) — `BaseHTTPMiddleware`, `JSONResponse`
- `mcp_server.middleware.auth_middleware` (internal) — `get_auth_context`
- `mcp_server.observability` (internal) — `get_logger`
- Python stdlib: `time`, `collections.deque`, `dataclasses`

**SBOM impact:** Zero new entries. Existing dependency tree unchanged.

---

## Secret Scanning

- No hardcoded API keys, tokens, passwords, or private keys found.
- No `.env` file references or environment variable secrets in this module.
- Rate limit keys contain `identity_id:machine_id` — operational identifiers, not secrets.

**Result: CLEAN**

---

## Auth/AuthZ Review

- Rate limiter depends on `AuthMiddleware` (upstream) for identity via `ContextVar`.
- Middleware ordering documented: RateLimitMiddleware MUST follow AuthMiddleware.
- Unauthenticated requests fall back to IP-based rate limiting (`anon:{client.host}`).
- No privilege decisions made — only request counting and throttling.
- Health endpoints (`/health`, `/healthz`, `/ready`, `/readiness`, `/livez`, `/readyz`) excluded from rate limiting — correct for monitoring probes.

---

## Input Validation

- `_is_write_operation()` — reads `request.method` (HTTP method enum) and `request.url.path` (framework-parsed). No user-controlled string interpolation.
- `_build_rate_limit_key()` — reads from `AuthContext` (server-set via `ContextVar`) or `request.client.host` (framework-provided). No injection vector.
- Path matching uses `str.startswith()` and `in` operator on frozen sets/tuples — safe.
- `RateLimitConfig` is a frozen dataclass with typed fields — rejects invalid types at construction.

---

## API Security

- **Rate limiting**: This IS the rate limiter. ✅
- **CORS**: Not affected by this module — handled elsewhere.
- **Auth headers**: Required by upstream AuthMiddleware for protected routes.
- **Response headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (on 429) — standard RFC-compliant headers.

---

## Data Classification

- No PII processed or stored by this middleware.
- Rate limit keys (`identity_id:machine_id`) are operational identifiers.
- Bucket timestamps are monotonic clock values — no calendar or personal time data.

---

## SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-RATE-001",
              "name": "RateLimitBypassViaMachineIdSpoofing",
              "shortDescription": {
                "text": "Rate limit bypass via X-Machine-Id header spoofing"
              },
              "fullDescription": {
                "text": "The rate limit key includes machine_id derived from the client-controlled X-Machine-Id header. An authenticated agent can vary this header to create separate rate limit buckets, effectively bypassing per-identity rate limits."
              },
              "defaultConfiguration": {
                "level": "warning"
              },
              "properties": {
                "cwe": "CWE-290",
                "severity": "Medium",
                "impact": 4,
                "likelihood": 3,
                "riskScore": 12
              }
            },
            {
              "id": "SEC-RATE-002",
              "name": "UnboundedBucketMemoryGrowth",
              "shortDescription": {
                "text": "Memory leak via unbounded rate limit bucket accumulation"
              },
              "fullDescription": {
                "text": "The _buckets dictionary in SlidingWindowLimiter never prunes empty or expired entries. Over time with many unique keys, memory grows without bound. Lazy eviction only removes timestamps within active buckets on access."
              },
              "defaultConfiguration": {
                "level": "note"
              },
              "properties": {
                "cwe": "CWE-401",
                "severity": "Low",
                "impact": 3,
                "likelihood": 2,
                "riskScore": 6
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-RATE-001",
          "level": "warning",
          "message": {
            "text": "Rate limit key uses client-controlled X-Machine-Id header. Authenticated agents can bypass per-identity rate limits by varying this header. Accepted risk: requires valid API key, system is for trusted agents."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/middleware/rate_limiter.py"
                },
                "region": {
                  "startLine": 228,
                  "endLine": 231
                }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Consider rate limiting per identity_id alone (ignoring machine_id), or validating machine_id against pre-registered values in the agent registry."
              }
            }
          ]
        },
        {
          "ruleId": "SEC-RATE-002",
          "level": "note",
          "message": {
            "text": "SlidingWindowLimiter._buckets dict never prunes expired/empty entries. Accepted risk: bounded agent population in controlled deployment."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/middleware/rate_limiter.py"
                },
                "region": {
                  "startLine": 132,
                  "endLine": 134
                }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Add periodic sweep (e.g., every N requests or via background task) to remove empty buckets from _buckets dict."
              }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Risk Acceptance

| Finding | Severity | Accepted | Rationale |
|---------|----------|----------|-----------|
| SEC-RATE-001: Machine-ID spoofing bypass | Medium | Yes | Requires valid API key (DB-validated). System designed for trusted agents, not public-facing. Per-machine tracking is intentional for multi-machine agent deployments. |
| SEC-RATE-002: Unbounded bucket memory | Low | Yes | Bounded agent population (~14 agents × small machine count). Single-instance deployment. Memory impact negligible at current scale. |

---

## Verdict Rationale

- **Zero critical findings.** No authentication bypass, no injection, no privilege escalation.
- **Zero high findings.** No vulnerable components, no cryptographic failures, no SSRF.
- **Two medium/low findings documented** with explicit risk acceptance and suggested future mitigations.
- **STRIDE complete** across all 6 categories on all trust boundaries.
- **OWASP 10/10 categories checked.**
- **Clean secret scan.** No hardcoded credentials.
- Implementation follows security best practices: frozen config, structured logging, typed fields, standard error responses.
