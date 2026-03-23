# TASK-PC-BE-003 — Security Review Report

**Agent:** Security Engineer  
**Stage:** SECURITY  
**Date:** 2026-03-14T17:23:03Z  
**Verdict:** PASS  
**Confidence:** HIGH

---

## Summary

Full STRIDE threat model, OWASP Top 10 checklist, secret scan, and dependency audit completed.  
Zero critical findings. Zero high findings. One pre-existing moderate CVE in `hono` (unrelated to reviewed files).

---

## Files Reviewed

- `forgeos-server/src/services/context-hash.ts`
- `forgeos-server/src/services/compiler.ts` (functions: `compileIfStale`, `invalidatePromptCache`)

---

## Tool Execution Results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `tsc --noEmit` | ✅ EXIT 0 — 0 errors |
| ESLint | `eslint context-hash.ts compiler.ts --max-warnings=0` | ✅ EXIT 0 — 0 warnings |
| Unit tests | `vitest run src/__tests__/context-hash.test.ts` | ✅ 11/11 pass, EXIT 0 |
| Dependency audit | `npm audit --audit-level=high` | ✅ 0 high/critical (1 moderate, unrelated) |

---

## STRIDE Threat Model

### Trust Boundaries

1. **External env → `buildContextHashInputsFromEnv`** — environment variables from process.env
2. **`compileIfStale` → PostgreSQL** — SELECT (read stored hash), UPDATE (write on invalidation)
3. **`invalidatePromptCache` → PostgreSQL** — UPDATE (clears hash/freshness metadata)
4. **Hash comparison in `evaluatePromptFreshness`** — in-memory, no IO

### STRIDE Analysis

| Component | Threat | Score (I×L) | Mitigation | Status |
|-----------|--------|-------------|------------|--------|
| `buildContextHashInputsFromEnv` | **Spoofing** — attacker controls env vars → crafts matching hash | 3×2=6 (Low) | Environment is controlled by the deployment runtime; not user-injected | ✅ Acceptable |
| `normalizeCanonicalToken` | **Tampering** — inject `\|`, `\n`, `\r`, `\t` to mutate canonical form | 2×2=4 (Low) | Stripped and replaced with `_` before hashing | ✅ Mitigated |
| `computeContextHash` | **Tampering** — hash collision or length extension to forge "fresh" status | 3×1=3 (Low) | SHA-256 collision resistance is sound; no `H(secret||msg)` construction → length extension N/A | ✅ No vector |
| `evaluatePromptFreshness` | **Elevation of Privilege** — manipulate stored hash in DB to force fresh/stale | 3×2=6 (Low) | DB write requires authenticated pool connection; function uses exact-match comparison, no timing oracle | ✅ Protected by DB auth |
| `invalidatePromptCache` | **DoS** — mass invalidation floods recompile queue | 2×2=4 (Low) | Not exposed to HTTP routes; only called from internal service layer | ✅ No external attack surface |
| `compileIfStale` logger | **Information Disclosure** — log leaks sensitive data | 2×1=2 (Low) | Logs only `ticketId` (non-sensitive identifier) and `contextHash` (SHA-256 digest, not a secret) | ✅ No PII/secrets |
| `invalidatePromptCache` | **Repudiation** — cache cleared without audit trail | 2×2=4 (Low) | DB `compiled_prompt_freshness_checked_at = NOW()` stamps the event | ✅ Timestamp preserved |

**No scores ≥ 10. No Critical or High STRIDE findings.**

---

## OWASP Top 10 Checklist

| # | Category | Finding | Status |
|---|----------|---------|--------|
| A01 | Broken Access Control | `compileIfStale` and `invalidatePromptCache` are NOT exposed to any HTTP or MCP route at this stage. Only test-harness callers found in `__tests__/`. | ✅ PASS |
| A02 | Cryptographic Failures | SHA-256 via `node:crypto` `createHash('sha256')`. No MD5/SHA-1. No plaintext secret storage. TLS enforcement is at infrastructure layer, out of scope here. | ✅ PASS |
| A03 | Injection | `invalidatePromptCache` uses parameterized query `WHERE ticket_id = $1` with bound parameter `[ticketId]`. Zero string interpolation in SQL. `normalizeCanonicalToken` strips pipe/newline/tab control chars before any string embedding. | ✅ PASS |
| A04 | Insecure Design | Canonical key ordering via `canonicalize()` (recursive sorted `Object.keys`) prevents hash manipulation through key reordering. Freshness gate is pure function; state mutations isolated to DB write. | ✅ PASS |
| A05 | Security Misconfiguration | No debug flags or unsafe defaults. `hashInputs` never includes runtime secrets. `GEMINI_API_KEY` read in a separate function and never included in hash computation or logged. | ✅ PASS |
| A06 | Vulnerable Components | `npm audit --audit-level=high`: 0 high/critical. **1 moderate**: `hono <4.12.7` — prototype pollution via `parseBody({ dot: true })`. **NOT used in reviewed files.** Freshness gate uses `node:crypto` only. No impact on reviewed code. | ⚠️ MODERATE (unrelated, pre-existing) |
| A07 | Auth Failures | No auth logic in reviewed files. Auth is enforced at middleware layer upstream. | ✅ N/A (not in scope) |
| A08 | Data Integrity | Hash inputs are version identifiers (git SHAs, semver strings). No deserialization of untrusted binary data. `canonical Serialize` is deterministic JSON stringification. | ✅ PASS |
| A09 | Logging Failures | Structured logging via `logger` (pino). Log fields: `ticketId`, `contextHash` (SHA-256 digest), `freshnessStatus`, `staleReason`. No PII, no credentials, no raw prompts in log fields. | ✅ PASS |
| A10 | SSRF | No outbound HTTP calls in reviewed functions. `buildContextHashInputsFromEnv` reads only `process.env`. | ✅ N/A (not in scope) |

