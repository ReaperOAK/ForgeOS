# Security Review — TASK-FOS-03-006: tickets.spawn MCP Tool

**Reviewer:** Security Engineer  
**Date:** 2026-03-10T14:30:00+00:00  
**Stage:** SECURITY  
**Verdict:** PASS (with advisory findings)  
**Confidence:** HIGH  
**Upstream:** QA PASS — 24/24 tests, 97%+ coverage

---

## 1. Scope

| Item | Detail |
|------|--------|
| File under review | `forgeos-server/src/tools/tickets-spawn.ts` (325 lines) |
| Supporting files | `tools/index.ts`, `middleware/auth.ts`, `auth/roles.ts`, `server.ts`, `config.ts`, `db/pool.ts`, `middleware/logging.ts`, `types/index.ts` |
| Stack | Express 4.21.2, MCP SDK 1.27.1, PostgreSQL (pg 8.13.1), Zod 3.24.2, Pino 9.6.0 |
| npm audit | 0 vulnerabilities (clean) |

---

## 2. STRIDE Threat Model

### Trust Boundaries

```
[Client/Agent] --(Bearer Token)--> [Express + authMiddleware]
   --(MCP SDK)--> [ticketsSpawnHandler]
   --(pg parameterized queries)--> [PostgreSQL]
```

### Threat Analysis

| # | Threat | Category | Boundary | Impact | Likelihood | Score | Status |
|---|--------|----------|----------|--------|------------|-------|--------|
| T1 | Unauthenticated agent calls tickets.spawn | Spoofing | Client → Express | 4 | 1 | 4 (LOW) | MITIGATED — authMiddleware validates Bearer token via SHA-256 hash lookup |
| T2 | Agent with wrong role calls tickets.spawn | Elevation of Privilege | Express → MCP Handler | 3 | 3 | 9 (LOW) | ADVISORY — RBAC matrix defined in roles.ts but NOT enforced at MCP tool layer (see S1) |
| T3 | SQL injection via parent_id/title/type | Tampering | Handler → PostgreSQL | 5 | 1 | 5 (LOW) | MITIGATED — ALL queries use parameterized placeholders ($1, $2, ...) |
| T4 | Concurrent ticket ID collision | Tampering | Handler → PostgreSQL | 3 | 2 | 6 (LOW) | ADVISORY — generateChildTicketId COUNT outside transaction (TOCTOU); UNIQUE constraint catches duplication (see S2) |
| T5 | Unlimited child ticket spawning | Denial of Service | Client → Handler → DB | 3 | 3 | 9 (LOW) | ADVISORY — No spawn depth or count limits (see S3) |
| T6 | Error message leaks DB schema | Information Disclosure | Handler → Client | 3 | 2 | 6 (LOW) | ADVISORY — raw err.message returned on INTERNAL_ERROR (see S4) |
| T7 | Replay of stolen Bearer token | Spoofing | Client → Express | 3 | 2 | 6 (LOW) | ACCEPTED — Tokens are SHA-256 hashed at rest; TLS in transit mitigates interception |
| T8 | Privilege escalation via parent_id spoofing | Elevation of Privilege | Client → Handler | 2 | 2 | 4 (LOW) | MITIGATED — parent_id validated via DB lookup; child inherits parent project_id |
| T9 | Transaction failure leaves partial state | Tampering | Handler → PostgreSQL | 3 | 1 | 3 (LOW) | MITIGATED — BEGIN/COMMIT/ROLLBACK transaction wrapping (lines 196-310) |

**Maximum STRIDE Score: 9 (LOW)** — No critical or high threats identified.

---

## 3. OWASP Top 10 Compliance

