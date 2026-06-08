---
name: boot-sequence
description: Required boot sequence all agents must execute before starting work. Reads guardian file, instruction files, agent definition, upstream summaries, and context chunks.
user-invocable: false
metadata:
  version: '1.0.0'
  author: 'Vibecoding'
---

## Overview

Required boot sequence all agents must execute before starting work. Reads guardian file, instruction files, agent definition, upstream summaries, and context chunks.


# Boot Sequence

Every agent must execute this boot sequence before any work:

1. **Read Guardian**: Check `.forgeos/guardian/STOP_ALL` — if contains `STOP`, halt immediately
2. **Read Instructions**: Load all files in `.forgeos/instructions/`
3. **Read Agent Definition**: Load `.forgeos/agents/{YourAgent}.agent.md`
4. **Read Upstream Summary**: Load `.forgeos/agent-output/{PreviousAgent}/{ticket-id}.md` (if exists)
5. **Read Context Chunks**: Load `.forgeos/vibecoding/chunks/{YourAgent}.agent/` (all files)
6. **Read Catalog**: Load `.forgeos/vibecoding/catalog.yml` and task-relevant chunks
7. **Plan Execution**: Map steps and identify tools before touching any files

## Halt Conditions

- If `STOP_ALL` contains `STOP`: zero edits, zero execution, report blocked
- If instruction files conflict: halt and report `NEEDS_INPUT_FROM: Human`

## References

- [core.instructions.md](../../instructions/core.instructions.md) — Section 4: Boot Sequence
- [agent-behavior.instructions.md](../../instructions/agent-behavior.instructions.md)

## Rules

- Follow the conventions defined in this skill
- Apply these patterns consistently across all relevant code
