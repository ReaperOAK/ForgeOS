# FORGEOS-BE064 — Security Review

## Ticket

- **ID:** FORGEOS-BE064
- **Title:** Implement Notification Event Queue
- **Stage:** SECURITY → CI
- **Verdict:** **PASS**
- **Confidence:** HIGH

## Files Reviewed

| File | Purpose |
|------|---------|
| `mcp-server/src/mcp_server/notifications/queue.py` | Core queue logic (365 LOC) |
| `mcp-server/src/mcp_server/notifications/__init__.py` | Public API exports |
| `mcp-server/alembic/versions/20260310_000000_004_notification_queue.py` | Migration DDL |
| `mcp-server/tests/test_notification_queue.py` | 44 tests, 94% coverage |

## STRIDE Threat Model

### Trust Boundaries

| # | Boundary | Components |
|---|----------|------------|
| B1 | Application → PostgreSQL | `queue.py` SQL queries → `notification_queue` table |
| B2 | Caller → Queue API | Method params (event_type, payload, notification_id) |
| B3 | Consumer → Queue | Concurrent dequeue via `FOR UPDATE SKIP LOCKED` |

### Threat Analysis

| Boundary | Threat | Score | Finding |
|----------|--------|-------|---------|
| B1 | **Spoofing** | 2 (L) | Queue is internal component; auth at pool/connection level. Correct architecture. |
| B1 | **Tampering** | 5 (L) | All SQL uses parameterized queries ($1-$4). No string interpolation. `$3::jsonb` for payload. No injection vectors. |
| B1 | **Repudiation** | 4 (L) | Structured logging of notification_id/event_type. created_at/updated_at audit columns. |
| B1 | **Info Disclosure** | 6 (L) | Payload stored as JSONB without encryption. Acceptable for internal event queue. |
| B1 | **DoS** | 6 (L) | No rate limit on enqueue. Expected — rate limiting belongs at API layer. |
| B1 | **Elevation** | 1 (L) | No privilege management. Uses pool's credentials. No escalation vectors. |
| B2 | **Tampering** | 3 (L) | Input validated: event_type non-empty+stripped, max_retries >= 1, notification_id via uuid.UUID(). |
| B2 | **Info Disclosure** | 2 (L) | Payload NOT logged — prevents PII leakage. Only notification_id/event_type logged. |
| B3 | **Tampering** | 4 (L) | TOCTOU window in mark_failed between _get_by_id and UPDATE. Mitigated by SKIP LOCKED ensuring single consumer. |
| B3 | **DoS** | 3 (L) | SKIP LOCKED prevents blocking between concurrent consumers. Correct pattern. |

**Maximum STRIDE Score: 6 (LOW-MEDIUM)**
**No critical (≥20) or high (≥15) findings.**

## OWASP Top 10 Checklist

| Category | Result | Evidence |
|----------|--------|----------|
| A01 Broken Access Control | **PASS** | Internal module; no HTTP endpoints exposed. Auth at API layer. |
| A02 Cryptographic Failures | **PASS** | No cryptographic operations in scope. No password/key handling. |
| A03 Injection | **PASS** | All SQL parameterized ($1-$4). `json.dumps()` + `::jsonb` cast for payload. No f-strings/concatenation in SQL. |
| A04 Insecure Design | **PASS** | Explicit state machine, dead-letter queue, exponential backoff (capped 3600s), frozen dataclass, Protocol DI. |
| A05 Security Misconfiguration | **PASS** | `gen_random_uuid()` for IDs, CHECK constraints, auto-update trigger. No debug mode. |
| A06 Vulnerable Components | **PASS** | Only dependency: asyncpg (well-maintained). No new external deps introduced. |
| A07 Auth Failures | **N/A** | Internal queue component — no authentication logic. |
| A08 Data Integrity | **PASS** | Frozen dataclass, DB CHECK constraints, state machine validation, JSONB validation. |
| A09 Logging Failures | **PASS** | Structured `get_logger()` — no print(). Logs IDs, not payload contents. Warning-level for dead-letter. |
| A10 SSRF | **N/A** | No outbound HTTP requests. |

## SQL Injection Analysis

| Method | Query Pattern | Parameters | Verdict |
|--------|--------------|------------|---------|
| `enqueue()` | `INSERT INTO ... VALUES ($1, $2, $3::jsonb, 'pending', $4)` | uuid, str, json_str, int | SAFE |
| `dequeue()` | `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ...` | datetime | SAFE |
| `mark_delivered()` | via `_transition()` — `UPDATE ... SET status = $2 ... WHERE id = $1 RETURNING ...` | uuid, str | SAFE |
| `mark_failed()` (dead-letter) | `UPDATE ... SET status = 'dead_letter', retry_count = $2, error_message = $3 WHERE id = $1 RETURNING ...` | uuid, int, str | SAFE |
| `mark_failed()` (retry) | `UPDATE ... SET status = 'failed', retry_count = $2, next_retry_at = $3, error_message = $4 WHERE id = $1 RETURNING ...` | uuid, int, datetime, str | SAFE |
| `_get_by_id()` | `SELECT ... WHERE id = $1` | uuid | SAFE |
| `get_dead_letters()` | `SELECT ... WHERE status = 'dead_letter' ... LIMIT $1` | int | SAFE |
| `count_by_status()` | `SELECT status::text, COUNT(*) ... GROUP BY status` | none | SAFE |

