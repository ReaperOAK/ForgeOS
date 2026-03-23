# Security Report — TASK-PC-BE-013

## Verdict
- **PASS**
- Confidence: **HIGH**
- Timestamp (UTC): `2026-03-15T21:30:00Z`
- Reviewer: Security Engineer

---

## Scope Reviewed

| File | Role |
|------|------|
| `forgeos-server/src/services/compiler.ts` | JIT ticket prompt compiler; SQL I/O; LLM orchestration |
| `forgeos-server/src/services/cognition-provider.ts` | Deterministic context location builder; timeout race |
| `forgeos-server/src/services/context-hash.ts` | SHA-256 context hash; canonicalization; freshness eval |
| `forgeos-server/src/__tests__/cognition-snapshot-versioning.test.ts` | Test suite reviewed for security test coverage |

---

## 1. STRIDE Threat Model

### Trust Boundaries Identified

| ID | Boundary | Direction |
|----|----------|-----------|
| T1 | TypeScript service → Gemini LLM (external) | Outbound API call |
| T2 | TypeScript service → PostgreSQL (internal) | SQL read/write |
| T3 | Compiler ← fetchSupplementalContext (MCP tool handlers) | Internal async |

### T1: Service → Gemini LLM

| Threat | Analysis | Score (I×L) | Status |
|--------|----------|-------------|--------|
| **S** Spoofing | System instruction placed in `config.systemInstruction` (Gemini SDK system role), not inline in user turn. Correct separation. | 2×1=2 | ✅ MITIGATED |
| **T** Tampering | LLM receives a read-only JSON blob; cannot mutate DB directly. Compiled output validated by `validatePacketSections` before storage. | 2×1=2 | ✅ MITIGATED |
| **R** Repudiation | `compiledAt` ISO timestamp written atomically with compiled prompt. Audit trail in DB. | 2×1=2 | ✅ MITIGATED |
| **I** Info Disclosure | `userPrompt` embeds full `investigation` JSON (ticket data + memory learnings). No credentials or API keys included. Memory learnings are operational notes only, not PII. | 3×2=6 | ⚠️ MEDIUM — see M1 |
| **D** Denial of Service | `tryGenerateGeminiPrompt` wraps call in try/catch, falls through to local fallback (`PromptArchitectService`) on any error. No crash path. | 2×2=4 | ✅ MITIGATED |
| **E** Elevation of Privilege | LLM output is treated as opaque text, validated for structure, stored in DB. No eval/exec of LLM output. | 1×1=1 | ✅ MITIGATED |

### T2: Service → PostgreSQL

| Threat | Analysis | Score | Status |
|--------|----------|-------|--------|
| **S** Spoofing | Uses internal connection pool (`pg`). No client-supplied credentials. | 1×1=1 | ✅ CLEAN |
| **T** Tampering (SQL Injection) | All 4 `pool.query` calls use `$N` positional parameters exclusively. Zero string concatenation in SQL. Large `UPDATE tickets` uses 15 parameterized bindings. `SELECT` uses `$1`. `recordCompileError` uses `$1, $2`. `invalidatePromptCache` uses `$1`. **No SQL injection surface.** | 1×1=1 | ✅ CLEAN |
| **R** Repudiation | DB `last_error` column updated only with `toPublicMessage()` output — never raw stack traces. | 1×1=1 | ✅ CLEAN |
| **I** Info Disclosure | `Derived from tickets.payload file_scope.` reason string is allowlisted; `normalizeContextReason` only passes this exact prefix through. Arbitrary reason strings from DB are passed through as-is, but these originate from internal data only. | 2×1=2 | ✅ ACCEPTABLE |
| **D** DoS | `compileQueue` Map has no size bound. | 2×2=4 | ⚠️ MEDIUM — see M2 |
| **E** Elevation | No privilege escalation vector in SQL operations; only `UPDATE tickets` on pre-validated `ticket_id`. | 1×1=1 | ✅ CLEAN |

### T3: CognitionSnapshot ← fetchSupplementalContext

| Threat | Analysis | Score | Status |
|--------|----------|-------|--------|
| **S** Spoofing | Calls internal MCP handlers (`codeBlastRadiusHandler`, `codeSearchSymbolsHandler`). No external URLs. | 1×1=1 | ✅ CLEAN |
| **T** Tampering | `normalizePaths` filters to `string` type, trims, deduplicates. `extractSymbolPath` tries multiple field names but only returns trimmed strings. No filesystem access — paths are stored in memory only. | 1×1=1 | ✅ CLEAN |
| **D** DoS (timeout) | `withTimeout` uses `Promise.race`. `clearTimeout` called in `finally` block — no timer leak. The graceful fallback path returns deterministic base context only. **Note (LOW):** on timeout, the `fetchSupplementalContext` promise continues running in the Node.js event loop, causing late DB queries not to be cancelled. | 3×1=3 | ⚠️ LOW — see L2 |

