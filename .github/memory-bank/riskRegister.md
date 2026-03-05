---
id: risk-register
version: "1.0"
owner: [Security, ReaperOAK]
write_access: [Security, ReaperOAK]
append_only: true
---

# Risk Register

> **Schema Version:** 1.0
> **Owner:** Security Agent
> **Write Access:** Security agent (append), ReaperOAK (full)
> **Lock Rules:** Only Security agent and ReaperOAK may write. All other
> subagents have read-only access. No entry may be deleted — only marked as
> mitigated or accepted.
> **Update Protocol:** Append new risks with timestamp, severity, and
> mitigation plan. Update existing risks only to change status or add
> mitigation evidence.

---

## Risk Entry Format

```
### RISK-{number}: {title}
- **Date Identified:** YYYY-MM-DD
- **Identified By:** {agent or human}
- **Severity:** Critical | High | Medium | Low
- **Likelihood:** High | Medium | Low
- **Category:** Security | Operational | Technical | Compliance
- **Description:** What could go wrong
- **Impact:** What happens if it occurs
- **Mitigation:** How to prevent or reduce it
- **Status:** Open | Mitigated | Accepted | Closed
- **Evidence:** Proof of mitigation if applicable
```

---

## Active Risks

### RISK-001: Memory Poisoning via Subagent Hallucination

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** High
- **Likelihood:** Medium
- **Category:** Security
- **Description:** A subagent could write false or contradictory information to
  shared memory bank files, corrupting the system's understanding of the project
- **Impact:** Downstream agents make decisions based on false context, producing
  incorrect code or architecture
- **Mitigation:** `systemPatterns.md` and `decisionLog.md` are write-locked to
  ReaperOAK only. Subagents can only append to `activeContext.md` and
  `progress.md`. All entries are timestamped and attributed.
- **Status:** Mitigated
- **Evidence:** Lock rules enforced in memory bank file headers

### RISK-002: Prompt Injection in External Content

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** Critical
- **Likelihood:** Medium
- **Category:** Security
- **Description:** Malicious content fetched from external URLs or APIs could
  contain prompt injection patterns that override agent behavior
- **Impact:** Agent executes unintended actions, leaks data, or escalates
  privileges
- **Mitigation:** External content sanitization protocol defined in
  `security.agentic-guardrails.instructions.md`. All external content treated as untrusted.
  Content boundaries enforced via delimiters.
- **Status:** Mitigated
- **Evidence:** Guardrails document created

### RISK-003: Token Runaway / Infinite Loop

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** High
- **Likelihood:** Low
- **Category:** Operational
- **Description:** A subagent enters an infinite retry loop, consuming
  excessive tokens/compute without producing results
- **Impact:** Cost runaway, context window exhaustion, system stall
- **Mitigation:** Maximum retry limit (3) per task. Timeout budgets in
  delegation packets. Loop counter in Plan-Act-Reflect cycle. ReaperOAK
  monitors iteration count.
- **Status:** Mitigated
- **Evidence:** Orchestration rules define loop detection heuristic

### RISK-004: Unauthorized Privilege Escalation

- **Date Identified:** 2026-02-21
- **Identified By:** ReaperOAK
- **Severity:** Critical
- **Likelihood:** Low
- **Category:** Security
- **Description:** A subagent attempts to use tools outside its allowed set or
  modify files outside its scope
- **Impact:** Unauthorized code changes, security config modifications,
  production access
- **Mitigation:** Each subagent has explicit `allowed_tools` list and
  `scopeBoundaries`. Tool access enforced at delegation time. Forbidden actions
  list in each agent definition.
- **Status:** Mitigated
- **Evidence:** Subagent files define explicit boundaries

### RISK-005: Overly Permissive RLS on agent_file_locks Table

- **Date Identified:** 2026-03-07
- **Identified By:** Security
- **Severity:** Medium
- **Likelihood:** Low
- **Category:** Security
- **Description:** The `agent_file_locks` table uses `USING(TRUE)` RLS policy, allowing any authenticated agent to read/modify any file lock regardless of ownership. CWE-285 (Improper Authorization).
- **Impact:** An agent could release or modify another agent's file locks, potentially causing concurrent file access conflicts.
- **Mitigation:** All file lock operations are mediated through stored functions (`acquire_file_lock`, `release_file_lock`) which enforce ownership checks. Direct table DML is prevented by application-level access patterns. Risk accepted for current internal-only deployment.
- **Status:** Accepted
- **Evidence:** TASK-FOS-01-001 Security Review — `.github/agent-output/Security/TASK-FOS-01-001.md`

### RISK-006: Default Admin API Key Accepted in Production

- **Date Identified:** 2026-03-07
- **Identified By:** Security
- **Severity:** Medium
- **Likelihood:** Medium
- **Category:** Security
- **Description:** `config.ts` accepts the default `ADMIN_API_KEY='forgeos_admin_CHANGE_ME'` value in production mode without validation or warning. CWE-1188 (Initialization with Hard-Coded Network Resource Configuration Data).
- **Impact:** If deployed without changing the default key, the admin API is accessible with a well-known credential.
- **Mitigation:** The key is named with `CHANGE_ME` convention, `.env.example` documents the requirement to change it, and Dockerfile does not embed the value. Recommend adding a startup validation that rejects the default key when `NODE_ENV=production`.
- **Status:** Open
- **Evidence:** TASK-FOS-08-003 Security Review — `.github/agent-output/Security/TASK-FOS-08-003.md`

---

## Closed Risks

<!-- Risks that have been resolved or are no longer applicable -->

_None_

### [TASK-FOS-08-003] — Configuration Security Risks (2026-03-06T10:15:00Z)

| ID | Severity | Description | Status | Mitigation |
|----|----------|-------------|--------|------------|
| SEC-CFG-001 | Medium | docker-compose.yml hardcodes `POSTGRES_PASSWORD: forgeos` and embeds password in `DATABASE_URL` | Risk Accepted | Local dev only; production deployments must override via env vars. Pattern `${ADMIN_API_KEY:-...}` already used for API key. |
| SEC-CFG-002 | Low | Root `.gitignore` does not exclude `.env` files — accidental secret commit possible | Open | Recommend adding `.env` and `!.env.example` to .gitignore in future housekeeping ticket |
| SEC-CFG-003 | Low | `ADMIN_API_KEY` minimum length 8 chars (recommend 16+ for production) | Risk Accepted | Production validation rejects default value; convention guides longer keys |
| SEC-CFG-004 | Low | Admin key comparison in auth middleware uses `===` (non-constant-time) | Risk Accepted | Network latency masks timing; admin key check is fallback before DB hash lookup |
