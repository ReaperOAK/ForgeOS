# FORGEOS-BE052 — Security Review: Machine Registration and Verification

## Verdict: **PASS**

**Confidence:** HIGH
**Reviewed By:** Security Engineer
**Timestamp:** 2026-03-11T12:30:00Z

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `mcp-server/src/mcp_server/auth/machine_auth.py` | 460 | Core machine registration, verification, lookup, deactivation |
| `mcp-server/src/mcp_server/services/machine_service.py` | 122 | Service wrapper orchestrating machine auth operations |

## STRIDE Threat Model

### Trust Boundary: External Agent → MCP Server → PostgreSQL

| Threat | Category | Analysis | Score (I×L) | Severity | Mitigated? |
|--------|----------|----------|-------------|----------|------------|
| T1: Machine identity spoofing | **Spoofing** | Attacker supplies a forged `machine_id` to impersonate a registered machine. STRICT mode requires pre-registration but AUTO mode allows any ID. `machine_id` is a free-form string (hostname/UUID) with no cryptographic binding. | 3×3=9 | **Low** | Partially — STRICT mode mitigates; AUTO mode is intentionally permissive by design. No cryptographic attestation, but acceptable for an internal orchestration system. |
| T2: Registration replay/flooding | **Tampering** | Attacker repeatedly registers machines to pollute the registry. UPSERT prevents duplicate rows but doesn't rate-limit registrations. | 2×2=4 | **Low** | Acceptable — internal system behind auth layer; UPSERT is idempotent. |
| T3: Non-repudiation gap | **Repudiation** | `last_seen_at` and `first_seen_at` timestamps are database-generated (`NOW()`), providing server-side audit trail. No client-side timestamps accepted. | 2×1=2 | **Low** | ✅ Mitigated — server-generated timestamps ensure integrity. |
| T4: Machine ID disclosure in errors | **Info Disclosure** | Error messages include `machine_id` in the exception text (e.g., `"Unknown machine 'foo' rejected"`). This is intentional for operability — the `machine_id` is not secret (it's a hostname). | 2×2=4 | **Low** | Acceptable — `machine_id` is an operational identifier, not a secret. |
| T5: DoS via validation bypass | **DoS** | `MAX_MACHINE_ID_LENGTH = 255` caps input size. Empty/whitespace inputs are rejected. Database queries are parameterized with single-row returns. No unbounded allocations. | 2×1=2 | **Low** | ✅ Mitigated — input validation + bounded queries. |
| T6: Privilege escalation via reactivation | **Elevation** | `register_machine()` UPSERT sets `is_active = TRUE` on conflict, effectively reactivating a soft-deleted machine. An attacker knowing a deactivated `machine_id` could re-register it. | 3×2=6 | **Low** | Noted — this is by-design behavior (re-registration reactivates). Document as design decision. In STRICT mode, only pre-registered machines are accepted, so this path requires explicit admin action. |

**No Critical or High STRIDE findings.**

---

## OWASP Top 10 Compliance

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| A01 | Broken Access Control | ✅ PASS | STRICT mode enforces deny-by-default (403 for unknown machines). Inactive machines always rejected regardless of mode. `MachineAuthError.status_code = 403`. |
| A02 | Cryptographic Failures | ✅ PASS | No secrets stored. No passwords or tokens in machine records. Machine IDs are operational identifiers, not credentials. Database timestamps are server-generated. |
| A03 | Injection | ✅ PASS | All SQL queries use parameterized placeholders (`$1`, `$2`) via asyncpg. No string concatenation in queries. Input validated and length-capped before any DB interaction. |
| A04 | Insecure Design | ✅ PASS | Defense in depth: validation layer → mode-based access control → database constraints. `ON CONFLICT` handles concurrent registrations safely. Frozen dataclass prevents mutation. `__slots__` prevents attribute injection. |
| A05 | Security Misconfiguration | ✅ PASS | No debug flags, no hardcoded configuration values. Registration mode is configurable via `MachineRegistrationMode` enum. Default is `AUTO` (appropriate for development); `STRICT` for production. |
| A06 | Vulnerable Components | ✅ PASS | Uses asyncpg (well-maintained PostgreSQL driver). No additional dependencies introduced. |
| A07 | Auth Failures | ✅ PASS | Not a credential-based auth module — this is machine identity verification. No passwords, no sessions, no lockout needed. Error on invalid input prevents enumeration abuse (same error shape for all failures). |
| A08 | Data Integrity | ✅ PASS | Frozen dataclass (`@dataclass(frozen=True, slots=True)`) ensures immutability of `MachineIdentity` after creation. UPSERT with `RETURNING` ensures atomicity. |
| A09 | Logging Failures | ✅ PASS | Structured logging via `get_logger("machine_auth")`. All operations logged: `machine_registered`, `machine_auto_registering`, `machine_rejected_strict`, `machine_rejected_inactive`, `machine_deactivated`. No PII in log entries — only `machine_id` and `hostname` (operational data). Errors logged with structured `extra` dict. |
| A10 | SSRF | ✅ N/A | No outbound HTTP calls. No URL parsing. No external resource fetching. |

---

## LLM Top 10

Not applicable — this module does not interact with LLM/AI features.

---

## Dependency Audit

No new dependencies introduced by this ticket. The module uses only:
- `asyncpg` (existing project dependency) — parameterized query driver
- `mcp_server.observability` — structured logging (existing)
- `mcp_server.server` — error base classes (existing)

**CVE Status:** No new vulnerabilities introduced.

---

## Secret Scanning

| Check | Status |
|-------|--------|
| Hardcoded API keys | ✅ None found |
| Hardcoded passwords | ✅ None found |
| Hardcoded tokens | ✅ None found |
| Private keys | ✅ None found |
| Credentials in logging | ✅ None — structured logger with operational fields only |

---

## Input Validation Review

| Input | Validation | Max Length | Sanitization |
|-------|-----------|------------|-------------|
| `machine_id` | `_validate_machine_id()`: strip, empty check, length check | 255 chars | Whitespace stripped |
| `hostname` | Stripped, falls back to `machine_id` if empty | No explicit cap (DB column constraint applies) | Whitespace stripped |

**Parameterized Queries (no SQL injection vectors):**
- `register_machine`: `INSERT ... VALUES ($1, $2, ...)` — 2 params
- `verify_machine`: `SELECT ... WHERE machine_id = $1` — 1 param
- `get_machine`: `SELECT ... WHERE machine_id = $1` — 1 param
- `deactivate_machine`: `UPDATE ... WHERE machine_id = $1 RETURNING ...` — 1 param
- `last_seen update`: `UPDATE ... WHERE machine_id = $1` — 1 param

All 5 queries use positional parameter binding. **Zero string interpolation in SQL.**

---

## Auth/AuthZ Review

| Check | Status |
|-------|--------|
| STRICT mode rejects unknowns | ✅ Returns `MachineAuthError` (403) |
| Inactive machines rejected | ✅ Both AUTO and STRICT modes check `is_active` |
| 403 status code mapping | ✅ `MachineAuthError.status_code = 403` |
| Mode configurable | ✅ `MachineRegistrationMode.from_string()` with validation |
| Invalid mode input | ✅ Raises `ValueError` with valid options listed |

---

## Soft Delete Analysis

| Scenario | Behavior | Secure? |
|----------|----------|---------|
| `deactivate_machine()` | Sets `is_active = FALSE` | ✅ |
| Verify deactivated machine (AUTO) | Raises `MachineAuthError` | ✅ |
| Verify deactivated machine (STRICT) | Raises `MachineAuthError` | ✅ |
| Re-register deactivated machine | UPSERT reactivates (`is_active = TRUE`) | ⚠️ By design |

**Note:** Re-registration reactivating a soft-deleted machine is documented as intended behavior. In STRICT mode, this requires the machine to already be known, making unauthorized reactivation infeasible. In AUTO mode, any machine can self-register by design.

---

## API Security

| Check | Status |
|-------|--------|
| Rate limiting | N/A — module-level functions; rate limiting is an upstream middleware concern |
| CORS | N/A — not an HTTP endpoint module |
| Input size limits | ✅ `MAX_MACHINE_ID_LENGTH = 255` |

---

## Data Classification

| Field | Classification | Encrypted at Rest | Encrypted in Transit |
|-------|---------------|-------------------|---------------------|
| `machine_id` | Operational | PostgreSQL TDE (if configured) | TLS (if configured) |
| `hostname` | Operational | PostgreSQL TDE (if configured) | TLS (if configured) |
| `first_seen_at` | Operational | PostgreSQL TDE (if configured) | TLS (if configured) |
| `last_seen_at` | Operational | PostgreSQL TDE (if configured) | TLS (if configured) |
| `is_active` | Operational | PostgreSQL TDE (if configured) | TLS (if configured) |

No PII stored. All fields are operational metadata.

---

## SARIF Findings Summary

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0"
        }
      },
      "results": [
        {
          "ruleId": "SEC-INFO-001",
          "level": "note",
          "message": {
            "text": "UPSERT reactivates soft-deleted machines. By-design behavior but worth documenting in operational runbook."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/auth/machine_auth.py"
                },
                "region": { "startLine": 237 }
              }
            }
          ],
          "taxa": [{ "id": "CWE-284", "toolComponent": { "name": "CWE" } }]
        },
        {
          "ruleId": "SEC-INFO-002",
          "level": "note",
          "message": {
            "text": "Schema mismatch between alembic migration 002 (UUID PK, registered_at, last_seen, no is_active) and code (text machine_id, first_seen_at, last_seen_at, is_active). Likely needs a follow-up migration. Not a security vulnerability but could cause runtime errors."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/auth/machine_auth.py"
                },
                "region": { "startLine": 230 }
              }
            }
          ],
          "taxa": [{ "id": "CWE-1057", "toolComponent": { "name": "CWE" } }]
        }
      ]
    }
  ]
}
```

**Critical findings: 0**
**High findings: 0**
**Medium findings: 0**
**Low/Informational findings: 2** (both documented above as notes)

---

## Verdict Rationale

The implementation demonstrates strong security practices:

1. **All SQL is parameterized** — zero injection vectors across 5 queries.
2. **Input validation** gates all public functions via `_validate_machine_id()`.
3. **STRICT mode** provides proper deny-by-default with 403 responses.
4. **Inactive machines are always rejected** — no soft-delete bypass possible via verify.
5. **Immutable data model** — frozen dataclass with `__slots__` prevents mutation and attribute injection.
6. **Structured logging** — no PII, no credentials in log output.
7. **Error handling** — all database errors wrapped in domain errors, no stack trace leakage to callers.
8. **Concurrency safety** — UPSERT with `ON CONFLICT` handles race conditions.
9. **Fire-and-forget `last_seen` update** — failure is non-blocking and non-critical, properly swallowed with debug logging.

**PASS** — Zero critical or high security findings. Two informational notes documented.

---

## Evidence

- **STRIDE Threat Model:** 6 threats analyzed, all Low severity (max score 9/25)
- **OWASP Top 10:** 10/10 categories checked, all PASS
- **LLM Top 10:** N/A (no AI features in scope)
- **SARIF Findings:** 0 critical, 0 high, 0 medium, 2 informational
- **Secret Scan:** Clean
- **Dependency Audit:** No new dependencies, no CVEs introduced
- **Confidence:** HIGH