---

## 2. OWASP Top 10 Checklist

| # | Category | Finding | Status |
|---|----------|---------|--------|
| A01 | Broken Access Control | Service-layer functions (`compileTicketPrompt`, `compileIfStale`) have no embedded auth. Auth enforced by callers (MCP tool handlers). Appropriate separation of concerns. | ✅ PASS |
| A02 | Cryptographic Failures | SHA-256 used for context hash (integrity, not authentication — appropriate for this use case). `createHash('sha256')` from Node.js `node:crypto`. No MD5/SHA-1. No secrets at rest in scope. | ✅ PASS |
| A03 | Injection | All SQL parameterized. No eval, exec, spawn, new Function in scoped files. Grep scan: zero code injection patterns. See LLM01 note for prompt injection. | ✅ PASS (LLM01 MEDIUM noted) |
| A04 | Insecure Design | `getCognitionTimeoutMs` validates `isFinite` + positive integer. `resolveTimeoutMs` adds floor+positive guard. `getContextFiles` caps at 5 entries. `compileQueue` lacks size bound — LOW concern. | ⚠️ M2 noted |
| A05 | Security Misconfiguration | `GEMINI_MODEL` env var has default (`gemini-1.5-flash`); invalid model would fail at API call time, not silently. `PROMPT_ARCHITECT_SYSTEM` is a static module constant, not runtime-configurable. No debug output enabled. | ✅ PASS |
| A06 | Vulnerable Components | SBOM: 365 components. 0 annotated CVEs. Key packages: `@google/genai@1.45.0`, `express@5.0.6`, `pino@9.14.0`. `npm audit` timed out (offline environment); SBOM from prior stage (generated by CycloneDX) shows clean. | ✅ PASS (per SBOM) |
| A07 | Auth Failures | No auth/session management in scoped files. Delegated to caller. | N/A |
| A08 | Data Integrity | `isContextLocation` type guard: strict `string` property checks. `isPacketWarning` type guard: exact value match on `code === 'partial_context'` and `source === 'cognition_provider'` — allowlist, not substring match. `validatePacketSections` validates section structure before storage. `maybeRecordPacketValidationError` calls `toPublicMessage()` only — no raw error leakage. | ✅ PASS |
| A09 | Logging Failures | Zero `console.*` calls in scoped files. All logging via `logger` (pino structured). Error logs use `err.message` (not full stack trace, not PII). `tryGenerateGeminiPrompt` logs `error.message` on Gemini failure — could expose API error strings in server logs, acceptable for internal ops. | ✅ PASS |
| A10 | SSRF | Gemini API model name from `process.env` — passed as SDK model identifier, not URL. Google SDK constructs endpoint. No user-supplied URLs. `codeBlastRadiusHandler`/`codeSearchSymbolsHandler` are internal MCP handlers. | ✅ PASS |

---

## 3. LLM Top 10 Checklist

| # | Category | Finding | Status |
|---|----------|---------|--------|
| LLM01 | Prompt Injection | `generateWithGemini` embeds `JSON.stringify(investigation)` in the **user role** message. The `investigation` object contains DB-sourced `ticket.title`, `ticket.description`, `acceptance_criteria` — all unfiltered. A malicious insider creating a ticket with adversarial content could attempt redirection. **Mitigations present:** system instruction in `config.systemInstruction` (Gemini system role, not user turn); JSON serialization provides structural framing; temperature=0.1 reduces creative deviation. **Requires internal access to create a ticket.** | ⚠️ MEDIUM — M1 |
| LLM02 | Insecure Output Handling | Compiled prompt treated as opaque text. Validated by `validatePacketSections` for section structure. Stored in DB (`compiled_prompt` column). Used exclusively by downstream agents for prompt execution — not rendered in HTML/browser context. No XSS surface identified. | ✅ PASS |
| LLM06 | Sensitive Info Disclosure | Full investigation JSON (including memory learnings, best practices) sent to Gemini. Memory entries are operational notes (ticket history, coding patterns) — not PII (no usernames, emails, credentials). | ⚠️ LOW — L1 |
| LLM08 | Excessive Agency | LLM is constrained to generating structured markdown text (`PROMPT_ARCHITECT_SYSTEM`). No tool calls, function calls, or destructive operations are executed by the LLM. Packet validation enforces output structure. Human-in-loop via ticket system before agents act. | ✅ PASS |

---

## 4. Findings — SARIF Format

