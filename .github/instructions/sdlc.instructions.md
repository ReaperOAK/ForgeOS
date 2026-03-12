---
name: SDLC Lifecycle
applyTo: '**'
description: Stage-based lifecycle, per-type flows, post-execution chain, rework rules, Definition of Done, MCP-based stage transitions.
---

# SDLC Lifecycle

## 1. Stage-Based Pipeline

RULE: Ticket state is stored in PostgreSQL and managed by the ForgeOS MCP Server.
RULE: There are 11 possible stages. Each ticket type traverses a defined subset.
RULE: Stage transitions are atomic database operations executed via MCP tools (`tickets.claim`, `tickets.complete`, `tickets.reject`).
RULE: Ticketer dispatches subagents after claiming tickets via `tickets.claim`. Subagents advance or reject via `tickets.complete` / `tickets.reject`.

### Available Stages

```
READY > RESEARCH > PM > ARCHITECT > DevOps > BACKEND > UIDesigner > FRONTEND > QA > SECURITY > CI > DOCS > VALIDATION > DONE
```

## 2. Stage Definitions

| Stage | Description | Owner |
|-------|-------------|-------|
| READY | Dependencies met, eligible for claim | System (MCP Server / dependency resolver) |
| RESEARCH | Evidence-based research, PoC, analysis | Research Analyst |
| PM | Project management, stakeholder communication | Product Manager |
| ARCHITECT | Architecture design, ADRs, API contracts | Architect |
| DevOps | Infrastructure, deployment, monitoring | DevOps Engineer |
| BACKEND | Server-side implementation, APIs, business logic | Backend |
| UIDesigner | UI/UX design, mockups, prototypes, import from figma/stitch | UIDesigner |
| FRONTEND | UI implementation, components, layouts | Frontend Engineer |
| QA | Test coverage, functional verification, mutation testing | QA Engineer |
| SECURITY | Vulnerability scan, STRIDE, OWASP review | Security Engineer |
| CI | Lint, type checks, complexity analysis | CI Reviewer |
| DOCS | Documentation updates, JSDoc/TSDoc, README | Documentation Specialist |
| VALIDATION | Independent DoD review, upstream verdict verification | Validator |
| DONE | Lifecycle complete | System |

## 3. Stage Transitions via MCP

RULE: All stage transitions are performed through ForgeOS MCP tools — never by moving files between directories.

### Advancing a Stage (`tickets.complete`)

RULE: When a subagent finishes its stage work, it calls `tickets.complete` with structured evidence.
RULE: The MCP Server's `advance_ticket` PostgreSQL function atomically:
  1. Validates claim ownership (`SELECT FOR UPDATE`).
  2. Computes the next stage from the ticket's `sdlc_flow[]`.
  3. Releases file locks held by the completing agent.
  4. Merges evidence JSONB into ticket metadata.
  5. When the ticket reaches DONE, calls `resolve_dependencies()` to unblock downstream tickets.

REQUIRED: Evidence payload for `tickets.complete`:
```jsonc
{
  "ticket_id": "TASK-001",
  "evidence": {
    "artifacts": ["src/feature.ts", "tests/feature.test.ts"],
    "test_results": "12 tests passed, 0 failed",
    "confidence": "HIGH",      // HIGH | MEDIUM | LOW
    "notes": "Optional notes"  // optional
  }
}
```

### Rejecting a Stage (`tickets.reject`)

RULE: When a review agent (QA, Security, CI, Validator) finds the work insufficient, it calls `tickets.reject` with a reason and optional evidence.
RULE: The MCP Server's `reject_ticket` PostgreSQL function atomically:
  1. Validates claim ownership.
  2. If `rework_count < max_reworks`: resets ticket to its first implementation stage with status READY, increments `rework_count`.
  3. If `rework_count >= max_reworks`: sets status to ESCALATED, clears claim.
  4. Releases file locks.
  5. Records a `STAGE_REJECTED` or `ESCALATED` event.

REQUIRED: Rejection payload for `tickets.reject`:
```jsonc
{
  "ticket_id": "TASK-001",
  "reason": "Coverage is 62%, below the 80% minimum",
  "evidence": { "coverage": 62 }  // optional structured evidence
}
```

### Claiming a Ticket (`tickets.claim`)

