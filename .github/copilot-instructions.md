# Project Context

This repository implements a **multi-agent vibecoding system** — a ticket-driven
AI development infrastructure where specialized agents collaborate under
ReaperOAK (stateless dispatcher).

## Repository Structure

```
.github/
  agents/              # 14 agent definitions (*.agent.md)
  instructions/        # 6 canonical instruction files (sole authority)
    core.instructions.md            # Identity, precedence, halt gate, boot, approvals, memory, security
    sdlc.instructions.md            # Stage-based lifecycle, post-chain, rework, Definition of Done
    ticket-system.instructions.md   # State machine, directories, tickets.py, dependency resolution, parallelism
    git-protocol.instructions.md    # Two-commit protocol, scoped git, lease, summary handoff
    agent-behavior.instructions.md  # Worker model, scope, context derivation, stage ownership
  memory-bank/         # Persistent shared state (append-only)
  tickets/             # Ticket JSON files + schema
  ticket-state/        # File-based state machine (11 stage directories)
    READY/ ARCHITECT/ RESEARCH/ BACKEND/ FRONTEND/ QA/ SECURITY/ CI/ DOCS/ VALIDATION/ DONE/
  agent-output/        # Summary handoff chain ({AgentName}/{ticket-id}.md)
  vibecoding/          # Context chunks, catalog, index
  guardian/            # Circuit breaker (STOP_ALL)
  tickets.py           # Distributed ticket state machine manager
  agent-runner.py      # Two-commit protocol execution runner
TODO/                  # Task decomposition artifacts
docs/uiux/            # UI/UX design artifacts
```

## Architecture

- **ReaperOAK**: Stateless dispatcher. Scans READY tickets, dispatches workers, advances lifecycle.
- **Distributed execution**: Multiple operators on multiple machines via Git-native locking.
- **Two-commit protocol**: CLAIM commit (distributed lock via push) + WORK commit (deliverables).
- **File-based state machine**: Ticket state = directory location under .github/ticket-state/.
- **14 agents**: Architect, Backend, Frontend, QA, Security, DevOps, Documentation, Research, ProductManager, CIReviewer, UIDesigner, TODO, Validator.
- **Summary handoff**: Context flows via .github/agent-output/{Agent}/{ticket-id}.md files.
- **Memory bank**: Git-tracked markdown files for cross-session persistence.

## Key Conventions

- All infrastructure lives inside .github/
- 6 instruction files are the sole source of system rules
- Agent files contain only: role, stage, scope, forbidden actions, references
- Memory bank files are append-only with ownership rules
- Destructive operations require human approval
- Every agent commits twice per stage: CLAIM then WORK
- tickets.py handles dependency resolution — agents never compute dependencies
