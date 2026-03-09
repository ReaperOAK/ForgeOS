# FORGEOS-DO007 — Security Review

## Verdict: **PASS**

**Confidence:** HIGH

Zero critical or high findings. Three medium findings documented with risk acceptance.
All are mitigated by the operational environment and documented recommendations in the
backup strategy document.

---

## 1. STRIDE Threat Model

### Components & Trust Boundaries

| # | Boundary | From | To |
|---|----------|------|----|
| B1 | Script → PostgreSQL | Shell (host/container) | PostgreSQL server |
| B2 | Script → Docker Engine | Host OS | Docker daemon / container |
| B3 | Script → Filesystem | Process | Backup directory (local disk) |
| B4 | Script → Environment | .env file / exported vars | Process memory |
| B5 | Script → User Input | CLI arguments | Script logic |

### Threat Analysis

| Threat | Category | Component | Impact | Likelihood | Score | Mitigation |
|--------|----------|-----------|--------|------------|-------|------------|
| Tampered backup file accepted as valid | Tampering | B3 | 4 | 2 | 8 (LOW) | SHA-256 checksum in .meta sidecar; pg_restore --list validation |
| Metadata sidecar modified alongside backup | Tampering | B3 | 3 | 2 | 6 (LOW) | .meta not signed — attacker with write access could update both. Mitigated by filesystem permissions |
| Backup data readable by other OS users | Info Disclosure | B3 | 4 | 3 | 12 (MED) | **SEC-DO007-001**: No explicit `umask 077` or `chmod 600` on created files. See Finding 1 |
| Backup contains unencrypted sensitive data | Info Disclosure | B3 | 4 | 3 | 12 (MED) | **SEC-DO007-002**: No at-rest encryption. Docs recommend GPG/fs-level. See Finding 2 |
| PGPASSWORD visible in /proc/*/environ | Info Disclosure | B4 | 3 | 2 | 6 (LOW) | Standard libpq behavior. PGPASSFILE alternative documented |
| SQL injection via --target-db argument | Tampering | B5→B1 | 3 | 1 | 3 (LOW) | **SEC-DO007-003**: Attacker needs shell access (equivalent privilege). See Finding 3 |
| Spoofed .env injects malicious values | Spoofing | B4 | 4 | 1 | 4 (LOW) | .env writable only by users with filesystem access (already trusted) |
| Retention=0 deletes all backups | DoS | B5 | 3 | 1 | 3 (LOW) | No minimum retention guard; operational risk. See Finding 5 |
| Script caller not authenticated | Spoofing | B5 | 2 | 2 | 4 (LOW) | Relies on OS-level access control (standard for infrastructure scripts) |
| Audit trail only in stdout | Repudiation | B3 | 2 | 2 | 4 (LOW) | Structured logging present; cron examples pipe to syslog via logger |

**Maximum STRIDE score: 12 (MEDIUM)** — No critical or high threats identified.

---

## 2. OWASP Top 10 Checklist

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| A01 | Broken Access Control | **PASS** | Scripts rely on OS filesystem permissions. No web-facing access. Backup dir is `.gitignore`d. Restore requires explicit confirmation (type database name). |
| A02 | Cryptographic Failures | **PASS w/ NOTE** | SHA-256 for integrity (good). No at-rest encryption (documented in strategy doc Section 9 as production recommendation). No plaintext password storage — uses env vars / .pgpass. |
| A03 | Injection | **PASS w/ NOTE** | All shell variables double-quoted throughout both scripts (`set -euo pipefail`, `IFS=$'\n\t'`). Format/compression inputs validated. Minor SQL injection vector in restore.sh `${target}` variable within psql `-c` — mitigated by trust model (attacker=admin). |
| A04 | Insecure Design | **PASS** | Defense-in-depth: validate before restore, confirm by typing db name, dry-run mode, SHA-256 checksums, pg_restore --list verification. Secure defaults. |
| A05 | Security Misconfiguration | **PASS** | Strict bash mode (`set -euo pipefail`). `.env` excluded from VCS. Backups excluded from VCS. No debug output in scripts. |
| A06 | Vulnerable Components | **N/A** | Shell scripts use only system utilities (pg_dump, pg_restore, psql, gzip, sha256sum, find, docker). No third-party dependencies, no package manager. No SBOM needed. |
| A07 | Auth Failures | **PASS** | PostgreSQL authentication delegated to libpq (`PGPASSWORD` / `PGPASSFILE`). No custom auth implemented. No credential storage in scripts. |
| A08 | Data Integrity | **PASS** | SHA-256 checksums on every backup. pg_restore --list for custom format. gzip -t for SQL format. Metadata sidecar with full audit trail. |
| A09 | Logging Failures | **PASS** | Structured logging (`log_info`, `log_ok`, `log_warn`, `log_error`) with UTC timestamps. `log_error` writes to stderr. No PII or credentials in log output. Host/port/dbname logged (non-sensitive operational data). |
| A10 | SSRF | **N/A** | No outbound HTTP/network calls. Scripts operate locally or via direct PostgreSQL wire protocol. |

**Result: 10/10 categories checked. Zero critical gaps.**

---

## 3. LLM Top 10

**N/A** — No AI, LLM, or agentic features in these infrastructure shell scripts.

---

## 4. SBOM / Dependency Audit

**N/A** — Pure bash scripts using only system utilities:
- `pg_dump`, `pg_restore`, `pg_isready`, `psql` (postgresql-client)
- `gzip`, `zcat` (coreutils/gzip)
- `sha256sum` (coreutils)
- `find`, `stat`, `du`, `date`, `mkdir`, `basename`, `dirname` (coreutils)
- `docker` (docker CLI, only when `--docker` flag used)

No npm, pip, or other package manager dependencies. No third-party scripts sourced.
No SBOM generation required.

---

## 5. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded API keys | **NONE** |
| Hardcoded passwords | **NONE** |
| Hardcoded tokens | **NONE** |
| Private keys | **NONE** |
| .env committed to VCS | **NO** — `.gitignore` excludes it |
| Backup files in VCS | **NO** — `infra/backups/.gitignore` excludes `*.dump`, `*.sql.gz`, `*.meta` |
| Secrets in metadata | **NO** — `.meta` records db, host, port, user, pg_version (non-secret operational info) |
| Credentials in logs | **NO** — log functions output timestamps, messages, file paths only |

**Result: CLEAN — no secrets detected.**

---

## 6. SARIF Findings

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
              "id": "SEC-DO007-001",
              "name": "MissingFilePermissionRestriction",
              "shortDescription": { "text": "Backup files created without restrictive permissions" },
              "helpUri": "https://cwe.mitre.org/data/definitions/276.html",
              "properties": { "cwe": "CWE-276" }
            },
            {
              "id": "SEC-DO007-002",
              "name": "MissingEncryptionAtRest",
              "shortDescription": { "text": "Backup files not encrypted at rest" },
              "helpUri": "https://cwe.mitre.org/data/definitions/311.html",
              "properties": { "cwe": "CWE-311" }
            },
            {
              "id": "SEC-DO007-003",
              "name": "SQLInjectionViaTargetDB",
              "shortDescription": { "text": "SQL injection via unsanitized target database name" },
              "helpUri": "https://cwe.mitre.org/data/definitions/89.html",
              "properties": { "cwe": "CWE-89" }
            },
            {
              "id": "SEC-DO007-004",
              "name": "UnsignedMetadataFile",
              "shortDescription": { "text": "Metadata sidecar has no integrity protection" },
              "helpUri": "https://cwe.mitre.org/data/definitions/354.html",
              "properties": { "cwe": "CWE-354" }
            },
            {
              "id": "SEC-DO007-005",
              "name": "NoMinimumRetentionGuard",
              "shortDescription": { "text": "Retention=0 could delete all existing backups" },
              "helpUri": "https://cwe.mitre.org/data/definitions/400.html",
              "properties": { "cwe": "CWE-400" }
            },
            {
              "id": "SEC-DO007-006",
              "name": "PasswordInEnvironment",
              "shortDescription": { "text": "PGPASSWORD visible in process environment" },
              "helpUri": "https://cwe.mitre.org/data/definitions/214.html",
              "properties": { "cwe": "CWE-214" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-DO007-001",
          "level": "warning",
          "message": { "text": "Backup files are created with the default umask. On multi-user systems, other users may read database dumps containing sensitive data. Recommend adding 'umask 077' at script start or 'chmod 600' after file creation." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/backup.sh" }, "region": { "startLine": 165, "endLine": 185 } } }]
        },
        {
          "ruleId": "SEC-DO007-002",
          "level": "warning",
          "message": { "text": "Backup files are stored unencrypted. The backup strategy document (Section 9) recommends GPG or filesystem-level encryption for production. Scripts do not enforce this. Risk accepted: encryption is an operational control, not a script-level control." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/backup.sh" }, "region": { "startLine": 157, "endLine": 200 } } }]
        },
        {
          "ruleId": "SEC-DO007-003",
          "level": "note",
          "message": { "text": "The ${target} variable (from --target-db CLI arg) is interpolated into a SQL string passed to psql -c without parameterization. A database name containing single quotes could break the SQL. Risk: LOW — attacker must have shell access (equivalent to direct DB access). Recommend quoting with pg_catalog.quote_ident() or validating target name against [a-zA-Z0-9_-] regex." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/restore.sh" }, "region": { "startLine": 318, "endLine": 322 } } }]
        },
        {
          "ruleId": "SEC-DO007-004",
          "level": "note",
          "message": { "text": "The .meta sidecar file provides SHA-256 for the backup, but the metadata file itself is not signed. An attacker with write access to the backup directory could modify both the backup and its checksum. Mitigated by filesystem access controls." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/backup.sh" }, "region": { "startLine": 195, "endLine": 210 } } }]
        },
        {
          "ruleId": "SEC-DO007-005",
          "level": "note",
          "message": { "text": "No minimum retention guard. Setting --retention 0 deletes all backups matching the pattern via find -mtime +0. Recommend enforcing a minimum retention of 1 day." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/backup.sh" }, "region": { "startLine": 293, "endLine": 310 } } }]
        },
        {
          "ruleId": "SEC-DO007-006",
          "level": "note",
          "message": { "text": "PGPASSWORD is set via .env sourcing and visible in /proc/*/environ. Standard PostgreSQL behavior. PGPASSFILE (.pgpass) is a more secure alternative and is supported by libpq. Recommendation only." },
          "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "infra/scripts/backup.sh" }, "region": { "startLine": 39, "endLine": 43 } } }]
        }
      ]
    }
  ]
}
```

---

## 7. Findings Summary

| ID | Severity | CWE | File | Description | Risk Acceptance |
|----|----------|-----|------|-------------|-----------------|
| SEC-DO007-001 | MEDIUM | CWE-276 | backup.sh | Backup files created without `umask 077` / `chmod 600` | Accepted: mitigated by server-level access controls; strategy doc Section 9 recommends `chmod 600` |
| SEC-DO007-002 | MEDIUM | CWE-311 | backup.sh | No at-rest encryption for backups | Accepted: strategy doc Section 9 recommends encryption for production; operational control |
| SEC-DO007-003 | MEDIUM→LOW | CWE-89 | restore.sh:318 | SQL injection via `--target-db` in psql `-c` | Accepted: attacker with shell access already has equivalent DB privilege |
| SEC-DO007-004 | LOW | CWE-354 | backup.sh | .meta sidecar not integrity-protected | Accepted: filesystem permissions control access |
| SEC-DO007-005 | LOW | CWE-400 | backup.sh | No minimum retention guard | Accepted: operational risk, admin-controlled input |
| SEC-DO007-006 | LOW | CWE-214 | backup.sh | PGPASSWORD in environment | Accepted: standard PostgreSQL authentication pattern; PGPASSFILE recommended |

---

## 8. Security Strengths

- **`set -euo pipefail` + `IFS=$'\n\t'`** — strict bash mode, safe field splitting
- **All variables double-quoted** — no word splitting or glob expansion vulnerabilities
- **Input validation** — format restricted to `custom|sql`, compression to `^[0-9]$`
- **Integrity verification pipeline** — SHA-256 checksum + pg_restore --list + gzip -t
- **Destructive operation confirmation** — user must type the full database name to confirm restore
- **Dry-run mode** — validation without data modification
- **No hardcoded credentials** — environment variables and .env file only
- **`.gitignore` coverage** — .env, backup files, and metadata excluded from VCS
- **Structured logging** — no PII/credentials in output, timestamps, stderr for errors
- **Docker isolation** — container mode properly uses `docker exec` with quoted arguments
- **Metadata sidecar** — full audit trail (timestamp, sha256, pg_version, duration)

---

## 9. Recommended Improvements (Non-blocking)

1. Add `umask 077` at script start in backup.sh to restrict file permissions.
2. Add `chmod 600 "${backup_file}" "${metadata_file}"` after creation.
3. Validate `--target-db` against `^[a-zA-Z_][a-zA-Z0-9_-]*$` regex in restore.sh.
4. Add minimum retention guard: `if [[ "${BACKUP_RETENTION}" -lt 1 ]]; then BACKUP_RETENTION=1; fi`
5. Document PGPASSFILE as preferred credential mechanism over PGPASSWORD.
6. Consider optional GPG encryption flag: `--encrypt` for sensitive environments.

These are defense-in-depth enhancements. None are blocking for this stage.

---

## 10. Artifacts Reviewed

| File | Lines | Analysis |
|------|-------|----------|
| `infra/scripts/backup.sh` | 353 | Full STRIDE + injection + credential review |
| `infra/scripts/restore.sh` | 492 | Full STRIDE + injection + path traversal + confirmation review |
| `docs/operations/backup-strategy.md` | ~270 | Security section review, WAL config, retention policy |
| `infra/Makefile` | 88 | Make target security (no injection vectors) |
| `infra/backups/.gitignore` | 4 | VCS exclusion verified |

---

**Verdict: PASS** — Zero critical/high findings. All medium findings documented with
risk acceptance and mitigated by operational controls and strategy document guidance.
Advancing to CI stage.
