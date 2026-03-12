# Security Review — TASK-INT-SEC002: Memory Engine

**Reviewer:** Security Engineer  
**Date:** 2026-03-12T22:00:00Z  
**Verdict:** PASS (0 Critical, 0 High, 3 Medium, 4 Low)  
**Confidence:** HIGH

---

## 1. Files Reviewed

| File | Purpose |
|------|---------|
| `forgeos-server/src/services/embedding-service.ts` | OpenAI API key handling, retry logic, rate limiting |
| `forgeos-server/src/tools/memory-add-lesson.ts` | Lesson content input and storage |
| `forgeos-server/src/tools/memory-search-lessons.ts` | Search query input and embedding lookup |
| `forgeos-server/src/tools/memory-get-context.ts` | Combined context queries (blast radius + lessons) |
| `forgeos-server/src/services/reflection-service.ts` | Auto-generated lessons from rework cycles |
| `forgeos-server/src/db/migrations/005-memory-engine.sql` | Stored functions, tables, indexes |
| `forgeos-server/src/db/migrations/004-pgvector.sql` | Vector extension setup |

---

## 2. STRIDE Threat Model

### 2.1 Trust Boundaries

```
Agent (MCP Client) → MCP Server → PostgreSQL (pgvector)
                   → OpenAI Embedding API (external)
```

### 2.2 Spoofing — Impact: 2 × Likelihood: 3 = 6 (LOW)

| Finding | Detail |
|---------|--------|
| **Agent authorship** | `agent_role` is accepted from the caller via Zod schema without server-side verification against the authenticated agent identity. An agent could claim a different role. However, this is within the trust boundary of the MCP server where agents are pre-authenticated by the orchestrator. |
| **Mitigation present** | MCP tool dispatch already validates agent identity at the transport layer. The `agent_role` field is metadata, not an authorization control. |
| **Risk accepted** | LOW — no privilege escalation from spoofing the `agent_role` string. |

### 2.3 Tampering — Impact: 3 × Likelihood: 3 = 9 (LOW)

| Finding | Detail |
|---------|--------|
| **Lesson content** | Lesson text is stored as-is in the `lessons` table. No HTML/script sanitization is applied before storage. If lesson text were ever rendered in a web context, this could enable stored XSS. |
| **Mitigation present** | Lessons are consumed as JSON over MCP protocol by agents, not rendered in HTML. The dashboard does not display lesson content. |
| **Finding ID** | SEC-002-M01 (Medium) — see Section 4. |

### 2.4 Repudiation — Impact: 2 × Likelihood: 2 = 4 (LOW)

| Finding | Detail |
|---------|--------|
| **Audit trail** | Lesson creation is logged with `ticket_id`, `stage`, and `agent_role` via structured pino logger. `created_at` timestamps with timezone are stored in the database. |
| **Event sourcing** | The reflection service reads from the `events` table, which provides a full audit trail of rejections and completions. |
| **Assessment** | PASS — adequate logging and audit capability present. |

### 2.5 Information Disclosure — Impact: 4 × Likelihood: 2 = 8 (LOW)

| Finding | Detail |
|---------|--------|
| **API key handling** | `OPENAI_API_KEY` is read from env var only. The `apiKey` field is `private readonly`. The key is never logged — error messages use `***MASKED***` (lines 209, 244). The `logger.info` at initialization does NOT include the key (only `model`, `maxRetries`, `batchSize`). |
| **Error messages** | Error responses in tools return `err.message` which could contain OpenAI API error bodies. These do not include the API key (only status codes and body text). The `Authorization` header in `callApi` sends the key but this is standard and never logged. |
| **Embedding vectors** | Embedding vectors are mathematical representations, not reversible to original text with current techniques. HNSW index parameters (`m=16`, `ef_construction=200`) are standard and do not leak data. |
| **Assessment** | PASS — API key is properly protected. One low finding about error message verbosity (SEC-002-L01). |

### 2.6 Denial of Service — Impact: 3 × Likelihood: 3 = 9 (LOW)

