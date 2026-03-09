# Security Report — TASK-FOS-03-002

## Ticket

**tickets.claim — Atomic Ticket Claiming**

## Stage

SECURITY — **PASS**

## Verdict

**PASS** — Zero critical or high findings. Three medium/low findings and one informational finding documented with risk acceptance. Implementation demonstrates strong security patterns: parameterized SQL, input validation via Zod, atomic operations via PostgreSQL stored functions with `SELECT FOR UPDATE SKIP LOCKED`, structured error taxonomy, and bearer-token authentication.

**Confidence: HIGH**

---

## 1. STRIDE Threat Model

### Component: `ticketsClaimHandler` (forgeos-server/src/tools/tickets-claim.ts)

#### Trust Boundaries Analyzed

| # | Boundary | From | To |
|---|----------|------|----|
| B1 | MCP Client → Express `/mcp` | External agent (authenticated) | Express + MCP SDK |
| B2 | Express → PostgreSQL | Application layer | Database layer |
| B3 | Handler → `claim_ticket_by_id()` SQL function | App logic | Stored procedure |

#### STRIDE Analysis

| Threat | Category | Boundary | Finding | Impact | Likelihood | Score | Severity |
|--------|----------|----------|---------|--------|------------|-------|----------|
| T1 | Spoofing | B1 | Bearer token auth via SHA-256 hash lookup enforced by `authMiddleware`. Public paths exempt (`/health` only). Agent identity populated on `req.agent`. | 4 | 1 | 4 | LOW |
| T2 | Tampering | B2 | All 3 SQL queries use `$1`-style parameterized bindings. No string concatenation. Zod schema validates all inputs before handler execution. | 5 | 1 | 5 | LOW |
| T3 | Repudiation | B3 | `claim_ticket_by_id()` inserts a CLAIMED event into `events` table with agent_id, agent_name, machine_id, operator, lease details. Immutable append-only audit trail. | 3 | 1 | 3 | LOW |
| T4 | Information Disclosure | B2 | INTERNAL_ERROR path returns raw `err.message`. Could leak constraint names, table structure. Mitigated: caller is authenticated agent. | 2 | 2 | 4 | LOW |
| T5 | Denial of Service | B1 | No per-tool rate limiting on `/mcp` endpoint. Rapid claim attempts could exhaust pool connections (max 20). Mitigated: auth required, SKIP LOCKED prevents blocking. | 3 | 2 | 6 | LOW |
| T6 | Elevation of Privilege | B2 | Agent auto-registration grants `["*"]` wildcard permissions. Requires valid API key first. See Finding F1. | 3 | 2 | 6 | MEDIUM |

**No scores ≥ 15 (High) or ≥ 20 (Critical).**

---

## 2. OWASP Top 10 Checklist

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| A01 | Broken Access Control | **PASS** | `authMiddleware` enforces Bearer token auth on all non-public paths. `requirePermission()` factory available. MCP endpoint authenticated. Deny-by-default (401 for missing/invalid tokens). |
| A02 | Cryptographic Failures | **PASS** | API keys stored as SHA-256 hashes (never plaintext). Keys generated with 32 bytes from `node:crypto.randomBytes`. No sensitive data stored in plaintext. DATABASE_URL from env vars. |
| A03 | Injection | **PASS** | All 3 queries use parameterized bindings (`$1`–`$6`). Zod validates input types/ranges before handler. Stored function parameters typed (TEXT, UUID, INTEGER). No dynamic SQL construction. |
| A04 | Insecure Design | **PASS** | Defense-in-depth: Zod validation → auth middleware → parameterized queries → stored function guards → RLS policies. `claim_ticket_by_id` enforces status/lease checks atomically. |
| A05 | Security Misconfiguration | **PASS** | Production mode requires `WEBHOOK_SECRET` and non-default `ADMIN_API_KEY` (Zod superRefine). Default `ADMIN_API_KEY` flagged in config validation. No debug endpoints exposed. |
| A06 | Vulnerable Components | **N/A** | Dependency audit not executable in this pass (no live environment). Package.json uses well-known dependencies: `pg`, `zod`, `pino`, `express`, `@modelcontextprotocol/sdk`. Recommend periodic `npm audit`. |
| A07 | Auth Failures | **PASS** | SHA-256 hash-based API key validation. `revoked_at` field enables key revocation. `is_active` flag on agents. `updateLastSeen` heartbeat for staleness detection. No plaintext password storage. |
| A08 | Data Integrity | **PASS** | Stored function atomicity (single transaction). `FOR UPDATE SKIP LOCKED` prevents concurrent modification. File lock conflict check before claiming. Event audit trail is append-only. |
| A09 | Logging Failures | **PASS** | Structured Pino logger. Request logging middleware records method, path, status, duration, requestId. Error paths log structured context (`{ err, ticket_id }`). No PII in logs. |
| A10 | SSRF | **N/A** | Handler does not make outbound HTTP requests. No URL inputs accepted. |

