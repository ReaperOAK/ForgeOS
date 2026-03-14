# TASK-PC-BE-002 — Security Review Report

## Verdict: PASS

**Confidence:** HIGH
**Date:** 2026-03-14
**Reviewer:** Security Engineer
**Stage:** SECURITY → CI

---

## Scope

Files reviewed (per ticket `file_paths`):

| File | Role |
|------|------|
| `forgeos-server/src/services/compiler.ts` | JIT prompt compiler — core logic |
| `forgeos-server/src/tools/tickets-claim.ts` | Claim lifecycle trigger hook |
| `forgeos-server/src/webhooks/reconciliation.ts` | Stage-transition trigger hook |
| `forgeos-server/src/__tests__/prompt-lifecycle-guardrails.test.ts` | Static regression guardrail tests |

---

## STRIDE Threat Model

### Trust Boundary Map

```
Ticket DB (authoritative) → gatherInvestigation → Gemini API (LLM) → extractGeminiText
                                                              ↓
                                                    compileAndStoreTicketPrompt
                                                              ↓
                                          tickets.compiled_prompt column (DB) → downstream agents
```

| Threat | Component | Impact | Likelihood | Score | Severity |
|--------|-----------|--------|-----------|-------|----------|
| **Spoofing** | `queueCompileTicketPrompt` — any authenticated caller of tickets.claim or reconciliation can trigger compile for any `ticket_id`. Both callers are authenticated server-side. | 2 | 1 | 2 | Low |
| **Tampering** | Ticket description/acceptance_criteria contain raw user-authored text → serialised into Gemini user turn. Adversarial content could attempt LLM01 prompt injection. System prompt is a separate `systemInstruction` API field (not user turn). | 2 | 2 | 4 | Low |
| **Repudiation** | `trigger` value + `ticketId` + idempotency key logged via structured logger at INFO level on every queue entry and completion. Audit trail adequate. | 1 | 1 | 1 | None |
| **Information Disclosure** | `GEMINI_API_KEY` read from `process.env`, never logged, never hardcoded. DB query results not echoed to external surfaces. | 1 | 1 | 1 | None |
| **DoS** | In-memory compile queue with idempotency: unique `ticketId:trigger` keys deduplicate repeated calls. However, callers could construct many unique trigger suffixes to bypass dedup. Queue is single-node in-memory — bounded by Node.js heap, not by external rate limit. Risk is process-scoped and not externally exploitable without authenticated access. | 2 | 2 | 4 | Low |
| **Elevation of Privilege** | No permission model changes. Compile result stored in DB; trigger does not alter ticket `stage` or `status`. | 1 | 1 | 1 | None |

**No scores ≥ 10 (Critical), ≥ 15 (High), or ≥ 20 (Critical).**

---

## OWASP Top 10 Checklist

| # | Category | Result | Notes |
|---|----------|--------|-------|
| A01 | Broken Access Control | ✓ PASS | No new endpoints. Compile trigger gated behind existing authenticated claim/reconciliation paths. |
| A02 | Cryptographic Failures | ✓ PASS | No plaintext secrets; `GEMINI_API_KEY` via env. DB at rest/in-transit is infrastructure concern (out of scope for this ticket). |
| A03 | Injection | ✓ PASS | All DB writes use parameterised queries (`$1`…`$15`). LLM prompt injection risk exists but is LOW (see LLM Top 10 below). |
| A04 | Insecure Design | ✓ PASS | Queue-based fire-and-forget with idempotency key is a sound design. No lifecycle state mutations from compile path. |
| A05 | Security Misconfiguration | ✓ PASS | No new config surfaces. No debug flags introduced. |
| A06 | Vulnerable Components | ⚠ MODERATE (not in scope) | `npm audit` shows 1 moderate-severity Hono prototype pollution (GHSA-v8w9-8mx6-g223). Not introduced by this PR. Tracked below. |
| A07 | Auth Failures | ✓ PASS | No new auth or session code. |
| A08 | Data Integrity | ✓ PASS | Compiled prompt persisted via parameterised UPDATE with explicit column names. `metadata` merged with `COALESCE + jsonb ||` operator — no arbitrary key injection. |
| A09 | Logging Failures | ✓ PASS | Structured logger used throughout. Only `ticketId`, `trigger`, `idempotencyKey`, model names, and error messages logged — no PII, no credentials. |
| A10 | SSRF | ✓ PASS | `codeBlastRadiusHandler` and `codeSearchSymbolsHandler` accept `file_path` from ticket `file_scope`, but these pass the path as a parameterised argument to a DB stored procedure (`blast_radius()`) — no outbound HTTP requests constructed from user input. Not a SSRF vector. |

