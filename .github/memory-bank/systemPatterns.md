---
id: system-patterns
version: "1.0"
owner: ReaperOAK
write_access: [ReaperOAK]
append_only: true
immutable_to_subagents: true
---

# System Patterns

> **Schema Version:** 1.0
> **Owner:** ReaperOAK (EXCLUSIVE)
> **Write Access:** ReaperOAK ONLY — this file is IMMUTABLE to all subagents
> **Lock Rules:** No subagent may modify, delete, or overwrite any entry.
> Subagents attempting to modify this file must be rejected and the attempt
> logged.
> **Update Protocol:** Append-only. New entries require timestamp and rationale.
> Existing entries are never deleted or modified — only superseded with explicit
> `[SUPERSEDED by entry DATE]` annotation.

---

## Update Log

<!-- Append entries below in reverse chronological order -->

### [2026-02-21] Initial Creation

- **Updated by:** ReaperOAK
- **Change:** Initial system patterns establishment

---

## Architecture Decisions

<!-- Format: ADR-{number}: {title} -->

### ADR-001: Multi-Agent Supervisor Pattern

- **Date:** 2026-02-21
- **Decision:** Use Supervisor Pattern with ReaperOAK as singular orchestrator
- **Rationale:** Prevents authority fragmentation, ensures single source of
  truth for delegation, validation, and state
- **Alternatives Considered:** Peer-to-peer agents, hierarchical delegation
  chains
- **Status:** Active

### ADR-002: File-Based Memory Bank

- **Date:** 2026-02-21
- **Decision:** Use markdown files in `.github/memory-bank/` for persistent
  state
- **Rationale:** Git-tracked, human-readable, no external dependencies, works
  with all agent frameworks
- **Status:** Active

### ADR-003: Append-Only Immutable Logs

- **Date:** 2026-02-21
- **Decision:** `systemPatterns.md` and `decisionLog.md` are append-only,
  controlled exclusively by ReaperOAK
- **Rationale:** Prevents memory poisoning, ensures architectural consistency
  across sessions
- **Status:** Active

---

## Code Conventions

<!-- Authoritative conventions for the project -->

- _Awaiting project initialization_

---

## Directory Structure

<!-- Canonical directory structure for the project -->

```
.github/
├── agents/           # Subagent definitions
├── memory-bank/      # Persistent state files
├── workflows/        # CI/CD workflows
├── ARCHITECTURE.instructions.md   # System architecture document
├── orchestration.rules.instructions.md  # Parallel execution framework
└── security.agentic-guardrails.instructions.md  # Security constraints
```

---

## Technology Stack

<!-- Authoritative technology choices for the project -->

- _Awaiting project initialization_

---

## Design Patterns in Use

<!-- Canonical patterns that must be followed -->

| Pattern | Where Applied | Rationale |
|---------|---------------|-----------|
| Supervisor Pattern | Agent orchestration | Single authority, clear delegation |
| Plan-Act-Reflect | All subagent execution | Deterministic quality loop |
| Append-Only Logs | Memory bank | Prevent memory poisoning |
| Least Privilege | Tool access | Minimize blast radius |
| Human-in-the-Loop | Destructive operations | Safety gate |

---

## Component Relationships

<!-- How system components interact -->

- _Awaiting project initialization_