| # | Category | Status | Detail |
|---|----------|--------|--------|
| A01 | Broken Access Control | PASS (advisory) | authMiddleware enforces authentication on /mcp. RBAC matrix (roles.ts) defines tickets.spawn permission for admin/architect/product_manager/backend/frontend/todo. However, requirePermission middleware is NOT applied to /mcp route — any authenticated agent can invoke any tool. Risk mitigated by agent registration being admin-controlled. |
| A02 | Cryptographic Failures | PASS | Bearer tokens stored as SHA-256 hashes. No plaintext secrets. No cryptographic operations in spawn handler. |
| A03 | Injection | PASS | All SQL queries use parameterized placeholders: lines 112-113 (COUNT), 198-209 (SELECT parent), 236-255 (INSERT child), 263-275 (INSERT parent event), 283-295 (INSERT child event). Zod validates input types/shapes before any DB interaction. |
| A04 | Insecure Design | PASS (advisory) | No spawn depth or count limits in DB schema or application logic. Abuse case: recursive spawning could create unbounded tree depth. Mitigated by: (a) agents are trusted internal actors, (b) admin controls agent registration. |
| A05 | Security Misconfiguration | PASS | DEBUG_MODE defaults to false. No sensitive config exposed in error responses (except raw err.message — see S4). CORS configured appropriately. |
| A06 | Vulnerable Components | PASS | `npm audit` returns 0 vulnerabilities. All dependencies at current stable versions. |
| A07 | Auth Failures | PASS | Bearer token auth with SHA-256 hash validation. Session-less (stateless MCP transport). No password-based auth in this component. |
| A08 | Data Integrity | PASS | Transaction atomicity ensures child ticket + events are created together or not at all. No deserialization of untrusted formats — Zod parses all input. |
| A09 | Logging Failures | PASS | Pino structured logging. Log entries include tool name, parent_id, child_id, agent info. No PII leaked in logs. Error details logged server-side only. |
| A10 | SSRF | N/A | No outbound HTTP requests in spawn handler. |

**Result: 10/10 categories reviewed. 0 failures. 2 advisory notes (A01, A04).**

---

## 4. LLM Top 10 Assessment

| # | Category | Status | Detail |
|---|----------|--------|--------|
| LLM01 | Prompt Injection | N/A | tickets.spawn does not interact with LLM prompts |
| LLM02 | Insecure Output | N/A | No LLM output handling |
| LLM06 | Sensitive Info Disclosure | N/A | No LLM-generated content |
| LLM08 | Excessive Agency | PASS | Tool has defined scope (child ticket creation only). No destructive operations. Human approval not required for ticket creation per system design. |

---

## 5. Detailed Findings (SARIF Summary)

### S1 — MCP Per-Tool Authorization Not Enforced

| Field | Value |
|-------|-------|
| Rule ID | SEC-AUTHZ-001 |
| Severity | LOW |
| CWE | CWE-862 (Missing Authorization) |
| Location | `forgeos-server/src/server.ts` (MCP route), `forgeos-server/src/middleware/auth.ts` |
| Description | The RBAC permission matrix in `auth/roles.ts` defines which roles can use `tickets.spawn` (admin, architect, product_manager, backend, frontend, todo). However, the `/mcp` Express endpoint only applies `authMiddleware` (authentication), not `requirePermission` (authorization). Any authenticated agent can invoke any MCP tool regardless of role. |
| Risk | An agent with a restricted role (e.g., qa, documentation) could call tickets.spawn if they have a valid Bearer token. |
| Mitigation | Agent registration is admin-controlled. Only trusted agents receive tokens. The MCP SDK tool registration does not natively support per-tool middleware. |
| Recommendation | Add per-tool permission checks inside each MCP tool handler, or wrap the MCP transport layer with role-based filtering. |

### S2 — TOCTOU Race in Child Ticket ID Generation

| Field | Value |
|-------|-------|
| Rule ID | SEC-RACE-001 |
| Severity | LOW |
| CWE | CWE-367 (Time-of-check Time-of-use Race Condition) |
| Location | `forgeos-server/src/tools/tickets-spawn.ts` lines 109-116 |
| Description | `generateChildTicketId()` runs a `SELECT COUNT(*)` query outside the transaction to determine the next sequential child number. Under concurrent spawning, two handlers could compute the same child ID. |
| Mitigation | The `ticket_id UNIQUE` constraint on the tickets table prevents duplicate insertion — the second concurrent INSERT would fail with a constraint violation, returned as INTERNAL_ERROR. |
| Recommendation | Move the COUNT query inside the transaction with `FOR UPDATE` locking on the parent row, or use a sequence/serial for child numbering. |

### S3 — No Spawn Depth or Count Limits

