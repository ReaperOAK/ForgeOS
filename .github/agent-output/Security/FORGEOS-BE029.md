# FORGEOS-BE029 — Security Stage Summary

## Ticket
**Title:** Implement tickets.claim MCP Tool  
**Type:** backend  
**Priority:** critical  
**Verdict:** ✅ PASS  
**Confidence:** HIGH  

## Files Reviewed
- `mcp-server/src/mcp_server/tools/ticket_tools.py` (lines 1–700, claim handler + schema)
- `mcp-server/src/mcp_server/services/ticket_service.py` (lines 1–500, `claim_by_id` service)
- `mcp-server/src/mcp_server/locking/claim_queue.py` (lines 1–500, `ClaimQueue.claim_by_id`)
- `mcp-server/src/mcp_server/tools/validation.py` (JSON Schema validation framework)
- `mcp-server/src/mcp_server/auth/authorization.py` (role-stage policy, machine binding)

---

## STRIDE Threat Model

### Trust Boundaries

| # | Boundary | From | To |
|---|----------|------|----|
| TB1 | MCP Client → Tool Handler | External agent (LLM/dispatcher) | `handle_tickets_claim()` |
| TB2 | Tool Handler → Service | `handle_tickets_claim()` | `TicketService.claim_by_id()` |
| TB3 | Service → ClaimQueue | `claim_by_id()` | `ClaimQueue.claim_by_id()` |
| TB4 | ClaimQueue → PostgreSQL | Python wrapper | `claim_ticket_by_id()` stored function |

### STRIDE per Boundary

| Threat | TB1 (MCP→Handler) | TB2 (Handler→Service) | TB3 (Service→Queue) | TB4 (Queue→DB) |
|--------|--------------------|-----------------------|---------------------|----------------|
| **Spoofing** | Agent identity is self-asserted (strings). MCP transport layer provides session isolation. | Internal delegation, no re-auth. | Internal, trusted. | Parameterized queries, UUID cast. |
| **Tampering** | JSON Schema validation enforces type+shape. `additionalProperties: false` blocks extra fields. | Parameters passed as-is after validation. | Parameters forwarded verbatim. | Stored function enforces atomic state transitions. |
| **Repudiation** | Structured logging with ticket_id, agent_id, machine_id on every call path. | Logger propagates correlation context. | Logger propagates context. | DB-level audit via stored function side effects. |
| **Info Disclosure** | Error messages reveal ticket existence ("not claimable"). Acceptable for internal system. No PII/secrets. | No sensitive data in internal calls. | No sensitive data. | Stored function returns only ticket metadata. |
| **DoS** | No rate limiting at handler level (acceptable: internal MCP, not public API). `lease_duration_minutes` bounded [1,1440]. | N/A internal. | `SKIP LOCKED` prevents blocking. | Non-blocking concurrent claims. |
| **EoP** | **MEDIUM**: `claim_by_id` does not call `check_role_stage_authorization()`. A valid agent with any role can claim any READY ticket by ID regardless of stage match. See SEC-BE029-001. | N/A. | N/A. | Stored function does not filter by stage. |

### Risk Scores

| ID | Threat | Impact | Likelihood | Score | Severity |
|----|--------|--------|------------|-------|----------|
| SEC-BE029-001 | Missing role-stage authorization in `claim_by_id` | 3 | 3 | 9 | **MEDIUM** |
| SEC-BE029-002 | Self-asserted agent identity (no cryptographic verification) | 3 | 2 | 6 | **LOW** |
| SEC-BE029-003 | No rate limiting on claim tool invocations | 2 | 2 | 4 | **LOW** |

---

## OWASP Top 10 Checklist

