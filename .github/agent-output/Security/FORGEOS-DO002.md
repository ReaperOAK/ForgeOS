# Security Review — FORGEOS-DO002: Configure PostgreSQL Container with Init Scripts

**Ticket:** FORGEOS-DO002
**Type:** infra
**Reviewer:** Security Engineer
**Date:** 2026-03-07T16:10:00Z
**Verdict:** PASS (with conditions)
**Confidence:** HIGH (92%)

---

## 1. Scope

Files reviewed (read-only analysis):

| File | Purpose |
|------|---------|
| `infra/docker/postgres/Dockerfile` | Custom PostgreSQL 17 Alpine image with init scripts and healthcheck |
| `infra/docker/postgres/init.sql` | Database initialization: extensions, application role, permissions |
| `infra/docker/postgres/pg-healthcheck.sh` | Container healthcheck: connectivity + query verification |

Supporting context reviewed (out-of-scope, read-only):
- `infra/docker-compose.yml` — secret mounting, environment configuration
- `infra/docker-compose.dev.yml` — development overrides
- `forgeos-server/secrets/db_password` — Docker secret placeholder

---

## 2. STRIDE Threat Model

### Trust Boundaries Identified

```
┌──────────────────────────────────────────────────┐
│ HOST OS                                          │
│  ┌──────────────────────────────────────────────┐│
│  │ Docker Bridge Network (forgeos-net)          ││
│  │  ┌──────────────────────────────────┐        ││
│  │  │ Container: forgeos-postgres      │        ││
│  │  │  ┌───────────────────────┐       │        ││
│  │  │  │ PostgreSQL 17         │◄─[B1]─┤◄─[B2]─┤│
│  │  │  │  ┌────────────────┐   │       │        ││
│  │  │  │  │ forgeos DB     │   │       │        ││
│  │  │  │  │ (init.sql)     │   │       │        ││
│  │  │  │  └────────────────┘   │       │        ││
│  │  │  └───────────────────────┘       │        ││
│  │  │  healthcheck.sh ─────[B3]────►PG │        ││
│  │  └──────────────────────────────────┘        ││
│  └──────────────────────────────────────────────┘│
└──────────────────────────────────────────────────┘

B1 = Container ↔ PostgreSQL (local socket/TCP)
B2 = Docker network ↔ Container (TCP 5432)
B3 = Healthcheck ↔ PostgreSQL (local pg_isready + psql)
```

### STRIDE Analysis per Boundary

| Threat | Boundary | Description | Impact | Likelihood | Score | Severity |
|--------|----------|-------------|--------|------------|-------|----------|
| **Spoofing** | B2 | Attacker on Docker network connects as forgeos_user with default password | 3 | 3 | 9 | LOW |
| **Spoofing** | B1 | Init script creates role with predictable default password | 3 | 3 | 9 | LOW |
| **Tampering** | B1 | Init script has read-only perms (444), cannot be modified at runtime | 2 | 1 | 2 | LOW |
| **Tampering** | B3 | Healthcheck is read+execute (555), no write operations | 2 | 1 | 2 | LOW |
| **Repudiation** | B1 | Slow query logging enabled (500ms threshold), log_line_prefix includes user/db | 2 | 2 | 4 | LOW |
| **Info Disclosure** | B1 | Default password visible in init.sql source code | 3 | 3 | 9 | LOW |
| **Info Disclosure** | B3 | Healthcheck error messages go to stdout (standard Docker pattern) | 2 | 2 | 4 | LOW |
| **DoS** | B2 | max_connections=50, connection_limit=40 on app role, statement_timeout=30s | 2 | 2 | 4 | LOW |
| **EoP** | B1 | forgeos_user: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT — least privilege | 2 | 1 | 2 | LOW |

**STRIDE Summary:** All threats score LOW (<10). No Critical (≥20) or High (≥15) findings.

---

## 3. OWASP Top 10 Compliance

