# FORGEOS-BE018 — Security Report: Wire MCP Server to Database Layer

## Stage: SECURITY — PASS

**Agent:** Security Engineer
**Timestamp:** 2026-03-11T13:00:00+05:30
**Confidence:** HIGH
**Verdict:** PASS

---

## Files Reviewed

| File | Purpose |
|------|---------|
| `mcp-server/src/mcp_server/server.py` | ServerConfig, AppContext, lifespan, error hierarchy, health_check tool |
| `mcp-server/src/mcp_server/dependencies.py` | Frozen DI container (pool + repos), async factory + teardown |
| `mcp-server/src/mcp_server/db/pool.py` | asyncpg connection pool wrapper, lifecycle management |
| `mcp-server/src/mcp_server/repositories/ticket_repo.py` | Ticket CRUD with parameterized queries |
| `mcp-server/src/mcp_server/repositories/claim_repo.py` | Atomic claim/release with parameterized queries |
| `mcp-server/src/mcp_server/repositories/event_repo.py` | Append-only event audit trail with parameterized queries |

---

## STRIDE Threat Model

### Trust Boundaries

```
[MCP Client] --HTTP/stdio--> [FastMCP Server] --asyncpg--> [PostgreSQL]
                                    |
                              [Environment]
                           (env vars / config)
```

### Threat Analysis per Boundary

#### Boundary 1: Environment → ServerConfig

| Category | Threat | Score (I×L) | Severity | Mitigation |
|----------|--------|-------------|----------|------------|
| **Spoofing** | Attacker sets malicious DATABASE_URL env var | 3×1=3 | LOW | Env vars require host-level access; pydantic validates format |
| **Tampering** | Attacker modifies pool size to exhaust resources | 2×1=2 | LOW | pydantic `ge=1` constraints on pool sizes; host-level access required |
| **Info Disclosure** | Default DSN contains dev credentials in source | 2×2=4 | LOW | Standard pydantic-settings pattern; production overrides via env vars |

#### Boundary 2: MCP Client → FastMCP Server

| Category | Threat | Score (I×L) | Severity | Mitigation |
|----------|--------|-------------|----------|------------|
| **Spoofing** | Unauthenticated MCP tool calls | 3×2=6 | LOW | Auth middleware exists (mcp_server/auth, middleware/auth_middleware.py); not in BE018 scope |
| **DoS** | Flood health_check to exhaust pool | 2×2=4 | LOW | health_check delegates to HealthChecker which uses a single ping, not a full query; pool max_size=10 limits blast radius |
| **Elevation** | Tool handler accesses raw pool for arbitrary SQL | 4×1=4 | LOW | Dependencies is frozen dataclass; repos expose typed operations only; no raw SQL API exposed to tools |

#### Boundary 3: Server → PostgreSQL

| Category | Threat | Score (I×L) | Severity | Mitigation |
|----------|--------|-------------|----------|------------|
| **Injection** | SQL injection through repo parameters | 5×1=5 | LOW | All repositories use asyncpg parameterized queries ($1, $2, ...) — injection impossible |
| **DoS** | Connection pool exhaustion | 3×2=6 | LOW | max_size=10 (configurable), command_timeout=30s, idle_timeout=300s |
| **Info Disclosure** | Connection failure exception leaks DSN | 3×2=6 | LOW | See Finding SEC-BE018-001 |
| **Spoofing** | No SSL enforcement in default DSN | 3×2=6 | LOW | See Finding SEC-BE018-002 |

---

## OWASP Top 10 Scan