---

## LLM Top 10 (AI/Agent Features Present)

| # | Category | Result | Notes |
|---|----------|--------|-------|
| LLM01 | Prompt Injection | ⚠ LOW | `gatherInvestigation` assembles raw ticket fields (`title`, `description`, `acceptance_criteria`) and serialises them with `JSON.stringify` into the Gemini user turn. A crafted ticket description could attempt to override system instructions. **Mitigation in place:** `systemInstruction` is a separate Gemini API field (not injected into user content); model temperature is 0.1 (low creativity); compiled output is used as context only, never as executable code. No immediate remediation required; recommend input normalisation in a future hardening pass. |
| LLM02 | Insecure Output Handling | ⚠ LOW | Gemini-generated prompt is stored in DB via parameterised query; downstream agents consume it as instruction context. If injection via LLM01 succeeded, the output could carry adversarial instructions. **Mitigation:** internal-only deployment; no user-facing rendering of compiled prompt. Acceptable risk at current threat level. |
| LLM06 | Sensitive Info Disclosure | ✓ PASS | Investigation object contains ticket metadata (title, description, file paths) — not credentials or PII beyond what is already in the ticket row. |
| LLM08 | Excessive Agency | ✓ PASS | Compiler only reads context and writes to `compiled_prompt` column. It does NOT execute compiled prompt, does NOT mutate ticket stage/status, and does NOT trigger downstream actions. Capability boundary is well-constrained. |

---

## Secret Scan

| Pattern | Scope | Result |
|---------|-------|--------|
| Hardcoded API keys/tokens | All 4 in-scope files | NONE |
| Hardcoded passwords/private keys | All 4 in-scope files | NONE |
| `process.env` API key access | `compiler.ts:179` | CORRECT — `GEMINI_API_KEY` read from env; not logged |
| `.env` files committed to VCS | `forgeos-server/secrets/` | Pre-existing — out of scope of this PR |

---

## Dependency Audit

```
npm audit --audit-level=high
# Result: 0 high, 0 critical vulnerabilities
# 1 moderate: hono < 4.12.7 (GHSA-v8w9-8mx6-g223)
#   Prototype Pollution in parseBody({ dot: true })
#   Fix: npm audit fix (version bump)
#   NOT introduced by this PR; pre-existing
```

**Critical/High count: 0** — audit gate passes.

---

## SARIF Findings