| # | Category | Status | Notes |
|---|----------|--------|-------|
| A01 | Broken Access Control | ✅ PASS | forgeos_user has least-privilege (CRUD only), NOSUPERUSER/NOCREATEDB/NOCREATEROLE, connection limit 40/50 |
| A02 | Cryptographic Failures | ✅ N/A | No cryptographic operations in container init scripts; PostgreSQL wire protocol is local-only within container |
| A03 | Injection | ✅ PASS | init.sql contains only static DDL/DML — no user-supplied input, no dynamic SQL, IF NOT EXISTS guards |
| A04 | Insecure Design | ✅ PASS | Defense-in-depth: read-only init scripts, one-time execution on empty volume, dual healthcheck (connectivity + query) |
| A05 | Security Misconfiguration | ⚠️ MEDIUM | Default password `changeme_db_password` in init.sql (CWE-1393). Alpine base (minimal), non-root user, read-only scripts mitigate other misconfig risks |
| A06 | Vulnerable Components | ✅ PASS | postgres:17-alpine is official Docker Hub image, no additional packages installed. Recommend digest pinning for production |
| A07 | Auth Failures | ⚠️ MEDIUM | Predictable default password for forgeos_user. Mitigated by Docker network isolation and dev-only intent. Comment in code notes production should use Vault |
| A08 | Data Integrity | ✅ PASS | IF NOT EXISTS idempotency guards, volume-based persistence, immutable init scripts |
| A09 | Logging Failures | ✅ PASS | log_min_duration_statement=500ms, log_line_prefix with timestamp/PID/user/db, RAISE NOTICE for init verification |
| A10 | SSRF | ✅ N/A | No outbound connections from init scripts or healthcheck |

---

## 4. LLM Top 10

**N/A** — No AI/ML features in PostgreSQL container configuration.

---

## 5. Container Security Best Practices

| Check | Status | Details |
|-------|--------|---------|
| Minimal base image | ✅ | `postgres:17-alpine` — Alpine Linux, minimal attack surface |
| Non-root runtime | ✅ | `USER postgres` — inherits from base image, confirmed in Dockerfile |
| Read-only init scripts | ✅ | `chmod 444` on init.sql — immutable at runtime |
| Healthcheck defined | ✅ | `HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s` |
| Explicit port declaration | ✅ | `EXPOSE 5432` — documentation-only, not auto-publish |
| Named volume | ✅ | `VOLUME ["/var/lib/postgresql/data"]` — data persistence |
| OCI labels | ✅ | Maintainer, title, description, version, source labels present |
| No unnecessary packages | ✅ | No `RUN apk add` — only base image packages |
| No secrets in image layers | ⚠️ | Default password in init.sql is baked into image layer (MEDIUM) |
| Image tag pinning | ℹ️ | Tag `17-alpine` used; recommend `postgres:17-alpine@sha256:...` for production |

---

## 6. Secret Scanning

| File | Line | Pattern | Severity | CWE |
|------|------|---------|----------|-----|
| `init.sql` | 58 | `PASSWORD 'changeme_db_password'` | MEDIUM | CWE-1393 |

**Context:** The superuser password is properly handled via Docker secrets (`POSTGRES_PASSWORD_FILE: /run/secrets/db_password` in docker-compose.yml). The application role password in init.sql is hardcoded because PostgreSQL `CREATE ROLE` statements don't support environment variable substitution natively. The comment at line 44–45 documents the intent to use a separate secret or Vault in production.

**Pre-existing:** This pattern was already documented in the FORGEOS-DO001 security review as SEC-DO001-001 (Risk Accepted).

---

## 7. Shell Script Analysis (pg-healthcheck.sh)

