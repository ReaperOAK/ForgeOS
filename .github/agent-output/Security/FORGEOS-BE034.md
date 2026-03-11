# FORGEOS-BE034 — Security Review

**Agent:** Security Engineer  
**Machine:** pop-os  
**Operator:** ReaperOAK  
**Completed:** 2026-03-11T23:55:00Z  
**Verdict:** PASS  
**Confidence:** HIGH

---

## Files Reviewed

| File | Purpose |
|------|---------|
| `mcp-server/src/mcp_server/api/routes/tickets.py` | GET /api/tickets endpoint handler |
| `mcp-server/src/mcp_server/api/schemas.py` | Pydantic response/request schemas |
| `mcp-server/src/mcp_server/repositories/ticket_repo.py` | `list_tickets()` DB query with dynamic WHERE |
| `mcp-server/src/mcp_server/transport/http.py` | Route mounting, late-binding repo ref |
| `mcp-server/src/mcp_server/api/routes/__init__.py` | Route module exports |

---

## STRIDE Threat Model

### Trust Boundary: HTTP Client → Starlette Route Handler → TicketRepository → PostgreSQL

| Threat | Analysis | Score (I×L) | Rating |
|--------|----------|-------------|--------|
| **Spoofing** | No per-endpoint auth. Consistent with existing platform pattern (FORGEOS-BE017 health, admin/audit). Internal orchestration API within Docker network. | 2×2=4 | LOW |
| **Tampering** | Read-only GET endpoint. No mutation capability. Query params validated via enums or parameterized SQL. | 1×1=1 | LOW |
| **Repudiation** | Read-only list operation. No audit logging for reads is acceptable. Errors logged via structured logger. | 1×1=1 | LOW |
| **Information Disclosure** | Returns operational ticket metadata (ticket_id, title, stage, claimed_by_name, machine_id, operator). No secrets, tokens, or PII. Internal errors return generic "Internal server error" — no stack trace leakage. | 2×2=4 | LOW |
| **Denial of Service** | `limit` capped at 200 via `_MAX_LIMIT`. `offset` clamped to ≥0. Non-numeric values default gracefully. `COUNT(*) OVER()` window function bounded by limit. | 2×2=4 | LOW |
| **Elevation of Privilege** | Read-only endpoint. No state mutation. Cannot be used to bypass RBAC or claim tickets. | 1×1=1 | LOW |

**Max STRIDE Score:** 4 (LOW). No findings exceed threshold.

---

## OWASP Top 10 Checklist

| # | Category | Status | Evidence |
|---|----------|--------|----------|
| A01 | Broken Access Control | ⚠️ NOTE | No per-endpoint authentication. Consistent with platform architectural decision (all existing REST endpoints in FORGEOS-BE017 lack auth). Internal-only API. See SEC-NOTE-001. |
| A02 | Cryptographic Failures | ✅ N/A | No sensitive data stored, transmitted, or encrypted by this endpoint. |
| A03 | Injection | ✅ PASS | All SQL uses asyncpg positional `$N` parameterized queries. Dynamic WHERE in `list_tickets()` builds conditions as `f"stage = ${idx}::ticket_stage"` with `params.append(stage)` — parameter index is computed from a counter, not from user input. Enum values validated against strict allowlists before reaching SQL. `claimed_by` and `machine_id` are freeform strings but still parameterized. |
| A04 | Insecure Design | ✅ PASS | Defense in depth: enum validation at handler layer, parameterized queries at repo layer, PostgreSQL type casting (`::ticket_stage`, `::ticket_type`, `::ticket_priority`) at DB layer. Limit capping prevents resource exhaustion. |
| A05 | Security Misconfiguration | ✅ PASS | No debug mode. Generic error responses. No unnecessary headers or CORS configuration changes. |
| A06 | Vulnerable Components | ✅ PASS | No new dependencies introduced. Uses existing asyncpg ≥0.30.0, Pydantic ≥2.0, Starlette (via MCP SDK). No known CVEs in pinned ranges. |
| A07 | Auth Failures | ⚠️ NOTE | No auth mechanism on this endpoint. See SEC-NOTE-001 (platform-level concern, not endpoint-specific). |
| A08 | Data Integrity | ✅ N/A | Read-only endpoint. No data modification. |
| A09 | Logging Failures | ✅ PASS | `logger.exception("ticket_list_query_failed")` on errors. No PII or credentials in log messages. Uses structured logger (`mcp_server.observability.get_logger`). |
| A10 | SSRF | ✅ N/A | No outbound requests. No URL parameters accepted. |

---

## LLM Top 10

Not applicable — this ticket implements a REST endpoint with no AI/LLM features.

---

## Injection Analysis (Deep Dive)

**Focus area per ticket instructions: SQL injection in filter params.**

### `list_tickets()` Dynamic WHERE Construction

```python
# From ticket_repo.py lines ~349-390
conditions: list[str] = []
params: list[Any] = []
idx = 1

if stage is not None:
    conditions.append(f"stage = ${idx}::ticket_stage")
    params.append(stage)
    idx += 1
# ... same pattern for ticket_type, priority, claimed_by, machine_id

where = ""
if conditions:
    where = "WHERE " + " AND ".join(conditions)

query = f"""
    SELECT *, COUNT(*) OVER() AS full_count
    FROM tickets
    {where}
    ORDER BY ...
    LIMIT ${idx} OFFSET ${idx + 1}
"""
params.extend([limit, offset])
rows = await conn.fetch(query, *params)
```

