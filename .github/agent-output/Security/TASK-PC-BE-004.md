# Security Review Report — TASK-PC-BE-004

- Ticket: `TASK-PC-BE-004`
- Stage: `SECURITY`
- Date: `2026-03-14`
- Reviewer: `Security Engineer`
- Scope:
  - `forgeos-server/src/services/packet-validator.ts`
  - `forgeos-server/src/services/compiler.ts`
  - `forgeos-server/src/services/packet-validator.test.ts`
- Upstream references:
  - `.github/agent-output/Backend/TASK-PC-BE-004.md`
  - `.github/agent-output/QA/TASK-PC-BE-004.md`

## Verdict

- Result: `FAIL`
- Confidence: `HIGH`
- Critical findings: `0`
- High findings: `1`
- Medium findings: `1`
- Low findings: `0`

The packet schema gate enforces 11-section presence/order, but it can be bypassed by decoy headers while malicious instructions remain in section bodies. This is a control-evasion issue for a security gate and requires rework.

## Requested Check Results

1. STRIDE: can an attacker craft a prompt that passes section validation while hiding malicious content?
- `YES`.
- Why:
  - Validator checks only section-header presence and relative order from first matched index.
  - It does not validate section body constraints, forbidden directives, duplicated headers, or suspicious payloads.
  - A crafted prompt can include ordered decoy headers to satisfy the gate, then hide malicious instructions in body text.
- Evidence:
  - Header matching logic: `forgeos-server/src/services/packet-validator.ts:47`
  - Presence/order-only validation: `forgeos-server/src/services/packet-validator.ts:72`

2. OWASP A03: can packet section names or content trigger injection in the validator?
- Section-name regex injection risk: `NO`.
  - `sectionName` is escaped before regex construction.
  - Evidence: `forgeos-server/src/services/packet-validator.ts:47`
- Content-driven injection in validator path: `NO direct sink found`.
  - No SQL/system execution in validator.
  - Compiler path throws validation error and logs message only.
  - Evidence: `forgeos-server/src/services/compiler.ts:158`, `forgeos-server/src/services/compiler.ts:176`, `forgeos-server/src/services/compiler.ts:361`

3. Verify `PacketValidationError` does not leak internal state to external callers
- `PARTIAL PASS / MEDIUM RISK`.
- Findings:
  - Error exposes `result` payload publicly (`public readonly result`), including internal rule details.
  - Error message includes `structuredReason` by design.
  - In reviewed paths, queue worker logs `err.message`; no direct external response leak found in scoped files.
- Evidence:
  - Error data exposure: `forgeos-server/src/services/packet-validator.ts:36`
  - Message includes structured details: `forgeos-server/src/services/packet-validator.ts:40`
  - Logged in queue worker: `forgeos-server/src/services/compiler.ts:361`

4. Confirm 11-section enforcement is strict-ordered (not just presence)
- `PASS`.
- Ordered comparison is implemented by computing first-match positions and comparing canonical order vs actual order.
- Evidence:
  - Canonical ordered sections: `forgeos-server/src/services/packet-validator.ts:14`
  - Order comparison loop: `forgeos-server/src/services/packet-validator.ts:109`

5. Hardcoded secrets scan on changed files only
- Command:
  - `rg -n --no-heading -i "(api[_-]?key|secret|token|password|passwd|private[_-]?key|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]+)" src/services/packet-validator.ts src/services/compiler.ts src/services/packet-validator.test.ts`
- Result:
  - No hardcoded credentials detected.
  - Benign matches observed (env-var use and tokenization variable names):
    - `GEMINI_API_KEY` env usage in compiler
    - Local variable `tokens` in text parsing

6. `npm audit --audit-level=high`
- Command:
  - `npm audit --audit-level=high`
- Result:
  - `0 high`, `0 critical`
  - `1 moderate` vulnerability in `hono <4.12.7` (prototype pollution advisory)
  - Does not trigger high-severity gate failure for this stage.

## STRIDE Threat Model

### Trust Boundaries

- Boundary A: Ticket/context inputs -> Prompt generation (`compiler.ts`)
- Boundary B: Generated prompt text -> Validation gate (`packet-validator.ts`)
- Boundary C: Validation failure -> Logging/worker handling (`compiler.ts`)

### Threats