| Check | Status | Details |
|-------|--------|---------|
| shellcheck | ✅ PASS | Zero warnings, zero errors |
| `set -e` | ✅ | Enables strict error handling — script exits on first failure |
| POSIX shell | ✅ | Uses `#!/bin/sh` — compatible with Alpine's BusyBox ash |
| No hardcoded credentials | ✅ | Uses `${POSTGRES_USER:-forgeos}` and `${POSTGRES_DB:-forgeos}` env var defaults |
| No write operations | ✅ | Read-only: `pg_isready` + `SELECT 1` |
| Error output | ✅ | Clear UNHEALTHY messages with context for debugging |
| Exit codes | ✅ | 0=healthy, 1=unhealthy — standard Docker healthcheck convention |
| Permissions | ✅ | `chmod 555` — read+execute for all, no write |

---

## 8. Database Security Configuration Review

### Positive Controls

| Control | Value | Assessment |
|---------|-------|------------|
| `max_connections` | 50 | Prevents connection exhaustion |
| `connection limit` (forgeos_user) | 40 | Reserves 10 slots for admin/monitoring |
| `statement_timeout` | 30s | Prevents runaway queries |
| `lock_timeout` | 10s | Prevents indefinite lock waits |
| `idle_in_transaction_session_timeout` | 300s | Cleans up idle transactions |
| `wal_level` | replica | Enables point-in-time recovery capability |
| `timezone` | UTC | Consistent timestamp handling |
| `NOINHERIT` on forgeos_user | Set | Prevents privilege inheritance from granted roles |

### Permission Model

```
forgeos (superuser) — owns database, runs init, manages schema
  └── forgeos_user (application role)
        ├── NOSUPERUSER
        ├── NOCREATEDB
        ├── NOCREATEROLE
        ├── NOINHERIT
        ├── CONNECTION LIMIT 40
        ├── GRANT: SELECT, INSERT, UPDATE, DELETE on public tables
        ├── GRANT: USAGE, SELECT on public sequences
        └── DEFAULT PRIVILEGES: auto-grant on future objects
```

No TRUNCATE, DROP, ALTER, or CREATE privileges granted — proper least-privilege implementation.

---

