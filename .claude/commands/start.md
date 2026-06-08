---
description: Initialize a new project from scratch with full SDLC planning (PRD, architecture, tickets).
argument-hint: Describe your project vision or paste a link to project docs
---

Execute the vibecoding **start** protocol. The full, authoritative protocol lives
in `.github/prompts/start.prompt.md` — read that file in its entirety and follow it step by step.

First run the safety boot: read `.github/guardian/STOP_ALL` (halt if it contains
`STOP`), then `AGENTS.md` and the relevant `.github/instructions/*.instructions.md`.

This protocol is driven by the **cto** agent: dispatch the `cto` subagent via the **Task** tool (it maps the `runSubagent(...)` calls in the prompt). Map any Copilot MCP tools to Claude-native tools per `.claude/TOOL_MAPPING.md`.

Honour scoped git (never `git add .`/`-A`/`--all`), the boot sequence, the memory
gate, and the evidence rule throughout.

User input for this run:

$ARGUMENTS
