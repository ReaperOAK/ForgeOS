---
id: risk-register
version: "1.0"
owner: [Security, ReaperOAK]
write_access: [Security, ReaperOAK]
append_only: true
---

# Risk Register

> **Schema Version:** 1.0
> **Owner:** Security Agent
> **Write Access:** Security agent (append), ReaperOAK (full)
> **Lock Rules:** Only Security agent and ReaperOAK may write. All other
> subagents have read-only access. No entry may be deleted — only marked as
> mitigated or accepted.
> **Update Protocol:** Append new risks with timestamp, severity, and
> mitigation plan. Update existing risks only to change status or add
> mitigation evidence.

---

## Risk Entry Format

```
### RISK-{number}: {title}
- **Date Identified:** YYYY-MM-DD
- **Identified By:** {agent or human}
- **Severity:** Critical | High | Medium | Low
- **Likelihood:** High | Medium | Low
- **Category:** Security | Operational | Technical | Compliance
- **Description:** What could go wrong
- **Impact:** What happens if it occurs
- **Mitigation:** How to prevent or reduce it
- **Status:** Open | Mitigated | Accepted | Closed
- **Evidence:** Proof of mitigation if applicable
```

---

## Active Risks

### RISK-001: Memory Poisoning via Subagent Hallucination

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** High
- **Likelihood:** Medium
- **Category:** Security
- **Description:** A subagent could write false or contradictory information to
  shared memory bank files, corrupting the system's understanding of the project
- **Impact:** Downstream agents make decisions based on false context, producing
  incorrect code or architecture
- **Mitigation:** `systemPatterns.md` and `decisionLog.md` are write-locked to
  ReaperOAK only. Subagents can only append to `activeContext.md` and
  `progress.md`. All entries are timestamped and attributed.
- **Status:** Mitigated
- **Evidence:** Lock rules enforced in memory bank file headers

### RISK-002: Prompt Injection in External Content

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** Critical
- **Likelihood:** Medium
- **Category:** Security
- **Description:** Malicious content fetched from external URLs or APIs could
  contain prompt injection patterns that override agent behavior
- **Impact:** Agent executes unintended actions, leaks data, or escalates
  privileges
- **Mitigation:** External content sanitization protocol defined in
  `security.agentic-guardrails.instructions.md`. All external content treated as untrusted.
  Content boundaries enforced via delimiters.
- **Status:** Mitigated
- **Evidence:** Guardrails document created

### RISK-003: Token Runaway / Infinite Loop

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** High
- **Likelihood:** Low
- **Category:** Operational
- **Description:** A subagent enters an infinite retry loop, consuming
  excessive tokens/compute without producing results
- **Impact:** Cost runaway, context window exhaustion, system stall
- **Mitigation:** Maximum retry limit (3) per task. Timeout budgets in
  delegation packets. Loop counter in Plan-Act-Reflect cycle. ReaperOAK
  monitors iteration count.
- **Status:** Mitigated
- **Evidence:** Orchestration rules define loop detection heuristic

### RISK-004: Unauthorized Privilege Escalation

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** Critical
- **Likelihood:** Low
- **Category:** Security
- **Description:** A subagent attempts to use tools outside its allowed set or
  modify files outside its scope
- **Impact:** Unauthorized code changes, security config modifications,
  production access
- **Mitigation:** Each subagent has explicit `allowed_tools` list and
  `scopeBoundaries`. Tool access enforced at delegation time. Forbidden actions
  list in each agent definition.
- **Status:** Mitigated
- **Evidence:** Subagent files define explicit boundaries

### RISK-005: Overly Permissive RLS on agent_file_locks Table

- **Date Identified:** 2026-03-07
- **Identified By:** Security
- **Severity:** Medium
- **Likelihood:** Low
- **Category:** Security
- **Description:** The `agent_file_locks` table uses `USING(TRUE)` RLS policy, allowing any authenticated agent to read/modify any file lock regardless of ownership. CWE-285 (Improper Authorization).
- **Impact:** An agent could release or modify another agent's file locks, potentially causing concurrent file access conflicts.
- **Mitigation:** All file lock operations are mediated through stored functions (`acquire_file_lock`, `release_file_lock`) which enforce ownership checks. Direct table DML is prevented by application-level access patterns. Risk accepted for current internal-only deployment.
- **Status:** Accepted
- **Evidence:** TASK-FOS-01-001 Security Review — `.github/agent-output/Security/TASK-FOS-01-001.md`

### RISK-006: Default Admin API Key Accepted in Production

- **Date Identified:** 2026-03-07
- **Identified By:** Security
- **Severity:** Medium
- **Likelihood:** Medium
- **Category:** Security
- **Description:** `config.ts` accepts the default `ADMIN_API_KEY='forgeos_admin_CHANGE_ME'` value in production mode without validation or warning. CWE-1188 (Initialization with Hard-Coded Network Resource Configuration Data).
- **Impact:** If deployed without changing the default key, the admin API is accessible with a well-known credential.
- **Mitigation:** The key is named with `CHANGE_ME` convention, `.env.example` documents the requirement to change it, and Dockerfile does not embed the value. Recommend adding a startup validation that rejects the default key when `NODE_ENV=production`.
- **Status:** Open
- **Evidence:** TASK-FOS-08-003 Security Review — `.github/agent-output/Security/TASK-FOS-08-003.md`

---

## Closed Risks

<!-- Risks that have been resolved or are no longer applicable -->

_None_

