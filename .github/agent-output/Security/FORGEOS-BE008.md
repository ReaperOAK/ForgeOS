# FORGEOS-BE008 — Security Review

**Agent:** Security Engineer  
**Machine:** pop-os  
**Operator:** reaperoak  
**Completed:** 2026-03-11T12:00:00+00:00  
**Verdict:** PASS  
**Confidence:** HIGH

---

## Scope

- **Implementation:** `mcp-server/src/mcp_server/locking/lease_heartbeat.py` (~640 lines)
- **Tests:** `mcp-server/tests/test_lease_heartbeat.py` (~700 lines)
- **Upstream:** QA PASS — 38/38 tests, 99% coverage

---

## 1. STRIDE Threat Model

### Trust Boundaries

| # | Boundary | Direction |
|---|----------|-----------|
| TB1 | Agent code → `extend_lease()` function | Internal library call |
| TB2 | `extend_lease()` → PostgreSQL (tickets table) | SQL over connection pool |
| TB3 | `find_stale_claims()` → PostgreSQL (tickets + lease_heartbeats) | SQL over connection pool |

### STRIDE Analysis per Boundary

#### TB1: Agent → extend_lease()

| Threat | Score | Finding |
|--------|-------|---------|
| **Spoofing** | Impact 2 × Likelihood 1 = **2** (Low) | `agent_id` is a UUID string passed by caller. SQL enforces `claimed_by = $2::uuid` — only the rightful claim owner can extend. DB rejects malformed UUIDs via `::uuid` cast. |
| **Tampering** | Impact 3 × Likelihood 1 = **3** (Low) | `HeartbeatConfig` is a frozen dataclass (`frozen=True, slots=True`). Config values are validated in `__post_init__`. No mutation after construction. |
| **Repudiation** | Impact 2 × Likelihood 1 = **2** (Low) | Every heartbeat writes to `lease_heartbeats` audit table. Structured logging with `ticket_id` + `agent_id` on all operations. |
| **Info Disclosure** | Impact 2 × Likelihood 2 = **4** (Low) | Error messages include `ticket_id` and `agent_id` (non-sensitive identifiers). No credentials, PII, or connection strings in logs. `DatabaseError` wraps `str(exc)` — see INFO-001 below. |
| **DoS** | Impact 2 × Likelihood 2 = **4** (Low) | `HeartbeatConfig` validates `interval_seconds > 0`. Background loop rate-limited by `asyncio.sleep(interval_seconds)`. Direct `extend_lease()` calls have no rate limiting, but this is an internal library function — not a public API endpoint. See ADVISORY-001 below. |
| **Elevation** | Impact 3 × Likelihood 1 = **3** (Low) | Agent can only extend its own lease — SQL `WHERE claimed_by = $2::uuid` enforces this. `max_lease_seconds` caps total duration. No admin/escalation paths. |

#### TB2: extend_lease() → PostgreSQL

| Threat | Score | Finding |
|--------|-------|---------|
| **Spoofing** | 2 (Low) | Pool-managed connections; no credential injection path. |
| **Tampering** | 2 (Low) | `SELECT ... FOR UPDATE` provides row-level locking. UPDATE/INSERT use parameterized queries only. |
| **Repudiation** | 2 (Low) | `INSERT INTO lease_heartbeats` creates audit trail. |
| **Info Disclosure** | 3 (Low) | Query results accessed by field name (`row["lease_expiry"]`). No `SELECT *`. |
| **DoS** | 3 (Low) | Transactions are scoped via `async with pool.acquire()`. No long-held connections. |
| **Elevation** | 2 (Low) | Connection uses pool credentials — no privilege escalation possible at query level. |

#### TB3: find_stale_claims() → PostgreSQL

| Threat | Score | Finding |
|--------|-------|---------|
| **Tampering** | 1 (Low) | Read-only query, no mutations. |
| **DoS** | Impact 2 × Likelihood 2 = **4** (Low) | Correlated subquery + no `LIMIT` clause. See ADVISORY-002 below. |

**Maximum STRIDE Score:** 4 (Low) — no findings reach Medium (≥ 10) threshold.

---

## 2. OWASP Top 10 Checklist

