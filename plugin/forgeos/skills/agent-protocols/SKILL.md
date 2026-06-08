---
name: 'agent-protocols'
description: 'Cross-cutting agent protocols including boot sequence, context derivation, forbidden actions, evidence requirements, and orchestration rules for multi-agent systems.'
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
  tags: ['agent', 'protocol', 'orchestration', 'multi-agent']
  source: 'chunks/_cross-cutting-protocols, chunks/orchestration.rules'
  last-updated: '2026-02-26'
---

## Overview

Cross-cutting agent protocols including boot sequence, context derivation, forbidden actions, evidence requirements, and orchestration rules for multi-agent systems.


# Agent Protocols

## When to Use
- Configuring new agents in the multi-agent system
- Understanding boot sequence requirements
- Implementing dispatcher-claim protocol
- Enforcing scoped git rules and evidence requirements

## Key Protocols
1. **Boot Sequence** — All agents must read STOP_ALL, instructions, chunks, catalog, upstream summary, and ticket JSON before work
2. **Context Derivation** — Agents derive context ONLY from filesystem (ticket JSON, previous summaries, codebase files)
3. **Forbidden Actions** — No `git add .`, no force push, no cross-ticket modifications
4. **Evidence Requirements** — Every completion claim must include artifact paths and confidence level

## Resources
See the `references/` directory for:
- Cross-cutting protocols reference
- Orchestration rules
- Boot sequence checklist

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