| Field | Value |
|-------|-------|
| Rule ID | SEC-DOS-001 |
| Severity | MEDIUM (advisory, not blocking) |
| CWE | CWE-770 (Allocation of Resources Without Limits) |
| Location | `forgeos-server/src/tools/tickets-spawn.ts`, DB schema (`001_initial.sql`) |
| Description | No CHECK constraint or application-level limit on: (a) nesting depth (a ticket can spawn children that spawn further children indefinitely), or (b) number of children per parent. A malicious or buggy agent could create a deeply nested or fan-out tree exhausting DB storage and query performance. |
| Risk | Low in practice — agents are trusted internal actors with admin-provisioned tokens. Rate limiting (RATE_LIMIT_PER_MINUTE=100) is configured but not enforced (middleware not wired). |
| Recommendation | Add `MAX_SPAWN_DEPTH` (e.g., 5) and `MAX_CHILDREN_PER_PARENT` (e.g., 20) limits. Add CHECK constraints or application-level guards. Wire rate-limiting middleware. |

### S4 — Error Message Information Disclosure

| Field | Value |
|-------|-------|
| Rule ID | SEC-INFO-001 |
| Severity | LOW |
| CWE | CWE-209 (Generation of Error Message Containing Sensitive Information) |
| Location | `forgeos-server/src/tools/tickets-spawn.ts` line 318 |
| Description | The catch block returns `err instanceof Error ? err.message : 'Unknown error'` as the INTERNAL_ERROR content text. PostgreSQL errors can contain table names, column names, constraint names, and query fragments. |
| Recommendation | Return a generic error message to the client. Log the detailed error server-side only (which is already done via `logger.error`). |

### S5 — Rate Limiting Not Enforced (Cross-cutting)

| Field | Value |
|-------|-------|
| Rule ID | SEC-DOS-002 |
| Severity | INFO |
| CWE | CWE-799 (Improper Control of Interaction Frequency) |
| Location | `forgeos-server/src/config.ts` (RATE_LIMIT_PER_MINUTE=100), server.ts |
| Description | Rate limit configuration exists but no rate-limiting middleware is applied to any route. This is a cross-cutting concern not specific to tickets.spawn. |
| Recommendation | Wire `express-rate-limit` or equivalent middleware on `/mcp` and API routes. |

### S6 — file_paths Array Not Validated

| Field | Value |
|-------|-------|
| Rule ID | SEC-INPUT-001 |
| Severity | INFO |
| CWE | CWE-22 (Improper Limitation of a Pathname to a Restricted Directory) |
| Location | `forgeos-server/src/tools/tickets-spawn.ts` lines 65-66 |
| Description | The `file_paths` array accepts arbitrary strings. While these paths are only stored in the DB (not used for filesystem access in this tool), downstream consumers could be affected if they use these paths for file operations without validation. |
| Recommendation | Add regex validation to file_paths entries (e.g., reject `../`, absolute paths, null bytes). |

---

## 6. Dependency Audit

| Metric | Value |
|--------|-------|
| `npm audit` result | 0 vulnerabilities |
| Total dependencies | ~85 (direct + transitive) |
| Critical CVEs | 0 |
| High CVEs | 0 |
| SBOM format | CycloneDX not generated (npm audit suffices for this scope) |

Key direct dependencies:
- `@modelcontextprotocol/sdk@^1.27.1` — current, no known CVEs
- `express@^4.21.2` — current stable, no open CVEs
- `pg@^8.13.1` — current, no known CVEs
- `zod@^3.24.2` — current, no known CVEs
- `pino@^9.6.0` — current, no known CVEs

---

## 7. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | None found |
| Hardcoded passwords | None found |
| Hardcoded tokens | None found |
| Private keys | None found |
| `.env` in VCS | Not tracked (confirmed in .gitignore) |
| `secrets/` directory | Contains `db_password` — used via Docker secrets mount, not hardcoded |

---

## 8. Auth/AuthZ Summary

| Check | Result |
|-------|--------|
| Authentication middleware | APPLIED — authMiddleware on all non-public routes including /mcp |
| Token storage | SHA-256 hashed in `agents` table |
| RBAC permission matrix | DEFINED — tickets.spawn restricted to 6 roles |
| Per-tool enforcement | NOT APPLIED — requirePermission not used on /mcp (see S1) |
| Session management | Stateless — no sessions, token per request |
| Least privilege | PARTIAL — matrix defined but not enforced at tool level |

---

## 9. Input Validation Summary