| Category | Status | Evidence |
|----------|--------|----------|
| **A01: Broken Access Control** | PASS | `claimed_by = $2::uuid` in all mutation queries. Only claim owner can extend. `SELECT ... FOR UPDATE` prevents concurrent modification. Deny-by-default: `fetchrow` returns `None` → `LeaseNotActiveError`. |
| **A02: Cryptographic Failures** | N/A | No cryptographic operations in this module. |
| **A03: Injection** | PASS | All 4 SQL queries use parameterized placeholders (`$1`, `$2::uuid`, `$3`, `$4`, `$5`). Zero string concatenation or formatting in SQL. UUID type enforced via `::uuid` cast. |
| **A04: Insecure Design** | PASS | Defense in depth: DB row locking + `claimed_by` check + `max_lease_seconds` cap + `lease_expiry > $3` freshness check. Graceful degradation: transient DB errors don't crash heartbeat loop. Config validation prevents nonsensical values. |
| **A05: Security Misconfiguration** | PASS | No debug flags, no hardcoded credentials. Sensible defaults (60s interval, 120s extension, 2h max). `interval < extension` validated to prevent lease gaps. |
| **A06: Vulnerable Components** | PASS | Module imports only stdlib (`asyncio`, `dataclasses`, `datetime`) + internal `mcp_server` modules. No third-party dependencies directly consumed. Parent project dependencies (asyncpg, pydantic, etc.) are version-pinned in pyproject.toml. |
| **A07: Auth/Identification Failures** | PASS | Agent identified by UUID. No session management in scope. No authentication bypass paths — SQL enforces identity match. |
| **A08: Data Integrity** | PASS | Frozen dataclasses (`HeartbeatConfig`, `HeartbeatRecord`, `StaleClaim`) prevent post-construction mutation. Audit trail via `lease_heartbeats` table is append-only by design. |
| **A09: Logging/Monitoring** | PASS | Structured logging via `get_logger("locking.lease_heartbeat")`. All operations logged at appropriate levels (debug for heartbeats, info for lifecycle, warning for rejections, error for DB failures). No PII or credentials in any log statement. |
| **A10: SSRF** | N/A | No outbound HTTP calls. |

**Result: 10/10 categories checked. 0 findings.**

---

## 3. LLM Top 10 Checklist

N/A — No AI/LLM features in this module.

---

## 4. SQL Injection Deep Dive

All SQL statements reviewed:

| Query | Location | Parameterized | Safe |
|-------|----------|---------------|------|
| `SELECT lease_expiry, claimed_by, claimed_at FROM tickets WHERE ticket_id = $1 AND claimed_by = $2::uuid AND lease_expiry > $3 FOR UPDATE` | `extend_lease()` L252-257 | Yes ($1, $2::uuid, $3) | YES |
| `UPDATE tickets SET lease_expiry = $1 WHERE ticket_id = $2 AND claimed_by = $3::uuid` | `extend_lease()` L296-299 | Yes ($1, $2, $3::uuid) | YES |
| `INSERT INTO lease_heartbeats (ticket_id, agent_id, previous_expiry, new_expiry, heartbeat_at) VALUES ($1, $2::uuid, $3, $4, $5)` | `extend_lease()` L302-307 | Yes ($1-$5) | YES |
| `SELECT t.ticket_id, ... FROM tickets t WHERE t.status = 'CLAIMED' AND t.lease_expiry < $1 AND (NOT EXISTS (...)) ORDER BY t.lease_expiry ASC` | `find_stale_claims()` L380-395 | Yes ($1, $2) | YES |

**Verdict: Zero SQL injection vectors.**

---

## 5. Race Condition Analysis

| Scenario | Mitigation | Status |
|----------|------------|--------|
| Two agents extend same lease concurrently | `SELECT ... FOR UPDATE` serializes access at row level | SAFE |
| Heartbeat fires during `stop()` | `_stopped` flag checked before and after `asyncio.sleep()` | SAFE |
| Double `start()` call | `RuntimeError` raised if task already running | SAFE |
| `stop()` during active DB query | `_task.cancel()` + `await self._task` ensures clean shutdown; `CancelledError` caught | SAFE |
| Lease released between heartbeat SELECT and UPDATE | `WHERE claimed_by = $3::uuid` re-checked in UPDATE; stale update would affect 0 rows (acceptable — next heartbeat detects via `fetchrow` returning `None`) | SAFE |

---

## 6. DoS Analysis

| Vector | Risk | Mitigation |
|--------|------|------------|
| Heartbeat flood via direct `extend_lease()` calls | LOW | Internal library function, not a public API. Only called by `_heartbeat_loop` which is rate-limited by `asyncio.sleep(interval_seconds)`. |
| Large `find_stale_claims()` result set | LOW | No `LIMIT` clause, but query is internal and called by system processes, not user-facing. See ADVISORY-002. |
| Thundering herd (many agents heartbeating simultaneously) | LOW | No jitter implemented. Noted by QA. Agents are few in number (14 max). Not a realistic threat at current scale. |

---

## 7. Error Handling / Information Disclosure

| Location | Pattern | Finding |
|----------|---------|---------|
| `extend_lease()` error catch | `DatabaseError(f"Failed to extend lease: {exc}", ...)` | INFO-001: `str(exc)` could include DB error details. Internal error only — not exposed to end users. |
| `find_stale_claims()` error catch | `DatabaseError(f"Failed to find stale claims: {exc}")` | Same as above. |
| Log entries | `extra={"ticket_id": ..., "agent_id": ..., "error": str(exc)}` | No PII. `ticket_id` and `agent_id` are non-sensitive identifiers. `str(exc)` in error-level logs is acceptable for debugging. |

