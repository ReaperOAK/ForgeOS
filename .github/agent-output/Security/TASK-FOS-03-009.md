# Security Review — TASK-FOS-03-009

## Ticket
- **ID:** TASK-FOS-03-009
- **Title:** tickets.extend — Extend Lease Duration
- **Type:** backend
- **Stage:** SECURITY → CI (PASS)
- **Reviewer:** Security Engineer
- **Date:** 2026-03-10

## Verdict

**Verdict:** PASS
**Confidence:** HIGH

**Justification:** Zero critical or high severity findings. The implementation follows secure coding patterns: parameterized SQL queries via `pool.query($1, $2, ...)`, Zod schema validation with strict integer bounds on `duration_minutes` (5–120), server-side enforcement of `max_lease_minutes` via PostgreSQL stored function with `SELECT FOR UPDATE` row-level locking, structured pino logging (no PII), proper error handling with categorized error codes. All 10 OWASP Top 10 categories checked. STRIDE analysis on 2 trust boundaries yields 6 threats, all scored Low (≤8). 2 informational findings documented.

## Files Reviewed (Read-Only)

| File | Lines | Role |
|------|-------|------|
| `forgeos-server/src/tools/tickets-extend.ts` | 178 | MCP tool handler |
| `forgeos-server/src/tools/index.ts` | 83 | Tool registration barrel |
| `forgeos-server/src/__tests__/tools/tickets-extend.test.ts` | 514 | Unit tests |
| `forgeos-server/src/db/migrations/001_initial.sql` (L858-904) | 46 | `extend_lease` SQL function |
| `forgeos-server/src/db/pool.ts` | 383 | Connection pool, RLS helpers |
| `forgeos-server/src/middleware/auth.ts` | 238 | Auth middleware |
| `forgeos-server/src/config.ts` | 111 | Config with Zod validation |
| `forgeos-server/src/types/index.ts` | 835 | Type definitions |

---

## 1. STRIDE Threat Model

### Trust Boundary 1: MCP Client → Express `/mcp` Endpoint → `ticketsExtendHandler`

| Threat | Category | Impact | Likelihood | Score | Mitigation | Status |
|--------|----------|--------|------------|-------|------------|--------|
| Spoofed agent identity (agent impersonates another to extend their lease) | Spoofing | 3 | 2 | 6 (Low) | `authMiddleware` validates Bearer token via SHA-256 hash lookup in `agents` table. Handler verifies `agent_name` → UUID resolution via DB lookup. SQL function enforces `claimed_by = p_agent_id` with `FOR UPDATE`. | Mitigated |
| Tampered `duration_minutes` exceeding bounds | Tampering | 2 | 1 | 2 (Low) | Zod schema enforces `z.number().int().min(5).max(120)`. SQL function re-validates against `max_lease_minutes` from `system_config`. Double validation (app + DB). | Mitigated |
| Lease extension without audit trail | Repudiation | 2 | 1 | 2 (Low) | SQL function inserts `LEASE_EXTENDED` event with `new_expiry` and `extension_minutes` in payload. Structured pino logging at handler entry. | Mitigated |
| Error messages leak internal DB state | Information Disclosure | 2 | 2 | 4 (Low) | Error handler catches all exceptions, maps to categorized error codes (`NOT_CLAIM_OWNER`, `LEASE_TOO_LONG`, `INTERNAL_ERROR`). `INTERNAL_ERROR` includes `err.message` — see INFO-001. | Mitigated (informational) |

### Trust Boundary 2: Express Handler → PostgreSQL `extend_lease()` Function

| Threat | Category | Impact | Likelihood | Score | Mitigation | Status |
|--------|----------|--------|------------|-------|------------|--------|
| SQL injection via `ticket_id` or `agent_name` | Tampering | 5 | 1 | 5 (Low) | All queries use parameterized `$1, $2, ...` placeholders. No string interpolation or concatenation in SQL. Pool.query enforces parameterized execution. | Mitigated |
| Infinite/repeated lease extensions (DoS) | Denial of Service | 3 | 2 | 6 (Low) | `max_lease_minutes` system config enforced by SQL function. Zod schema caps at 120 min. Auth middleware + rate limiting (`RATE_LIMIT_PER_MINUTE` in config). Each extension sets absolute expiry (not additive — `NOW() + duration`), preventing accumulation. | Mitigated |

**STRIDE Summary:** 6 threats identified, all scored Low (≤8). No Critical (≥20) or High (≥15) findings.

---

## 2. OWASP Top 10 Checklist

