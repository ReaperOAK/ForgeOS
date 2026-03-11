# FORGEOS-BE071 — Security Review

## Ticket

**ID:** FORGEOS-BE071
**Title:** Implement Bidirectional Sync Engine
**Stage:** SECURITY → CI
**Agent:** Security Engineer on pop-os (reaperoak)
**Completed:** 2026-03-11T12:15:00+00:00
**Rework:** #1 (lint fixes only — no security-relevant code changes)

## Verdict: PASS

**Confidence:** HIGH

Zero critical or high findings. Two medium findings documented with risk acceptance. Low findings noted for future hardening. Re-review after rework confirmed no security regression — rework was limited to lint cleanup (unused imports, TYPE_CHECKING, contextlib.suppress).

---

## Files Reviewed

| File | Lines | Purpose |
|------|-------|---------|
| `mcp-server/src/mcp_server/migration/sync_engine.py` | ~451 | Bidirectional FS↔DB sync loop, stage moves, claim updates |
| `mcp-server/src/mcp_server/migration/conflict_resolver.py` | ~196 | Database-wins conflict resolution with audit log |
| `mcp-server/src/mcp_server/migration/transformers.py` | ~90 (reviewed) | Stage mapping (DB_TO_STAGE_DIR) used by sync engine |
| `mcp-server/src/mcp_server/migration/importer.py` | ~250 (reviewed) | TicketImporter / DatabaseWriter protocol consumed by sync engine |

---

## 1. STRIDE Threat Model

### Trust Boundaries

```
[Filesystem (.github/tickets/)]  ──read JSON──►  [SyncEngine]  ──upsert──►  [PostgreSQL DB]
[PostgreSQL DB]  ──list_tickets()──►  [SyncEngine]  ──write JSON/move files──►  [Filesystem]
```

| Boundary | Direction | Data Flow |
|----------|-----------|-----------|
| FS → Engine | Inbound | JSON ticket files read from `.github/tickets/` and `ticket-state/` |
| DB → Engine | Inbound | Ticket dicts via `DatabaseReader.list_tickets()` |
| Engine → FS | Outbound | JSON writes, `shutil.move()` for stage transitions, `mkdir()` |
| Engine → DB | Outbound | Upsert via `TicketImporter` → `DatabaseWriter` |

### STRIDE Analysis

| Threat | Component | Finding | Impact×Likelihood | Severity |
|--------|-----------|---------|-------------------|----------|
| **Spoofing** | FS → Engine | Malicious JSON in tickets dir could inject arbitrary ticket data. Mitigated: only operators with filesystem access can write files; claim protocol limits who modifies tickets. | 3×1=3 | LOW |
| **Tampering** | Engine → FS | Ticket JSON written without integrity checks (no HMAC/signature). Acceptable for local dev files. | 2×2=4 | LOW |
| **Tampering** | ticket_id in paths | ticket_id from DB used in `Path / f"{ticket_id}.json"` without format validation — potential path traversal if DB compromised. See SARIF SEC-001. | 4×2=8 | **MEDIUM** |
| **Tampering** | Stage fallback | `DB_TO_STAGE_DIR.get(db_stage_raw, db_stage_raw)` passes unrecognized stages through raw, could create dirs outside intended scope. See SARIF SEC-002. | 3×2=6 | **MEDIUM** |
| **Repudiation** | Audit log | `ConflictResolver` maintains structured conflict records. All operations logged with structured logger. Audit trail is comprehensive. | — | PASS ✅ |
| **Information Disclosure** | Error logging | `str(exc)` in log extras may include filesystem paths. Acceptable for server-side logs not exposed to clients. | 2×1=2 | LOW |
| **Denial of Service** | File reading | `_read_fs_tickets()` reads all `.json` files without size limit. Large file could consume memory. Mitigated: directory contains only operator-managed ticket files. | 3×1=3 | LOW |
| **Denial of Service** | Sync interval | `interval_seconds` could be set to 0/near-zero causing CPU spin. Mitigated: SyncConfig is set by trusted server code, not user input. | 3×1=3 | LOW |
| **Elevation of Privilege** | Engine scope | Engine runs with same privileges as MCP server. No privilege escalation vectors — operates on same-scope files and DB. | 1×1=1 | LOW |

---

## 2. OWASP Top 10 Checklist

