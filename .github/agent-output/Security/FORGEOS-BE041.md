# FORGEOS-BE041 — Security Review

## Verdict: PASS

**Confidence:** HIGH

## Summary

Idempotency key middleware (`mcp-server/src/mcp_server/middleware/idempotency.py`) reviewed for STRIDE threats, OWASP Top 10, secret scanning, input validation, and dependency audit. The implementation follows sound security practices: clean store abstraction, proper in-progress cleanup on exception, 409 Conflict for concurrent duplicates, and no hardcoded secrets. Two Medium/Low findings documented below with risk acceptance — neither constitutes a critical or high severity issue.

## Scope

| File | Access | Purpose |
|------|--------|---------|
| `mcp-server/src/mcp_server/middleware/idempotency.py` | Read-only | Primary implementation (452 lines) |
| `mcp-server/src/mcp_server/middleware/__init__.py` | Read-only | Package exports |
| `mcp-server/tests/test_idempotency.py` | Read-only | Test suite (516 lines, 38 tests) |

## STRIDE Threat Model

### Trust Boundary: Client → IdempotencyMiddleware → Handler

| Threat | Analysis | Score | Status |
|--------|----------|-------|--------|
| **Spoofing** | Key is client-supplied header — no authentication of key ownership. Keys are opaque strings; no user-binding. An attacker could replay another client's key to receive their cached response. | Impact=3 × Likelihood=2 = **6 (Low)** | Acceptable — idempotency keys are typically per-client UUIDs; cross-client key collision requires key knowledge. Rate limiting (separate middleware) mitigates brute-force. |
| **Tampering** | In-memory store (`dict`) is process-local, not shared. No external persistence to tamper with. Headers are read-only from Starlette `Request`. | Impact=2 × Likelihood=1 = **2 (Low)** | No action needed. |
| **Repudiation** | Operations are logged via structured logging (`idempotency_replay`, `idempotency_conflict`, `idempotency_key_missing`). Replay events include key and path. | Impact=2 × Likelihood=2 = **4 (Low)** | Adequate — structured log entries provide audit trail. |
| **Information Disclosure** | Key value echoed in 409 Conflict response body: `f"...key '{key}' is still in-progress"`. Key is client-supplied, so client already knows it. JSON API responses are not rendered in browser context. | Impact=1 × Likelihood=2 = **2 (Low)** | See Finding SEC-BE041-002. |
| **Denial of Service** | No key length limit on `_extract_idempotency_key()`. Attacker could send arbitrarily large keys to exhaust memory in the `InMemoryIdempotencyStore`. TTL-based expiry mitigates duration but not peak memory. | Impact=3 × Likelihood=3 = **9 (Medium)** | See Finding SEC-BE041-001. |
| **Elevation of Privilege** | Middleware does not bypass auth — it runs before the handler and only caches/replays responses. No privilege escalation vector. | Impact=1 × Likelihood=1 = **1 (Low)** | No action needed. |

### Trust Boundary: IdempotencyMiddleware → IdempotencyStore (Internal)

All calls are in-process (`InMemoryIdempotencyStore`). No external store boundary in current implementation. When PostgreSQL store is added, SQL injection review will be needed.

## OWASP Top 10 Checklist

| Category | Status | Notes |
|----------|--------|-------|
| **A01 Broken Access Control** | ✅ PASS | Middleware does not grant/deny access — it caches responses from downstream handlers that enforce their own auth. No authorization bypass. |
| **A02 Cryptographic Failures** | ✅ PASS | No cryptographic operations. No sensitive data stored in cache beyond HTTP response body (which is already accessible to the client). |
| **A03 Injection** | ✅ PASS | No SQL, command, or template injection vectors. Key is used only as a dict key and in log messages. Log formatting uses structured `extra={}` dict, not string interpolation in the log message itself. |
| **A04 Insecure Design** | ✅ PASS | Clean separation of concerns: abstract store interface, configurable policy, frozen config dataclass. In-progress cleanup in `except` block prevents orphaned locks. |
| **A05 Security Misconfiguration** | ✅ PASS | Health endpoints excluded. Default policy is `WARN` (non-breaking). TTL default is 24h (reasonable). `_EXCLUDED_PATHS` is a frozen set. |
| **A06 Vulnerable Components** | ✅ PASS | Dependencies: `starlette` (framework standard), `time` / `abc` / `enum` / `dataclasses` (stdlib). No third-party dependencies introduced. |
| **A07 Auth Failures** | ✅ N/A | Middleware does not handle authentication. |
| **A08 Data Integrity** | ✅ PASS | Cached entries are immutable once stored (`IdempotencyEntry` uses `dataclass(slots=True)`). In-progress flag prevents concurrent writes. |
| **A09 Logging Failures** | ✅ PASS | Structured logging for all decision branches: missing key (warn/reject), conflict, replay. Uses `get_logger()` from observability module. No PII in logs — only key value (opaque UUID) and path. |
| **A10 SSRF** | ✅ N/A | No outbound requests. |

