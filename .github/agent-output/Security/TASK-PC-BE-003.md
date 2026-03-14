# TASK-PC-BE-003 — Security Review

**Agent:** Security Engineer  
**Stage:** SECURITY (retroactive — ticket currently at CI due to QA double-advance)  
**Date:** 2026-03-14T22:00:00Z  
**Verdict:** PASS  
**Confidence:** HIGH

---

## Scope

Files reviewed (as specified by ticket `file_paths`):

- `forgeos-server/src/services/context-hash.ts` — full file (new)
- `forgeos-server/src/services/compiler.ts` — new functions: `loadStoredPromptSnapshot`, `compileIfStale`, `invalidatePromptCache`
- `forgeos-server/src/__tests__/context-hash.test.ts` — full file (new)

---

## 1. STRIDE Threat Model

### System Context

The freshness gate sits between the DB and the LLM compilation path. Trust boundaries:

```
Agent/Caller → compileIfStale(ticketId) → DB SELECT (tickets table)
                                        → evaluatePromptFreshness (pure logic)
                                        → [CACHE HIT] return stored prompt
                                        → [MISS/STALE] → compileAndStoreTicketPrompt → LLM
                                        
Agent/Caller → invalidatePromptCache(ticketId) → DB UPDATE (tickets table)
```

Hash inputs flow: `process.env` → `buildContextHashInputsFromEnv` → `computeContextHash` → SHA-256 hex

### STRIDE Analysis

| Threat | Component | Analysis | Score | Risk |
|--------|-----------|----------|-------|------|
| **Spoofing** | `compileIfStale` caller | Functions are not yet exposed externally (no API route → no unauthenticated caller). Internal-only. | I:2 × L:1 = 2 | LOW |
| **Tampering (Cache Poisoning)** | DB `compiled_prompt_context_hash` column | To cause a false cache hit, an attacker must write an arbitrary hash to the DB. Requires existing DB write privilege — not an app-layer vulnerability. Hash is computed server-side from env vars, never from client input. | I:4 × L:1 = 4 | LOW |
| **Tampering (Hash Preimage)** | SHA-256 computation | SHA-256 is collision-resistant. An attacker cannot craft inputs that produce a known target hash without DB write privilege. | I:4 × L:1 = 4 | LOW |
| **Repudiation** | Hash changes | `logger.info` records `{ ticketId, contextHash }` on both cache hit and miss paths. Audit trail exists. | I:2 × L:1 = 2 | LOW |
| **Information Disclosure** | `CompiledPromptResult` | `canonicalContext.repoCommit` (repo commit SHA from env var) is returned in result and stored in the packet envelope. This is server-internal version metadata, not PII or credentials. Acceptable for server-to-server use. | I:1 × L:2 = 2 | LOW |
| **DoS** | `compileIfStale` | One `SELECT` on fast path; one `SELECT + UPDATE` on slow path. No amplification, no unbounded loops, no recursive calls. `invalidatePromptCache` is idempotent (NULL → NULL). | I:2 × L:1 = 2 | LOW |
| **Elevation of Privilege** | Future routing (TASK-PC-BE-005/006) | No exposure yet. When wired, caller ownership validation (can agent X invalidate ticket Y?) must be enforced. Forward-looking only. | I:3 × L:2 = 6 | LOW (future) |

**No STRIDE threat scores ≥ 10 (Medium threshold). Zero Critical (≥20) or High (≥15).**

---

## 2. OWASP Top 10

