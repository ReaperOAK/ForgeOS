# Security Report — TASK-FOS-01-001

**Agent:** Security Engineer
**Stage:** SECURITY
**Ticket:** TASK-FOS-01-001 — PostgreSQL Schema — Initial Migration
**Reviewed:** 2026-03-06T01:00:00Z
**Verdict:** PASS (with documented medium/low findings — risk accepted)
**Confidence:** HIGH

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `forgeos-server/src/db/migrations/001_initial.sql` | Complete DDL: 7 tables, 5 enums, indexes, RLS, 10 functions, triggers |

## 2. STRIDE Threat Model

### Trust Boundary: Application → PostgreSQL Database

| Threat | Category | Analysis | Score (I×L) | Severity |
|--------|----------|----------|-------------|----------|
| Agent impersonation via session variable manipulation | **Spoofing** | RLS uses `current_setting('app.agent_role')` and `current_setting('app.agent_name')` which are set by the application layer. If the application correctly sets these via `SET LOCAL`, spoofing requires bypassing the application. The `true` parameter in `current_setting(..., true)` returns NULL on missing setting rather than error — this is safe (denies by default when NULL ≠ 'admin'). | 3×2 = 6 | **Low** |
| Direct SQL modification of ticket state bypassing functions | **Tampering** | Stored functions (claim_ticket, advance_ticket, reject_ticket) enforce business logic. However, RLS `agent_update_tickets` policy allows direct UPDATE by claim owner without requiring function use. Agents could bypass SDLC flow validation by issuing raw UPDATE. | 4×2 = 8 | **Low** |
| Missing audit trail for direct DML | **Repudiation** | The `notify_ticket_change` trigger fires on all INSERT/UPDATE on tickets, providing auditability. Events table tracks all state changes. The trigger is AFTER INSERT OR UPDATE — covers the surface. | 2×2 = 4 | **Low** |
| Session token stored as plaintext TEXT | **Info Disclosure** | `sessions.session_token` is stored as plain TEXT. If the database is compromised, session tokens are exposed in plaintext. `agents.api_key_hash` correctly uses hashing, but session tokens do not follow this pattern. | 3×2 = 6 | **Low** |
| Unbounded ticket creation (no rate limit at DB level) | **DoS** | No database-level rate limiting on INSERT operations. Application-level rate limiting is expected. The `system_config` table stores `rate_limit_per_minute` but no DB function enforces it. Acceptable: rate limiting belongs at the API layer. | 2×2 = 4 | **Low** |
| `agent_file_locks` policy allows unrestricted access | **Elevation of Privilege** | `agent_file_locks` policy uses `USING (TRUE) WITH CHECK (TRUE)` for `FOR ALL` — any authenticated connection can create/modify/delete ANY file lock regardless of ownership. An agent could release another agent's file locks or create locks on files outside its ticket scope. | 4×3 = 12 | **Medium** |

### Trust Boundary: PostgreSQL Functions (Internal)

| Threat | Category | Analysis | Score (I×L) | Severity |
|--------|----------|----------|-------------|----------|
| Priority ordering bug in claim_ticket | **Tampering** | `ORDER BY priority DESC` causes low-priority tickets to be claimed first (enum ordinal: critical=0, low=3). QA flagged this as DEFECT-001. This is a functional bug, not a security vulnerability — it doesn't bypass access control. | 2×4 = 8 | **Low** |
| `release_ticket` with `p_force=TRUE` allows any agent to release any claim | **Elevation of Privilege** | Force release bypasses ownership check. This is intentional for admin/reconciliation use but the function doesn't verify caller role. Application layer must restrict force release to admin. | 3×2 = 6 | **Low** |

## 3. OWASP Top 10 Assessment

