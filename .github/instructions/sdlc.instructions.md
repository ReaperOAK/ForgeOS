---
name: SDLC Lifecycle
applyTo: '**'
description: Stage-based lifecycle, per-type flows, post-execution chain, rework rules, Definition of Done, stage transitions.
---

# SDLC Lifecycle

## 1. Stage-Based Pipeline

RULE: Ticket state is determined by directory location under `.github/ticket-state/`.
RULE: There are 11 possible stages. Each ticket type traverses a defined subset.
RULE: Two-commit protocol applies per stage: CLAIM commit then WORK commit.

### Available Stages

```
READY | ARCHITECT | RESEARCH | BACKEND | FRONTEND | QA | SECURITY | CI | DOCS | VALIDATION | DONE
```

### SDLC Flows by Ticket Type

| Type | Flow |
|------|------|
| backend | READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| frontend | READY → FRONTEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| fullstack | READY → BACKEND → FRONTEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| infra | READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| security | READY → SECURITY → QA → CI → DOCS → VALIDATION → DONE |
| docs | READY → DOCS → VALIDATION → DONE |
| research | READY → RESEARCH → DOCS → VALIDATION → DONE |
| architecture | READY → ARCHITECT → DOCS → VALIDATION → DONE |

PROHIBITED: Skipping any stage in the ticket's defined flow.
PROHIBITED: Reordering stages.
RULE: tickets.py enforces flow order per ticket type.

## 2. Stage Definitions

| Stage | Description | Owner |
|-------|-------------|-------|
| READY | Dependencies met, eligible for claim | System (tickets.py) |
| ARCHITECT | Architecture design, ADRs, API contracts | Architect |
| RESEARCH | Evidence-based research, PoC, analysis | Research Analyst |
| BACKEND | Server-side implementation, APIs, business logic | Backend / DevOps |
| FRONTEND | UI implementation, components, layouts | UIDesigner (mockup), Frontend Engineer |
| QA | Test coverage, functional verification, mutation testing | QA Engineer |
| SECURITY | Vulnerability scan, STRIDE, OWASP review | Security Engineer |
| CI | Lint, type checks, complexity analysis | CI Reviewer |
| DOCS | Documentation updates, JSDoc/TSDoc, README | Documentation Specialist |
| VALIDATION | Independent DoD review, upstream verdict verification | Validator |
| DONE | Lifecycle complete | System |

## 3. Post-Implementation Chain

REQUIRED: After implementation stage completes, execute in strict order:
1. QA Engineer
2. Security Engineer
3. CI Reviewer
4. Documentation Specialist
5. Validator

RULE: Any rejection returns ticket to REWORK.
PROHIBITED: Skipping any step in the chain.
PROHIBITED: Reordering the chain.

## 4. Rework Rules

RULE: REWORK is a side-state entered on rejection by QA, Security, Validator, or CI.
RULE: Maximum 3 combined rework attempts per ticket.
RULE: After 3 reworks => ESCALATED to human.
RULE: Rework re-enters at the implementation stage with rejection evidence attached.

## 5. Definition of Done (10 Items)

REQUIRED: Every ticket must satisfy ALL items. Validator verifies independently.

1. Code implemented (all acceptance criteria met)
2. Tests written (>=80% coverage for new code)
3. Lint passes (zero errors, zero warnings)
4. Type checks pass
5. CI passes (all workflow checks green)
6. Docs updated (JSDoc/TSDoc, README if applicable)
7. Reviewed by Validator (independent review)
8. No console errors (structured logger only)
9. No unhandled promises
10. No TODO comments in code

## 6. Stage Transition Guards

RULE: Implementation stage varies by ticket type (ARCHITECT, RESEARCH, BACKEND, FRONTEND, or SECURITY).
RULE: Claim commit locks the ticket within its current stage directory.

| From | To | Guard |
|------|----|-------|
| READY | impl stage | Claim commit pushed successfully |
| impl stage | QA | Agent emits completion with evidence |
| QA | SECURITY | QA PASS |
| QA | REWORK | QA rejects |
| SECURITY | CI | Security PASS |
| SECURITY | REWORK | Security rejects |
| CI | DOCS | CI PASS |
| CI | REWORK | Lint/type/complexity failure |
| DOCS | VALIDATION | Doc update confirmed |
| VALIDATION | DONE | Validator APPROVED + memory gate pass |
| VALIDATION | REWORK | Validator rejects |
| REWORK | impl stage | Rework count < 3 |
| REWORK | ESCALATED | Rework count >= 3 |

## 7. TODO Agent Decomposition

RULE: Only ReaperOAK may invoke TODO agent.
REQUIRED: Decomposition order for multi-step work:
1. Strategic Mode (L0->L1): Vision to capabilities
2. Planning Mode (L1->L2): Capabilities to execution blocks
3. Execution Planning Mode (L2->L3): Blocks to actionable tickets

RULE: L3 tasks become tickets in READY state (after dependency check).
PROHIBITED: Jumping from L0 to L3 directly.