RULE: Ticketer (dispatcher) claims tickets via `tickets.claim` before launching subagents.
RULE: The MCP Server atomically acquires a database-level lock, validates the ticket is in READY state, sets claim metadata (`claimed_by`, `machine_id`, `lease_expiry`), and acquires file-level locks.
RULE: Subagents NEVER call `tickets.claim` — they receive pre-claimed tickets.

## 4. Rework Rules

RULE: REWORK is triggered when `tickets.reject` is called by QA, Security, CI, or Validator.
RULE: The MCP Server automatically handles rework routing:
  - If `rework_count < max_reworks` (default 3): ticket returns to its implementation stage in READY status.
  - If `rework_count >= max_reworks`: ticket is set to ESCALATED status for human intervention.
RULE: Maximum 3 combined rework attempts per ticket (configurable via `max_reworks`).
RULE: Rejection evidence is preserved in the ticket's event history and metadata for the reworking agent.
PROHIBITED: Manual rework state changes — always use `tickets.reject`.

## 5. Definition of Done (11 Items)

REQUIRED: Every ticket must satisfy ALL items. Validator verifies independently via MCP queries (`tickets.stats`, `tickets.graph`).

1. Code implemented (all acceptance criteria met)
2. Tests written (>=80% coverage for new code)
3. Lint passes (zero errors, zero warnings)
4. Type checks pass
5. CI passes (all workflow checks green)
6. Docs updated (JSDoc/TSDoc, README if applicable)
7. Reviewed by Validator (independent review via MCP event history)
8. No console errors (structured logger only)
9. No unhandled promises
10. No TODO comments in code
11. UI designs exist in figma/stitch and in codebase

RULE: Validator confirms DoD by querying the MCP Server for ticket metadata, event history, and evidence payloads from prior stages.
RULE: On DoD pass, Validator calls `tickets.complete` with APPROVED evidence. On DoD fail, Validator calls `tickets.reject` with specific failure reasons.

## 6. Stage Transition Guards

RULE: Implementation stage varies by ticket type (ARCHITECT, RESEARCH, BACKEND, FRONTEND, or SECURITY).
RULE: `tickets.claim` acquires a database-level lock and file-level locks for the ticket.
RULE: `tickets.complete` validates claim ownership and enforces SDLC flow ordering before advancing.
RULE: `tickets.reject` validates claim ownership before resetting to rework or escalating.

| From | To | Guard | MCP Tool |
|------|----|-------|----------|
| READY | impl stage | `tickets.claim` succeeds (atomic lock acquired) | `tickets.claim` |
| impl stage | QA | Agent provides evidence (artifacts, tests, confidence) | `tickets.complete` |
| QA | SECURITY | QA PASS with evidence | `tickets.complete` |
| QA | REWORK | QA rejects with reason | `tickets.reject` |
| SECURITY | CI | Security PASS with evidence | `tickets.complete` |
| SECURITY | REWORK | Security rejects with reason | `tickets.reject` |
| CI | DOCS | CI PASS with evidence | `tickets.complete` |
| CI | REWORK | Lint/type/complexity failure with reason | `tickets.reject` |
| DOCS | VALIDATION | Doc update confirmed with evidence | `tickets.complete` |
| VALIDATION | DONE | Validator APPROVED + memory gate pass + evidence | `tickets.complete` |
| VALIDATION | REWORK | Validator rejects with reason | `tickets.reject` |
| REWORK | impl stage | `rework_count < max_reworks` (automatic via `tickets.reject`) | `tickets.reject` |
| REWORK | ESCALATED | `rework_count >= max_reworks` (automatic via `tickets.reject`) | `tickets.reject` |

RULE: When a ticket reaches DONE via `tickets.complete`, the MCP Server automatically resolves downstream dependencies and unblocks waiting tickets.

## 7. TODO Agent Decomposition

REQUIRED: Decomposition order for multi-step work:
1. Strategic Mode (L0->L1): Vision to capabilities
2. Planning Mode (L1->L2): Capabilities to execution blocks
3. Execution Planning Mode (L2->L3): Blocks to actionable tickets

RULE: L3 tasks become tickets in READY state (after dependency check via MCP Server).
RULE: New tickets are created via `tickets.spawn` MCP tool with parent linkage and inherited context.
PROHIBITED: Jumping from L0 to L3 directly.
