# Project Context

This repository implements a **multi-agent vibecoding system** — a ticket-driven
AI development infrastructure where specialized agents collaborate under
the ForgeOS dispatcher (MCP-native orchestrator).

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
  tickets/             # Legacy ticket JSON artifacts (migration/compat only)
  ticket-state/        # Legacy state snapshots (not runtime source of truth)
  agent-output/        # Summary handoff chain ({AgentName}/{ticket-id}.md)
  vibecoding/          # Context chunks, catalog, index
  guardian/            # Circuit breaker (STOP_ALL)
  tickets.py           # Distributed ticket state machine manager
  agent-runner.py      # Two-commit protocol execution runner
forgeos-server/        # ForgeOS MCP Server (TypeScript/Express)
  src/
    server.ts          # Express app with MCP Streamable HTTP
    config.ts          # Zod-validated environment config
    db/                # Connection pool, migrations, seed, file-mutex
    tools/             # MCP tool handlers (claim, advance, reject, release, etc.)
    api/               # REST + SSE routes (tickets, stages, events, admin)
    auth/              # Agent registration, API key management
    dashboard/         # Static Kanban dashboard (HTML/CSS/JS)
    middleware/        # Logging, error handling, validation
    webhooks/          # GitHub push reconciliation
  docker-compose.yml   # PostgreSQL + PgBouncer + MCP Server
  Dockerfile           # Multi-stage Docker build
infra/                 # Infrastructure and DevOps
  docker-compose.yml   # Production Docker stack
  scripts/             # setup.sh, seed.sh, backup.sh, restore.sh
  config/              # Environment profiles (settings.py)
  monitoring/          # Prometheus + Grafana stack
TODO/                  # Task decomposition artifacts
docs/uiux/            # UI/UX design artifacts
```

## Architecture

- **ForgeOS dispatcher**: MCP-native orchestrator. Finds READY work via `tickets.next`, claims via `tickets.claim`, and dispatches stage agents.
- **ForgeOS MCP Server** (`forgeos-server/`): TypeScript/Express server exposing 11 ticket lifecycle tools over Model Context Protocol (MCP) via Streamable HTTP transport. Backed by PostgreSQL 17 with Row-Level Security, stored functions for atomic ticket operations, and LISTEN/NOTIFY for real-time SSE.
- **PostgreSQL 17**: Primary data store with event-sourcing audit trail, file-level mutex for concurrent access, and dependency resolution.
- **Real-Time Dashboard**: Live Kanban board at http://localhost:3011/dashboard with SSE-driven updates, stage filtering, and ticket detail views.
- **Distributed execution**: Multiple operators on multiple machines via Git-native locking.
- **Two-commit protocol**: CLAIM commit (distributed lock via push) + WORK commit (deliverables).
- **PostgreSQL state machine**: Ticket state lives in DB `tickets.stage` and advances via MCP tools.
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
