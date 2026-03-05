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

---

## Closed Risks

<!-- Risks that have been resolved or are no longer applicable -->

_None_