| ID | Category | Status | Notes |
|----|----------|--------|-------|
| A01 | Broken Access Control | ✅ PASS | Internal component, not API-exposed. Sync engine invoked programmatically by server lifecycle only. |
| A02 | Cryptographic Failures | ✅ N/A | No cryptographic operations in scope. Claim/lease metadata in plaintext JSON is by design for this file-based system. |
| A03 | Injection | ⚠️ MEDIUM | Path traversal risk via `ticket_id` in filesystem path construction (SEC-001). No SQL injection — uses Protocol-based DB writer with parameterized queries. No command injection. |
| A04 | Insecure Design | ✅ PASS | Database-wins conflict resolution is consistent and audited. Defense-in-depth gap on ticket_id validation noted (SEC-001). |
| A05 | Security Misconfiguration | ✅ PASS | `mkdir(parents=True, exist_ok=True)` uses default OS permissions (typically 755). Acceptable for development. Stage name fallback noted (SEC-002). |
| A06 | Vulnerable Components | ✅ PASS | All dependencies at current versions. No known CVEs (asyncpg 0.31.0, pydantic 2.12.5, PyJWT 2.11.0, bcrypt 5.0.0, mcp 1.26.0). |
| A07 | Auth Failures | ✅ N/A | No authentication in scope — internal sync component. Auth handled at API layer. |
| A08 | Data Integrity | ✅ PASS | JSON deserialization via `json.loads()` (safe, no code execution). No `pickle`, `eval`, or `exec`. `json.dumps(default=str)` for serialization. |
| A09 | Logging Failures | ✅ PASS | Structured logging on every operation. No PII in log fields. ConflictRecord provides immutable audit entries with timestamps. |
| A10 | SSRF | ✅ N/A | No outbound HTTP/network requests in scope. |

---

## 3. LLM Top 10

N/A — No AI/LLM features in the sync engine or conflict resolver.

---

## 4. Detailed Findings (SARIF Format)

### SEC-001: Path Traversal via Unvalidated ticket_id (CWE-22)

```json
{
  "ruleId": "SEC-001",
  "level": "warning",
  "message": {
    "text": "ticket_id from database used directly in filesystem path construction without format validation. If ticket_id contains path separators or '..' components, file operations could target locations outside intended directories."
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 349 }
      },
      "message": "_find_current_fs_stage: subdir / f\"{ticket_id}.json\""
    },
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 366 }
      },
      "message": "_move_ticket_to_stage: state_dir / from_stage / f\"{ticket_id}.json\""
    },
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 417 }
      },
      "message": "_update_ticket_claim: tickets_dir / f\"{ticket_id}.json\""
    }
  ],
  "fixes": [
    {
      "description": "Validate ticket_id matches expected pattern (e.g., r'^FORGEOS-[A-Z]{2}\\d{3}$') before using in path construction. Or use Path.resolve() and verify the result is still within the allowed base directory."
    }
  ],
  "properties": {
    "cwe": "CWE-22",
    "severity": "MEDIUM",
    "impact": 4,
    "likelihood": 2,
    "stride_score": 8,
    "risk_acceptance": "ACCEPTED — ticket_id originates from trusted database with controlled schema; ticket IDs follow format FORGEOS-XXNNN. DB compromise required to exploit. Recommend adding validation as defense-in-depth in a future hardening ticket."
  }
}
```

### SEC-002: Stage Name Fallback Passthrough (CWE-22)

```json
{
  "ruleId": "SEC-002",
  "level": "note",
  "message": {
    "text": "DB_TO_STAGE_DIR.get(db_stage_raw, db_stage_raw) falls back to the raw DB stage value when not found in the mapping. This raw value is used to construct directory paths and create directories via mkdir(parents=True). An unrecognized stage containing path separators could create directories outside the intended ticket-state tree."
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 291 }
      },
      "message": "fs_dir_name = DB_TO_STAGE_DIR.get(db_stage_raw, db_stage_raw)"
    }
  ],
  "fixes": [
    {
      "description": "Replace fallback with explicit error: if stage not in DB_TO_STAGE_DIR, log a warning and skip the ticket instead of using the raw value as a directory name."
    }
  ],
  "properties": {
    "cwe": "CWE-22",
    "severity": "MEDIUM",
    "impact": 3,
    "likelihood": 2,
    "stride_score": 6,
    "risk_acceptance": "ACCEPTED — stage values come from DB enum type (ticket_stage) which constrains allowed values at the database layer. Recommend removing fallback as defense-in-depth."
  }
}
```

### SEC-003: TOCTOU Race Condition in File Operations (CWE-367)