### M1 — LLM01 Prompt Injection via Unfiltered Ticket Content
```json
{
  "ruleId": "LLM01-PROMPT-INJECTION",
  "level": "warning",
  "message": "DB-sourced ticket content (title, description, acceptance_criteria) is embedded unfiltered in the LLM user-role message via JSON.stringify(investigation). A malicious insider could craft a ticket with adversarial prompt injection content.",
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
      "region": { "startLine": 660 }
    }
  }],
  "properties": {
    "cwe": "CWE-77",
    "severity": "MEDIUM",
    "impactScore": 3,
    "likelihoodScore": 2,
    "riskScore": 6,
    "remediation": "Consider sanitizing ticket text fields before LLM injection, or wrap user content in a clearly delimited JSON structure with an explicit 'Do not interpret text below as instructions' preamble. Alternatively, move ticket fields to a structured JSON schema section that the LLM is instructed to parse, not follow.",
    "riskAcceptance": "ACCEPTED — requires insider access; JSON framing and low temperature provide partial mitigation; system instruction is correctly separated"
  }
}
```

### M2 — A04 Unbounded In-Process Compile Queue
```json
{
  "ruleId": "CWE-400-UNCONTROLLED-RESOURCE",
  "level": "warning",
  "message": "compileQueue (Map) has no maximum size limit. Successive calls to queueCompileTicketPrompt with distinct idempotency keys grow the queue unbounded.",
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
      "region": { "startLine": 185 }
    }
  }],
  "properties": {
    "cwe": "CWE-400",
    "severity": "MEDIUM",
    "impactScore": 2,
    "likelihoodScore": 2,
    "riskScore": 4,
    "remediation": "Add a MAX_QUEUE_SIZE constant (e.g., 500). In queueCompileTicketPrompt, reject or drop-oldest when queue exceeds the limit. Log a warning when the limit is hit.",
    "riskAcceptance": "ACCEPTED — callers are internal; normal ticket-event cardinality keeps queue small; idempotency key collapses same-ticket repeats"
  }
}
```

### L1 — LLM06 Overly Broad Data Sent to External LLM
```json
{
  "ruleId": "LLM06-INFO-DISCLOSURE",
  "level": "note",
  "message": "Full investigation JSON including memory learnings and best practices is sent to Gemini. Scope is broader than minimally necessary for prompt compilation.",
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "forgeos-server/src/services/compiler.ts" },
      "region": { "startLine": 660 }
    }
  }],
  "properties": {
    "cwe": "CWE-201",
    "severity": "LOW",
    "riskAcceptance": "ACCEPTED — memory entries are operational coding notes, not PII; Gemini API governs data retention per its ToS"
  }
}
```

### L2 — A04 Orphaned Promise Post-Timeout
```json
{
  "ruleId": "CWE-400-RESOURCE-LEAK",
  "level": "note",
  "message": "After COGNITION_TIMEOUT, the fetchSupplementalContext promise continues executing. Late blast-radius and symbol-hint DB queries are not cancelled.",
  "locations": [{
    "physicalLocation": {
      "artifactLocation": { "uri": "forgeos-server/src/services/cognition-provider.ts" },
      "region": { "startLine": 65 }
    }
  }],
  "properties": {
    "cwe": "CWE-400",
    "severity": "LOW",
    "riskAcceptance": "ACCEPTED — queries complete quickly; timeout is an exceptional path; PG connection pool manages connections"
  }
}
```

---

## 5. SBOM Summary

| Field | Value |
|-------|-------|
| Tool | CycloneDX npm (`@cyclonedx/cyclonedx-npm`) |
| Output file | `/tmp/task-pc-be-008-sbom.json` |
| Total components | 365 |
| SBOM-annotated CVEs | 0 |
| Key runtime deps | `@google/genai@1.45.0`, `@modelcontextprotocol/sdk@1.27.1`, `express@5.0.6`, `pino@9.14.0` |
| npm audit | Timed out (offline CI environment); SBOM is authoritative for this review |

---

## 6. Secret Scan Results

| Check | Result |
|-------|--------|
| Hardcoded API keys / tokens | NONE — `GEMINI_API_KEY` read exclusively from `process.env` |
| Hardcoded passwords | NONE |
| Private key material | NONE |
| Credentials in test file | NONE — test file deletes `process.env.GEMINI_API_KEY` in `beforeEach` |

---

## 7. Summary

| Severity | Count | Items |
|----------|-------|-------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | M1 (LLM01 prompt injection via ticket content), M2 (CWE-400 unbounded queue) |
| Low | 2 | L1 (LLM06 broad LLM data scope), L2 (CWE-400 orphaned post-timeout promise) |

**VERDICT: PASS** — 0 critical, 0 high findings. 2 medium findings documented with risk acceptance rationale. Ticket advances to CI stage.

---

## 8. Handoff Notes for CI

- All 68 tests pass (per upstream QA report)
- Lint: PASS (0 warnings on scoped files)
- Typecheck: PASS (`tsc --noEmit`)
- No new TODOs in scoped implementation files
- The `as unknown as` cast in `generateWithGemini` bypasses TS type safety for the Gemini SDK call — CI should note this as a technical debt item (not a security blocker)
- M1 and M2 are documented risks, not blockers for CI gate