- `Tampering` (Boundary B): decoy ordered headers + malicious body bypasses control intent.
  - Impact: `4`
  - Likelihood: `4`
  - Score: `16` (`HIGH`)
- `Information Disclosure` (Boundary C): structured validation internals can propagate via thrown error/logging.
  - Impact: `2`
  - Likelihood: `5`
  - Score: `10` (`MEDIUM`)
- `Repudiation` (Boundary C): current logs include error message but no structured decision event hash for validation bypass attempts.
  - Impact: `2`
  - Likelihood: `3`
  - Score: `6` (`LOW`, accepted for this ticket)
- `Spoofing/DoS/EoP`: no direct evidence in scoped files.

## OWASP Top 10 Checklist

- A01 Broken Access Control: `N/A in scoped files`
- A02 Cryptographic Failures: `N/A in scoped files`
- A03 Injection: `Checked` -> no direct injection sink in validator; regex-escape protects section-name pattern composition
- A04 Insecure Design: `Finding` -> schema-only gate can be semantically bypassed by malicious body payloads
- A05 Security Misconfiguration: `No issue found in scope`
- A06 Vulnerable Components: `1 moderate` dependency finding, no high/critical
- A07 Identification/Auth Failures: `N/A in scoped files`
- A08 Software/Data Integrity Failures: `Finding` -> validation control can be gamed by decoy formatting
- A09 Security Logging/Monitoring Failures: `Partial` -> error logs present, but no explicit validation-abuse marker
- A10 SSRF: `N/A in scoped files`

## LLM Top 10 (Applicable)

- LLM01 Prompt Injection: `FAIL` (high finding)
  - Validator enforces syntax shape only, not malicious instruction semantics.
- LLM02 Insecure Output Handling: `PARTIAL`
  - Output is trusted after schema check; additional policy scanning is absent.
- LLM06 Sensitive Information Disclosure: `PASS in scoped code`
- LLM08 Excessive Agency: `N/A in scoped files`

## SARIF Findings

```json
{
  "version": "2.1.0",
  "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS Security Review",
          "rules": [
            {
              "id": "FORGEOS-SEC-001",
              "name": "PacketValidationBypassViaDecoyHeaders",
              "shortDescription": { "text": "Schema gate can be bypassed by ordered decoy headers while malicious body content remains" },
              "properties": { "tags": ["OWASP:A04", "LLM01", "CWE-20", "CWE-693"] }
            },
            {
              "id": "FORGEOS-SEC-002",
              "name": "ValidationErrorDetailExposure",
              "shortDescription": { "text": "Validation error exposes structured internals via public result payload and message" },
              "properties": { "tags": ["OWASP:A09", "CWE-209"] }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "FORGEOS-SEC-001",
          "level": "error",
          "message": {
            "text": "validatePacketSections enforces only header presence/order from first matches; attacker can satisfy ordering with decoy headers and place malicious instructions in section bodies."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/src/services/packet-validator.ts" },
                "region": { "startLine": 72 }
              }
            }
          ]
        },
        {
          "ruleId": "FORGEOS-SEC-002",
          "level": "warning",
          "message": {
            "text": "PacketValidationError includes structuredReason and exposes raw ValidationResult on .result; ensure external boundaries do not return this object directly."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "forgeos-server/src/services/packet-validator.ts" },
                "region": { "startLine": 36 }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

## Required Remediation (Rework)

1. Strengthen validator semantics beyond header presence/order:
- Reject duplicate canonical headers.
- Require exactly one instance of each canonical section.
- Enforce bounded content per section and reject disallowed patterns (for example destructive git commands, secrets directives, or policy-violating instructions).
- Parse sections structurally (single-pass parser) instead of first-occurrence regex matching.

2. Add anti-evasion checks:
- Detect and reject decoy headers that appear before the true packet body.
- Reject packets where canonical headers appear inside fenced code blocks or quoted payload wrappers.

3. Reduce error detail exposure at external boundary:
- Keep `PacketValidationError.result` internal-only or redact before any external transport.
- Return normalized public error codes/messages (`VALIDATION_FAILED`) and keep specifics in internal logs.

4. Extend tests:
- Add adversarial packet cases: duplicate headers, decoy preamble headers, code-fence header spoofing, malicious directives hidden in body.

## Security Decision

- Decision: `REJECT`
- Rework reason: High-severity validation bypass risk (`FORGEOS-SEC-001`) remains.
