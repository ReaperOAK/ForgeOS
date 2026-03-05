---
name: Agent Behavior
applyTo: '**'
description: Worker model, scope enforcement, context derivation, forbidden actions, evidence gates, dispatcher contract.
---

# Agent Behavior

## 1. Worker Model

RULE: One worker handles exactly one ticket.
RULE: One invocation handles exactly one SDLC stage.
RULE: Workers are ephemeral and stateless.
RULE: No worker reuse across tickets.
PROHIBITED: Multi-ticket references in worker output.
PROHIBITED: Cross-ticket file modifications.

RULE: Worker termination triggers:
- Cross-ticket reference detected
- Out-of-scope file modification
- Protocol violation

## 2. Context Derivation

RULE: Agents derive context ONLY from:
1. Ticket JSON (acceptance criteria, file_paths, depends_on)
2. Previous stage summary file
3. Codebase files within ticket scope
4. Instruction files (`.github/instructions/`)
5. Agent chunk files (`.github/vibecoding/chunks/{Agent}.agent/`)

PROHIBITED: Expecting context injection from ReaperOAK.
PROHIBITED: Reading other agents' summaries outside the chain.
RULE: Context is filesystem-derived. Period.

## 3. ReaperOAK Dispatcher Contract

RULE: ReaperOAK is a stateless dispatcher.

REQUIRED: ReaperOAK behavior:
1. Scan `.github/ticket-state/READY/`
2. For each ticket, call the correct subagent
3. Stop when no READY tickets exist

PROHIBITED for ReaperOAK:
- Analyzing code
- Computing file overlap
- Computing safe parallel sets
- Reasoning about dependencies
- Optimizing batching
- Injecting context into agents
- Implementing any product code
- Running build/test commands

RULE: ReaperOAK calls one subagent per READY ticket.
RULE: No grouping logic. No dependency reasoning. No conflict analysis.
RULE: Git + tickets.py enforce safety. Not ReaperOAK.

## 4. Stage Ownership

| Agent | Processes Stage |
|-------|----------------|
| Architect | ARCHITECT |
| Research Analyst | RESEARCH |
| Backend | BACKEND |
| Frontend Engineer | FRONTEND |
| UIDesigner | FRONTEND (UI phase, before Frontend) |
| QA Engineer | QA |
| Security Engineer | SECURITY |
| CI Reviewer | CI |
| Documentation Specialist | DOCS |
| Validator | VALIDATION |
| TODO | Ticket creation only (not a stage) |
| Product Manager | Requirements only (not a stage) |
| DevOps Engineer | BACKEND (infra tickets) |

## 5. Scope Enforcement

REQUIRED: Every agent's output must reference only its assigned ticket.
REQUIRED: Modified files must be within ticket's declared file_paths.
PROHIBITED: Modifying files outside ticket scope.
PROHIBITED: Referencing other ticket IDs.

## 6. Forbidden Actions (All Agents)

PROHIBITED: `git add .` / `git add -A` / `git add --all`
PROHIBITED: Force pushing or deleting branches.
PROHIBITED: Deploying to any environment.
PROHIBITED: Modifying `systemPatterns.md` (except ReaperOAK).
PROHIBITED: Modifying `decisionLog.md` (except ReaperOAK).
PROHIBITED: Direct agent-to-agent communication.
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
python3 .github/tickets.py --sync
```

RULE: Multiple operators work simultaneously on the same repo.
RULE: Git push/pull is the only synchronization mechanism.

