---
name: 'orchestration'
description: 'Multi-agent orchestration rules including agent dispatching, parallel execution, dependency resolution, and workflow coordination.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['orchestration', 'multi-agent', 'workflow', 'coordination']
  source: 'chunks/orchestration.rules'
  last-updated: '2026-02-26'
---

## Overview

Multi-agent orchestration rules including agent dispatching, parallel execution, dependency resolution, and workflow coordination.


# Orchestration Rules

## When to Use
- Dispatching agents for parallel execution
- Coordinating multi-agent workflows
- Resolving dependencies between tickets
- Managing agent handoffs

## Key Rules
1. **One Agent Per Ticket** — Each ticket gets exactly one worker per stage
2. **Parallel Execution** — Independent tickets can be processed simultaneously
3. **Dependency Resolution** — tickets.py handles dependencies, not agents
4. **Handoff Protocol** — Context flows via filesystem summaries only

## Resources
See the `../agent-protocols/references/` directory for:
- Cross-cutting protocols reference
- Orchestration rules (chunk-01, chunk-02)
- Agent dispatch patterns
- Dependency resolution guide

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