| Finding | Detail |
|---------|--------|
| **Concurrency limiter** | `ConcurrencyLimiter` class caps concurrent API calls at `maxConcurrent` (default 5). This prevents unbounded parallelism. |
| **Retry with backoff** | Exponential backoff on transient failures (5xx, 429). Max 3 retries by default. |
| **Missing: per-caller rate limiting** | The embedding service has no per-agent or per-ticket rate limit. Any agent can generate unlimited embedding requests by calling `memory.add_lesson` or `memory.search_lessons` repeatedly. The concurrency limiter only bounds parallelism, not total throughput. |
| **Finding ID** | SEC-002-M02 (Medium) — see Section 4. |

### 2.7 Elevation of Privilege — Impact: 4 × Likelihood: 1 = 4 (LOW)

| Finding | Detail |
|---------|--------|
| **DB permissions** | `forgeos_user` has SELECT/INSERT/UPDATE/DELETE on lessons and lesson_embeddings. No SUPERUSER or DDL grants. |
| **Stored function** | `search_similar_lessons()` is `LANGUAGE SQL STABLE` — no side effects, no dynamic SQL, no privilege escalation vector. |
| **Tool access** | Memory tools are registered as standard MCP tools. No special privilege elevation path exists through them. |
| **Assessment** | PASS — least privilege enforced at database layer. |

---

## 3. OWASP Top 10 Checklist