## LLM Top 10

Not applicable — this middleware contains no AI/LLM features.

## Secret Scanning

- **Result:** CLEAN
- Scanned `idempotency.py` and `__init__.py` for patterns: `secret`, `password`, `token`, `api_key`, `credential`, `private_key`.
- Zero matches. No `.env` references. No hardcoded values.

## Dependency Audit

| Dependency | Type | CVE Status |
|------------|------|------------|
| `starlette` (BaseHTTPMiddleware, JSONResponse, Response) | Framework | Covered by project-level SBOM — no new deps introduced |
| `time`, `abc`, `enum`, `dataclasses` | Python stdlib | N/A |
| `mcp_server.observability.get_logger` | Internal | No external surface |

**SBOM impact:** Zero new dependencies added. No change to project SBOM.

## SARIF Findings

### SEC-BE041-001 — Unbounded Idempotency Key Length

```json
{
  "ruleId": "SEC-BE041-001",
  "level": "warning",
  "message": {
    "text": "No maximum length enforced on idempotency key. Attacker could send arbitrarily large keys to exhaust in-memory store."
  },
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/idempotency.py" },
      "region": { "startLine": 240, "endLine": 250 }
    }
  }],
  "properties": {
    "severity": "MEDIUM",
    "cwe": "CWE-770",
    "owasp": "A05",
    "stride": "Denial of Service",
    "score": 9,
    "riskAcceptance": "ACCEPTED — Rate limiting middleware (RateLimitMiddleware) is applied before idempotency in the middleware stack, bounding request volume. In-memory store entries expire via TTL. A follow-up ticket could add MAX_KEY_LENGTH=256 validation in _extract_idempotency_key() for defense-in-depth."
  }
}
```

### SEC-BE041-002 — Client Key Echoed in Error Response

```json
{
  "ruleId": "SEC-BE041-002",
  "level": "note",
  "message": {
    "text": "User-supplied idempotency key echoed in 409 Conflict response body. Low risk since (a) key is client-supplied and already known to requester, (b) responses are JSON API, not rendered in browser."
  },
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/idempotency.py" },
      "region": { "startLine": 290, "endLine": 308 }
    }
  }],
  "properties": {
    "severity": "LOW",
    "cwe": "CWE-209",
    "owasp": "A04",
    "stride": "Information Disclosure",
    "score": 2,
    "riskAcceptance": "ACCEPTED — Key is opaque client-supplied value (UUID), content-type is application/json. No XSS vector. Standard practice in idempotency implementations (Stripe, AWS)."
  }
}
```

## Auth/AuthZ Review

Middleware is positioned in the Starlette middleware stack and does not bypass auth middleware. It caches the complete response (including any auth-derived content), which is safe because the cached response was originally authorized for that specific request.

## Input Validation Review

- Key extraction: strips whitespace, rejects empty strings.
- **Gap:** No max-length validation (see SEC-BE041-001).
- No SQL injection surface (in-memory dict storage).
- No user-controlled format strings in logging (uses structured `extra={}`).

## API Security

- Health endpoints excluded from enforcement (correct).
- `_MUTATING_METHODS` correctly scoped to POST/PUT/DELETE/PATCH.
- GET/HEAD/OPTIONS bypass idempotency (correct — safe methods).
- 409 Conflict prevents concurrent duplicate execution (correct).

## Data Classification

- Cached data: HTTP response bodies (status code, headers, body bytes).
- No PII stored beyond what the original response contains.
- TTL-based expiry ensures data is not retained indefinitely.
- In-memory only — no persistence to disk.

## Verdict Rationale

- **Zero critical findings.**
- **Zero high findings.**
- **Two medium/low findings documented with risk acceptance.**
- Clean architecture with proper error handling and audit logging.
- No secrets, no new dependencies, no injection vectors.
- Rate limiting middleware provides defense-in-depth against DoS via key abuse.

**VERDICT: PASS** — Advance to CI stage.