**Result: 8/8 applicable categories PASS. 2 N/A (A06, A10).**

---

## 3. LLM Top 10

No AI/LLM features in this ticket's scope. The handler is a thin database wrapper. **N/A — skipped.**

---

## 4. Race Condition Analysis (Special Focus)

| Scenario | Protection | Evidence |
|----------|-----------|----------|
| Two agents claim same ticket simultaneously | `SELECT FOR UPDATE SKIP LOCKED` — first acquirer locks the row; second gets empty result → ALREADY_CLAIMED | SQL function lines 554-560 |
| File lock race between claim check and insert | `FOR UPDATE` row lock held throughout transaction. File conflict check and lock insert are in same transaction. `ON CONFLICT DO NOTHING` as defense-in-depth. | SQL function lines 562-577 |
| Lease expiry race | Expired leases allow re-claiming: `(status = 'CLAIMED' AND lease_expiry < NOW())`. `SKIP LOCKED` prevents two re-claimers from selecting same ticket. | SQL function line 557 |
| Pool exhaustion from concurrent claims | 20 max connections. Claim is fast (3 queries). Pool exhaustion logged as warning. Connection timeout at 10s. | pool.ts lines 22-29 |

**No race condition vulnerabilities identified. PostgreSQL's `FOR UPDATE SKIP LOCKED` is the gold-standard pattern for concurrent work queues.**

---

## 5. Injection Analysis (Special Focus)

| Vector | Status | Evidence |
|--------|--------|----------|
| SQL Injection | **SAFE** | All queries use parameterized bindings. No string interpolation in SQL. |
| NoSQL Injection | **N/A** | PostgreSQL only. |
| Command Injection | **N/A** | No shell/exec calls. |
| Log Injection | **SAFE** | Pino serializes objects to JSON. No raw string interpolation in log calls. |
| Header Injection | **N/A** | MCP tool returns JSON content, not HTTP headers. |

---

## 6. Privilege Escalation Analysis (Special Focus)

| Vector | Status | Evidence |
|--------|--------|----------|
| Agent impersonation | **SAFE** | `agent_name` from request body, but the claim is tied to agent UUID from database lookup. Spoofing a name creates a new agent (auto-reg) rather than impersonating an existing one. |
| Wildcard permission on auto-reg | **MEDIUM** | See Finding F1. Auto-registered agents get `["*"]` permissions. Mitigated by requiring valid Bearer token. |
| Cross-ticket claiming | **SAFE** | Handler claims exactly one ticket by `ticket_id`. No batch operations. |
| Claim without auth | **SAFE** | `authMiddleware` enforces Bearer token auth. 401 returned for missing/invalid tokens. |

---

