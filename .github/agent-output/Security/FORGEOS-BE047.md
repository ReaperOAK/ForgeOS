# FORGEOS-BE047 — Security Review

## Ticket
- **ID:** FORGEOS-BE047
- **Title:** Implement Background Lease Heartbeat in SDK
- **Stage:** SECURITY
- **Files reviewed:** `agent-sdk/src/forgeos_sdk/heartbeat.py`, `agent-sdk/src/forgeos_sdk/operations.py`
- **Verdict:** PASS
- **Confidence:** HIGH

---

## STRIDE Threat Model

### Component: LeaseHeartbeat (heartbeat.py)

**Trust Boundaries Crossed:**
1. SDK process → MCP Server (network boundary via `session.call_tool`)

| Threat | Category | Boundary | Impact | Likelihood | Score | Analysis |
|--------|----------|----------|--------|------------|-------|----------|
| Spoofed heartbeat from rogue client | Spoofing | SDK→Server | 3 | 2 | 6 (Low) | Heartbeat uses existing MCP session — server-side validates session + ticket ownership. No additional auth bypass. |
| Heartbeat payload tampered in transit | Tampering | SDK→Server | 3 | 1 | 3 (Low) | MCP transport layer (Streamable HTTP) handles integrity; heartbeat sends only `ticket_id` string. No user-controlled data injection risk. |
| Heartbeat failure not auditable | Repudiation | Internal | 2 | 2 | 4 (Low) | Failures logged via `logger.warning` with `exc_info=True`. Structured logging provides audit trail. |
| Ticket ID disclosed in logs | Info Disclosure | Internal | 2 | 2 | 4 (Low) | Ticket IDs are not sensitive data (operational identifiers). No PII, secrets, or credentials logged. |
| Heartbeat flood exhausts server | DoS | SDK→Server | 3 | 2 | 6 (Low) | Interval minimum not enforced client-side but server-side rate limiting + single-session scope mitigate. Default 300s is safe. |
| Heartbeat extends lease beyond authorized scope | Elevation | SDK→Server | 4 | 2 | 8 (Low) | Server-side `tickets.heartbeat` validates claim ownership. SDK cannot extend leases for tickets it doesn't own. |

### Component: TicketOperations heartbeat integration (operations.py)

| Threat | Category | Boundary | Impact | Likelihood | Score | Analysis |
|--------|----------|----------|--------|------------|-------|----------|
| Orphaned heartbeat task on crash | DoS | Internal | 2 | 3 | 6 (Low) | `_stop_heartbeat` called in advance/release/rework. `stop_all_heartbeats()` for cleanup. asyncio task GC handles process exit. |
| Race: heartbeat continues after ticket released | Tampering | SDK→Server | 2 | 2 | 4 (Low) | `_stop_heartbeat` awaited before returning from advance/release/rework. Sequential order prevents race. |

**Maximum STRIDE Score:** 8 (Low) — No critical or high threats identified.

---

## OWASP Top 10 Assessment

| Category | Status | Analysis |
|----------|--------|----------|
| A01 Broken Access Control | ✅ PASS | Heartbeat delegates to MCP `session.call_tool` — server-side enforces claim ownership. No client-side authz bypass possible. SDK does not implement its own authorization; it relies on server. |
| A02 Cryptographic Failures | ✅ N/A | No cryptographic operations. No secrets stored or transmitted by heartbeat code. Interval configured via env var (`FORGEOS_HEARTBEAT_INTERVAL`) — not sensitive. |
| A03 Injection | ✅ PASS | `ticket_id` passed as dict argument to `session.call_tool` — MCP SDK handles serialization. No string concatenation, no SQL, no shell invocation. Input is typed (Python string). |
| A04 Insecure Design | ✅ PASS | Defense-in-depth: `asyncio.wait_for` pattern for clean cancellation, idempotent `start()`/`stop()`, context manager for lifecycle, `_stopped` event for graceful shutdown. Exception handling catches all errors without crashing. |
| A05 Security Misconfiguration | ✅ PASS | Default interval (300s) is safe. Configurable via constructor or env var. `heartbeat_interval=0` disables feature entirely. No debug/verbose mode leaks. |
| A06 Vulnerable Components | ⚠️ INFO | Dependencies: `mcp>=1.25,<2`, `pydantic>=2.0,<3`, `httpx>=0.27`. No known critical CVEs for these version ranges (checked March 2026). `pip-audit` not available in environment — manual review performed against known advisories. |
| A07 Auth Failures | ✅ PASS | Heartbeat reuses authenticated MCP session. No separate auth mechanism introduced. No credential handling in heartbeat code. |
| A08 Data Integrity | ✅ PASS | No deserialization of untrusted data in heartbeat. Response `isError` check validates server response before processing. Content block extraction uses `hasattr` guard. |
| A09 Logging Failures | ✅ PASS | Structured logging via `logging.getLogger("forgeos_sdk")`. Warning on failure with `exc_info=True`. Debug on success. No PII in log messages. No credential exposure. |
| A10 SSRF | ✅ N/A | Heartbeat calls fixed MCP tool name (`"tickets.heartbeat"`) with ticket ID. No URL construction, no user-controlled endpoints. |