**Result: 0/8 queries vulnerable. All use parameterized placeholders.**

## Payload Injection / XSS Analysis

- Payloads serialized via `json.dumps()` on enqueue — standard library JSON encoder.
- Stored as `$3::jsonb` — PostgreSQL validates JSONB format on INSERT. Malformed JSON rejected.
- Payloads deserialized via `json.loads()` or returned as dict in `_record_to_notification()`.
- **No HTML rendering of payloads** — backend-only component, no template/DOM output.
- **No code execution from payload** — data stored and retrieved, not evaluated.
- **Verdict: No XSS or payload injection vectors.**

## Queue Poisoning Analysis

- `event_type`: Validated non-empty and stripped.
- `payload`: Must be JSON-serializable (via `json.dumps()`), validated JSONB by PostgreSQL.
- `max_retries`: Validated `>= 1`.
- `notification_id`: Validated via `uuid.UUID()` constructor.
- Status transitions: Enforced by `_VALID_TRANSITIONS` dict — cannot inject arbitrary states.
- **Verdict: No queue poisoning vectors identified.**

## Resource Exhaustion Analysis

- **Queue flooding:** No max queue depth enforced. A runaway enqueue loop could fill the table.
  - Mitigation: Internal component — not exposed to external callers. Rate limiting at API layer.
  - Severity: LOW (CWE-400).
- **Retry storms:** Exponential backoff `10 * 2^n` capped at 3600s prevents thundering herd.
- **Dead-letter accumulation:** `get_dead_letters(limit=100)` bounds result set size.
- **Unbounded UUID generation:** `uuid.uuid4()` — no collision risk in practical scenarios.
- **Verdict: LOW risk. No actionable findings.**

## SKIP LOCKED Concurrency Analysis

```sql
UPDATE notification_queue
SET status = 'processing', updated_at = NOW()
WHERE id = (
  SELECT id FROM notification_queue
  WHERE status IN ('pending', 'failed')
    AND (next_retry_at IS NULL OR next_retry_at <= $1)
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING ...
```

- **Pattern:** Canonical PostgreSQL concurrent queue dequeue pattern.
- **FOR UPDATE:** Locks the selected row for the duration of the outer transaction.
- **SKIP LOCKED:** Other consumers skip already-locked rows — no blocking.
- **LIMIT 1:** Exactly one notification dequeued per call.
- **Subquery + UPDATE:** The outer UPDATE atomically transitions status. The row cannot be modified between subquery and UPDATE because it's locked.
- **Partial index:** `idx_notification_queue_dequeue ON (status, next_retry_at) WHERE status IN ('pending', 'failed')` — efficient for dequeue queries.
- **Verdict: Correct implementation. No double-processing possible.**

## SARIF Findings Summary

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": { "driver": { "name": "ForgeOS-Security", "version": "1.0.0" } },
    "results": [
      {
        "ruleId": "SEC-CWE-400",
        "level": "note",
        "message": { "text": "No maximum queue depth enforced. Runaway enqueue could exhaust disk. Mitigated by internal-only access." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "mcp-server/src/mcp_server/notifications/queue.py" }, "region": { "startLine": 128 } } }],
        "properties": { "severity": "LOW", "cwe": "CWE-400", "confidence": "HIGH" }
      },
      {
        "ruleId": "SEC-CWE-367",
        "level": "note",
        "message": { "text": "TOCTOU window between _get_by_id and UPDATE in mark_failed. Mitigated by SKIP LOCKED single-consumer guarantee and defensive ValueError guards." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "mcp-server/src/mcp_server/notifications/queue.py" }, "region": { "startLine": 189 } } }],
        "properties": { "severity": "LOW", "cwe": "CWE-367", "confidence": "HIGH" }
      }
    ]
  }]
}
```

## SBOM Summary

| Metric | Value |
|--------|-------|
| New dependencies introduced | 0 |
| Existing deps used | asyncpg, standard library (json, uuid, math, datetime, enum, dataclasses) |
| Critical CVEs | 0 |
| High CVEs | 0 |
| License conflicts | None |

## Verdict

**PASS** — Zero critical or high-severity findings. Two LOW/informational findings documented with risk acceptance:

1. **CWE-400 (LOW):** No max queue depth — acceptable for internal component, rate limiting at API layer.
2. **CWE-367 (LOW):** TOCTOU in mark_failed — mitigated by SKIP LOCKED concurrency model and defensive guards.

All SQL parameterized. SKIP LOCKED pattern correct. No injection, XSS, or queue poisoning vectors. Proper input validation at boundaries. Structured logging without PII leakage. Clean state machine with terminal state enforcement.

## Timestamp

2026-03-10T17:30:00+00:00
