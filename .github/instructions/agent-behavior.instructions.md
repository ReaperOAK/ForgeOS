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
Allowed: Multi-ticket references in worker output.
PROHIBITED: Cross-ticket file modifications.

RULE: Worker termination
Triggers:
- Out-of-scope file modification
- Protocol violation

## 2. Context Derivation

RULE: Agents derive context from the following sources:
1. Ticket data via MCP `tickets.get(ticket_id)` (acceptance criteria, file_paths, depends_on, history)
2. Dispatch payload via MCP `tickets.payload(ticket_id, agent_role)` (ticket + upstream summary + memory lessons)
3. Codebase files within ticket scope
4. Instruction files (`.github/instructions/`)
5. Agent chunk files (`.github/vibecoding/chunks/{Agent}.agent/`)

RULE: Ticket context is MCP-delivered, not filesystem-derived.
RULE: The ForgeOS orchestrator provides `ticket_id` at dispatch. Agents call `tickets.get(ticket_id)` to load full context.
PROHIBITED: Reading `.github/ticket-state/` or `.github/tickets/` directly for workflow purposes.
PROHIBITED: Expecting context injection via environment variables or prompt preamble.
Allowed: Reading other agents' summaries outside the chain via `tickets.payload`.

## 3. ForgeOS Dispatcher Contract

RULE: ForgeOS is the orchestrator that dispatches agents.

REQUIRED: ForgeOS behavior:
1. Query MCP `tickets.list(stage='READY')` for available work
2. For each ticket, dispatch the correct subagent with `ticket_id`
3. Stop when no READY tickets exist

PROHIBITED for ForgeOS dispatcher:
- Analyzing code
- Computing file overlap
- Computing safe parallel sets
- Reasoning about dependencies
- Optimizing batching
- Implementing any product code
- Running build/test commands

RULE: ForgeOS dispatches one subagent per READY ticket.
RULE: No grouping logic. No dependency reasoning. No conflict analysis.
RULE: MCP server + PostgreSQL enforce safety. Not the dispatcher.

## 4. Stage Ownership

| Agent | Processes Stage |
|-------|----------------|
| Research Analyst | RESEARCH |
| Product Manager | PM |
| Architect | ARCHITECT |
| TODO | Ticket creation only |
| DevOps Engineer | BACKEND (infra tickets) |
| Backend | BACKEND |
| UIDesigner | UI |
| Frontend Engineer | FRONTEND |
| QA Engineer | QA |
| Security Engineer | SECURITY |
| CI Reviewer | CI |
| Documentation Specialist | DOCS |
| Validator | VALIDATION |

## 5. Scope Enforcement

PROHIBITED: Modifying files outside ticket scope.

## 6. Forbidden Actions (All Agents)

PROHIBITED: `git add .` / `git add -A` / `git add --all`
PROHIBITED: Force pushing or deleting branches.
PROHIBITED: Deploying to any environment. (allowed for DevOps agent)
PROHIBITED: Modifying `systemPatterns.md` (except ForgeOS dispatcher and Documentation agent).
PROHIBITED: Modifying `decisionLog.md` (except ForgeOS dispatcher and Documentation agent).
PROHIBITED: Processing unclaimed tickets.
PROHIBITED: Holding claims on multiple tickets per agent instance.
PROHIBITED: Reading `.github/ticket-state/` directories for workflow state (use MCP `tickets.get` instead).

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
```

RULE: Multiple operators work simultaneously on the same repo.
RULE: Git push/pull is the only synchronization mechanism.