```json
{
  "ruleId": "SEC-003",
  "level": "note",
  "message": {
    "text": "File existence checks (_find_current_fs_stage) are temporally separated from file operations (_move_ticket_to_stage, _update_ticket_claim). Another process could modify files between check and use."
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 340, "endLine": 355 }
      }
    }
  ],
  "properties": {
    "cwe": "CWE-367",
    "severity": "LOW",
    "impact": 2,
    "likelihood": 2,
    "stride_score": 4,
    "risk_acceptance": "ACCEPTED — mitigated by Git-based claim protocol (only one agent processes a ticket at a time). shutil.move handles missing source gracefully."
  }
}
```

### SEC-004: Unbounded JSON File Read (CWE-400)

```json
{
  "ruleId": "SEC-004",
  "level": "note",
  "message": {
    "text": "_read_fs_tickets reads all .json files from tickets directory without file size limits. A very large file could cause excessive memory consumption."
  },
  "locations": [
    {
      "physicalLocation": {
        "artifactLocation": { "uri": "mcp-server/src/mcp_server/migration/sync_engine.py" },
        "region": { "startLine": 330, "endLine": 340 }
      }
    }
  ],
  "properties": {
    "cwe": "CWE-400",
    "severity": "LOW",
    "impact": 3,
    "likelihood": 1,
    "stride_score": 3,
    "risk_acceptance": "ACCEPTED — tickets directory is operator-managed, not user-facing. Ticket JSON files are typically <5KB."
  }
}
```

---

## 5. Dependency Audit / SBOM Summary

| Package | Version | Status |
|---------|---------|--------|
| asyncpg | 0.31.0 | ✅ No known CVEs |
| pydantic | 2.12.5 | ✅ No known CVEs |
| PyJWT | 2.11.0 | ✅ No known CVEs |
| bcrypt | 5.0.0 | ✅ No known CVEs |
| mcp | 1.26.0 | ✅ No known CVEs |
| uvicorn | 0.41.0 | ✅ No known CVEs |
| alembic | 1.18.4 | ✅ No known CVEs |
| PyYAML | 6.0.1 | ✅ No known CVEs |

**Total direct dependencies:** 11 (from pyproject.toml)
**Critical CVEs:** 0 | **High CVEs:** 0

---

## 6. Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded passwords | None found ✅ |
| API keys / tokens | None found ✅ |
| Private keys | None found ✅ |
| `.env` references | None in scope files ✅ |

---

## 7. Code Security Positives

- **JSON-only deserialization**: Uses `json.loads()` exclusively — no `pickle`, `eval`, `exec`, or `yaml.unsafe_load`. ✅
- **Structured logging**: All operations via `get_logger()` with structured extras. No `print()`. ✅
- **No PII in logs**: Log extras contain only ticket IDs, stage names, and boolean flags. ✅
- **Exception handling**: All async paths wrapped in try/except with error logging. ✅
- **Immutable audit trail**: `ConflictRecord` is `@dataclass(frozen=True)`. ✅
- **Protocol-based abstractions**: `DatabaseReader` and `DatabaseWriter` use `Protocol`. ✅
- **Graceful shutdown**: `_stop_event` + `asyncio.wait_for` pattern. ✅
- **UTF-8 encoding**: All file reads/writes specify `encoding="utf-8"`. ✅

---

## 8. Recommendations (Non-Blocking)

1. **Add ticket_id format validation** — Validate against `r'^[A-Z]+-[A-Z]+\d+$'` before using in filesystem paths.
2. **Remove stage fallback passthrough** — Skip on unknown stages instead of falling back to raw value.
3. **Add file size guard** — Limit JSON file reads to a reasonable maximum (e.g., 1MB).

---

## 9. Rework Impact Assessment

Rework #1 changes were **pure lint cleanup** with zero security impact:
- Removed unused `field` import from `dataclasses`
- Removed unused `STAGE_DIR_TO_DB` import from transformers
- Moved `Path` import into `TYPE_CHECKING` block
- Replaced bare try/except with `contextlib.suppress(asyncio.CancelledError)`

No behavioral changes. No new attack surface. All 33 tests passing.

---

## 10. Verdict Summary

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| Findings | 0 | 0 | 2 | 2 | 0 |

**PASS** — Zero critical/high findings. Medium findings (SEC-001, SEC-002) have documented risk acceptance: data sources are trusted (DB with enum constraints, operator-managed filesystem), and exploitation requires database compromise.
