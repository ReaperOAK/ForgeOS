# FORGEOS-BE039 — Security Stage Summary

## Ticket
**Title:** Implement WebSocket Ticket State Streaming  
**Stage:** SECURITY → CI  
**Verdict:** PASS (with documented medium-severity findings, risk-accepted)  
**Agent:** Security on pop-os  
**Timestamp:** 2026-03-11T23:55:00Z

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `mcp-server/src/mcp_server/api/routes/websocket.py` | 120 | WebSocket endpoint `/ws/tickets` |
| `mcp-server/src/mcp_server/services/event_broadcaster.py` | 230 | Event broadcaster, client registry, ping loop |
| `mcp-server/src/mcp_server/transport/http.py` | 220–290 | Route registration, deferred broadcaster binding |
| `mcp-server/src/mcp_server/middleware/rate_limiter.py` | 1–100, 325–365 | Rate limiter middleware (BaseHTTPMiddleware) |

---

## STRIDE Threat Model

### Trust Boundaries

```
[Browser/Dashboard] ──ws──► [/ws/tickets endpoint] ──internal──► [EventBroadcaster]
                                                                        │
                                                        fan-out via send_text()
                                                                        │
                                                              [All WS Clients]
```

### Threat Analysis

| Category | Threat | Boundary | Impact | Likelihood | Score | Severity | Finding |
|----------|--------|----------|--------|------------|-------|----------|---------|
| **Spoofing** | Unauthenticated WS connections | Client → /ws/tickets | 3 | 4 | 12 | MEDIUM | SEC-BE039-001 |
| **Tampering** | Client message mutation | Client → Endpoint | 1 | 1 | 1 | LOW | None — read-only protocol; `_handle_client_message` only handles `pong`, ignores all other types |
| **Repudiation** | Unattributed actions | Endpoint → Logs | 2 | 2 | 4 | LOW | None — connect/disconnect logged; no mutating actions to attribute |
| **Info Disclosure** | Ticket state data exposed to unauthenticated clients | Broadcaster → Clients | 3 | 3 | 9 | LOW | SEC-BE039-001 (related) — operational metadata only, no PII |
| **Denial of Service** | Unlimited WS connections exhaust resources | Client → Broadcaster | 4 | 3 | 12 | MEDIUM | SEC-BE039-002 |
| **Elevation of Privilege** | Command execution via WS | Client → Endpoint | 1 | 1 | 1 | LOW | None — no mutation or command endpoints; receive_text is inert |

---

## OWASP Top 10 Checklist

| Category | Status | Evidence |
|----------|--------|----------|
| **A01 Broken Access Control** | ⚠️ MEDIUM | WebSocket endpoint has no authentication. Any network-reachable client can connect and receive events. Mitigated: internal tool, private network deployment, data is non-PII operational metadata. |
| **A02 Cryptographic Failures** | ✅ PASS | No credentials stored or transmitted. TLS enforcement is a deployment concern (uvicorn + reverse proxy). |
| **A03 Injection** | ✅ PASS | No SQL, no command execution. `json.loads` wrapped in try/except (websocket.py L110-115). Input from clients is discarded — no path to injection. |
| **A04 Insecure Design** | ⚠️ MEDIUM | No max connection limit on EventBroadcaster (unlike SSE transport which has `max_connections=100`). Design gap for DoS resilience. |
| **A05 Security Misconfiguration** | ⚠️ LOW | Rate limiter uses `BaseHTTPMiddleware` which doesn't intercept WebSocket upgrades. WS connections bypass rate limiting. |
| **A06 Vulnerable Components** | ✅ PASS | `mcp>=1.25` (pulls starlette transitively), `uvicorn>=0.31.0`. No known CVEs in current versions. |
| **A07 Auth Failures** | ⚠️ MEDIUM | Same as A01 — no auth on WS endpoint. No session token, no API key, no JWT validation on upgrade. |
| **A08 Data Integrity** | ✅ PASS | Read-only event streaming. Frozen dataclasses (`ClientFilter`, `TicketEvent`) prevent tampering. No deserialization of untrusted objects. |
| **A09 Logging Failures** | ✅ PASS | Connection/disconnect logged via structured logger (websocket.py L83-90, L97). No PII in log extras. Debug-level for unhandled messages. |
| **A10 SSRF** | ✅ N/A | No outbound HTTP requests from WS handler or broadcaster. |

---

## LLM Top 10

Not applicable — no AI/LLM features in WebSocket streaming components.

---

## Dependency Audit (SBOM Summary)

| Package | Version Constraint | Known CVEs | Status |
|---------|--------------------|------------|--------|
| mcp | >=1.25,<2 | None known | ✅ |
| uvicorn | >=0.31.0 | None known | ✅ |
| starlette | (transitive via mcp) | None known | ✅ |
| asyncpg | >=0.30.0 | None known | ✅ |
| pydantic | >=2.0,<3 | None known | ✅ |

**Total dependencies scanned:** 5 direct + transitives.  
**Critical/High CVEs:** 0.

---

## Secret Scanning

- No hardcoded API keys, tokens, passwords, or private keys in reviewed files.
- No `.env` files loaded or referenced by WS components.
- **Result:** CLEAN

---

## Auth/AuthZ Review

- WebSocket endpoint at `/ws/tickets` has **no authentication middleware**.
- No API key validation, no JWT verification, no session token check on upgrade.
- BaseHTTPMiddleware rate limiter does not intercept WebSocket connections (Starlette limitation).
- **Risk accepted:** This is an internal dashboard streaming endpoint for operational metadata on a private network. Data contains ticket IDs, stage names, and timestamps — no PII, no secrets, no credentials.

---

## Input Validation