| Category | ID | Result | Evidence |
|----------|----|--------|----------|
| Broken Access Control | A01 | PASS | `authMiddleware` enforces Bearer token on `/mcp` (non-public path). SQL function uses `claimed_by = p_agent_id` with `FOR UPDATE` — only the claim owner can extend. Agent UUID resolved from DB, not from client input. |
| Cryptographic Failures | A02 | PASS | API keys stored as SHA-256 hashes in `agents.api_key_hash`. No plaintext secret storage in handler code. `node:crypto` used for key generation (32 bytes randomness). No custom crypto. |
| Injection | A03 | PASS | All 3 SQL queries (`SELECT id FROM agents WHERE name = $1`, `SELECT * FROM extend_lease($1, $2, $3, $4)`) use parameterized placeholders. No string concatenation. Zod schema rejects non-string/non-integer inputs. |
| Insecure Design | A04 | PASS | Defense-in-depth: Zod validation (app layer) + SQL function validation (DB layer) for duration bounds. `SELECT FOR UPDATE` prevents TOCTOU on claim ownership. Deny-by-default: unknown agents return `NOT_CLAIM_OWNER`. |
| Security Misconfiguration | A05 | PASS | Config validated via Zod schema with `superRefine` for production (requires non-default `ADMIN_API_KEY` and `WEBHOOK_SECRET`). `DEFAULT_LEASE_MINUTES` and `MAX_LEASE_MINUTES` have bounded defaults (30, 120). |
| Vulnerable Components | A06 | PASS | `npm audit --audit-level=high`: 0 vulnerabilities. 15 dependencies (5 runtime, 10 dev). No known CVEs in `pg@8.20.0`, `express@4.22.1`, `zod@3.25.76`, `pino@9.14.0`. |
| Auth Failures | A07 | PASS | Bearer token auth via SHA-256 hash lookup. Lease has 30-minute default expiry with max 120 min. No credentials in handler code. Agent `last_seen` updated on each request for staleness detection. |
| Data Integrity | A08 | PASS | SQL function uses `RETURNING *` to return authoritative DB state. Event insertion provides tamper-evident audit. No deserialization of untrusted data (Zod parses, doesn't deserialize). |
| Logging Failures | A09 | PASS | Structured pino JSON logging with `ticket_id`, `agent_name`, `duration_minutes` at entry. Errors logged with `logger.error()` including stack trace. No PII in log fields. No `console.log`. |
| SSRF | A10 | N/A | Handler makes no outbound HTTP requests. Database-only communication via connection pool. |

**OWASP Summary:** 10/10 categories checked. 0 critical/high findings.

---

## 3. Focus Area Analysis

### 3.1 Unauthorized Lease Extension
- **Attack:** Agent A tries to extend Agent B's lease.
- **Defense:** Handler resolves `agent_name` → UUID from `agents` table (L95-106). SQL function `extend_lease` uses `WHERE claimed_by = p_agent_id FOR UPDATE` (migration L878-881). Mismatch → `NOT_CLAIM_OWNER` exception.
- **Assessment:** SECURE. Ownership verified at DB level with row lock.

### 3.2 Infinite Lease Attacks
- **Attack:** Repeatedly calling `tickets.extend` with max duration to keep a ticket locked forever.
- **Defense:** 
  1. Zod caps `duration_minutes` at 120 (L38).
  2. SQL function checks `p_minutes > v_max_minutes` from `system_config` (migration L884-886).
  3. Lease expiry is absolute: `NOW() + duration` (migration L889), not additive to existing expiry.
  4. Rate limiting via `RATE_LIMIT_PER_MINUTE` config (default 100).
  5. `release_expired_claims` system function and `tickets.py --sync` periodically reclaim expired leases.
- **Assessment:** LOW RISK. While repeated calls can keep extending, maximum window is 120 minutes per call, rate-limited, and system sync releases expired claims. Operational control is adequate for an internal agent orchestration system.

### 3.3 SQL Injection
- **Attack:** Malicious `ticket_id` or `agent_name` containing SQL payloads.
- **Defense:** All queries use `pool.query(sql, [params])` with parameterized placeholders. Zero string interpolation or template literals in SQL strings.
  - L95: `SELECT id FROM agents WHERE name = $1 LIMIT 1`
  - L107: `SELECT * FROM extend_lease($1, $2, $3, $4)`
- **Assessment:** SECURE. Standard parameterized query pattern.

### 3.4 Timing Attacks
- **Attack:** Using response timing differences to enumerate valid ticket IDs or agent names.
- **Defense:**
  1. Agent lookup failure (L98-106) and SQL function failure (L114-122) both return `NOT_CLAIM_OWNER` — same error code for both paths.
  2. However, the two paths have different execution times (1 query vs 2 queries).
  3. This is an internal MCP tool behind Bearer auth — not exposed to unauthenticated users.
- **Assessment:** INFORMATIONAL (INFO-002). Timing difference between 1-query and 2-query paths is theoretically observable but requires prior authentication. Risk is negligible for an internal agent orchestration system.

---

## 4. SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "ForgeOS-Security-Agent",
        "version": "1.0.0",
        "rules": [
          {
            "id": "INFO-001",
            "shortDescription": {"text": "Internal error message may include database details"},
            "defaultConfiguration": {"level": "note"}
          },
          {
            "id": "INFO-002",
            "shortDescription": {"text": "Timing side-channel between agent-lookup and SQL-function paths"},
            "defaultConfiguration": {"level": "note"}
          }
        ]
      }
    },
    "results": [
      {
        "ruleId": "INFO-001",
        "level": "note",
        "message": {"text": "INTERNAL_ERROR response includes err.message which may contain PostgreSQL error details (connection strings, table names). In production, consider sanitizing to a generic message."},
        "locations": [{
          "physicalLocation": {
            "artifactLocation": {"uri": "forgeos-server/src/tools/tickets-extend.ts"},
            "region": {"startLine": 137, "endLine": 137}
          }
        }],
        "properties": {
          "cwe": "CWE-209",
          "severity": "informational",
          "impact": 2,
          "likelihood": 1,
          "score": 2,
          "recommendation": "Replace err.message with generic 'Internal server error' in production responses. Keep detailed message in structured logs only."
        }
      },
      {
        "ruleId": "INFO-002",
        "level": "note",
        "message": {"text": "Agent-not-found path executes 1 DB query; claim-owner-check path executes 2 DB queries. Timing difference is theoretically observable but requires valid Bearer token and is negligible in an internal MCP system."},
        "locations": [{
          "physicalLocation": {
            "artifactLocation": {"uri": "forgeos-server/src/tools/tickets-extend.ts"},
            "region": {"startLine": 95, "endLine": 122}
          }
        }],
        "properties": {
          "cwe": "CWE-208",
          "severity": "informational",
          "impact": 1,
          "likelihood": 1,
          "score": 1,
          "recommendation": "Acceptable risk for internal system. No action required."
        }
      }
    ]
  }]
}
```

---

## 5. SBOM Summary

| Metric | Value |
|--------|-------|
| Package Manager | npm |
| Total Dependencies | 15 (5 runtime, 10 dev) |
| npm audit | 0 vulnerabilities |
| Critical CVEs | 0 |
| High CVEs | 0 |
| Runtime deps | `@modelcontextprotocol/sdk@1.27.1`, `dotenv@16.6.1`, `express@4.22.1`, `pg@8.20.0`, `pino@9.14.0`, `zod@3.25.76` |

---

## 6. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys in handler | None found |
| Hardcoded passwords | None found |
| Hardcoded tokens | None found |
| Private keys | None found |
| `.env` in VCS | Not tracked (gitignored) |

---

## 7. Auth/AuthZ Review

| Check | Result |
|-------|--------|
| Auth middleware on `/mcp` | PASS — `authMiddleware` applied globally; `/health` only public path |
| Bearer token validation | PASS — SHA-256 hash lookup in `agents` table |
| Claim ownership verification | PASS — SQL `FOR UPDATE` with `claimed_by = p_agent_id` |
| Least privilege | PASS — Only claim owner can extend; agent UUID resolved server-side |
| Session management | PASS — Stateless MCP over HTTP; lease expiry is the session bound |

---

## 8. Input Validation

| Check | Result |
|-------|--------|
| Zod schema validation | PASS — `ticket_id: string`, `agent_name: string`, `duration_minutes: int().min(5).max(120).default(30)` |
| Parameterized queries | PASS — All 2 queries use `$1, $2, ...` placeholders |
| Unknown property stripping | PASS — Zod strips unknown fields by default |
| Integer overflow | PASS — Zod `.int()` rejects non-integer, `.max(120)` caps value |

---

## 9. Data Classification

| Data Element | Classification | Protection |
|-------------|---------------|------------|
| `ticket_id` | Internal | Input validation via Zod |
| `agent_name` | Internal | DB lookup, not stored in logs with PII |
| `duration_minutes` | Internal | Bounded 5–120, integer only |
| `lease_expiry` | Internal | Computed server-side (`NOW() + duration`) |
| Agent UUID | Internal | Resolved server-side, not exposed to caller |

No PII processed or stored by this tool.

---

## 10. API Security

| Check | Result |
|-------|--------|
| Rate limiting | PASS — `RATE_LIMIT_PER_MINUTE` config (default 100) |
| CORS | N/A — MCP endpoint, not browser-facing API |
| Auth headers | PASS — Bearer token required on `/mcp` |
| Input size limits | PASS — `express.json()` default 100kb limit; schema rejects extraneous fields |

---

## LLM Top 10

Not applicable — `tickets.extend` does not involve AI/LLM features.

---

## Upstream QA Summary Verification

QA PASS confirmed (HIGH confidence). 24/24 tests pass. 100% statement/function/line coverage, 92.85% branch coverage. DEF-001 (tool registration) resolved in rework #1.