| # | Category | Finding | Status |
|---|----------|---------|--------|
| A01 | Broken Access Control | `compileIfStale` and `invalidatePromptCache` are unexported from the module's public API surface and have no direct HTTP route. Ticket ownership is not validated at this layer — acceptable because there is no external caller yet. See SEC-F1 for forward note. | ✅ PASS |
| A02 | Cryptographic Failures | SHA-256 used via `node:crypto` `createHash('sha256')`. Correct algorithm for a deterministic integrity/freshness hash (not a password hash — Argon2/bcrypt not required). No plaintext storage of sensitive data. | ✅ PASS |
| A03 | Injection (SQL) | Both DB queries use parameterized form with `$1` placeholder: `pool.query('SELECT ... WHERE ticket_id = $1', [ticketId])` and `pool.query('UPDATE ... WHERE ticket_id = $1', [ticketId])`. No string interpolation into SQL. | ✅ PASS |
| A03 | Injection (other) | `normalizeCanonicalToken` strips `\|`, `\n`, `\r`, `\t` from hash inputs. `canonicalize` uses `Object.keys().sort()` for deterministic serialization. No eval, no template-string injection. | ✅ PASS |
| A04 | Insecure Design | Hash inputs are exclusively server-controlled environment variables and compile-time constants (`PACKET_VERSION`, `TEMPLATE_VERSION`). No user-supplied data enters the hash path. | ✅ PASS |
| A05 | Security Misconfiguration | `process.env.GEMINI_API_KEY = 'test-key'` in test file is a placeholder string to toggle a conditional branch (`if (!geminiApiKey)`). The mock replaces the actual API call. Not a real credential leak (see SEC-F2). | ✅ PASS |
| A06 | Vulnerable Components | `npm audit --audit-level=high`: 1 moderate severity (Hono `<4.12.7` prototype pollution via `parseBody({ dot: true })`). Zero high or critical CVEs. Hono finding is pre-existing and not related to TASK-PC-BE-003 scope. | ✅ PASS |
| A07 | Auth Failures | No auth logic added or modified. Freshness functions are internal; no session/token handling touched. | ✅ N/A |
| A08 | Data Integrity | Hash comparison in `evaluatePromptFreshness` uses strict equality (`!==`). `stored.length === 0` guard prevents empty-string bypass. Mutation-tested by QA (all critical mutants killed). | ✅ PASS |
| A09 | Logging Failures | Uses structured `logger.info` with `{ ticketId, contextHash }`. No PII in log fields. Hash value is not a secret. | ✅ PASS |
| A10 | SSRF | No outbound HTTP calls in new code. `compileIfStale` defers to `compileAndStoreTicketPrompt` on miss (pre-existing; TASK-PC-BE-003 adds no new outbound paths). | ✅ N/A |

---

## 3. LLM Top 10 (applicable — system uses LLM compilation)

| # | Category | Finding | Status |
|---|----------|---------|--------|
| LLM01 | Prompt Injection | Hash inputs come from server-controlled env vars and constants — not from ticket content or user input. No ticket body, title, or description data enters the context hash computation. Hash cannot be poisoned via ticket content. | ✅ PASS |
| LLM02 | Insecure Output | `compileIfStale` returns `storedPrompt!` (the cached compiled prompt). This is a pre-stored server product. No LLM output rendered directly to user in this layer. | ✅ PASS |
| LLM06 | Sensitive Info Disclosure | `canonicalContext` returned in `CompiledPromptResult` contains `repoCommit`, `graphVersion`, `memorySnapshot` — version metadata only, no PII. | ✅ PASS |
| LLM08 | Excessive Agency | `invalidatePromptCache` is a destructive action (clears compiled prompt hash). It has no rate limit or ownership check at present. Acceptable as internal-only. See SEC-F1. | ✅ PASS (internal) |

---

## 4. SQL Injection Deep Verification

**`loadStoredPromptSnapshot`** (compiler.ts ~L419):
```sql
SELECT compiled_prompt, compiled_prompt_context_hash FROM tickets WHERE ticket_id = $1
```
Parameter: `[ticketId]` — fully parameterized. ✅

**`invalidatePromptCache`** (compiler.ts ~L504):
```sql
UPDATE tickets
 SET compiled_prompt_context_hash = NULL,
     compiled_prompt_freshness_status = 'missing',
     compiled_prompt_stale_reason = 'not_compiled',
     compiled_prompt_freshness_checked_at = NOW()
 WHERE ticket_id = $1
```
Parameter: `[ticketId]` — fully parameterized. `NULL`, `'missing'`, `'not_compiled'` are SQL literals, not user input. ✅

**Zero SQL injection surface in TASK-PC-BE-003 additions.**

---

## 5. Hardcoded Secrets Scan

Scan performed on `context-hash.ts` and `context-hash.test.ts`:

| Pattern | Result |
|---------|--------|
| API keys / tokens | None found in `context-hash.ts` |
| Passwords / credentials | None found in either file |
| `GEMINI_API_KEY = 'test-key'` in test | Mock placeholder value; no real key structure. Not a real API key (does not match Gemini key format `AIza...`). Used only to toggle `if (!geminiApiKey)` guards in tests. Real key is consumed via `process.env` at runtime. |
| Private keys, JWTs, secrets | None found |

**Result: No hardcoded secrets detected.**

---

## 6. npm Audit Results