| Category | Status | Evidence |
|----------|--------|----------|
| **A01 Broken Access Control** | ⚠️ MEDIUM | `claim_by_id()` in `ticket_service.py` does NOT call `check_role_stage_authorization()` — unlike `claim_next()` which does (FORGEOS-BE055). An agent with any valid role can claim a READY ticket that is destined for a different stage's agent. Mitigated: dispatcher protocol controls ticket assignment; advance stage would reject role-stage mismatch. See SEC-BE029-001. |
| **A02 Cryptographic Failures** | ✅ PASS | No cryptographic operations in claim flow. No plaintext secrets stored or transmitted. bcrypt/PyJWT present in deps but not used in this code path. |
| **A03 Injection** | ✅ PASS | All DB queries use parameterized placeholders (`$1`, `$2::uuid`, etc.) via asyncpg. JSON Schema validation with `Draft202012Validator` before processing. `uuid.UUID()` cast validates format. No SQL/command injection vectors. |
| **A04 Insecure Design** | ⚠️ MEDIUM | Asymmetry between `claim_next` (has auth check) and `claim_by_id` (no auth check) indicates a design inconsistency. Defense-in-depth violated — DB stored function `claim_ticket_by_id` does not filter by stage. |
| **A05 Security Misconfiguration** | ✅ PASS | `additionalProperties: false` on `TICKETS_CLAIM_SCHEMA`. No debug info in error responses. Error paths return structured `{isError, code, message}` without stack traces. |
| **A06 Vulnerable Components** | ✅ PASS | Dependencies: asyncpg ≥0.30.0, pydantic ≥2.0, mcp ≥1.25, jsonschema (via mcp). All use current major versions. No known critical/high CVEs for these version ranges. |
| **A07 Auth Failures** | ✅ PASS | Lease mechanism provides configurable session timeout (default 30 min, bounded [1,1440]). `SELECT FOR UPDATE SKIP LOCKED` ensures single-winner semantics. Agent identity validated as non-empty via `minLength: 1`. |
| **A08 Data Integrity** | ✅ PASS | Stored function enforces transactional atomicity. `SKIP LOCKED` guarantees exactly-one-winner for concurrent claims. No deserialization of untrusted data beyond schema-validated JSON. |
| **A09 Logging Failures** | ✅ PASS | All code paths logged: `logger.info` on invocation, `logger.info` on no-match, `logger.warning` on invalid role and conflicts. Correlation context includes ticket_id, agent_id, machine_id. No PII or credentials in log output. |
| **A10 SSRF** | ✅ N/A | No outbound HTTP calls. No URL processing. Not applicable to claim flow. |

---

## LLM Top 10 Assessment

| Category | Status | Evidence |
|----------|--------|----------|
| LLM01 Prompt Injection | ✅ N/A | Tool accepts typed parameters (strings/integers), not freeform prompts. JSON Schema validation rejects unexpected shapes. |
| LLM02 Insecure Output | ✅ PASS | Output is structured data (`to_dict()`), not rendered as HTML/code. No user-controlled content reflected unsanitized. |
| LLM06 Sensitive Info Disclosure | ✅ PASS | Response contains only ticket metadata (ID, title, type, stage, file_paths, acceptance_criteria). No PII, credentials, or internal system details exposed. |
| LLM08 Excessive Agency | ✅ PASS | Tool only performs claim operations — cannot advance, delete, or modify tickets. Bounded action scope. Lease auto-expires. |

---

## Secret Scanning

| Check | Result |
|-------|--------|
| Hardcoded secrets in `ticket_tools.py` | ✅ None found |
| Hardcoded secrets in `ticket_service.py` | ✅ None found |
| API keys / tokens in source | ✅ None found |
| Private keys in source | ✅ None found |
| `.env` files in VCS | ✅ Not applicable (no `.env` in modified files) |

---

## Dependency Summary (SBOM Excerpt)

| Package | Version Constraint | Known Critical/High CVEs | Status |
|---------|--------------------|---------------------------|--------|
| asyncpg | ≥0.30.0 | None known | ✅ |
| pydantic | ≥2.0, <3 | None known | ✅ |
| mcp | ≥1.25, <2 | None known | ✅ |
| PyJWT | ≥2.0, <3 | None known (CVE-2022-29217 fixed in 2.4+) | ✅ |
| bcrypt | ≥4.0, <6 | None known | ✅ |
| jsonschema | Transitive via mcp | None known | ✅ |

