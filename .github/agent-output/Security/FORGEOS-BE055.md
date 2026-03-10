# FORGEOS-BE055 — Security Review

## Verdict: FAIL

**Confidence:** HIGH

## Summary

Security review of role-based claim restrictions implementation in
`authorization.py` and `ticket_service.py`. Found **1 HIGH-severity
authorization bypass** via `claim_by_id` missing the role-stage
authorization check. This allows any authenticated agent to bypass SDLC
stage restrictions by calling the `tickets.claim` MCP tool with a
specific ticket ID instead of `tickets.claim_next`. All other aspects
of the implementation (operator bypass logic, admin bypass, error
descriptors, configurable policy) are sound.

---

## STRIDE Threat Model

### Trust Boundaries Analyzed

1. **Agent → MCP Tool Layer** — agent provides role + ticket ID
2. **MCP Tool Layer → TicketService** — tool handler delegates to service
3. **TicketService → ClaimQueue** — service delegates to database-level claim

### Threats

| ID | Category | Threat | Boundary | Impact | Likelihood | Score |
|----|----------|--------|----------|--------|------------|-------|
| T1 | Elevation of Privilege | Agent calls `claim_by_id` with mismatched role, bypasses stage check | Agent → TicketService | 5 | 4 | **20 (CRITICAL)** |
| T2 | Spoofing | Agent spoofs role string to bypass restriction | Agent → MCP Tool | 2 | 2 | 4 (LOW) — mitigated by API key auth binding agent identity |
| T3 | Tampering | Runtime mutation of `_default_policy` singleton | Internal | 3 | 1 | 3 (LOW) — not exposed via any API endpoint |
| T4 | Information Disclosure | Error messages leak authorized stage mapping | TicketService → Agent | 2 | 3 | 6 (LOW) — by design for descriptive errors |
| T5 | Denial of Service | Rapid claim attempts exhaust SKIP LOCKED pool | Agent → ClaimQueue | 2 | 2 | 4 (LOW) — PostgreSQL handles gracefully |

---

