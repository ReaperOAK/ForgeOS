---
description: Structured shutdown. Drains active tickets, consolidates memory, produces resume artifacts for /continue.
argument-hint: No arguments needed — run /stop to cleanly pause development
---

Execute the vibecoding **stop** protocol. The full, authoritative protocol lives
in `.github/prompts/stop.prompt.md` — read that file in its entirety and follow it step by step.

First run the safety boot: read `.github/guardian/STOP_ALL` (halt if it contains
`STOP`), then `AGENTS.md` and the relevant `.github/instructions/*.instructions.md`.

This protocol is driven by the **ticketer** agent: dispatch the `ticketer` subagent via the **Task** tool (it maps the `runSubagent(...)` calls in the prompt). Map any Copilot MCP tools to Claude-native tools per `.claude/TOOL_MAPPING.md`.

Honour scoped git (never `git add .`/`-A`/`--all`), the boot sequence, the memory
gate, and the evidence rule throughout.

User input for this run:

$ARGUMENTS
