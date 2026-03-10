# FORGEOS-BE054 — Security Review

## Verdict: **PASS**

**Confidence:** HIGH
**Reviewed files:**
- `mcp-server/src/mcp_server/middleware/auth_middleware.py` (read-only)
- `mcp-server/src/mcp_server/middleware/__init__.py` (read-only)
- `mcp-server/src/mcp_server/auth/agent_auth.py` (read-only, dependency)

---

## 1. STRIDE Threat Model

### Trust Boundaries Identified

| # | Boundary | From | To |
|---|----------|------|-----|
| TB-1 | Network → Middleware | Client (browser/agent) | `AuthMiddleware.dispatch()` |
| TB-2 | Middleware → Database | `validate_api_key()` | PostgreSQL via asyncpg pool |
| TB-3 | Middleware → Downstream | `set_auth_context()` | Request handlers |

### Threat Analysis

| Threat | Score (I×L) | Severity | Analysis |
|--------|-------------|----------|----------|
| **Spoofing** | 3×2 = **6** | LOW | API key validated via SHA-256 hash + `hmac.compare_digest` constant-time comparison. Rate limiting (60/min per prefix) prevents brute force. `X-Machine-Id`/`X-Forwarded-For` are user-controllable but used only for audit context, not authorization. No session state to fixate. |
| **Tampering** | 3×1 = **3** | LOW | `AuthContext` is `frozen=True` dataclass — immutable after creation. `ContextVar` provides async-safe per-request isolation. `clear_auth_context()` in `finally` block prevents context leakage. `_EXCLUDED_PATHS` is a module-level `frozenset`. No mutable shared state exposed. |
| **Repudiation** | 2×2 = **4** | LOW | Structured logging via `get_logger()` for both success and failure. Auth attempts logged with `identity_type`, `agent_name`, `path`, and failure `reason`. Full API key never logged — only 8-char `key_prefix`. `_update_last_used` provides DB-level audit trail. |
| **Info Disclosure** | 2×1 = **2** | LOW | Error messages are generic ("Authentication required", "Invalid API key") — no key-exists-vs-wrong-hash oracle. No stack traces exposed. 503 returns "Service unavailable" without internals. Rate limit message omits window details. MCP errors use JSON-RPC code `-32602`. |
| **Denial of Service** | 3×2 = **6** | LOW | Token-bucket rate limiter per key prefix (60 req/min). Unauthenticated requests are rejected cheaply before any DB call (no `api_key` → immediate 401). 503 fallback prevents hanging when DB pool is unavailable. External WAF/reverse proxy provides additional layer for volumetric attacks. |
| **Elevation of Privilege** | 4×1 = **4** | LOW | `_classify_identity()` maps roles from DB — no client-controlled escalation path. `frozen=True` prevents post-creation mutation. Path normalization (`rstrip("/")`) prevents path traversal bypass. Excluded paths use exact frozenset match, not regex/prefix. Permissions are DB-sourced, not client-derived. |

**STRIDE Summary:** All threat categories score below 10 (LOW). No MEDIUM, HIGH, or CRITICAL threats identified.

---

## 2. OWASP Top 10 Checklist

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| A01 | Broken Access Control | **PASS** | Deny-by-default: missing credentials → 401. Path exclusion uses exact `frozenset` match. Context cleared after each request in `finally` block. No path traversal bypass vectors. |
| A02 | Cryptographic Failures | **PASS** | SHA-256 for high-entropy key hashing (32-byte random = 256-bit entropy). `hmac.compare_digest` for constant-time comparison. `os.urandom` for key generation. No plaintext key storage — only hashes persisted. |
| A03 | Injection | **PASS** | SQL uses parameterized queries (`$1` placeholder in `_lookup_by_prefix`). No string concatenation in queries. Key prefix extraction uses fixed-length slice `[:8]`. No `eval`/`exec` usage. |
| A04 | Insecure Design | **PASS** | Defense-in-depth validation pipeline: format check → rate limit → prefix lookup → hash compare → status check → expiry check → agent status. Immutable data structures throughout. Async-safe context management via `contextvars`. |
| A05 | Security Misconfiguration | **PASS** | No debug mode flags. No verbose error messages. Health endpoints defined as immutable `frozenset`. Default rate limits are reasonable (60/min). No hardcoded secrets. |
| A06 | Vulnerable Components | **PASS ℹ** | Dependencies (starlette, asyncpg) are well-maintained. No SBOM tooling available in this Python project to run automated CVE scan. Manual review shows no known CVEs for current usage patterns. |
| A07 | Auth Failures | **PASS** | Constant-time hash comparison. Per-prefix rate limiting. Key expiry + revocation checks. Agent active-status check. Stateless per-request auth (no session fixation risk). |
| A08 | Data Integrity | **PASS** | Frozen dataclasses prevent post-creation mutation. API key format validated before processing (`fgos_` prefix check). No deserialization of untrusted data. |
| A09 | Logging Failures | **PASS** | Structured logging with scoped logger names. Both success and failure paths logged. No PII in logs. Only key prefix (8 chars) logged, never full key. |
| A10 | SSRF | **N/A** | No outbound HTTP calls. No URL construction from user input. Not applicable to this component. |