## 9. SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS Security Engineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-DO002-001",
              "name": "HardcodedDefaultPassword",
              "shortDescription": {
                "text": "Default password hardcoded in SQL init script"
              },
              "helpUri": "https://cwe.mitre.org/data/definitions/1393.html",
              "properties": {
                "tags": ["security", "CWE-1393", "OWASP-A05", "OWASP-A07"]
              }
            },
            {
              "id": "SEC-DO002-002",
              "name": "PasswordInImageLayer",
              "shortDescription": {
                "text": "Application role password baked into Docker image layer via COPY"
              },
              "helpUri": "https://cwe.mitre.org/data/definitions/798.html",
              "properties": {
                "tags": ["security", "CWE-798", "container-security"]
              }
            },
            {
              "id": "SEC-DO002-003",
              "name": "ImageTagNotPinned",
              "shortDescription": {
                "text": "Base image uses mutable tag instead of content-addressable digest"
              },
              "helpUri": "https://cwe.mitre.org/data/definitions/829.html",
              "properties": {
                "tags": ["security", "CWE-829", "supply-chain"]
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-DO002-001",
          "level": "warning",
          "message": {
            "text": "init.sql creates forgeos_user with hardcoded password 'changeme_db_password'. PostgreSQL CREATE ROLE does not support env var substitution natively, but the password can be injected via a Docker entrypoint wrapper script or psql variable. Production deployments must override this."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "infra/docker/postgres/init.sql"
                },
                "region": {
                  "startLine": 58
                }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Replace hardcoded password with environment variable injection: 1) Mount a separate Docker secret for the app role password, 2) Use a shell wrapper in entrypoint to substitute $FORGEOS_USER_PASSWORD into the CREATE ROLE statement, or 3) Use psql variable substitution: psql -v app_password=\"$FORGEOS_USER_PASSWORD\" -f init.sql"
              }
            }
          ]
        },
        {
          "ruleId": "SEC-DO002-002",
          "level": "warning",
          "message": {
            "text": "init.sql containing the default password is COPY'd into the image at build time (layer: /docker-entrypoint-initdb.d/00_init.sql). The password is permanently visible in the image layer history. Mitigated by Docker network isolation and dev-only deployment."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "infra/docker/postgres/Dockerfile"
                },
                "region": {
                  "startLine": 46
                }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-DO002-003",
          "level": "note",
          "message": {
            "text": "Base image 'postgres:17-alpine' uses a mutable tag. A compromised or updated tag could introduce vulnerabilities. For production, pin to a specific digest: postgres:17-alpine@sha256:<digest>."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "infra/docker/postgres/Dockerfile"
                },
                "region": {
                  "startLine": 23
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

## 10. SBOM Summary

| Category | Count |
|----------|-------|
| Base image | 1 (`postgres:17-alpine`) |
| Added packages | 0 |
| Init scripts | 1 (`init.sql`) |
| Health scripts | 1 (`pg-healthcheck.sh`) |
| PostgreSQL extensions | 2 (`uuid-ossp`, `pgcrypto`) |
| Critical CVEs | 0 |
| High CVEs | 0 |

No additional dependencies beyond the official PostgreSQL Alpine image. Extension `pgcrypto` and `uuid-ossp` are bundled with PostgreSQL — no external supply chain risk.

---

## 11. Findings Summary

| ID | Severity | CWE | File | Description | Status |
|----|----------|-----|------|-------------|--------|
| SEC-DO002-001 | MEDIUM | CWE-1393 | init.sql:58 | Hardcoded default password `changeme_db_password` for forgeos_user | Risk Accepted |
| SEC-DO002-002 | MEDIUM | CWE-798 | Dockerfile:46 | Password baked into image layer via COPY of init.sql | Risk Accepted |
| SEC-DO002-003 | LOW | CWE-829 | Dockerfile:23 | Base image tag not pinned to digest | Risk Accepted |

### Risk Acceptance Justification

**SEC-DO002-001 / SEC-DO002-002:** The hardcoded password is a development placeholder consistent with the Docker secret pattern already in use for the superuser password (`POSTGRES_PASSWORD_FILE`). The init.sql comment at line 44-45 explicitly documents: *"In production, use a separate secret or Vault integration."* PostgreSQL's `CREATE ROLE` DDL does not support native environment variable substitution, making this a common pattern for dev container init scripts. The Docker bridge network provides isolation, and the `CONNECTION LIMIT 40` + `NOSUPERUSER` constraints limit blast radius. This pattern was previously documented and accepted in the FORGEOS-DO001 security review (SEC-DO001-001). **Recommended fix for production:** Use an entrypoint wrapper script that injects the password from a Docker secret via `psql -v` variable substitution.

**SEC-DO002-003:** Official Docker Hub image with Alpine minimal surface. Mutable tag is standard for development. **Recommended fix for production:** Pin to specific digest.

---

## 12. Verdict

**PASS** — Zero critical or high findings. Two medium findings documented with risk acceptance and production remediation guidance. One low finding documented.

| Metric | Value |
|--------|-------|
| Critical findings | 0 |
| High findings | 0 |
| Medium findings | 2 (risk accepted) |
| Low findings | 1 (risk accepted) |
| STRIDE max score | 9 (LOW) |
| OWASP categories checked | 10/10 |
| LLM Top 10 | N/A (no AI features) |
| shellcheck | PASS (0 warnings) |
| Confidence | HIGH (92%) |

**Advance ticket to CI stage.**

---

## 13. Recommendations for Production Hardening

1. **Inject app role password via Docker secret:** Create a wrapper entrypoint script that reads the password from a mounted secret and passes it to `CREATE ROLE` via `psql -v`.
2. **Pin base image to digest:** `postgres:17-alpine@sha256:<digest>` for supply-chain integrity.
3. **Add `.gitignore` entry for `secrets/`** to prevent accidental commit of real credentials (tracked as SEC-DO001-001).
4. **Enable TLS** for PostgreSQL connections when deploying outside Docker bridge network.
5. **Add `log_connections=on` and `log_disconnections=on`** to base config (currently only in dev overlay).