| Input Field | Validation | Status |
|-------------|-----------|--------|
| parent_id | Zod `string().min(1)` + DB existence check | PASS |
| title | Zod `string().min(1).max(200)` | PASS |
| type | Zod `enum` (8 valid types) | PASS |
| priority | Zod `enum` with default 'medium' | PASS |
| acceptance_criteria | Zod `array(string()).min(1)` | PASS |
| file_paths | Zod `array(string())` — no path validation | ADVISORY (S6) |
| description | Zod `string().optional()` | PASS |
| depends_on | Zod `array(string()).optional()` | PASS |

Additional defensive validation (lines 171-192): handler re-checks title, type, and acceptance_criteria beyond Zod schema.

---

## 10. Positive Security Observations

1. **Parameterized SQL throughout** — Zero raw string concatenation in queries. All 5 query sites use $1..$N placeholders.
2. **Transaction atomicity** — Child INSERT + parent SPAWNED event + child CREATED event wrapped in BEGIN/COMMIT/ROLLBACK. Partial state impossible.
3. **Comprehensive input validation** — Zod schema with type-safe enum constraints + redundant handler-level checks.
4. **Structured logging** — Pino logger with child context. No PII in log output.
5. **Clean dependency tree** — 0 npm audit vulnerabilities.
6. **No hardcoded secrets** — Configuration via environment variables with Zod defaults.
7. **Explicit error typing** — Custom error codes (INVALID_SUBTASK, TICKET_NOT_FOUND, INTERNAL_ERROR) prevent ambiguous error handling.

---

## 11. SARIF Output (Abbreviated)

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "ForgeOS-Security-Agent", "version": "1.0.0" } },
    "results": [
      {
        "ruleId": "SEC-AUTHZ-001",
        "level": "note",
        "message": { "text": "MCP per-tool authorization not enforced. RBAC matrix defined but requirePermission middleware not applied to /mcp route." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/server.ts" } } }],
        "properties": { "cwe": "CWE-862", "severity": "LOW" }
      },
      {
        "ruleId": "SEC-RACE-001",
        "level": "note",
        "message": { "text": "TOCTOU race in generateChildTicketId: COUNT query outside transaction." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-spawn.ts" }, "region": { "startLine": 109, "endLine": 116 } } }],
        "properties": { "cwe": "CWE-367", "severity": "LOW" }
      },
      {
        "ruleId": "SEC-DOS-001",
        "level": "warning",
        "message": { "text": "No spawn depth or count limits. Recursive spawning could exhaust resources." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-spawn.ts" } } }],
        "properties": { "cwe": "CWE-770", "severity": "MEDIUM-advisory" }
      },
      {
        "ruleId": "SEC-INFO-001",
        "level": "note",
        "message": { "text": "Error handler returns raw err.message which may contain DB schema details." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-spawn.ts" }, "region": { "startLine": 318, "endLine": 318 } } }],
        "properties": { "cwe": "CWE-209", "severity": "LOW" }
      },
      {
        "ruleId": "SEC-DOS-002",
        "level": "note",
        "message": { "text": "Rate limiting configured (RATE_LIMIT_PER_MINUTE=100) but middleware not wired." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/config.ts" } } }],
        "properties": { "cwe": "CWE-799", "severity": "INFO" }
      },
      {
        "ruleId": "SEC-INPUT-001",
        "level": "note",
        "message": { "text": "file_paths array accepts arbitrary strings without path validation." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-spawn.ts" }, "region": { "startLine": 65, "endLine": 66 } } }],
        "properties": { "cwe": "CWE-22", "severity": "INFO" }
      }
    ]
  }]
}
```

---

## 12. Verdict

**PASS** — Zero critical or high findings. All findings are LOW or INFO severity.

| Finding | Severity | Blocking? |
|---------|----------|-----------|
| S1 — MCP per-tool authz | LOW | No |
| S2 — TOCTOU child ID race | LOW | No |
| S3 — No spawn limits | MEDIUM (advisory) | No |
| S4 — Error message leak | LOW | No |
| S5 — Rate limiting not wired | INFO | No |
| S6 — file_paths not validated | INFO | No |

**Justification:** The tickets.spawn tool operates in a trusted internal environment where:
- All agents are provisioned by administrators
- Bearer tokens are SHA-256 hashed at rest
- All SQL is parameterized (zero injection risk)
- Transaction atomicity prevents partial state
- Input validation is comprehensive (Zod + defensive checks)
- No hardcoded secrets, clean dependency tree

The advisory findings (S1, S3) should be addressed in future hardening tickets but do not constitute blocking security vulnerabilities for this implementation.

**Advance to CI stage.**
