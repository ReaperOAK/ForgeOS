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

### [FORGEOS-DO001] — Docker Compose Local Dev Security Risks (2026-03-07T14:02:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-DO001-001 | Medium | Secrets placeholder file `forgeos-server/secrets/db_password` tracked in git with value `changeme_db_password`; secrets/ dir not in .gitignore (CWE-798) | Risk Accepted | Placeholder only with warning comments; recommend adding secrets/ to .gitignore in production hardening |
| SEC-DO001-002 | Medium | Node.js debugger port 9229 exposed to 0.0.0.0 in dev overlay — allows remote code execution from LAN (CWE-489) | Risk Accepted | Dev overlay only, never in base config; recommend binding to 127.0.0.1:9229:9229 |
| SEC-DO001-003 | Low | pgAdmin default credentials admin@forgeos.local / admin (CWE-1393) | Risk Accepted | Env var overrides available (PGADMIN_EMAIL, PGADMIN_PASSWORD); local dev only |
| SEC-DO001-004 | Low | DATABASE_URL missing password parameter — relies on Docker internal trust auth (CWE-287) | Risk Accepted | Docker bridge network isolation; production must include password in connection string |
| SEC-DO001-005 | Low | Hardcoded API key `forgeos_dev_key_12345678` in dev overlay (CWE-798) | Risk Accepted | Dev-only file; base config uses env var with fallback |

### [TASK-FOS-02-003] — Middleware Stack Security Risks (2026-03-07T09:16:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-001 | Medium | `withErrorHandling()` in error-handler.ts returns raw `err.message` to MCP clients regardless of NODE_ENV. PG errors could leak schema/table/constraint names via MCP transport (CWE-209). | Risk Accepted | MCP is a machine-to-machine protocol used by authenticated AI agents. Auth enforcement (TASK-FOS-04) will restrict MCP access. Recommend applying `isProduction` guard in future hardening pass. |
| SEC-002 | Low | No length/format validation on `X-Request-ID` header. Accepts any non-empty string (CWE-20). | Risk Accepted | Node.js HTTP parser limits total headers to ~16KB. ID used for log correlation only, never for authorization. Industry standard practice. |
| SEC-003 | Low | Validation middleware does not log validation failures server-side (CWE-778). | Risk Accepted | 400 status code is captured by request-level logging middleware. Validation failures are expected in normal operation. |
| SEC-DO001-006 | Low | All service ports (5432, 3000, 5050) bind to 0.0.0.0 — accessible from LAN (CWE-668) | Risk Accepted | Standard local dev pattern; production should bind to 127.0.0.1 or use reverse proxy |

### [FORGEOS-DO002] — PostgreSQL Container Init Script Security Risks (2026-03-07T16:10:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-DO002-001 | Medium | Hardcoded default password `changeme_db_password` in init.sql CREATE ROLE statement (CWE-1393) | Risk Accepted | Dev placeholder; PostgreSQL DDL lacks native env var substitution; comment documents Vault/secret for production; consistent with SEC-DO001-001 pattern |
| SEC-DO002-002 | Medium | Password baked into Docker image layer via COPY of init.sql to /docker-entrypoint-initdb.d/ (CWE-798) | Risk Accepted | Docker network isolation; init runs once on empty volume; production should use entrypoint wrapper with psql -v variable substitution |
| SEC-DO002-003 | Low | Base image `postgres:17-alpine` uses mutable tag, not pinned to digest (CWE-829) | Risk Accepted | Official Docker Hub image; Alpine minimal surface; pin to digest in production hardening phase |

### [TASK-FOS-05-002] — SSE Endpoint Security Risks (2026-03-07T21:30:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-SSE-001 | Medium | SSE endpoint (`GET /api/events`) broadcasts all ticket data (titles, stages, assignments) to unauthenticated clients. No optional auth or data filtering implemented (CWE-200, OWASP A01). | Risk Accepted | Internal dashboard endpoint. Ticket metadata considered non-sensitive operational data. Recommend adding optional auth filtering before external exposure. |
| SEC-SSE-002 | High→Medium | `sseClients` Set has no maximum size limit. Unbounded connections can exhaust file descriptors, memory, and event loop via timer accumulation (CWE-400, OWASP A04). | Risk Accepted (Internal) | Currently internal-only deployment limits practical likelihood. **MUST be addressed before any external exposure.** Recommend MAX_SSE_CLIENTS=100 cap + per-IP limit. |
| SEC-SSE-003 | Medium | `RATE_LIMIT_PER_MINUTE=100` configured but no rate-limiting middleware installed or applied. Authenticated agents can flood REST endpoints (CWE-770). | Risk Accepted | Auth requirement limits abuse surface. Recommend installing `express-rate-limit` in follow-up ticket. |
| SEC-SSE-004 | Low | Duplicate SSE implementations in `server.ts` (legacy) and `api/routes/events.ts` (new). Two separate `sseClients` Sets and two PG LISTEN clients create maintenance confusion and doubled resource usage (CWE-1127). | Open | Recommend consolidation in cleanup ticket. |