- `_parse_filters()` (websocket.py L30-52): Query params parsed, stripped, uppercased for stages. Uses `frozenset` — immutable, no injection vector.
- `_handle_client_message()` (websocket.py L100-120): `json.loads` wrapped in try/except; malformed JSON silently ignored. Only `"pong"` type processed; all others discarded. No state mutation from client input.
- No parameterized queries needed (no DB access in WS handler).
- **Result:** PASS — robust handling, fail-safe defaults.

---

## Data Classification

- **Data transmitted:** ticket_id (string), event_type (string), old_stage/new_stage (enum-like strings), timestamp (ISO 8601), optional payload (dict with agent metadata).
- **PII present:** None.
- **Sensitivity:** Low — operational orchestration metadata.
- **Encryption at rest:** N/A (not persisted by WS component).
- **Encryption in transit:** Depends on deployment (TLS via reverse proxy or uvicorn SSL).

---

## API Security

- **Rate limiting:** Not applied to WebSocket (BaseHTTPMiddleware limitation). Documented as SEC-BE039-003.
- **CORS:** Not applicable to WebSocket (CORS is HTTP-only; WebSocket uses Origin header checked by browser, not enforced server-side).
- **Auth headers:** Not required (see Auth/AuthZ review).
- **Connection lifecycle:** Clean disconnect via try/finally with `unregister()`. Failed sends auto-remove clients. Stale detection via 30s ping loop.

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
              "id": "SEC-BE039-001",
              "shortDescription": { "text": "Unauthenticated WebSocket endpoint" },
              "helpUri": "https://cwe.mitre.org/data/definitions/306.html"
            },
            {
              "id": "SEC-BE039-002",
              "shortDescription": { "text": "No connection limit on WebSocket broadcaster" },
              "helpUri": "https://cwe.mitre.org/data/definitions/770.html"
            },
            {
              "id": "SEC-BE039-003",
              "shortDescription": { "text": "Rate limiter does not apply to WebSocket connections" },
              "helpUri": "https://cwe.mitre.org/data/definitions/770.html"
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE039-001",
          "level": "warning",
          "message": { "text": "WebSocket endpoint /ws/tickets accepts connections without authentication. Any network-reachable client can subscribe to ticket state events. CWE-306 (Missing Authentication for Critical Function). STRIDE: Spoofing/Info Disclosure. Risk accepted: internal tool, non-PII data, private network." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/api/routes/websocket.py" },
                "region": { "startLine": 72, "endLine": 97 }
              }
            },
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/transport/http.py" },
                "region": { "startLine": 269 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE039-002",
          "level": "warning",
          "message": { "text": "EventBroadcaster has no max_clients limit. Unlimited WebSocket connections can be registered, risking memory/fd exhaustion. CWE-770 (Allocation of Resources Without Limits). STRIDE: DoS (Impact=4 x Likelihood=3 = 12). Mitigation: ping loop removes stale connections at 30s intervals, reducing accumulation. Recommendation: add max_clients parameter similar to SSE transport ConnectionTracker (max_connections=100)." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/services/event_broadcaster.py" },
                "region": { "startLine": 130, "endLine": 145 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE039-003",
          "level": "note",
          "message": { "text": "Starlette BaseHTTPMiddleware does not intercept WebSocket upgrade requests. The rate_limiter middleware (FORGEOS-BE042) applies to HTTP but not WS. This is a framework limitation, not a code defect. CWE-770." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/middleware/rate_limiter.py" },
                "region": { "startLine": 288, "endLine": 320 }
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

## Positive Security Properties

1. **Immutable data structures** — `ClientFilter` and `TicketEvent` use `frozen=True` dataclasses, preventing mutation after creation.
2. **Fail-safe disconnect** — `try/finally` guarantees `unregister()` on any exit path (websocket.py L92-97).
3. **Auto-eviction of failed clients** — `publish()` catches send exceptions and removes broken clients (event_broadcaster.py L193-200).
4. **Stale connection detection** — 30s ping loop proactively removes unresponsive clients (event_broadcaster.py L203-213).
5. **Input discarding** — Client messages are parsed but not acted upon (except pong). No mutation path from client input.
6. **Clean logger hygiene** — No PII in log extras. Structured logging via `get_logger()`.
7. **Deferred binding pattern** — Broadcaster uses closure-based deferred lookup, returning 1013 (Service Unavailable) if not wired.

---

## Recommendations (Future Hardening — Non-Blocking)

1. **Add `max_clients` to EventBroadcaster** — Reject new registrations when limit reached (e.g., 100). Return WS close code 1013. Aligns with SSE transport's `ConnectionTracker`.
2. **Add origin validation** — Check `websocket.headers.get("origin")` against allowed origins before `accept()`.
3. **Add auth token parameter** — Accept optional `?token=` query param validated against agent auth to restrict access.
4. **Message size limit** — Set `max_size` on uvicorn WebSocket config to prevent large frame DoS.

These are recommendations for future tickets, not blockers for this review.

---

## Verdict

**PASS** — Zero critical or high-severity findings. Three medium/low findings documented with risk acceptance rationale:

| Finding | Severity | CWE | Risk Acceptance |
|---------|----------|-----|-----------------|
| SEC-BE039-001 | MEDIUM | CWE-306 | Internal tool, non-PII data, private network deployment |
| SEC-BE039-002 | MEDIUM | CWE-770 | Ping loop mitigates stale accumulation; max_clients recommended for future hardening |
| SEC-BE039-003 | LOW | CWE-770 | Framework limitation, not a code defect |

**Confidence:** HIGH — All STRIDE categories analyzed per trust boundary. Full OWASP Top 10 checklist completed. Secret scan clean. SBOM clean.