## SARIF Findings

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "ForgeOS-Security-Agent",
          "version": "1.0.0",
          "rules": [
            {
              "id": "SEC-001",
              "name": "MissingAuthorizationCheck",
              "shortDescription": {
                "text": "claim_by_id missing role-stage authorization"
              },
              "helpUri": "https://cwe.mitre.org/data/definitions/862.html",
              "properties": {
                "cwe": "CWE-862",
                "owasp": "A01:2021 Broken Access Control",
                "severity": "HIGH"
              }
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "SEC-001",
          "level": "error",
          "message": {
            "text": "TicketService.claim_by_id() does not call check_role_stage_authorization() before delegating to ClaimQueue.claim_by_id(). This allows any agent to bypass role-stage restrictions by specifying a ticket_id directly. The claim_next() method correctly enforces the check at line 288, but claim_by_id() at line 340 skips it entirely. The MCP tickets.claim tool handler (ticket_tools.py:237) routes through claim_by_id, making this exploitable via the MCP protocol."
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "mcp-server/src/mcp_server/services/ticket_service.py"
                },
                "region": {
                  "startLine": 340,
                  "endLine": 435
                }
              }
            }
          ],
          "fixes": [
            {
              "description": {
                "text": "Add check_role_stage_authorization(agent_role, stage) call in claim_by_id() after AgentRoleMap.stage_for_role() resolution and before ClaimQueue.claim_by_id() delegation, mirroring the pattern in claim_next()."
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

## OWASP Top 10 Checklist

| Category | Status | Details |
|----------|--------|---------|
| **A01 Broken Access Control** | **FAIL** | `claim_by_id` missing `check_role_stage_authorization` — bypass vector via `tickets.claim` MCP tool (CWE-862). `claim_next` correctly enforces authorization at line 288. |
| A02 Cryptographic Failures | PASS | No cryptographic operations in scope. bcrypt (v5.0.0) and PyJWT (v2.11.0) used elsewhere are current. |
| A03 Injection | PASS | All SQL uses parameterized queries (`$1`, `$2`). No string interpolation in SQL. f-strings used only in error messages (not query construction). |
| A04 Insecure Design | PASS | Defense-in-depth pattern: API key auth → machine auth → role-stage auth → SKIP LOCKED. Configurable policy pattern is sound. |
| A05 Security Misconfiguration | PASS | No debug modes. Deny-by-default: unknown roles rejected, empty strings rejected. |
| A06 Vulnerable Components | PASS | All dependencies current. No known CVEs. See SBOM below. |
| A07 Auth Failures | N/A | Auth ticket (BE051-BE053) not in scope. bcrypt and JWT are current versions. |
| A08 Data Integrity | PASS | `frozen=True` dataclasses prevent mutation. `RoleStagePolicy._mapping` is a private dict not exposed via API. |
| A09 Logging Failures | PASS | Structured logging via `get_logger`. No PII in log messages. Authorization decisions logged with relevant context. |
| A10 SSRF | N/A | No outbound HTTP calls in modified files. |

---

## LLM Top 10

N/A — No AI/LLM features in modified files.

---

## Dependency Audit (SBOM — CycloneDX Summary)

| Component | Version | License | CVEs |
|-----------|---------|---------|------|
| asyncpg | 0.31.0 | Apache-2.0 | None known |
| pydantic | 2.12.5 | MIT | None known |
| PyJWT | 2.11.0 | MIT | None known |
| bcrypt | 5.0.0 | Apache-2.0 | None known |
| mcp (Python SDK) | 1.26.0 | MIT | None known |
| uvicorn | 0.41.0 | BSD-3 | None known |
| alembic | 1.18.4 | MIT | None known |
| SQLAlchemy | 2.0.48 | MIT | None known |
| pydantic-settings | >=2.0 | MIT | None known |

**Total dependencies:** 9 direct. **Critical/High CVEs:** 0.

---

## Secret Scanning

- No hardcoded secrets, API keys, tokens, or passwords in `authorization.py` or `ticket_service.py`.
- No `.env` files committed in scope.
- Credentials handled via separate auth modules (agent_auth, operator_auth).

---

## Auth/AuthZ Review

- `check_role_stage_authorization` correctly enforces deny-by-default for unknown roles.
- Empty string inputs are rejected.
- Case-insensitive normalization (`lower()`/`upper()`) prevents case-based bypass.
- Operator/admin bypass is scoped correctly: only when `role_override is None`.
- When operator provides `role_override`, the override role IS validated.
- **FINDING:** `claim_by_id` does not call `check_role_stage_authorization` — an agent calling `tickets.claim(ticket_id=X, agent_id="qa")` can claim a ticket at any stage, not just QA.

---

## Input Validation

- `agent_role` validated for emptiness and stripped.
- `ticket_stage` validated for emptiness and stripped.
- No raw SQL interpolation — all queries parameterized.
- `role_override` is optional; when provided, is stripped and lowered.

---

## Data Classification

- No PII in modified files. Operator IDs are UUIDs.
- Machine IDs are hostnames (low sensitivity).
- No encryption-at-rest requirements for role mapping data.

---

## API Security

- Both MCP and REST paths route through `TicketService` (single enforcement point — good pattern, but `claim_by_id` misses the check).
- CORS and rate limiting not in scope for this ticket.

---

## Detailed Finding: SEC-001

### Description

`TicketService.claim_by_id()` (ticket_service.py, lines 340–435) does NOT
call `check_role_stage_authorization()` before delegating to
`ClaimQueue.claim_by_id()`. The parallel method `claim_next()` (lines 229–335)
correctly enforces the check at line 288.

### Attack Vector

1. Agent authenticates via API key (role = "qa").
2. Agent calls `tickets.claim` MCP tool with `ticket_id="FORGEOS-BE006"` 
   (a ticket currently in BACKEND stage).
3. `ticket_tools.py:237` calls `ticket_service.claim_by_id(agent_role="qa", ...)`.
4. `claim_by_id` resolves stage via `AgentRoleMap` but never validates the
   resolved stage against the ticket's current stage.
5. QA agent successfully claims a BACKEND-stage ticket — **role-stage bypass**.

### Impact

- **STRIDE Category:** Elevation of Privilege
- **OWASP Category:** A01 Broken Access Control (CWE-862: Missing Authorization)
- **Severity:** HIGH (Impact=5 × Likelihood=4 = 20)
- An agent can claim tickets outside its authorized SDLC stage, violating
  the core multi-agent orchestration invariant.

### Recommended Fix

Add `check_role_stage_authorization` call in `claim_by_id()` after
`AgentRoleMap.stage_for_role()` and before `ClaimQueue.claim_by_id()`:

```python
async def claim_by_id(self, *, ticket_id, agent_role, machine_id, operator, lease_minutes=30):
    stage = AgentRoleMap.stage_for_role(agent_role)
    if stage is None:
        raise ValueError(f"Unknown agent role: {agent_role}")

    # FIX: Add role-stage authorization check (mirrors claim_next pattern)
    check_role_stage_authorization(agent_role, stage)

    agent_id = str(uuid.uuid4())
    # ... rest unchanged
```

---

## Verdict Rationale

**FAIL** — SEC-001 is a HIGH-severity authorization bypass (CWE-862, OWASP A01).
The `claim_by_id` code path, reachable via the `tickets.claim` MCP tool, allows
any authenticated agent to claim tickets outside its authorized SDLC stage.
This directly violates Acceptance Criterion #5 ("Authorization check integrated
into the claim service — both MCP and REST paths"). The fix is a one-line
addition mirroring the existing pattern in `claim_next`.

Ticket returned to BACKEND for rework.

---

## Artifacts

- `.github/agent-output/Security/FORGEOS-BE055.md` — this report
- `mcp-server/src/mcp_server/auth/authorization.py` — reviewed (read-only, no findings)
- `mcp-server/src/mcp_server/services/ticket_service.py` — reviewed (read-only, SEC-001 found)
- `mcp-server/src/mcp_server/tools/ticket_tools.py` — reviewed (read-only, confirms attack path)
- `mcp-server/src/mcp_server/auth/__init__.py` — verified exports

**Report timestamp:** 2026-03-11T00:00:00Z