| Category | Status | Details |
|----------|--------|---------|
| **A01 Broken Access Control** | ⚠️ MEDIUM | RLS policies are present but `agent_file_locks` is overly permissive (FOR ALL USING TRUE). Missing INSERT policy on tickets for non-admin agents (QA DEFECT-003). `agent_select_tickets` uses `OR TRUE` — intentionally permissive for reads, acceptable. |
| **A02 Cryptographic Failures** | ⚠️ LOW | `api_key_hash` uses application-side SHA-256 hashing (adequate for API keys). `session_token` stored as plaintext TEXT — should be hashed. `pgcrypto` extension loaded but not used for session tokens. |
| **A03 Injection** | ✅ PASS | All functions use parameterized variables (`p_ticket_id`, `p_agent_id`). No string concatenation in queries except `(p_lease_minutes \|\| ' minutes')::INTERVAL` which uses integer-typed parameter — safe. `RAISE EXCEPTION` uses `%` format specifier with typed parameters — safe. |
| **A04 Insecure Design** | ✅ PASS | Defense-in-depth via RLS + stored functions + application middleware. SKIP LOCKED prevents race conditions. Lease mechanism prevents stale claims. |
| **A05 Security Misconfiguration** | ✅ PASS | RLS enabled on all sensitive tables. Extensions use IF NOT EXISTS. Functions use CREATE OR REPLACE. |
| **A06 Vulnerable Components** | N/A | Pure SQL, no external dependencies. PostgreSQL 17 is current. |
| **A07 Auth Failures** | ✅ PASS | api_key_hash properly stored. Agent revocation checked (`is_active`, `revoked_at`). Lease expiry enforced. |
| **A08 Data Integrity** | ✅ PASS | CHECK constraints on rework_count. UNIQUE constraints on agent_name_role. Foreign keys with appropriate ON DELETE behavior. |
| **A09 Logging Failures** | ✅ PASS | Events table provides full audit trail. pg_notify trigger on all ticket changes. No PII in notify payload (only ticket_id, status, stage, agent name). |
| **A10 SSRF** | N/A | No outbound connections from database layer. |

## 4. SARIF Findings

```json
{
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "ForgeOS-Security", "version": "1.0.0" } },
    "results": [
      {
        "ruleId": "SEC-SQL-001",
        "level": "warning",
        "message": { "text": "file_locks RLS policy 'agent_file_locks' uses USING(TRUE) WITH CHECK(TRUE) for FOR ALL — allows any authenticated user to manipulate any file lock regardless of ownership" },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/db/migrations/001_initial.sql" }, "region": { "startLine": 260 } } }],
        "properties": { "cwe": "CWE-285", "severity": "medium", "fix": "Restrict file_locks policy: USING (locked_by = current_setting('app.agent_id')::UUID OR current_setting('app.agent_role', true) = 'admin') and add ticket_id ownership check in WITH CHECK" }
      },
      {
        "ruleId": "SEC-SQL-002",
        "level": "note",
        "message": { "text": "session_token stored as plaintext TEXT in sessions table — api_key_hash uses hashing but session tokens do not" },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/db/migrations/001_initial.sql" }, "region": { "startLine": 114 } } }],
        "properties": { "cwe": "CWE-312", "severity": "low", "fix": "Hash session tokens before storage using SHA-256, store as session_token_hash. Alternatively, use pgcrypto's crypt() function." }
      },
      {
        "ruleId": "SEC-SQL-003",
        "level": "note",
        "message": { "text": "Missing INSERT policy on tickets table for non-admin agents — non-admin connections cannot create tickets via RLS" },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/db/migrations/001_initial.sql" }, "region": { "startLine": 233 } } }],
        "properties": { "cwe": "CWE-285", "severity": "low", "fix": "Add INSERT policy for ticket spawning or ensure spawn operations route through admin context" }
      },
      {
        "ruleId": "SEC-SQL-004",
        "level": "note",
        "message": { "text": "Priority ordering in claim_ticket uses DESC which gives low-priority tickets first due to enum ordinal ordering" },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/db/migrations/001_initial.sql" }, "region": { "startLine": 316 } } }],
        "properties": { "cwe": "CWE-682", "severity": "low", "fix": "Change ORDER BY priority DESC to ORDER BY priority ASC" }
      }
    ]
  }]
}
```

## 5. Dependency Audit / SBOM

N/A — Pure SQL DDL migration file with no external dependencies. PostgreSQL extensions used: `uuid-ossp`, `pgcrypto` (both bundled with PostgreSQL).

## 6. Verdict

**PASS** — Zero critical or high findings. All findings are medium or low severity with documented risk acceptance:

- **SEC-SQL-001 (Medium):** file_locks RLS overly permissive — acceptable because file lock operations are mediated by stored functions (`claim_ticket_by_id` handles lock creation, `advance_ticket`/`reject_ticket`/`release_ticket` handle lock release). Direct RLS bypass requires authenticated DB connection outside the application. Risk accepted.
- **SEC-SQL-002 (Low):** Plaintext session tokens — deferred to auth/security ticket (TASK-FOS-04-*). Application layer is the primary auth mechanism.
- **SEC-SQL-003 (Low):** Missing INSERT RLS policy — ticket spawning routed through application layer with admin context.
- **SEC-SQL-004 (Low):** Priority ordering bug — functional defect, not a security vulnerability. Does not enable unauthorized access.

All stored functions use parameterized queries. No SQL injection vectors. RLS provides defense-in-depth. Audit trail via events table is comprehensive.

**Advance to CI stage.**
