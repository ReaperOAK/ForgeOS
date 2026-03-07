# [TASK-FOS-08-002] — Security Engineer — Docker Compose with PostgreSQL and Server

## Verdict: PASS

**Confidence: HIGH**
**Timestamp:** 2026-03-07T07:42:00+00:00

Zero critical/high findings. 3 medium and 5 low findings documented with risk acceptance below.

---

## STRIDE Threat Model

### Components & Trust Boundaries

| ID | Boundary | From | To |
|----|----------|------|----|
| TB1 | Host ↔ Docker Engine | Host OS | Container runtime |
| TB2 | External Network ↔ pgbouncer | Host network (0.0.0.0:6432) | pgbouncer container |
| TB3 | pgbouncer ↔ postgres | pgbouncer container | postgres container |
| TB4 | mcp-server ↔ pgbouncer | mcp-server container | pgbouncer container |
| TB5 | Host filesystem ↔ containers | Host volumes | Container mounts |
| TB6 | Docker secrets ↔ containers | Secret files | /run/secrets/ in container |

### STRIDE Analysis Per Boundary

| Boundary | Threat | Category | Impact | Likelihood | Score | Severity |
|----------|--------|----------|--------|------------|-------|----------|
| TB2 | Any host process can connect to pgbouncer on 6432 | Spoofing (S) | 3 | 3 | 9 | MEDIUM |
| TB4 | DATABASE_URL leaks password via env var inspection | Info Disclosure (I) | 3 | 3 | 9 | MEDIUM |
| TB3 | No TLS between pgbouncer and postgres | Info Disclosure (I) | 2 | 2 | 4 | LOW |
| TB4 | No TLS between mcp-server and pgbouncer | Info Disclosure (I) | 2 | 2 | 4 | LOW |
| TB5 | Migrations mounted read-only — tamper-resistant | Tampering (T) | — | — | — | MITIGATED |
| TB5 | Workspace mounted read-only — tamper-resistant | Tampering (T) | — | — | — | MITIGATED |
| TB6 | Docker secrets mounted to /run/secrets/ (tmpfs) | Info Disclosure (I) | — | — | — | MITIGATED |
| TB1 | No resource limits — container can consume all host resources | DoS (D) | 3 | 2 | 6 | LOW |
| TB1 | No `no-new-privileges` security option | Elevation (E) | 2 | 2 | 4 | LOW |
| TB2 | Unpinned pgbouncer `:latest` tag — supply chain risk | Tampering (T) | 4 | 2 | 8 | MEDIUM |
| TB1 | All services restart:unless-stopped — recovery posture | DoS (D) | — | — | — | MITIGATED |
| TB1 | mcp-server runs as USER node (non-root) | Elevation (E) | — | — | — | MITIGATED |

---

## OWASP Top 10 Checklist

| Category | Result | Notes |
|----------|--------|-------|
| A01 Broken Access Control | FINDING | pgbouncer port 6432 exposed to all host interfaces (0.0.0.0). Bind to 127.0.0.1 to restrict. |
| A02 Cryptographic Failures | FINDING | Plaintext password in DATABASE_URL env var. No TLS between services. Acceptable for dev; requires hardening for production. |
| A03 Injection | PASS | Migrations mounted read-only. SQL files from controlled local source. |
| A04 Insecure Design | INFO | Password management inconsistency: postgres/pgbouncer use Docker secrets, mcp-server uses hardcoded env. pgbouncer lacks healthcheck. |
| A05 Security Misconfiguration | FINDING | `edoburu/pgbouncer:latest` unpinned. No resource limits. No read-only root filesystem. No `no-new-privileges` security opt. |
| A06 Vulnerable Components | FINDING | `:latest` tag for pgbouncer — unpinned dependency, supply chain risk. |
| A07 Auth Failures | PASS | Password authentication via pgbouncer. Credentials provided via Docker secrets (postgres, pgbouncer) or env (mcp-server). |
| A08 Data Integrity | PASS | Volumes use named volume with driver. No unsigned image pulls (standard Docker trust). |
| A09 Logging Failures | INFO | No logging driver configured. Defaults to Docker json-file driver. Acceptable for dev. |
| A10 SSRF | N/A | No outbound HTTP from containers in this configuration. |

---

## LLM Top 10

Not applicable — this ticket is infrastructure configuration only. No AI/LLM components are introduced.

---

## SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-SecurityEngineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-FOS08002-01",
              "shortDescription": {"text": "Hardcoded password in DATABASE_URL environment variable"},
              "helpUri": "https://cwe.mitre.org/data/definitions/798.html"
            },
            {
              "id": "SEC-FOS08002-02",
              "shortDescription": {"text": "Unpinned container image tag (pgbouncer:latest)"},
              "helpUri": "https://cwe.mitre.org/data/definitions/1104.html"
            },
            {
              "id": "SEC-FOS08002-03",
              "shortDescription": {"text": "Database proxy port exposed to all host interfaces"},
              "helpUri": "https://cwe.mitre.org/data/definitions/284.html"
            },
            {
              "id": "SEC-FOS08002-04",
              "shortDescription": {"text": "No container resource limits defined"},
              "helpUri": "https://cwe.mitre.org/data/definitions/770.html"
            },
            {
              "id": "SEC-FOS08002-05",
              "shortDescription": {"text": "Password mismatch between DATABASE_URL and secrets file"},
              "helpUri": "https://cwe.mitre.org/data/definitions/521.html"
            },
            {
              "id": "SEC-FOS08002-06",
              "shortDescription": {"text": "No TLS encryption between container services"},
              "helpUri": "https://cwe.mitre.org/data/definitions/319.html"
            },
            {
              "id": "SEC-FOS08002-07",
              "shortDescription": {"text": "Missing container hardening (no-new-privileges, read-only FS)"},
              "helpUri": "https://cwe.mitre.org/data/definitions/250.html"
            },
            {
              "id": "SEC-FOS08002-08",
              "shortDescription": {"text": "pgbouncer service lacks healthcheck"},
              "helpUri": "https://cwe.mitre.org/data/definitions/693.html"
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-FOS08002-01",
          "level": "warning",
          "message": {"text": "DATABASE_URL contains hardcoded password 'forgeos' in plaintext. Docker secrets are used for postgres and pgbouncer but bypassed for mcp-server. Use environment variable interpolation or a secret-backed env file. CWE-798."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 46}}}]
        },
        {
          "ruleId": "SEC-FOS08002-02",
          "level": "warning",
          "message": {"text": "pgbouncer uses 'edoburu/pgbouncer:latest' — mutable tag that could resolve to a different image on rebuild. Pin to a specific version digest for reproducibility and supply chain safety. CWE-1104."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 23}}}]
        },
        {
          "ruleId": "SEC-FOS08002-03",
          "level": "warning",
          "message": {"text": "pgbouncer port 6432 is bound to 0.0.0.0 (all host interfaces). Any process on the host or reachable network can connect. Bind to 127.0.0.1:6432:6432 to restrict to localhost. CWE-284."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 35}}}]
        },
        {
          "ruleId": "SEC-FOS08002-04",
          "level": "note",
          "message": {"text": "No mem_limit, cpus, or deploy.resources constraints on any container. A runaway process could exhaust host resources. Add deploy.resources.limits for production. CWE-770."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 1}}}]
        },
        {
          "ruleId": "SEC-FOS08002-05",
          "level": "note",
          "message": {"text": "DATABASE_URL password is 'forgeos' but secrets/db_password contains 'changeme_db_password'. Values must be synchronized before deployment. CWE-521."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 46}}}]
        },
        {
          "ruleId": "SEC-FOS08002-06",
          "level": "note",
          "message": {"text": "No TLS configured between mcp-server → pgbouncer → postgres. Traffic on Docker internal network is unencrypted. Acceptable for local dev; must be addressed for production deployments. CWE-319."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 1}}}]
        },
        {
          "ruleId": "SEC-FOS08002-07",
          "level": "note",
          "message": {"text": "No security_opt: [no-new-privileges:true] or read_only: true on any container. Add these for defense-in-depth. CWE-250."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 1}}}]
        },
        {
          "ruleId": "SEC-FOS08002-08",
          "level": "note",
          "message": {"text": "pgbouncer has no healthcheck; mcp-server depends on it via service_started (not service_healthy). May cause transient connection failures on startup. CWE-693."},
          "locations": [{"physicalLocation": {"artifactLocation": {"uri": "forgeos-server/docker-compose.yml"}, "region": {"startLine": 22}}}]
        }
      ]
    }
  ]
}
```

---

## SBOM Summary

This ticket introduces no new npm dependencies. The docker-compose.yml references three container images:

| Image | Version | Source | CVE Status |
|-------|---------|--------|------------|
| postgres | 17-alpine | Docker Hub (official) | Pinned to major. Alpine base regularly patched. |
| edoburu/pgbouncer | latest (UNPINNED) | Docker Hub (community) | **Unpinned — supply chain risk.** Pin to specific version. |
| node:22-alpine (Dockerfile) | 22-alpine | Docker Hub (official) | Pinned to major. |

No npm audit applicable — no application code changes in this ticket.

---

## Dependency Audit

No new application dependencies introduced. Container image dependency audit:
- **postgres:17-alpine** — Official image, actively maintained, acceptable.
- **edoburu/pgbouncer:latest** — Community image, unpinned tag. MEDIUM risk. Recommend pinning to a specific tested version.
- **node:22-alpine** (via Dockerfile) — Official image, acceptable.

---

## Secret Scanning Results

| Check | Result | Details |
|-------|--------|---------|
| Hardcoded API keys | PASS | None found |
| Hardcoded tokens | PASS | None found |
| Private keys | PASS | None found |
| Plaintext passwords in config | FINDING | `DATABASE_URL` contains password `forgeos` (SEC-FOS08002-01) |
| `.env` in VCS | PASS | No .env file tracked |
| `secrets/db_password` in VCS | INFO | Tracked but contains placeholder with "DO NOT COMMIT real secrets" warning |
| `.gitignore` coverage | INFO | `secrets/db_password` is git-tracked; recommend adding to `.gitignore` after initial setup |

---

## Auth/AuthZ Review

- postgres authentication via `POSTGRES_PASSWORD_FILE` (Docker secrets) — correct pattern.
- pgbouncer authenticates to postgres via `DB_PASSWORD_FILE` secret — correct pattern.
- mcp-server connects via `DATABASE_URL` with inline password — inconsistent with secrets pattern.
- No additional auth layers (mTLS, client certificates) between services — acceptable for dev.

---

## Positive Security Controls Identified

1. **Docker secrets** used for postgres and pgbouncer password management (tmpfs-backed, not in env).
2. **Read-only mounts** for migrations (`:ro`) and workspace (`:ro`) — prevents container-side tampering.
3. **Healthcheck** on postgres — ensures downstream services wait for readiness.
4. **Non-root user** in Dockerfile (`USER node`) — limits privilege in mcp-server.
5. **Dependency ordering** via `depends_on` with conditions — prevents premature connections.
6. **Named volume** for pgdata — persistent, managed by Docker, not a host bind mount.
7. **restart: unless-stopped** on all services — automatic recovery from crashes.

---

## Risk Acceptance for Medium Findings

| Finding | Risk Acceptance Rationale |
|---------|--------------------------|
| SEC-FOS08002-01 (hardcoded password) | Development/placeholder configuration. Password "forgeos" is a dev default. Production deployment MUST use secret injection. Tracked for follow-up. |
| SEC-FOS08002-02 (unpinned pgbouncer) | Acceptable for initial infrastructure setup. MUST be pinned before production. Tracked for follow-up. |
| SEC-FOS08002-03 (exposed port) | Development convenience for local debugging. Production MUST bind to 127.0.0.1 or remove host exposure. Tracked for follow-up. |

---

## QA Finding Cross-Reference

| QA Finding | Security Assessment |
|------------|---------------------|
| F1: DATABASE_URL password vs secret mismatch | Confirmed as SEC-FOS08002-05 (LOW). Values must be synchronized. |
| F2: Dockerfile missing dashboard dir | Out of scope (pre-existing, different ticket). |
| F3: pgbouncer no healthcheck | Confirmed as SEC-FOS08002-08 (LOW). Startup race condition risk. |

---

## Artifacts

- Security report: `.github/agent-output/Security/TASK-FOS-08-002.md`
- Risk register update: `.github/memory-bank/riskRegister.md` (appended)

## Evidence

- STRIDE threat model: 6 trust boundaries analyzed, 12 threat vectors evaluated
- OWASP Top 10: 10/10 categories checked, 4 findings
- LLM Top 10: N/A (no AI components)
- SBOM: 3 container images audited, 0 npm deps changed
- SARIF: 8 findings (3 MEDIUM, 5 LOW), 0 CRITICAL, 0 HIGH
- Secret scan: 1 finding (hardcoded dev password in env var)
- Verdict: **PASS** — confidence HIGH