**Assessment:**
- The f-string interpolation in `f"stage = ${idx}::ticket_stage"` only interpolates the **parameter index** (`idx`), which is an integer counter controlled entirely server-side. User input is never interpolated into the SQL string.
- User-supplied values are passed as positional parameters via `params` list and bound by asyncpg's native parameterized query engine.
- PostgreSQL type casts (`::ticket_stage`, `::ticket_type`, `::ticket_priority`) provide an additional layer — invalid values would fail the cast, not execute arbitrary SQL.
- `claimed_by` and `machine_id` are untyped string parameters but still bound via `$N` — no injection vector.

**Result: ZERO SQL injection risk.** ✅

### Enum Validation

```python
def _validate_enum(value, enum_cls, param_name):
    valid_values = {e.value for e in enum_cls}
    if value not in valid_values:
        raise ValueError(...)
    return value
```

Values are checked against a frozen set of enum members. Arbitrary strings rejected with 400 before reaching the repository layer. ✅

### Integer Parsing

```python
def _parse_int(value, default, max_val=None):
    if not value: return default
    try:
        result = int(value)
        if max_val is not None: result = min(result, max_val)
        return max(result, 0)
    except ValueError: return default
```

Non-numeric input defaults gracefully. Negative values clamped to 0. Max enforced. No exception leakage. ✅

---

## IDOR / Auth Bypass Analysis

**Focus area per ticket instructions.**

- **IDOR:** Not applicable. This is a list endpoint returning all matching tickets — not a per-record access endpoint with user-owned resources. No tenant isolation concerns since this is a single-tenant internal orchestration system.
- **Auth Bypass:** No authentication exists on this endpoint to bypass. This is consistent with all existing REST endpoints in the platform (health, admin/audit). The architectural decision is that REST endpoints are internal-only, accessed within the Docker network. Auth is planned at the platform level, not per-endpoint.

---

## Information Disclosure Analysis

**Response fields exposed:**
- `ticket_id`, `title`, `type`, `priority`, `stage`, `status` — operational metadata
- `claimed_by_name`, `machine_id`, `operator` — agent orchestration data
- `rework_count`, `tags`, `created_at`, `updated_at` — lifecycle metadata

**Not exposed (filtered by TicketSummary schema):**
- `description` (full text)
- `acceptance_criteria` (list)
- `file_paths` (list)
- `depends_on` (list)
- `metadata` (dict)
- `lease_expiry`, `lease_duration_minutes`
- Database UUIDs (`id`, `claimed_by`, `parent_id`, `project_id`)

The Pydantic `TicketSummary` model acts as an effective data transfer filter, exposing only summary fields. ✅

**Error responses:**
- 400: `{"error": "Invalid value for 'stage': 'X'. Must be one of: [...]"}` — reveals valid enum values (acceptable — they're not secrets)
- 500: `{"error": "Internal server error"}` — generic, no stack trace
- 503: `{"error": "Database unavailable"}` — generic

No sensitive data leakage in error paths. ✅

---

## Dependency Audit

No new dependencies introduced by FORGEOS-BE034. All imports are from existing packages already in the dependency tree:
- `starlette` (via `mcp>=1.25`)
- `asyncpg>=0.30.0`
- `pydantic>=2.0`
- `mcp_server.observability` (internal)

SBOM impact: Zero new entries. No CVE exposure from this change.

---

## Secret Scanning

Reviewed all 5 files. **Zero** hardcoded secrets, API keys, tokens, or passwords found. No `.env` files created or modified. ✅

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
          "name": "ForgeOS-SecurityReview",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-NOTE-001",
              "shortDescription": { "text": "No per-endpoint authentication on GET /api/tickets" },
              "defaultConfiguration": { "level": "note" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-NOTE-001",
          "level": "note",
          "message": {
            "text": "GET /api/tickets has no authentication middleware. This is consistent with all existing REST endpoints (health, admin/audit) which follow the same pattern from FORGEOS-BE017. The API is designed for internal orchestration within a Docker network. Auth should be addressed at the platform level via a dedicated auth ticket, not per-endpoint."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/transport/http.py" },
                "region": { "startLine": 175, "startColumn": 13 }
              }
            }
          ],
          "relatedLocations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/api/routes/tickets.py" },
                "region": { "startLine": 91 }
              },
              "message": { "text": "Endpoint handler has no auth check" }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## Findings Summary

| ID | Severity | CWE | Description | Status |
|----|----------|-----|-------------|--------|
| SEC-NOTE-001 | NOTE | CWE-306 | No authentication on GET /api/tickets | Risk Accepted — platform-level concern, consistent with existing architecture |

- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 0
- **Note:** 1 (risk accepted)

---

## Verdict

**PASS** — Zero critical or high findings. One informational note (no per-endpoint auth) is a platform-level architectural decision consistent with all existing REST endpoints and risk-accepted.

**Justification:**
1. All SQL is fully parameterized via asyncpg `$N` positional params — zero injection risk.
2. Enum validation provides defense-in-depth before values reach SQL.
3. Integer params capped and clamped — no DoS via unbounded queries.
4. TicketSummary Pydantic model filters response fields — no information disclosure beyond operational metadata.
5. Error responses are generic — no stack trace or internal detail leakage.
6. Read-only endpoint — no state mutation, IDOR, or privilege escalation possible.
7. No new dependencies — zero SBOM impact.
8. No hardcoded secrets.