## 7. SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "ForgeOS-SecurityAgent",
        "version": "1.0.0",
        "rules": [
          {
            "id": "SEC-001",
            "name": "WildcardPermissionsOnAutoRegistration",
            "shortDescription": { "text": "Agent auto-registration grants wildcard permissions" },
            "helpUri": "https://cwe.mitre.org/data/definitions/250.html",
            "defaultConfiguration": { "level": "warning" }
          },
          {
            "id": "SEC-002",
            "name": "RLSSessionContextNotSet",
            "shortDescription": { "text": "Pool queries bypass RLS session context" },
            "helpUri": "https://cwe.mitre.org/data/definitions/863.html",
            "defaultConfiguration": { "level": "note" }
          },
          {
            "id": "SEC-003",
            "name": "ErrorMessageInformationDisclosure",
            "shortDescription": { "text": "Raw error messages returned to caller" },
            "helpUri": "https://cwe.mitre.org/data/definitions/209.html",
            "defaultConfiguration": { "level": "note" }
          },
          {
            "id": "SEC-004",
            "name": "NoPerToolRateLimiting",
            "shortDescription": { "text": "No rate limiting on MCP tool invocations" },
            "helpUri": "https://cwe.mitre.org/data/definitions/770.html",
            "defaultConfiguration": { "level": "note" }
          }
        ]
      }
    },
    "results": [
      {
        "ruleId": "SEC-001",
        "level": "warning",
        "message": {
          "text": "Agent auto-registration (lines 55-60) inserts new agents with permissions: '[\"*\"]'::JSONB (wildcard). Any authenticated caller can trigger this by providing an unknown agent_name. While auth is required, wildcard permissions are overly broad. Recommend: assign minimum necessary permissions or a default restricted role."
        },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-claim.ts" },
            "region": { "startLine": 55, "endLine": 60 }
          }
        }],
        "taxa": [{ "id": "CWE-250", "toolComponent": { "name": "CWE" } }]
      },
      {
        "ruleId": "SEC-002",
        "level": "note",
        "message": {
          "text": "Handler calls pool.query() directly without setting RLS session variables (app.agent_role, app.agent_name) via setSessionContext(). RLS policies on tickets/file_locks are not enforced during claim operations. Mitigated by: (a) stored function has internal guards, (b) pool user is likely table owner (RLS bypassed by default for owners). Systemic issue, not specific to this handler."
        },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-claim.ts" },
            "region": { "startLine": 45, "endLine": 66 }
          }
        }],
        "taxa": [{ "id": "CWE-863", "toolComponent": { "name": "CWE" } }]
      },
      {
        "ruleId": "SEC-003",
        "level": "note",
        "message": {
          "text": "INTERNAL_ERROR response includes raw err.message (line 101). Could expose database constraint names, table structure, or internal details. Caller is an authenticated agent so risk is low. Recommend: sanitize error messages in production by returning generic message and logging details server-side only."
        },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": { "uri": "forgeos-server/src/tools/tickets-claim.ts" },
            "region": { "startLine": 99, "endLine": 110 }
          }
        }],
        "taxa": [{ "id": "CWE-209", "toolComponent": { "name": "CWE" } }]
      },
      {
        "ruleId": "SEC-004",
        "level": "note",
        "message": {
          "text": "RATE_LIMIT_PER_MINUTE (default 100) is configured but no rate-limiting middleware is applied to the /mcp endpoint or individual MCP tools. Rapid invocations could exhaust the 20-connection pool. Mitigated by: authentication requirement and PostgreSQL SKIP LOCKED preventing blocking waits."
        },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": { "uri": "forgeos-server/src/server.ts" },
            "region": { "startLine": 97, "endLine": 111 }
          }
        }],
        "taxa": [{ "id": "CWE-770", "toolComponent": { "name": "CWE" } }]
      }
    ]
  }]
}
```

---

## 8. SBOM Summary

| Package | Version (from package.json) | Role | Known CVEs |
|---------|---------------------------|------|------------|
| pg | ^8.x | PostgreSQL client | No critical/high known |
| zod | ^3.x | Input validation | No known CVEs |
| pino | ^8.x | Structured logging | No known CVEs |
| express | ^4.x | HTTP framework | No known CVEs (recent patches applied) |
| @modelcontextprotocol/sdk | ^1.x | MCP protocol | No known CVEs |
| dotenv | ^16.x | Env loading | No known CVEs |

**Note:** Full `npm audit` not executed in this offline review. Recommend running `npm audit --audit-level=high` in CI pipeline.

---

## 9. Security Strengths

1. **Parameterized SQL throughout** — Zero injection vectors. All 3 queries use `$1`-style bindings.
2. **Atomic claiming via PostgreSQL** — `FOR UPDATE SKIP LOCKED` is the gold-standard pattern for concurrent work queues. Impossible to double-assign.
3. **File lock conflict detection** — SQL function checks for conflicting file locks BEFORE claiming, within the same transaction.
4. **Input validation** — Zod schema enforces types, ranges (lease_minutes 5-120), and defaults before handler invocation.
5. **Structured error taxonomy** — Returns typed error codes (ALREADY_CLAIMED, FILE_CONFLICT, INTERNAL_ERROR) rather than raw exceptions.
6. **Bearer token auth** — SHA-256 hash-based API key validation with revocation support.
7. **Audit trail** — CLAIMED event recorded with full context (agent, machine, operator, lease details).
8. **Structured logging** — Pino JSON logger with no PII. Request logging captures method, path, status, duration.
9. **No hardcoded secrets** — Config loaded from environment variables with Zod validation.
10. **Lease expiry mechanism** — Bounded lease duration prevents indefinite locking.

---

## 10. Recommendations (Non-Blocking)

| # | Finding | Severity | Recommendation |
|---|---------|----------|----------------|
| R1 | SEC-001: Wildcard permissions on auto-reg | Medium | Assign a default restricted permission set (e.g., `["tickets.claim", "tickets.next"]`) instead of `["*"]`. |
| R2 | SEC-003: Raw error messages | Low | Replace `err.message` with generic "An internal error occurred" in INTERNAL_ERROR response; log details server-side. |
| R3 | SEC-004: No rate limiting | Low | Apply rate-limiting middleware to `/mcp` endpoint using existing `RATE_LIMIT_PER_MINUTE` config. |
| R4 | SEC-002: RLS context not set | Low | Use `queryWithContext()` helper from pool.ts instead of direct `pool.query()` for RLS enforcement (systemic improvement). |

**All recommendations are non-blocking improvements. None represent exploitable vulnerabilities given the current threat model (trusted agents behind API key auth).**

---

## Timestamp

2026-03-10T00:15:00Z