```json
{
  "$schema": "https://json.schemastore.org/sarif-2.1.0",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS Security Engineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "LLM01-001",
              "name": "PromptInjectionRisk",
              "shortDescription": { "text": "Raw ticket content passed to LLM user turn without sanitization" },
              "fullDescription": { "text": "Ticket description and acceptance_criteria are included verbatim in the Gemini user prompt via JSON.stringify. An adversarial ticket description could attempt to override system instructions." },
              "defaultConfiguration": { "level": "note" },
              "properties": { "tags": ["LLM01", "CWE-77"], "security-severity": "2.0" }
            },
            {
              "id": "LLM02-001",
              "name": "UnsanitizedLLMOutput",
              "shortDescription": { "text": "LLM output stored as agent instruction context without output sanitization" },
              "fullDescription": { "text": "Gemini-generated compiled prompt is persisted to DB and consumed by downstream agents as execution context. If LLM01 injection succeeded, adversarial content could propagate." },
              "defaultConfiguration": { "level": "note" },
              "properties": { "tags": ["LLM02", "CWE-116"], "security-severity": "1.5" }
            },
            {
              "id": "DEP-001",
              "name": "ModerateVulnerableDependency",
              "shortDescription": { "text": "Hono < 4.12.7 — moderate prototype pollution (GHSA-v8w9-8mx6-g223)" },
              "fullDescription": { "text": "Pre-existing moderate CVE in hono; not introduced by this PR. parseBody({ dot: true }) prototype pollution. Not exercised by compiler path." },
              "defaultConfiguration": { "level": "warning" },
              "properties": { "tags": ["A06", "CWE-1321"], "security-severity": "4.3" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "LLM01-001",
          "level": "note",
          "message": { "text": "Raw ticket field 'description' and 'acceptance_criteria' serialised into Gemini user turn. Mitigated by systemInstruction separation and temperature=0.1." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
                "region": { "startLine": 501 }
              }
            }
          ]
        },
        {
          "ruleId": "LLM02-001",
          "level": "note",
          "message": { "text": "extractGeminiText output written to DB via parameterised query; consumed as agent instruction context. Acceptable for internal-only deployment." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
                "region": { "startLine": 228 }
              }
            }
          ]
        },
        {
          "ruleId": "DEP-001",
          "level": "warning",
          "message": { "text": "Pre-existing hono moderate vulnerability. Requires npm audit fix in a separate dependency-update ticket." },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/package.json" },
                "region": { "startLine": 1 }
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

## Guardrail Test Robustness Assessment

The `prompt-lifecycle-guardrails.test.ts` suite uses `readFileSync` + string pattern assertions as a static analysis regression mechanism. This is a valid, deterministic approach.

**Strengths:**
- Checks the actual compiled source files at the path resolved from `process.cwd()` — no mock substitution possible
- Pattern matching covers all known forbidden access patterns (FS imports, write operations, direct state path strings)
- Queue-based trigger pattern check ensures the integration contract cannot silently regress

**Residual limitation (informational only):**
- Uses `process.cwd()` to resolve paths; requires tests to be run from `forgeos-server/` directory. CI must `cd forgeos-server` first (confirmed by QA run evidence).
- String containment assertions cannot catch obfuscated violations (e.g., dynamic string concatenation that assembles `.github/ticket-state`). This is an acceptable trade-off for a regression guardrail; full AST analysis would be required for exhaustive coverage.

**Assessment: FIT FOR PURPOSE**

---

## AC Verification

| AC | Criterion | Security Assessment |
|----|-----------|---------------------|
| AC1 | No `.github/ticket-state` or `.github/tickets` refs in prompt lifecycle modules | ✓ CONFIRMED — grep and guardrail test both verify. |
| AC2 | Lifecycle transitions remain delegated to existing lifecycle interfaces | ✓ CONFIRMED — compile path has zero state mutation; only reads and writes `compiled_prompt` column. |
| AC3 | CI-fast regression suite fails fast if forbidden paths introduced | ✓ CONFIRMED — deterministic static assertions with no side effects or timing dependencies. |
| AC4 | All prompt lifecycle modifications within `forgeos-server` lifecycle contracts | ✓ CONFIRMED — scope confined to compiler.ts, tickets-claim.ts, reconciliation.ts. |

---

## Summary

- **Critical findings:** 0
- **High findings:** 0
- **Medium findings:** 0
- **Low findings:** 2 (informational LLM01/LLM02 notes — no remediation required pre-CI)
- **Moderate pre-existing dependency:** 1 (Hono — not introduced by this PR)
- **Hardcoded secrets:** 0
- **Forbidden FS state paths:** 0

**VERDICT: PASS — advance to CI stage.**