| Category | Status | Notes |
|----------|--------|-------|
| **A01 Broken Access Control** | ⚠️ LOW | Memory tools lack per-agent access scoping — any agent can read/write any lesson. Acceptable in current trust model (all agents are system-internal). |
| **A02 Cryptographic Failures** | ✅ PASS | API key from env var, never stored in code/config. TLS enforced for OpenAI API calls (https://). No plaintext credential storage. |
| **A03 Injection** | ✅ PASS | All SQL queries use parameterized placeholders ($1, $2, etc.) via `pool.query()`. Stored function `search_similar_lessons()` uses typed parameters, no dynamic SQL, no string concatenation. Zod schemas validate all inputs. |
| **A04 Insecure Design** | ⚠️ LOW | No input length limit on `lesson_text` beyond min 10 chars. Extremely long text could consume excessive embedding tokens. Finding SEC-002-M03. |
| **A05 Security Misconfiguration** | ✅ PASS | `IF NOT EXISTS` guards on all DDL. No debug flags in production paths. Structured logging with pino (no console.log). |
| **A06 Vulnerable Components** | ⚠️ INFO | pgvector extension and OpenAI SDK used. `npm audit` should be run as part of CI. No known CVEs in the reviewed code's direct dependencies. |
| **A07 Auth Failures** | ✅ PASS | API key loaded from environment, not hardcoded. No user-facing auth in this subsystem (internal MCP tools only). |
| **A08 Data Integrity** | ✅ PASS | Foreign key constraints with CASCADE delete ensure referential integrity. Reflection service uses explicit transactions (BEGIN/COMMIT/ROLLBACK). |
| **A09 Logging Failures** | ✅ PASS | Structured pino logger used consistently. API key masked in all log paths. No PII logged. Error events include contextual metadata (ticket_id, stage) without sensitive data. |
| **A10 SSRF** | ✅ PASS | `baseUrl` defaults to `https://api.openai.com/v1/embeddings`. Configurable via `options.baseUrl` — only used in testing. Not exposed to external callers. No user-controlled URL construction. |

---

## 4. Findings (SARIF Summary)

### SEC-002-M01 — No Content Sanitization on Lesson Text (Medium)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-M01 |
| **Severity** | Medium |
| **CWE** | CWE-79 (Stored XSS — Preventive) |
| **Location** | `forgeos-server/src/tools/memory-add-lesson.ts:64-72` |
| **Description** | `lesson_text` is stored directly without HTML/script sanitization. While current consumers (MCP agents) treat this as plaintext JSON, if the dashboard or any web UI ever renders lesson content, stored XSS becomes possible. |
| **Impact** | 3 × Likelihood 2 = 6 (Medium — defense-in-depth gap) |
| **Remediation** | Add a text sanitization step before INSERT: strip HTML tags or apply an allowlist. Consider `validator.escape()` or `DOMPurify.sanitize()` for any web rendering path. The Zod schema should add `.max(10000)` to bound input length. |
| **Risk Accepted** | Yes — current architecture is MCP-internal only. Documented for future awareness. |

### SEC-002-M02 — No Per-Caller Rate Limiting on Embedding API (Medium)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-M02 |
| **Severity** | Medium |
| **CWE** | CWE-770 (Allocation of Resources Without Limits) |
| **Location** | `forgeos-server/src/services/embedding-service.ts:100-135` |
| **Description** | The `ConcurrencyLimiter` bounds parallelism (max 5 concurrent) but does not limit total requests per time window. A misbehaving or compromised agent could generate excessive API calls, causing cost overrun or OpenAI rate limit exhaustion. |
| **Impact** | 3 × Likelihood 3 = 9 (Medium — cost and availability impact) |
| **Remediation** | Implement a token-bucket or sliding-window rate limiter per caller or per time window (e.g., max 100 embeddings/minute). Consider tracking token usage from the `usage.prompt_tokens` field in API responses. |
| **Risk Accepted** | Yes — mitigated by the MCP server's single-agent-per-ticket model and OpenAI's own 429 handling with retry. |

### SEC-002-M03 — No Maximum Length on lesson_text Input (Medium)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-M03 |
| **Severity** | Medium |
| **CWE** | CWE-400 (Uncontrolled Resource Consumption) |
| **Location** | `forgeos-server/src/tools/memory-add-lesson.ts:34` |
| **Description** | The Zod schema enforces `z.string().min(10)` but has no `.max()` constraint. An agent could submit arbitrarily large text, consuming excessive embedding tokens (billed by token count) and potentially causing API timeouts. |
| **Impact** | 3 × Likelihood 2 = 6 (Medium — cost impact) |
| **Remediation** | Add `.max(10000)` to the `lesson_text` Zod schema (10K chars ≈ 2500 tokens, well within OpenAI limits). Also add `.max(500)` to the search `query` field in `memory-search-lessons.ts`. |
| **Risk Accepted** | Yes — agents are trusted internal actors. Documented for hardening. |

### SEC-002-L01 — Error Messages May Leak OpenAI API Error Bodies (Low)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-L01 |
| **Severity** | Low |
| **CWE** | CWE-209 (Generation of Error Message Containing Sensitive Information) |
| **Location** | `forgeos-server/src/services/embedding-service.ts:207-209` |
| **Description** | On 4xx errors, the full response body from OpenAI is included in the error message: `OpenAI API error ${statusCode}: ${body}`. While the API key is masked separately, error bodies could contain account-identifying information (org ID, rate limit details). |
| **Remediation** | Truncate or sanitize the OpenAI error body before including in the thrown error. Log full details at `debug` level only. |

### SEC-002-L02 — EmbeddingService Instantiated Per-Request (Low)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-L02 |
| **Severity** | Low |
| **CWE** | CWE-404 (Improper Resource Shutdown or Release) |
| **Location** | `forgeos-server/src/tools/memory-add-lesson.ts:79`, `memory-search-lessons.ts:95`, `memory-get-context.ts:131` |
| **Description** | Each tool handler creates a new `EmbeddingService()` instance. This bypasses the shared `ConcurrencyLimiter` — each instance has its own limiter with `maxConcurrent=5`, meaning parallel tool calls could exceed the intended concurrency bound (5 × N instances). |
| **Remediation** | Use a singleton or dependency-injected `EmbeddingService` instance shared across all tool handlers to enforce a single global concurrency limit. |

### SEC-002-L03 — Reflection Service Uses claimed_by as agent_role (Low)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-L03 |
| **Severity** | Low |
| **CWE** | CWE-345 (Insufficient Verification of Data Authenticity) |
| **Location** | `forgeos-server/src/services/reflection-service.ts:122` |
| **Description** | The `claimed_by` field (which is a worker ID or agent identifier) is used as `agent_role` when storing auto-reflected lessons. This may not accurately represent the agent's SDLC role (e.g., could be a UUID vs. "Backend"). |
| **Remediation** | Resolve the agent role from a canonical mapping or store `claimed_by` separately from `agent_role`. |

### SEC-002-L04 — Non-Transactional Lesson + Embedding Insert in add_lesson (Low)

| Field | Value |
|-------|-------|
| **Rule ID** | SEC-002-L04 |
| **Severity** | Low |
| **CWE** | CWE-367 (Time-of-Check Time-of-Use Race Condition) |
| **Location** | `forgeos-server/src/tools/memory-add-lesson.ts:66-87` |
| **Description** | The lesson INSERT and embedding INSERT are two separate `pool.query()` calls without a transaction. If the embedding INSERT fails (e.g., OpenAI API error between steps), a lesson row exists without its embedding — an orphaned record. The reflection service correctly uses `BEGIN`/`COMMIT` for this pattern. |
| **Remediation** | Wrap the lesson INSERT + embedding generation + embedding INSERT in a database transaction (matching `reflection-service.ts` pattern). |

---

## 5. Stored Function Analysis

### `search_similar_lessons()` (005-memory-engine.sql)

| Check | Result |
|-------|--------|
| Dynamic SQL | ✅ NONE — pure `LANGUAGE SQL` function |
| String concatenation | ✅ NONE — all parameters are typed (`vector`, `TEXT`, `FLOAT`, `INTEGER`) |
| SQL injection risk | ✅ NONE — parameterized function arguments, no `EXECUTE` or `format()` |
| Privilege escalation | ✅ NONE — `STABLE` volatility, read-only operations, no `SECURITY DEFINER` |
| Return type safety | ✅ Returns `JSONB` with explicit `jsonb_build_object` — no raw column exposure |

### `blast_radius()` (referenced in memory-get-context.ts)

| Check | Result |
|-------|--------|
| Called with parameterized args | ✅ `pool.query('SELECT blast_radius($1, $2)', [file_path, 3])` |
| Injection risk | ✅ NONE — parametrized |

---

## 6. pgvector / HNSW Index Security

| Concern | Assessment |
|---------|------------|
| **Data leakage via embeddings** | Embeddings are high-dimensional floating-point vectors. They are lossy projections — original text cannot be reconstructed from the embedding vector with current techniques. |
| **HNSW index parameters** | `m=16`, `ef_construction=200` are standard parameters controlling graph connectivity and build quality. They do not expose data or create side channels. |
| **Index-only scans** | pgvector HNSW indexes do not store original data — only vector values. No additional exposure beyond what's in the `embedding` column itself. |
| **Cosine distance operator** | `<=>` is a pure mathematical operation. No injection or bypass vector. |
| **Assessment** | ✅ PASS — no security concerns with pgvector configuration. |

---

## 7. API Key Security Summary

| Check | Status | Evidence |
|-------|--------|----------|
| Key source | ✅ | `process.env.OPENAI_API_KEY` — environment variable only |
| Key hardcoded | ✅ | Not found in any source file |
| Key in logs | ✅ | Masked as `***MASKED***` in all log/error paths |
| Key in error messages | ✅ | Error constructor uses `(auth: ***MASKED***)` |
| Key in init log | ✅ | Only `model`, `maxRetries`, `batchSize` logged |
| Key in serialization | ✅ | `private readonly` — not enumerable in JSON.stringify |
| Key not required check | ✅ | Throws immediately if empty |

---

## 8. Dependency / SBOM Summary

| Package | Role | Risk |
|---------|------|------|
| `pg` (node-postgres) | Database driver | Parameterized queries used throughout — no injection risk |
| `zod` | Input validation | Schema-level enforcement present on all tool inputs |
| `pino` | Structured logging | No PII or secrets in log output |
| `@modelcontextprotocol/sdk` | MCP protocol | Internal transport layer |
| pgvector (PostgreSQL ext) | Vector similarity | Standard ANN index — no data exposure |

> **Note:** `npm audit` should be verified as part of CI pipeline. No code-level dependency vulnerabilities identified in the reviewed files.

---

## 9. Verdict

**PASS** — 0 Critical, 0 High findings.

- 3 Medium findings documented with risk acceptance (content sanitization, rate limiting, input length).
- 4 Low findings documented with remediation recommendations.
- All Medium findings are defense-in-depth improvements for a system where consumers are trusted internal MCP agents.
- SQL injection prevention is comprehensive (parameterized queries + typed stored functions).
- API key protection is thorough (env-only, masked logging, private field).
- pgvector configuration is secure and standard.

### Risk Acceptance Rationale

The three Medium findings (M01–M03) are accepted because:
1. **M01 (XSS)** — No web rendering path currently exists for lesson content. All consumers are MCP agents processing JSON.
2. **M02 (Rate limiting)** — Mitigated by OpenAI's own 429 handling + retry, and the single-agent-per-ticket model.
3. **M03 (Input length)** — Agents are trusted internal actors. Adding `.max()` is recommended but not blocking.

---

## 10. SARIF Output

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "ForgeOS Security Agent",
        "version": "1.0.0",
        "rules": [
          {
            "id": "SEC-002-M01",
            "shortDescription": { "text": "No Content Sanitization on Lesson Text" },
            "defaultConfiguration": { "level": "warning" },
            "properties": { "cwe": "CWE-79" }
          },
          {
            "id": "SEC-002-M02",
            "shortDescription": { "text": "No Per-Caller Rate Limiting on Embedding API" },
            "defaultConfiguration": { "level": "warning" },
            "properties": { "cwe": "CWE-770" }
          },
          {
            "id": "SEC-002-M03",
            "shortDescription": { "text": "No Maximum Length on lesson_text Input" },
            "defaultConfiguration": { "level": "warning" },
            "properties": { "cwe": "CWE-400" }
          },
          {
            "id": "SEC-002-L01",
            "shortDescription": { "text": "Error Messages May Leak OpenAI API Error Bodies" },
            "defaultConfiguration": { "level": "note" },
            "properties": { "cwe": "CWE-209" }
          },
          {
            "id": "SEC-002-L02",
            "shortDescription": { "text": "EmbeddingService Instantiated Per-Request" },
            "defaultConfiguration": { "level": "note" },
            "properties": { "cwe": "CWE-404" }
          },
          {
            "id": "SEC-002-L03",
            "shortDescription": { "text": "Reflection Service Uses claimed_by as agent_role" },
            "defaultConfiguration": { "level": "note" },
            "properties": { "cwe": "CWE-345" }
          },
          {
            "id": "SEC-002-L04",
            "shortDescription": { "text": "Non-Transactional Lesson + Embedding Insert" },
            "defaultConfiguration": { "level": "note" },
            "properties": { "cwe": "CWE-367" }
          }
        ]
      }
    },
    "results": [
      {
        "ruleId": "SEC-002-M01",
        "level": "warning",
        "message": { "text": "lesson_text stored without HTML/script sanitization. Stored XSS risk if content is ever rendered in web UI." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/memory-add-lesson.ts" }, "region": { "startLine": 64, "endLine": 72 } } }]
      },
      {
        "ruleId": "SEC-002-M02",
        "level": "warning",
        "message": { "text": "ConcurrencyLimiter bounds parallelism but not total throughput. No per-caller or per-window rate limit on embedding API calls." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/services/embedding-service.ts" }, "region": { "startLine": 100, "endLine": 135 } } }]
      },
      {
        "ruleId": "SEC-002-M03",
        "level": "warning",
        "message": { "text": "Zod schema has min(10) but no max() on lesson_text. Unbounded input could consume excessive embedding API tokens." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/memory-add-lesson.ts" }, "region": { "startLine": 34 } } }]
      },
      {
        "ruleId": "SEC-002-L01",
        "level": "note",
        "message": { "text": "OpenAI API error response body included verbatim in thrown EmbeddingApiError. May contain org-identifying information." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/services/embedding-service.ts" }, "region": { "startLine": 207, "endLine": 209 } } }]
      },
      {
        "ruleId": "SEC-002-L02",
        "level": "note",
        "message": { "text": "New EmbeddingService() per tool call creates independent ConcurrencyLimiters, bypassing global concurrency bound." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/memory-add-lesson.ts" }, "region": { "startLine": 79 } } }]
      },
      {
        "ruleId": "SEC-002-L03",
        "level": "note",
        "message": { "text": "claimed_by (worker ID) used as agent_role for auto-reflected lessons. May not match canonical SDLC role names." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/services/reflection-service.ts" }, "region": { "startLine": 122 } } }]
      },
      {
        "ruleId": "SEC-002-L04",
        "level": "note",
        "message": { "text": "Lesson INSERT and embedding INSERT not wrapped in a transaction. Embedding failure leaves orphaned lesson row." },
        "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "forgeos-server/src/tools/memory-add-lesson.ts" }, "region": { "startLine": 66, "endLine": 87 } } }]
      }
    ]
  }]
}
```