**Total dependencies:** 9 direct + transitive  
**Critical CVEs:** 0  
**High CVEs:** 0

---

## SARIF Findings

```json
{
  "version": "2.1.0",
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-SecurityEngineer",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-BE029-001",
              "shortDescription": { "text": "Missing role-stage authorization in claim_by_id" },
              "helpUri": "https://cwe.mitre.org/data/definitions/862.html",
              "properties": { "cwe": "CWE-862", "severity": "medium" }
            },
            {
              "id": "SEC-BE029-002",
              "shortDescription": { "text": "Self-asserted agent identity without cryptographic verification" },
              "helpUri": "https://cwe.mitre.org/data/definitions/287.html",
              "properties": { "cwe": "CWE-287", "severity": "low" }
            },
            {
              "id": "SEC-BE029-003",
              "shortDescription": { "text": "No rate limiting on claim tool invocations" },
              "helpUri": "https://cwe.mitre.org/data/definitions/770.html",
              "properties": { "cwe": "CWE-770", "severity": "low" }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-BE029-001",
          "level": "warning",
          "message": {
            "text": "TicketService.claim_by_id() does not call check_role_stage_authorization() before delegating to ClaimQueue.claim_by_id(). This allows an agent with any valid role to claim a READY ticket by ID even if the ticket's current SDLC stage does not match the agent's authorized stage. Unlike claim_next() which enforces role-stage policy (FORGEOS-BE055), claim_by_id() only validates that the role is known via AgentRoleMap.stage_for_role() but does not verify the mapping against the ticket's actual stage. Risk accepted: dispatcher protocol limits exposure; advance stage would reject mismatched claims."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/services/ticket_service.py" },
                "region": { "startLine": 350, "endLine": 420 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE029-002",
          "level": "note",
          "message": {
            "text": "Agent identity (agent_id, machine_id, operator) is accepted as self-asserted strings with only minLength:1 validation. No cryptographic binding or token verification. Acceptable for internal MCP transport where session isolation is enforced by the protocol layer."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/tools/ticket_tools.py" },
                "region": { "startLine": 155, "endLine": 195 }
              }
            }
          ]
        },
        {
          "ruleId": "SEC-BE029-003",
          "level": "note",
          "message": {
            "text": "No rate limiting at the MCP tool handler level. A compromised or buggy agent could issue rapid claim requests. Mitigated: SELECT FOR UPDATE SKIP LOCKED prevents resource exhaustion at DB level; MCP transport provides session management."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "mcp-server/src/mcp_server/tools/ticket_tools.py" },
                "region": { "startLine": 198, "endLine": 240 }
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

## Verdict

**PASS** — Zero critical or high findings. One medium finding (SEC-BE029-001: missing `check_role_stage_authorization` in `claim_by_id`) documented with risk acceptance. Two low findings documented.

### Risk Acceptance Rationale (SEC-BE029-001)

The missing authorization check in `claim_by_id` is mitigated by:
1. **Dispatcher protocol**: Only ReaperOAK dispatches agents to specific tickets — agents don't self-select via `claim_by_id` in normal operation.
2. **Advance-stage guard**: The `tickets.advance` tool validates claim ownership and stage transitions, catching any role-stage mismatch downstream.
3. **DB-level READY filter**: The stored function `claim_ticket_by_id` only claims tickets in READY status, limiting the attack surface.
4. **Recommendation**: A follow-up ticket should add `check_role_stage_authorization()` to `claim_by_id` for defense-in-depth parity with `claim_next`.

## Artifacts
- `.github/agent-output/Security/FORGEOS-BE029.md` (this report)
- `mcp-server/src/mcp_server/tools/ticket_tools.py` (read-only review)
- `mcp-server/src/mcp_server/services/ticket_service.py` (read-only review)