### [FORGEOS-DO004] — Environment Configuration Security Risks (2026-03-07T18:22:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-DO004-001 | Medium | Project `.gitignore` does not exclude `.env` files. Real `.env` files with secrets could be committed to VCS history (CWE-200, CWE-540). | Risk Accepted | `.env.template` includes explicit warning "Never commit .env files containing real secrets." Recommend adding `.env` exclusion to `.gitignore` in follow-up. |
| SEC-DO004-002 | Medium | `DATABASE_URL` template line contains placeholder password `changeme`: `postgresql://forgeos:changeme@localhost:5432/forgeos` (CWE-798). `DB_PASSWORD` field is correctly empty. | Risk Accepted | Template file only; `settings.py` composes URL from parts when `DATABASE_URL` not set. Recommend removing password from template URL. |
| SEC-DO004-003 | Medium | No production validation requiring `DB_SSL_MODE` ≠ `disable`. Database connections in production should use SSL (CWE-319). | Risk Accepted | Default is `disable` for local dev. Recommend adding production guard in `settings.py`. |

### [TASK-FOS-06-004] — Webhook State Recovery Security Risks (2026-03-07T22:45:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-06004-001 | Low | No webhook-specific rate limiting on `POST /api/webhooks/github`. Global 100/min limit may drop legitimate GitHub webhook bursts during high-activity periods (CWE-770). | Risk Accepted | Operational concern, not a vulnerability. GitHub retries failed webhooks. Recommend dedicated webhook rate limit in future ticket. |
| SEC-06004-002 | Low | `WEBHOOK_SECRET` optional in non-production config (CWE-1188). Router factory `WebhookRouterConfig` requires non-optional `string`, so startup fails without it. Production guard via Zod `superRefine`. | Risk Accepted | Design-by-contract — type system prevents mounting without secret. |

### [FORGEOS-BE001] — Alembic Migration Framework Security Risks (2026-03-10T00:20:59+05:30)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-BE001-001 | Medium | Default fallback `DATABASE_URL` in `alembic/env.py:60` and `db/connection.py:45` contains hardcoded credentials `postgresql://forgeos:forgeos@localhost:5432/forgeos` (CWE-798). If `DATABASE_URL` env var is unset, the fallback exposes dev credentials in production. | Risk Accepted | Dev-only fallback. Production deployment must set `DATABASE_URL` env var. Recommend removing fallback and raising error if env var missing. |
| SEC-BE001-002 | Low | `migration_helpers.py` uses f-string SQL construction in `create_enum_type()`, `drop_enum_type()`, `create_updated_at_trigger()`, `drop_updated_at_trigger()` (CWE-89). Only called with hardcoded `ENUM_DEFINITIONS` values — no user input reaches these paths. | Risk Accepted | Internal DDL helpers only. Values come from hardcoded dictionary. No injection vector present. Recommend parameterized DDL if helpers become public API. |
| SEC-BE001-003 | Low | No SSL enforcement in database connection config. `DatabaseConfig` in `connection.py` defaults `db_ssl_mode` to empty string. Production PostgreSQL connections should require `sslmode=require` or `verify-full` (CWE-319). | Risk Accepted | Local dev configuration. Recommend adding SSL enforcement guard for production environments. |
| SEC-BE001-004 | Low | Project `.gitignore` does not exclude `.env` files. If `.env` files with real `DATABASE_URL` credentials are created, they could be committed to version control (CWE-200). | Risk Accepted | No `.env` files exist in repo currently. Recommend adding `.env` exclusion to `.gitignore`. |

### [FORGEOS-DO006] — Database Migration CI Security Risks (2026-03-10T12:00:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-DO006-001 | Medium | `actions/checkout@v4` and `actions/setup-python@v5` pinned by major version tag, not commit SHA (CWE-829). Tag-based pinning allows potential supply chain attacks via tag mutation. | Risk Accepted | First-party GitHub-maintained actions with strong provenance and signed releases. SHA pinning recommended as defense-in-depth for future hardening. |
| SEC-DO006-002 | Low | Schema object names (7 tables, 5 enums, 20 indexes, 3 triggers, 1 function) logged in `GITHUB_STEP_SUMMARY` (CWE-200). Reveals internal database design to repository readers. | Risk Accepted | Intentional CI transparency. Ephemeral test database only. No production data or credentials exposed. |