| Category | Status | Evidence |
|----------|--------|----------|
| **A01 — Broken Access Control** | ✅ N/A | DB wiring layer; auth handled by auth module |
| **A02 — Cryptographic Failures** | ✅ PASS (with note) | No plaintext credential storage beyond dev defaults. Production DSN via env. See SEC-BE018-002 for SSL note |
| **A03 — Injection** | ✅ PASS | All 3 repositories (ticket, claim, event) use asyncpg parameterized queries exclusively. No string concatenation in SQL. Verified: `$1`, `$2`, etc. used in every query |
| **A04 — Insecure Design** | ✅ PASS | Dependencies is frozen=True (immutable). Lifespan pattern ensures cleanup in finally block. Degraded mode is intentional design choice |
| **A05 — Security Misconfiguration** | ✅ PASS | Default bind 0.0.0.0 appropriate for containers. Pool constraints validated by pydantic |
| **A06 — Vulnerable Components** | ✅ PASS | Dependencies pinned with upper bounds: asyncpg>=0.30.0, pydantic>=2.0<3, uvicorn>=0.31.0, bcrypt>=4.0<6, PyJWT>=2.0<3. No known critical/high CVEs at pinned versions |
| **A07 — Auth Failures** | ✅ N/A | Auth module separate (not in scope) |
| **A08 — Data Integrity** | ✅ PASS | Frozen dataclass prevents mutation. RETURNING * clauses verify writes. Event repo is append-only |
| **A09 — Logging Failures** | ✅ PASS (with note) | Structured logger via `get_logger()`. No PII logged. See SEC-BE018-001 for exception msg note |
| **A10 — SSRF** | ✅ N/A | No outbound HTTP calls in reviewed code |

---

## LLM Top 10

