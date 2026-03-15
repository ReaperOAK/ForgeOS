# TASK-PC-BE-006 - Security Review Report

**Agent:** Security Engineer  
**Stage:** SECURITY  
**Date:** 2026-03-15T16:43:27Z  
**Reviewed Commit:** d57a531e  
**Verdict:** REJECT  
**Confidence:** HIGH

## Summary

Security review completed for the freshness-gate changes in `tickets.claim` and the supporting context-hash logic.

Critical findings: 0  
High findings: 1  
Medium findings: 0  
Low findings: 0

This ticket must return for rework because the scoped implementation contains a high-severity broken access control flaw in `tickets.claim`: the handler derives acting identity from the caller-controlled `agent_name` parameter instead of the authenticated request principal, and auto-registers unknown names with wildcard permissions.

## Files Reviewed

- `forgeos-server/src/tools/tickets-claim.ts`
- `forgeos-server/src/services/context-hash.ts`
- `forgeos-server/src/__tests__/tickets-claim-freshness.test.ts`

## Command Evidence

| Check | Command | Result |
|---|---|---|
| QA carry-forward | `vitest` targeted suite + `tsc --noEmit` + `eslint ... --max-warnings=0` | PASS from upstream QA handoff |
| Dependency audit | `npm audit --audit-level=high --json` | PASS for gate: 0 high, 0 critical, 1 moderate (`hono` advisory GHSA-v8w9-8mx6-g223) |
| Secret scan | `rg -n --hidden ... '(API_KEY|SECRET|PASSWORD|TOKEN|PRIVATE KEY|...)'` | PASS: no matches in scoped files |
| SBOM | `npm sbom --sbom-format cyclonedx --sbom-type application` | FAIL: npm `EINVALIDPURLTYPE` on existing package metadata/lock state; no usable SBOM artifact produced |

## Finding

### SEC-AUTHZ-001 — Caller-controlled agent identity allows spoofing and claim ownership bypass

- **Severity:** High
- **OWASP:** A01:2021 Broken Access Control
- **CWE:** CWE-285 Improper Authorization
- **Primary Location:** `forgeos-server/src/tools/tickets-claim.ts`
- **Supporting Boundary Evidence:** `forgeos-server/src/middleware/auth.ts`

`authMiddleware` authenticates the request and stores the trusted principal on `req.agent`, including its permission set. `ticketsClaimHandler` does not consume that trusted identity. Instead, it trusts `params.agent_name`, looks up an agent row by that name, and if no row exists, inserts a new agent with `permissions = ["*"]` before calling `claim_ticket_by_id` with that derived UUID.

That creates two linked problems:

1. Any authenticated caller who is allowed to invoke `tickets.claim` can submit an arbitrary `agent_name` and have the claim/audit trail attributed to that spoofed agent rather than the authenticated principal.
2. Unknown agent names are auto-provisioned at runtime with wildcard permissions, expanding the blast radius for any later code path that trusts the persisted agent record.

The vulnerability is not mitigated by SQL parameterization or by the freshness-gate logic. The boundary failure happens before the stored function call, at the application identity layer.

### Exploit Sketch

1. Authenticate as any agent that is permitted to call `tickets.claim`.
2. Call `tickets.claim` with `agent_name: "Security"` (or any arbitrary new name).
3. The handler binds ticket ownership to the looked-up or newly created row for that supplied name, not to the authenticated bearer token identity.
4. The resulting claim metadata and audit events now reflect the spoofed agent identity.

## STRIDE Threat Model

| Boundary | Threat | Score (Impact x Likelihood) | Notes |
|---|---|---|---|
| Caller -> `ticketsClaimHandler` | Spoofing / Elevation of Privilege | 4 x 4 = 16 (High) | Trusted auth identity exists, but handler uses caller-controlled `agent_name` instead |
| Handler -> `claim_ticket_by_id()` | Tampering | 2 x 1 = 2 (Low) | SQL call is parameterized; no injection issue found |
| Handler -> compile queue | DoS | 2 x 2 = 4 (Low) | Recompile enqueue is idempotent by `ticketId:trigger`, worker errors are caught |
| Runtime env -> `computeContextHash()` | Tampering | 2 x 2 = 4 (Low) | Hash inputs come from environment; requires deployment-env compromise |
| Response/logging | Information Disclosure | 2 x 2 = 4 (Low) | No secrets found in scoped files; warning/error logging stays operational |

## OWASP Top 10 Checklist

- A01 Broken Access Control: **FAIL** — acting identity is derived from an untrusted parameter rather than the authenticated principal.
- A02 Cryptographic Failures: PASS — `context-hash.ts` uses SHA-256 only for deterministic freshness hashing; no weak crypto found.
- A03 Injection: PASS — reviewed SQL calls are parameterized.
- A04 Insecure Design: FAIL via A01 root cause — trust boundary between authenticated request identity and tool arguments is broken.
- A05 Security Misconfiguration: PASS — no insecure defaults introduced in scoped code.
- A06 Vulnerable Components: PASS for gate — 0 high/critical findings in `npm audit`; 1 moderate `hono` advisory remains outside this ticket's scoped logic.
- A07 Identification and Authentication Failures: FAIL-adjacent — authentication exists, but its result is not bound to claim ownership decisions.
- A08 Software and Data Integrity Failures: PASS — deterministic hash and freshness evaluation are stable and covered by tests.
- A09 Security Logging and Monitoring Failures: PASS — log lines are operational and no hardcoded secrets were found.
- A10 SSRF: N/A — no outbound URL fetch path in reviewed files.

## LLM Top 10 Applicability

No direct LLM input/output handling changes were introduced in the scoped files. The reviewed code only queues background prompt compilation and computes freshness metadata.

## Test Coverage Gap

The new freshness tests validate stale/missing/fresh behavior thoroughly, but they call `ticketsClaimHandler` directly and do not exercise the authentication boundary. There is currently no regression test proving that the authenticated principal matches the `agent_name` used for ownership.

## Required Remediation

1. Remove `agent_name` as a trusted ownership source in mutation handlers; derive acting identity from authenticated request context.
2. Eliminate runtime auto-registration with wildcard permissions from claim/reject/release/orchestrator mutation paths.
3. Add security regression tests for mismatched bearer identity vs requested agent name, and for unknown agent-name claim attempts.

## SARIF

See: `.github/agent-output/Security/TASK-PC-BE-006.sarif`

## Verdict

REJECT.

The freshness-gate logic itself is safe, but the ticket cannot pass SECURITY while `tickets.claim` allows authenticated callers to spoof agent identity and bind ticket ownership to arbitrary names.