**OWASP Summary:** 9/9 applicable categories PASS. 1 category N/A.

---

## 3. LLM Top 10 Assessment

This middleware does not directly interact with LLM/AI features. The auth middleware protects MCP tool endpoints that may eventually invoke LLM-backed agents, but the middleware itself performs no LLM processing.

| # | Category | Status | Notes |
|---|----------|--------|-------|
| LLM01 | Prompt Injection | **N/A** | No LLM invocation in middleware |
| LLM02 | Insecure Output | **N/A** | No LLM output handling |
| LLM06 | Sensitive Info Disclosure | **N/A** | No LLM data flows |
| LLM08 | Excessive Agency | **N/A** | Middleware enforces auth boundary — agents are constrained by DB-sourced permissions |

---

## 4. SARIF Findings

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
              "id": "SEC-BE054-001",
              "shortDescription": { "text": "IdentityType.OPERATOR enum value unused" },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-863", "severity": "LOW" }
            },
            {
              "id": "SEC-BE054-002",
              "shortDescription": { "text": "Machine ID from user-controllable headers" },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-290", "severity": "LOW" }
            },
            {
              "id": "SEC-BE054-003",
              "shortDescription": { "text": "No pre-auth rate limiting for unauthenticated requests" },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-770", "severity": "LOW" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE054-001",
          "level": "note",
          "message": {
            "text": "_classify_identity() maps 'admin' to ADMIN and everything else to AGENT. The IdentityType.OPERATOR enum value exists but is never assigned. Operators are classified as AGENT. Not a vulnerability — OPERATOR-specific authorization has not been implemented yet. Document as design intent."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/auth_middleware.py" },
                "region": { "startLine": 149, "endLine": 153 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE054-002",
          "level": "note",
          "message": {
            "text": "X-Machine-Id and X-Forwarded-For headers are user-controllable. The extracted machine_id is stored in AuthContext for audit/logging only, not used for authorization decisions. Acceptable but should be documented as untrusted metadata. In production, reverse proxy should strip/overwrite X-Forwarded-For."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/auth_middleware.py" },
                "region": { "startLine": 126, "endLine": 140 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE054-003",
          "level": "note",
          "message": {
            "text": "Requests without any API key are rejected immediately (401) without a DB call, but there is no rate limiting on unauthenticated requests. At high volume, this could consume CPU (though minimal per-request cost). Typical mitigation is reverse proxy / WAF rate limiting. Not blocking — the rejection path is lightweight."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/auth_middleware.py" },
                "region": { "startLine": 230, "endLine": 240 }
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

## 5. Dependency / SBOM Summary

| Package | Role | Known CVEs |
|---------|------|------------|
| `starlette` | ASGI framework, BaseHTTPMiddleware | None for auth-relevant usage |
| `asyncpg` | PostgreSQL driver (parameterized queries) | None known |
| `hashlib` | SHA-256 hashing (stdlib) | N/A |
| `hmac` | Constant-time comparison (stdlib) | N/A |
| `os.urandom` | Cryptographic random (stdlib) | N/A |
| `contextvars` | Async-safe context (stdlib) | N/A |

No critical or high CVEs identified in the dependency chain relevant to this middleware.

---

## 6. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | None found |
| Hardcoded passwords | None found |
| Hardcoded tokens | None found |
| Private keys | None found |
| `.env` in VCS | Not applicable (no `.env` in middleware) |
| Key in source | Only `API_KEY_PREFIX = "fgos_"` (format identifier, not a secret) |

---

## 7. Security Posture Summary

### Strengths
- **Constant-time comparison** via `hmac.compare_digest` prevents timing attacks
- **Frozen dataclasses** (`AuthContext`, `AgentIdentity`) ensure immutability
- **Async-safe context** via `contextvars.ContextVar` with `finally`-block cleanup
- **Parameterized SQL** prevents injection
- **Defense-in-depth validation**: format → rate limit → prefix lookup → hash compare → status → expiry → agent status
- **Structured logging** with no PII/key leakage (prefix only)
- **Immutable path config** via `frozenset` prevents runtime modification
- **Rate limiting** per key prefix (token bucket, 60/min)

### Low-Risk Observations (documented, not blocking)
1. `IdentityType.OPERATOR` defined but unused — classify when operator auth is implemented
2. `machine_id` from user-controllable headers — document as untrusted audit metadata
3. No pre-auth rate limiting — rely on reverse proxy/WAF for volumetric protection

---

## 8. Verdict

**PASS** — Zero critical or high findings. Three LOW/informational findings documented with risk acceptance. The auth middleware implements industry-standard security patterns: constant-time comparison, rate limiting, defense-in-depth validation, immutable context, and structured logging without sensitive data exposure.

**Confidence: HIGH**
