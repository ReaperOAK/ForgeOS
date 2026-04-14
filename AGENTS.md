# AGENTS.md

last_reviewed: 2026-04-11

Human-readable pointer for agent operators.

## Canonical Orchestration Rules
- `.github/instructions/agent-orchestration.instructions.md`

## Core System Rules
- `.github/instructions/core.instructions.md`
- `.github/instructions/sdlc.instructions.md`
- `.github/instructions/ticket-system.instructions.md`
- `.github/instructions/git-protocol.instructions.md`
- `.github/instructions/agent-behavior.instructions.md`
- `.github/instructions/python.instructions.md`

## Notes
- Agent definitions live in `.github/agents/`.
- This file is a pointer index; executable orchestration rules live in `.github/instructions/agent-orchestration.instructions.md`.
- Prefer `description`-based instruction discovery.
- Avoid `applyTo: '**'` to prevent unnecessary context loading.