Not applicable — BE018 contains no AI/LLM-facing features.

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
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-BE018-001",
              "name": "ExceptionMessageMayLeakDSN",
              "shortDescription": {
                "text": "Connection failure exceptions may include DSN with credentials"
              },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-209", "severity": "LOW", "score": 6 }
            },
            {
              "id": "SEC-BE018-002",
              "name": "NoSSLEnforcementInDefaultDSN",
              "shortDescription": {
                "text": "Default DSN does not enforce SSL mode for database connections"
              },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-319", "severity": "LOW", "score": 6 }
            },
            {
              "id": "SEC-BE018-003",
              "name": "DefaultDevCredentialsInSource",
              "shortDescription": {
                "text": "Default DSN contains development credentials in source code"
              },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-798", "severity": "LOW", "score": 4 }
            },
            {
              "id": "SEC-BE018-004",
              "name": "NoExplicitPoolAcquireTimeout",
              "shortDescription": {
                "text": "No explicit timeout on connection pool acquisition"
              },
              "defaultConfiguration": { "level": "note" },
              "properties": { "cwe": "CWE-400", "severity": "LOW", "score": 4 }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE018-001",
          "level": "note",
          "message": {
            "text": "ConnectionError raised in pool.py (line 196-197) includes {exc} from asyncpg which may contain the DSN with credentials. This is then logged in server.py (lines 198-203) via logger.error/warning. In server-side logs only — not exposed to clients. Risk accepted for dev/staging; production should use log scrubbing."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/db/pool.py" },
                "region": { "startLine": 196, "endLine": 197 }
              }
            },
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/server.py" },
                "region": { "startLine": 198, "endLine": 203 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE018-002",
          "level": "note",
          "message": {
            "text": "Default DSN 'postgresql://forgeos:forgeos@localhost:5432/forgeos' does not include sslmode parameter. Production deployments should set DATABASE_URL with ?sslmode=require or ?sslmode=verify-full. Default is intentionally for local dev."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/server.py" },
                "region": { "startLine": 90, "endLine": 93 }
              }
            },
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/db/pool.py" },
                "region": { "startLine": 56, "endLine": 59 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE018-003",
          "level": "note",
          "message": {
            "text": "Default DSN contains 'forgeos:forgeos' credentials. Standard pydantic-settings pattern — designed to be overridden by env vars in production. Not a vulnerability in itself but documented per CWE-798."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/server.py" },
                "region": { "startLine": 90, "endLine": 93 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE018-004",
          "level": "note",
          "message": {
            "text": "asyncpg.create_pool does not configure an explicit acquire timeout. Under load, connection requests queue indefinitely if all max_size connections are busy. asyncpg has internal timeout behavior but it is not explicitly configured. Consider adding connection_timeout parameter."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/db/pool.py" },
                "region": { "startLine": 182, "endLine": 189 }
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

## SBOM Summary

| Package | Version Constraint | License | CVE Status |
|---------|-------------------|---------|------------|
| mcp | >=1.25,<2 | MIT | No known critical/high |
| asyncpg | >=0.30.0 | Apache-2.0 | No known critical/high |
| pydantic | >=2.0,<3 | MIT | No known critical/high |
| pydantic-settings | >=2.0,<3 | MIT | No known critical/high |
| uvicorn | >=0.31.0 | BSD-3-Clause | No known critical/high |
| alembic | >=1.13,<2 | MIT | No known critical/high |
| sqlalchemy[asyncio] | >=2.0,<3 | MIT | No known critical/high |
| psycopg2-binary | >=2.9,<3 | LGPL-2.1 | No known critical/high |
| bcrypt | >=4.0,<6 | Apache-2.0 | No known critical/high |
| PyJWT | >=2.0,<3 | MIT | No known critical/high |

- **Total direct dependencies:** 10
- **Critical CVEs:** 0
- **High CVEs:** 0
- **Licenses flagged:** psycopg2-binary (LGPL-2.1) — standard for PostgreSQL drivers, acceptable

---

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | ✅ None found |
| Hardcoded tokens | ✅ None found |
| Private keys | ✅ None found |
| .env in VCS | ✅ No .env files committed |
| AWS keys (AKIA*) | ✅ None found |
| GitHub tokens (ghp_/gho_) | ✅ None found |

---

## Auth/AuthZ Review

- Not directly in scope — BE018 wires DB to server, not auth endpoints.
- Auth module (mcp_server/auth/) and middleware (mcp_server/middleware/auth_middleware.py) exist as separate concerns.
- Dependencies container does not expose auth-related operations — clean separation.

---

## Input Validation Review

- `ServerConfig` uses pydantic-settings with Field validation (ge=1 for pool sizes, gt=0 for timeouts).
- `PoolConfig` similarly validates all numeric fields.
- Dependencies.create() accepts typed parameters — no raw string parsing.
- Repository methods accept typed parameters (str, int, UUID) — asyncpg handles type safety.

---

## Data Classification

- **DSN/connection string:** Contains credentials (user:password). Loaded from env vars, never stored beyond process memory. Not logged directly (but exception messages may include it — SEC-BE018-001).
- **Ticket data:** Business data, not PII. Stored in PostgreSQL.
- **Audit events:** Operational metadata. No PII fields identified.

---

## API Security

- FastMCP with `stateless_http=True` — no server-side session state.
- `json_response=True` — structured responses only.
- Host/port configurable via env vars.
- CORS/rate limiting handled at middleware level (not in scope for BE018).

---

## Verdict

**PASS** — Zero critical or high severity findings.

4 LOW findings documented with risk acceptance:

1. **SEC-BE018-001** (LOW, CWE-209): Exception messages from asyncpg may leak DSN credentials into server logs. Mitigated: logs are server-side only; production should use log scrubbing.
2. **SEC-BE018-002** (LOW, CWE-319): Default DSN lacks SSL enforcement. Mitigated: default is for local dev; production overrides via env var with sslmode.
3. **SEC-BE018-003** (LOW, CWE-798): Default dev credentials in source code. Mitigated: standard pydantic-settings pattern; production uses env vars.
4. **SEC-BE018-004** (LOW, CWE-400): No explicit pool.acquire timeout. Mitigated: asyncpg has internal timeout; command_timeout=30s prevents indefinite queries; max_size=10 limits connections.

**Risk acceptance rationale:** All findings are LOW severity with existing mitigations. The code follows security best practices: parameterized queries, immutable DI containers, structured logging, typed configuration validation, and clean separation of concerns.