### [FORGEOS-BE015] — SEC-001: .env not in .gitignore
- **Severity:** Medium
- **CWE:** CWE-312
- **Component:** Repository root .gitignore
- **Description:** .env files are not excluded from version control. Accidental credential commit risk if developer creates .env with production secrets.
- **Recommended Fix:** Add `.env` and `*.env` patterns to root `.gitignore`
- **Status:** Documented risk acceptance — no .env files currently exist
- **Agent:** Security Engineer
- **Timestamp:** 2026-03-10T08:04:48.122281+00:00

### [FORGEOS-BE003] — Event History Audit Table Risks

| ID | Severity | Description | Status | Rationale |
|-----|----------|-------------|--------|-----------|
| SEC-BE003-001 | Low | event_history.machine_id and stage_transitions.triggered_by are TEXT without FK — spoofing risk at application layer (CWE-290) | Risk Accepted | Application-layer validation expected. TEXT fields appropriate for cross-system identifiers. |
| SEC-BE003-002 | Low | event_history.agent_id uses ON DELETE SET NULL — audit attribution lost on agent deletion (CWE-778) | Risk Accepted | Agent deletion is rare admin action. machine_id provides secondary attribution. |
| SEC-BE003-003 | Low | stage_transitions has no immutability triggers — records modifiable post-insertion (CWE-471) | Risk Accepted | AC4 only requires event_history immutability. Application policy enforces integrity. |
| SEC-BE003-004 | Info | ON DELETE CASCADE on event_history.ticket_id blocked by BEFORE DELETE trigger — emergent defense-in-depth | Documented | Positive behavior. Recommend documenting in architecture docs. |

- **Agent:** Security Engineer
- **Timestamp:** 2026-03-10T23:15:00Z

### [TASK-FOS-03-008] — SEC-001: INTERNAL_ERROR leaks raw DB error messages
- **Severity:** Medium
- **CWE:** CWE-209
- **Component:** forgeos-server/src/tools/tickets-release.ts (line 248)
- **Description:** Catch-all INTERNAL_ERROR handler returns raw PostgreSQL error messages in MCP response. Could expose table/column/constraint names to MCP caller.
- **Recommended Fix:** Return generic message for INTERNAL_ERROR; log detailed error server-side only (already done via logger.error).
- **Status:** Documented risk acceptance — MCP transport is internal (agent-to-server, not user-facing). Known error types already mapped to safe codes.
- **Agent:** Security Engineer
- **Timestamp:** 2026-03-10T17:30:00Z

### [TASK-FOS-03-006] — SEC-AUTHZ-001: MCP Per-Tool Authorization Not Enforced
- **Severity:** Low
- **CWE:** CWE-862
- **Component:** forgeos-server/src/server.ts, forgeos-server/src/middleware/auth.ts
- **Description:** RBAC permission matrix in auth/roles.ts defines tickets.spawn permission for 6 roles but requirePermission middleware is not applied to /mcp Express route. Any authenticated agent can invoke any MCP tool regardless of role.
- **Recommended Fix:** Add per-tool permission checks inside MCP tool handlers or wrap MCP transport with role-based filtering.
- **Status:** Documented risk acceptance — agent registration is admin-controlled, only trusted agents receive tokens.
- **Agent:** Security Engineer
- **Timestamp:** 2026-03-10T14:30:00Z

### [TASK-FOS-03-006] — SEC-DOS-001: No Spawn Depth or Count Limits
- **Severity:** Medium (advisory)
- **CWE:** CWE-770
- **Component:** forgeos-server/src/tools/tickets-spawn.ts, DB schema
- **Description:** No CHECK constraint or application-level limit on nesting depth or number of children per parent. Recursive spawning could create unbounded tree depth or fan-out, exhausting DB resources.
- **Recommended Fix:** Add MAX_SPAWN_DEPTH (e.g., 5) and MAX_CHILDREN_PER_PARENT (e.g., 20) limits. Wire rate-limiting middleware.
- **Status:** Documented risk acceptance — agents are trusted internal actors with admin-provisioned tokens.
- **Agent:** Security Engineer
- **Timestamp:** 2026-03-10T14:30:00Z

### [TASK-FOS-05-004] -- SEC-001 CWE-79 MEDIUM app.js:1366
Inline onclick; escapeHtml misses single quotes. Risk accepted.
### [TASK-FOS-05-004] -- SEC-002 CWE-352 MEDIUM admin.js:211
fetchJSON drops POST options. Advisory.
### [TASK-FOS-05-004] -- SEC-003 CWE-1021 LOW server.ts:86
No CSP/X-Frame-Options. Risk accepted (internal).
### [TASK-FOS-05-004] -- SEC-004 CWE-829 MEDIUM index.html:13
D3.js CDN without SRI. Risk accepted.
- **Agent:** Security | **Timestamp:** 2026-03-10T10:30:00Z