---

## Secret Scanning

No hardcoded secrets, API keys, tokens, or credentials found in:
- `context-hash.ts` — uses `node:crypto` only; no external imports
- `compiler.ts` (reviewed functions) — hash inputs are version/commit identifiers only

Hash inputs verified as non-sensitive:
- `repoCommit` → git commit SHA (`FORGEOS_REPO_COMMIT` / `GIT_COMMIT_SHA` / `SOURCE_COMMIT`)
- `graphVersion` → `FORGEOS_GRAPH_VERSION` (version string)
- `memorySnapshot` → `FORGEOS_MEMORY_SNAPSHOT_VERSION` (version string)
- `packetSchema` → `PACKET_VERSION` constant
- `templateVersion` → `TEMPLATE_VERSION` constant

`GEMINI_API_KEY` is isolated in `tryGenerateGeminiPrompt` (separate function, not in scope), instantiated directly into `GoogleGenAI` SDK constructor, never included in hash inputs, never logged.

---

## Input Sanitization Analysis

### `normalizeCanonicalToken(value: string): string`
```
value.trim().replace(/[|\n\r\t]/g, '_')
```
- **Trim**: removes leading/trailing whitespace — prevents hash-by-whitespace spoofing
- **Pipe strip `|`**: canonical separator escape prevention
- **Newline/CR/Tab strip**: prevents multiline injection breaking canonical serialization
- Output used only as JSON object property value before SHA-256 hashing — no render/SQL/exec path
- **SAFE** ✅

### `canonicalize()` recursive key sort
- Recursively sorts object keys with `a.localeCompare(b)` — deterministic across insertion order
- Arrays preserved as-is (order-sensitive)
- Handles non-object primitives as base case
- **SAFE** ✅

---

## SQL Security Analysis

### `invalidatePromptCache`
```sql
UPDATE tickets
SET compiled_prompt_context_hash = NULL,
    compiled_prompt_freshness_status = 'missing',
    compiled_prompt_stale_reason = 'not_compiled',
    compiled_prompt_freshness_checked_at = NOW()
WHERE ticket_id = $1
```
- Parameterized query — `ticketId` bound as `$1`, no string interpolation
- Sets only freshness metadata columns to safe sentinel values (`NULL`, `'missing'`, `'not_compiled'`)
- No arbitrary value injection possible
- **SAFE** ✅

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
          "name": "ForgeOS Security Engineer",
          "version": "1.0.0",
          "rules": []
        }
      },
      "results": [
        {
          "ruleId": "MOD-001",
          "level": "note",
          "message": {
            "text": "Moderate CVE: hono <4.12.7 prototype pollution via parseBody({ dot: true }). Not used in reviewed files. Risk accepted pending upgrade via npm audit fix."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/package.json" }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Critical findings: 0**  
**High findings: 0**  
**Medium findings: 0** (hono CVE is pre-existing moderate, not in reviewed files)  
**Low/Note findings: 1** (hono CVE advisory)

---

## Dependency SBOM Summary

- **Total direct dependencies:** per `package.json`
- **Vulnerabilities:** 0 critical, 0 high, 1 moderate (`hono` prototype pollution — not in reviewed code path)
- **Recommended action:** `npm audit fix` to upgrade hono (non-breaking patch)

---

## Verdict: PASS

All STRIDE threat scores < 10. OWASP Top 10 applied — 10/10 categories checked — 0 violations in reviewed code.  
No secrets hardcoded. No injection vectors. No cryptographic misuse. SQL parameterized.  
The one moderate CVE (`hono`) does not affect `context-hash.ts` or `compiler.ts` (freshness gate functions).

→ Advancing to CI stage.