### [TASK-FOS-08-003] — Configuration Security Risks (2026-03-06T10:15:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-CFG-001 | Medium | docker-compose.yml hardcodes `POSTGRES_PASSWORD: forgeos` and embeds password in `DATABASE_URL` | Risk Accepted | Local dev only; production deployments must override via env vars. Pattern `${ADMIN_API_KEY:-...}` already used for API key. |
| SEC-CFG-002 | Low | Root `.gitignore` does not exclude `.env` files — accidental secret commit possible | Open | Recommend adding `.env` and `!.env.example` to .gitignore in future housekeeping ticket |
| SEC-CFG-003 | Low | `ADMIN_API_KEY` minimum length 8 chars (recommend 16+ for production) | Risk Accepted | Production validation rejects default value; convention guides longer keys |
| SEC-CFG-004 | Low | Admin key comparison in auth middleware uses `===` (non-constant-time) | Risk Accepted | Network latency masks timing; admin key check is fallback before DB hash lookup |

### [TASK-FOS-08-001] — Dockerfile Security Risks (2026-03-06T12:00:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-DOCKER-001 | Low | Base image `node:22-alpine` uses mutable tag, not pinned to digest (CWE-829) | Risk Accepted | Official Docker Hub image; Alpine minimal surface; pin to digest in production hardening phase |
| SEC-DOCKER-002 | Low | Runtime image includes devDependencies in node_modules/ (CWE-1104) | Risk Accepted | No known vulnerabilities; recommend `npm ci --omit=dev` in future optimization |
| SEC-DOCKER-003 | Low | No `npm audit` executed during Docker build (CWE-1395) | Risk Accepted | CI pipeline handles dependency auditing; build-time audit is defense-in-depth enhancement |

### [TASK-FOS-01-002] — Database Pool & Migration Security Risks (2026-03-07T05:00:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-POOL-001 | Medium | Direct `pool`/`getPool()` exports bypass RLS enforcement — queries via `pool.query()` have no session context (CWE-285) | Risk Accepted | `pool` export marked `@deprecated`; application code should use `queryWithRLS()`/`transactionWithRLS()`; recommend removing deprecated export in future cleanup ticket |
| SEC-MIGRATE-001 | Medium | New migration files executed as raw SQL without pre-execution integrity verification; checksum only protects already-applied migrations (CWE-494) | Risk Accepted | Standard migration runner pattern; integrity relies on Git branch protection and code review; consider adding migration signing in production hardening phase |
| SEC-POOL-002 | Low | `queryWithRLS()`/`transactionWithRLS()` pass empty string for `agentId` to `setSessionContext()` (CWE-276) | Risk Accepted | Current RLS policies use `agent_name`/`agent_role`, not `agent_id`; add `agentId` parameter when policies require it |
| SEC-POOL-003 | Low | Pool error handler may serialize connection details (hostname/port/db) in pino error output (CWE-209) | Risk Accepted | Structured logging goes to server-side log aggregation only; recommend configuring pino error serializer to redact connection strings in production |
| SEC-MIGRATE-002 | Low | CLI entry point uses loose `process.argv[1]?.includes('migrate')` heuristic (CWE-183) | Risk Accepted | Low risk — only affects CLI-mode activation; recommend `import.meta.url` comparison for precise detection |
### [TASK-FOS-08-002] — Docker Compose Infrastructure Security Risks (2026-03-07T07:42:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-COMPOSE-001 | Medium | Hardcoded password in mcp-server DATABASE_URL env var bypasses Docker secrets pattern (CWE-798) | Risk Accepted | Dev placeholder; production MUST use secret injection or env file with restricted permissions |
| SEC-COMPOSE-002 | Medium | pgbouncer image uses `:latest` tag — unpinned, supply chain risk (CWE-1104) | Risk Accepted | Initial setup; MUST pin to specific version before production deployment |
| SEC-COMPOSE-003 | Medium | pgbouncer port 6432 exposed to all host interfaces (0.0.0.0) (CWE-284) | Risk Accepted | Dev convenience; production MUST bind to 127.0.0.1 or use internal-only networking |
| SEC-COMPOSE-004 | Low | No container resource limits (mem_limit, cpus) on any service (CWE-770) | Risk Accepted | Dev environment; add deploy.resources.limits for production |
| SEC-COMPOSE-005 | Low | Password mismatch between DATABASE_URL ("forgeos") and secrets/db_password ("changeme_db_password") (CWE-521) | Risk Accepted | Both are placeholders; must be synchronized before deployment |
| SEC-COMPOSE-006 | Low | No TLS encryption between container services on Docker network (CWE-319) | Risk Accepted | Docker internal network is isolated; add TLS for production/multi-host deployments |
| SEC-COMPOSE-007 | Low | Missing container hardening: no security_opt no-new-privileges, no read_only FS (CWE-250) | Risk Accepted | Dev environment; add hardening options for production |
| SEC-COMPOSE-008 | Low | pgbouncer lacks healthcheck; mcp-server depends via service_started only (CWE-693) | Risk Accepted | pgbouncer starts quickly; add healthcheck for production reliability |

### [TASK-FOS-03-001] — tickets.next MCP Tool Security Risks (2026-03-07T08:15:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-INFO-001 | Medium | `SELECT *` returns all ticket columns including internal operational fields (claimed_by, machine_id, operator, lease_expiry, history) to any MCP caller (CWE-200) | Risk Accepted | Ticket data is non-sensitive operational metadata; full ticket visibility is by design for MCP agents; column restriction to be added with field-level access control in TASK-FOS-04 |
| SEC-INFO-002 | Low | Database error message forwarded to client in response payload via `Query error: ${errorMessage}` — may leak table/column/constraint names (CWE-209) | Risk Accepted | Development phase; production hardening will sanitize error messages to generic text; detailed errors logged server-side only |
| SEC-AUTHZ-001 | Low | No per-tool authorization check — any authenticated MCP client can query any stage (CWE-862) | Risk Accepted | Auth is separate ticket (TASK-FOS-04); MCP transport provides auth boundary; tool is read-only peek with no state mutation |