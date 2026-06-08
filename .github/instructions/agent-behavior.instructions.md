---
name: Agent Behavior
applyTo: '**'
description: Worker model, scope enforcement, context derivation, forbidden actions, evidence gates, dispatcher contract. Defines how all agents operate within the vibecoding system.
---

# Agent Behavior

## 1. Worker Model

RULE: One worker handles exactly one ticket.
RULE: One invocation handles exactly one SDLC stage.
RULE: Workers are ephemeral and stateless.
RULE: No worker reuse across tickets.
Allowed: Multi-ticket references in worker output.
PROHIBITED: Cross-ticket file modifications.

RULE: Worker termination 
Triggers:
- Out-of-scope file modification
- Protocol violation

## 2. Context Derivation

RULE: Agents derive context ONLY from:
1. Ticket JSON (acceptance criteria, file_paths, depends_on)
2. Previous stage summary file
3. Codebase files within ticket scope
4. Instruction files (`.github/instructions/`)
5. Agent skill files (`.github/skills/` — SKILL.md and references)

PROHIBITED: Expecting context injection from Ticketer.
Allowed: Reading other agents' summaries outside the chain.
RULE: Context is filesystem-derived. Period.

## 3. Ticketer Dispatcher Contract

RULE: Ticketer is a stateless dispatcher.

REQUIRED: Ticketer behavior:
1. Scan `ticket-state/READY/`
2. For each ticket, call the correct subagent
3. Stop when no READY tickets exist

PROHIBITED for Ticketer:
- Analyzing code
- Computing file overlap
- Computing safe parallel sets
- Reasoning about dependencies
- Optimizing batching
- Injecting context into agents
- Implementing any product code
- Reading/modifying files 
- Running build/test commands

RULE: Ticketer calls one subagent per READY ticket.
RULE: No grouping logic. No dependency reasoning. No conflict analysis.
RULE: Git + tickets.py enforce safety. Not Ticketer.

## 4. Stage Ownership

| Agent | Processes Stage |
|-------|----------------|
| Research Analyst | RESEARCH |
| ProductManager | PM |
| Architect | ARCHITECT |
| TODO | Ticket creation only |
| DevOps | BACKEND (infra tickets) |
| Backend | BACKEND |
| UIDesigner | UI |
| Frontend  | FRONTEND |
| QA | QA |
| Security | SECURITY |
| CIReviewer | CI |
| Documentation Specialist | DOCS |
| Validator | VALIDATION |

## 5. Scope Enforcement

PROHIBITED: Modifying files outside ticket scope.

## 6. Forbidden Actions (All Agents)

PROHIBITED: `git add .` / `git add -A` / `git add --all`
PROHIBITED: Force pushing or deleting branches.
PROHIBITED: Deploying to any environment. (allowed for DevOps agent)
PROHIBITED: Modifying `systemPatterns.md` (except Ticketer and Documentation agent).
PROHIBITED: Modifying `decisionLog.md` (except Ticketer and Documentation agent).
PROHIBITED: Processing unclaimed tickets.
PROHIBITED: Holding claims on multiple tickets per agent instance.

## 7. Evidence Requirements

REQUIRED: Completion claims must include:
- Artifact paths (files created/modified)
- Test results or justified N/A
- Confidence level (HIGH/MEDIUM/LOW)

PROHIBITED: Claims without evidence.
PROHIBITED: Hallucinated capability claims.

## 8. Self-Reflection Gate

REQUIRED: Before submission, agent verifies:
1. All acceptance criteria addressed
2. Modified files within write scope
3. Single ticket reference only
4. Evidence present for all claims

## 9. Rework Handling

RULE: On rejection, agent receives rejection evidence with re-delegation.
RULE: Agent must address ALL rejection points.
RULE: Same failure 3 times => escalate, do not retry same approach.

## 10. Operator Workflow

REQUIRED: Before any work:
```bash
git pull --rebase
python3 tickets.py --sync
```

RULE: Multiple operators work simultaneously on the same repo.
RULE: Git push/pull is the only synchronization mechanism.

