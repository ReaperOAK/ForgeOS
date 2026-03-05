# Agent Execution Contract (LLM-Optimized)

Machine-priority protocol. Follow exactly. No interpretation layer.

## 0) Rule Precedence

When rules conflict, apply highest first:
1. .github/instructions/core.instructions.md
2. .github/instructions/*.instructions.md
3. .github/agents/*.agent.md
4. This file (agents.md)
5. Delegation prompt

If unresolved conflict remains: STOP and emit NEEDS_INPUT_FROM: ReaperOAK.

## 1) Required Boot Sequence (run in order, no skips)

1. Read .github/guardian/STOP_ALL — if contains STOP: halt, zero edits
2. Read .github/instructions/core.instructions.md
3. Read .github/instructions/sdlc.instructions.md
4. Read .github/instructions/ticket-system.instructions.md
5. Read .github/instructions/git-protocol.instructions.md
6. Read .github/instructions/agent-behavior.instructions.md
7. Read .github/instructions/terminal-management.instructions.md
8. Read upstream summary from .github/agent-output/{PreviousAgent}/{ticket-id}.md (if exists)
9. Read .github/vibecoding/chunks/{YourAgent}.agent/ (all files)
10. Read .github/vibecoding/catalog.yml; load task-relevant chunks

## 2) Identity Invariants

- ReaperOAK is orchestrator-only: no implementation, no file edits
- Worker handles exactly one ticket, one SDLC stage per invocation
- Never reference or modify artifacts outside assigned ticket scope

## 3) Required Lifecycle

Each ticket type traverses a defined subset of 11 stages:

```
READY | ARCHITECT | RESEARCH | BACKEND | FRONTEND | QA | SECURITY | CI | DOCS | VALIDATION | DONE
```

Post-implementation chain (strict order): QA → Security → CI → Docs → Validator.

No skip, no merge, no reorder. Failure at any stage -> REWORK (max 3, then ESCALATED).

## 4) Scoped Git (non-negotiable)

- PROHIBITED: git add . / git add -A / git add --all
- Stage explicit files only
- Two-commit protocol: CLAIM commit then WORK commit per stage

## 5) Memory Gate (pre-DONE)

Before DONE, entry must exist in .github/memory-bank/activeContext.md:

### [TICKET-ID] — Summary
- **Artifacts:** file1.ts, file2.ts
- **Decisions:** Chose X over Y because Z
- **Timestamp:** ISO8601

## 6) Human Approval Gate

Require explicit approval before: destructive data ops, force push, production deploy, new external deps, destructive schema migration.

## 7) Anti-Loop Rule

If same failed approach repeats >= 3 times: stop retrying, switch strategy or escalate.

## 8) Evidence Rule

Every TASK_COMPLETED must include: artifact paths, test results (or justified N/A), confidence level.

## References

- .github/instructions/core.instructions.md
- .github/instructions/sdlc.instructions.md
- .github/instructions/ticket-system.instructions.md
- .github/instructions/git-protocol.instructions.md
- .github/instructions/agent-behavior.instructions.md
- .github/instructions/terminal-management.instructions.md
- .github/tickets.py
- .github/agent-runner.py