**OWASP Result:** 10/10 categories reviewed — all PASS or N/A.

---

## LLM Top 10 Assessment

Not applicable — heartbeat.py and operations.py modifications do not involve AI/LLM features. The SDK interacts with MCP tools via typed Python calls, not LLM prompt/response flows.

---

## Dependency Audit (SBOM Summary)

| Package | Version Constraint | Known Critical/High CVEs | Status |
|---------|--------------------|--------------------------|--------|
| mcp | >=1.25,<2 | None known | ✅ |
| pydantic | >=2.0,<3 | None known | ✅ |
| pydantic-settings | >=2.0,<3 | None known | ✅ |
| httpx | >=0.27 | None known | ✅ |

- **Total direct dependencies:** 4
- **pip-audit:** Not available in environment. Manual review against NVD/PyPI advisories shows no critical/high CVEs for pinned ranges as of March 2026.
- **No new dependencies introduced** by FORGEOS-BE047.

---

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | ✅ None found |
| Embedded tokens | ✅ None found |
| Passwords in source | ✅ None found |
| Private keys | ✅ None found |
| .env files in VCS | ✅ N/A — no .env files in agent-sdk |
| Env var for config | ✅ `FORGEOS_HEARTBEAT_INTERVAL` — non-sensitive (numeric interval) |

---

## Auth/AuthZ Review

| Check | Result |
|-------|--------|
| Heartbeat uses authenticated session | ✅ Reuses `ForgeOSClient.session` (MCP `ClientSession`) |
| No bypass of server-side auth | ✅ `session.call_tool` routes through MCP protocol |
| Null session guard | ✅ `_send_heartbeat` checks `session is None` before calling |
| No privilege escalation | ✅ Cannot heartbeat tickets not owned — server validates |

---

## Input Validation

| Check | Result |
|-------|--------|
| `ticket_id` type | ✅ Python `str` enforced by type hints |
| `interval_seconds` validation | ⚠️ INFO — No lower-bound check (negative or zero interval accepted). However: `asyncio.wait_for` with timeout ≤ 0 fires immediately → rapid loop. Mitigated by `TicketOperations` which disables heartbeat when `interval ≤ 0`. Not exploitable externally — constructor is internal SDK API. |
| Env var parsing | ✅ `float()` conversion — invalid values raise `ValueError` at init time (fail-fast) |
| MCP tool arguments | ✅ Dict with `ticket_id` string — no injection vector |

---

## API Security

| Check | Result |
|-------|--------|
| Rate limiting | ✅ Server-side — SDK sends at configurable interval (default 300s) |
| CORS | ✅ N/A — SDK is client-side, not server |
| Auth headers | ✅ MCP session manages transport-level auth |

---

## Data Classification

| Data Element | Classification | Handling |
|--------------|---------------|----------|
| ticket_id | Operational (non-sensitive) | Logged at debug/warning level — acceptable |
| heartbeat result | Operational | Error text logged on failure — no PII |
| interval_seconds | Configuration | Non-sensitive numeric value |

---

## SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Engineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-BE047-001",
              "name": "UnboundedHeartbeatInterval",
              "shortDescription": {
                "text": "LeaseHeartbeat accepts negative or zero interval without lower-bound validation"
              },
              "defaultConfiguration": {
                "level": "note"
              },
              "properties": {
                "cwe": "CWE-20",
                "severity": "Low"
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE047-001",
          "level": "note",
          "message": {
            "text": "LeaseHeartbeat.__init__ accepts interval_seconds <= 0 without validation. A zero/negative interval causes asyncio.wait_for to fire immediately, creating a tight loop. Mitigated: TicketOperations._start_heartbeat skips when heartbeat_interval <= 0, and the constructor is internal SDK API. Risk: Low. Recommendation: Add `if interval <= 0: raise ValueError` guard for defense-in-depth."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "agent-sdk/src/forgeos_sdk/heartbeat.py"
                },
                "region": {
                  "startLine": 47,
                  "endLine": 53
                }
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

## Findings Summary

| ID | Severity | CWE | File | Description | Status |
|----|----------|-----|------|-------------|--------|
| SEC-BE047-001 | Low (Note) | CWE-20 | heartbeat.py:47-53 | No lower-bound validation on `interval_seconds` — zero/negative creates tight loop. Mitigated by `TicketOperations` guard. | Risk Accepted |

- **Critical findings:** 0
- **High findings:** 0
- **Medium findings:** 0
- **Low findings:** 1 (risk accepted — defense-in-depth recommendation for future)

---

## Verdict

**PASS** — Zero critical or high security findings. One low-severity informational finding documented with existing mitigation and risk acceptance. The implementation follows secure coding practices:

1. **No secrets** hardcoded or logged.
2. **No injection vectors** — typed MCP tool calls, no string construction.
3. **Proper error handling** — catches all exceptions, logs warnings, never crashes.
4. **Session null guard** prevents calls on disconnected clients.
5. **Clean lifecycle management** — context manager, idempotent start/stop, `stop_all_heartbeats`.
6. **Server-side authz delegation** — heartbeat cannot extend unauthorized leases.
7. **No new dependencies** introduced.

Ticket advances to CI stage.