---

## 8. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | None found |
| Hardcoded tokens/passwords | None found |
| Private keys | None found |
| Connection strings | None found |
| `.env` references | None |

---

## 9. Input Validation

| Parameter | Validation | Status |
|-----------|-----------|--------|
| `interval_seconds` | `> 0` (ValueError on ≤ 0) | PASS |
| `extension_seconds` | `> 0` (ValueError on ≤ 0) | PASS |
| `max_lease_seconds` | `> 0` (ValueError on ≤ 0) | PASS |
| `interval_seconds < extension_seconds` | Validated in `__post_init__` | PASS |
| `agent_id` (UUID format) | Enforced by SQL `::uuid` cast — DB rejects malformed | PASS |
| `ticket_id` | String; no format validation needed (DB lookup fails gracefully) | PASS |

---

## 10. Dependency / SBOM Summary

This module has **zero direct third-party imports**. It uses only:
- Python stdlib: `asyncio`, `dataclasses`, `datetime`, `typing`
- Internal: `mcp_server.observability.get_logger`, `mcp_server.server.{DatabaseError, ForgeOSError, INVALID_PARAMS}`

Parent project dependencies (from `pyproject.toml`):
- `asyncpg>=0.30.0` — database driver (used indirectly via pool)
- `pydantic>=2.0,<3` — not used by this module
- Other deps not in scope for this module

**No CVEs applicable to this module's direct dependencies (stdlib only).**

---

## 11. Advisory Findings (Informational — No Action Required)

### ADVISORY-001: No Rate Limiting on Direct `extend_lease()` Calls
- **Severity:** LOW (Informational)
- **CWE:** CWE-770 (Allocation of Resources Without Limits)
- **Impact:** 2 × **Likelihood:** 1 = **Score: 2**
- **Description:** `extend_lease()` has no rate limiting. However, it is an internal library function called only by `_heartbeat_loop` (rate-limited by `asyncio.sleep`). Not exposed as a public API.
- **Risk Acceptance:** Acceptable at current architecture. If exposed as an API endpoint in the future, add rate limiting middleware.

### ADVISORY-002: No LIMIT Clause in `find_stale_claims()`
- **Severity:** LOW (Informational)
- **CWE:** CWE-400 (Uncontrolled Resource Consumption)
- **Impact:** 2 × **Likelihood:** 1 = **Score: 2**
- **Description:** Query returns all stale claims without pagination. At scale (thousands of stale tickets), this could return a large result set.
- **Risk Acceptance:** Acceptable. System has 14 agents maximum; stale claims are expected to be few. If scale increases, add `LIMIT` + pagination.

### INFO-001: Exception Message in DatabaseError
- **Severity:** LOW (Informational)
- **CWE:** CWE-209 (Information Exposure Through Error Message)
- **Impact:** 2 × **Likelihood:** 1 = **Score: 2**
- **Description:** `DatabaseError(f"Failed to extend lease: {exc}")` includes `str(exc)` which could contain DB-specific error details. This is an internal error type — not serialized to external clients.
- **Risk Acceptance:** Acceptable for internal error handling. If error messages are ever exposed via API, sanitize by removing the original exception text.

---

## 12. SARIF Findings Summary

```json
{
  "version": "2.1.0",
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-SecurityReview",
          "version": "1.0.0",
          "rules": []
        }
      },
      "results": [],
      "invocations": [
        {
          "executionSuccessful": true,
          "toolExecutionNotifications": [
            {
              "message": { "text": "ADVISORY-001: No rate limiting on extend_lease() — LOW, CWE-770, internal function" },
              "level": "note"
            },
            {
              "message": { "text": "ADVISORY-002: No LIMIT clause in find_stale_claims() — LOW, CWE-400, internal function" },
              "level": "note"
            },
            {
              "message": { "text": "INFO-001: str(exc) in DatabaseError message — LOW, CWE-209, internal error type" },
              "level": "note"
            }
          ]
        }
      ]
    }
  ]
}
```

**SARIF Result: 0 critical, 0 high, 0 medium findings. 3 informational advisories (risk accepted).**

---

## Verdict

**PASS** — Zero critical or high findings. Three low/informational advisories documented with risk acceptance rationale. The implementation demonstrates strong security practices:

- Parameterized SQL throughout (zero injection vectors)
- Row-level locking (`SELECT FOR UPDATE`) prevents race conditions
- Frozen immutable data objects prevent tampering
- Agent identity enforced at DB level (`claimed_by` match)
- Max lease duration cap prevents indefinite lock holding
- Structured logging with no PII/credential leakage
- Clean async lifecycle (no resource leaks)
- Config validation prevents misconfiguration

**Confidence: HIGH**
