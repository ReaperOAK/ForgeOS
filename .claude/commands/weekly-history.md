---
description: Analyze the last 7 days of Git history and produce a concise, high-level summary for non-technical founders.
argument-hint: No arguments needed — run /weekly-history
---

Execute the vibecoding **weekly-history** protocol. The full, authoritative protocol lives
in `.github/prompts/weekly-history.prompt.md` — read that file in its entirety and follow it step by step.

First run the safety boot: read `.github/guardian/STOP_ALL` (halt if it contains
`STOP`), then `AGENTS.md` and the relevant `.github/instructions/*.instructions.md`.

Run this directly in the main session using `git log`/`git diff` via Bash.

Honour scoped git (never `git add .`/`-A`/`--all`), the boot sequence, the memory
gate, and the evidence rule throughout.

User input for this run:

$ARGUMENTS