```
Command: npm audit --audit-level=high
Result:  0 high, 0 critical findings

1 moderate: hono <4.12.7
  GHSA-v8w9-8mx6-g223: Prototype Pollution via parseBody({ dot: true })
  Scope: pre-existing dependency, unrelated to TASK-PC-BE-003
  fix available via: npm audit fix
```

**Gate: PASS** — zero high or critical CVEs. The moderate Hono finding is a pre-existing issue outside this ticket's scope.

---

## 7. Input Sanitization Review

`normalizeCanonicalToken` strips the following characters from hash inputs:

| Char | Code | Risk if unsanitized |
|------|------|---------------------|
| `\|` | U+007C | Log injection separator ambiguity |
| `\n` | U+000A | Multiline hash instability |
| `\r` | U+000D | Multiline hash instability |
| `\t` | U+0009 | Hash instability |

All five hash input fields (`repoCommit`, `graphVersion`, `memorySnapshot`, `packetSchema`, `templateVersion`) pass through `normalizeCanonicalToken`. The test at line 162 verifies pipe, newline, tab, and CR all map to `_`. ✅

---

## 8. Findings (SARIF format)

```json
{
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": { "driver": { "name": "ForgeOS-Security", "version": "1.0" } },
      "results": [
        {
          "ruleId": "SEC-F1",
          "level": "note",
          "message": {
            "text": "compileIfStale / invalidatePromptCache have no caller ownership check (any internal caller can invalidate any ticket). When these functions are wired into HTTP routes (TASK-PC-BE-005/006), a caller ownership guard must be added. No current external attack surface."
          },
          "locations": [{
            "physicalLocation": {
              "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
              "region": { "startLine": 442 }
            }
          }],
          "properties": { "cwe": "CWE-284", "severity": "informational" }
        },
        {
          "ruleId": "SEC-F2",
          "level": "note",
          "message": {
            "text": "process.env.GEMINI_API_KEY = 'test-key' in test file. Confirmed placeholder — not a real credential. Pattern does not match real Gemini key format. Mocked API layer is in place."
          },
          "locations": [{
            "physicalLocation": {
              "artifactLocation": { "uri": "forgeos-server/src/__tests__/context-hash.test.ts" },
              "region": { "startLine": 257 }
            }
          }],
          "properties": { "cwe": "N/A", "severity": "informational" }
        },
        {
          "ruleId": "SEC-F3",
          "level": "note",
          "message": {
            "text": "npm audit: 1 moderate vulnerability in hono <4.12.7 (GHSA-v8w9-8mx6-g223). Pre-existing, not introduced by TASK-PC-BE-003. Recommend: npm audit fix in follow-up maintenance ticket."
          },
          "locations": [{
            "physicalLocation": {
              "artifactLocation": { "uri": "forgeos-server/package.json" },
              "region": { "startLine": 1 }
            }
          }],
          "properties": { "cwe": "CWE-1321", "severity": "moderate", "preExisting": true }
        }
      ]
    }
  ]
}
```

---

## 9. Summary

| Check | Result |
|-------|--------|
| STRIDE — 7 threat categories analyzed | ✅ Zero Medium/High/Critical threats |
| OWASP A01–A10 | ✅ 10/10 checked, 0 failures |
| LLM01, LLM02, LLM06, LLM08 | ✅ 4/4 checked, 0 failures |
| SQL Injection (parameterized queries) | ✅ Confirmed |
| Hardcoded secrets scan | ✅ None found |
| npm audit --audit-level=high | ✅ 0 high, 0 critical (1 moderate pre-existing) |
| Input sanitization | ✅ normalizeCanonicalToken strips injection chars |
| Cryptography (SHA-256) | ✅ Correct algorithm for use case |

**Findings:** 3 × Informational (no gate failures)  
**Critical:** 0  
**High:** 0  
**Medium:** 0  
**Low/Informational:** 3

---

## Verdict

**PASS** — Zero critical or high security findings. The freshness gate implementation in TASK-PC-BE-003 is secure: all SQL is parameterized, SHA-256 is the correct algorithm for this non-password hash use case, no hardcoded secrets exist in changed files, and hash inputs are server-controlled environment variables with no user-input attack surface. The informational findings are forward-looking notes for when these functions are wired into the HTTP API layer (TASK-PC-BE-005/006).

**Confidence:** HIGH

**Artifacts:**
- `.github/agent-output/Security/TASK-PC-BE-003.md` (this file)
