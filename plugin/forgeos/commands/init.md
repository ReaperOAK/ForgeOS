---
description: Initialize ForgeOS in the current project — scaffolds the .forgeos/ control-plane (engine + runtime state) so the SDLC agents and slash commands can operate here.
---

Initialize the **ForgeOS** engine in this project.

ForgeOS keeps its control-plane (agents, instructions, prompts, skills, the
ticket CLI, guardian, and memory-bank) in a `.forgeos/` directory at the project
root. This must be scaffolded once before `/start`, `/continue`, or any ForgeOS
agent can run.

Run the scaffold script that ships inside the plugin. Locate it and execute it
with Bash:

```bash
SCAFFOLD="$(find "$HOME/.claude/plugins" -type f -name scaffold.sh -path '*forgeos*' 2>/dev/null | head -1)"
if [ -z "$SCAFFOLD" ]; then
  echo "Could not find the ForgeOS plugin scaffold. Is the plugin installed? Try: claude plugin install forgeos@forgeos"
else
  bash "$SCAFFOLD"
fi
```

After it succeeds:

1. Confirm `.forgeos/` exists with `agents/`, `instructions/`, `.forgeos/tickets.py`, and
   a `ticket-state/` with 14 stage folders.
2. Report what was created and tell the user they can now run:
   - **`/start`** — plan a new project from a vision (PRD → architecture → tickets).
   - **`/continue`** — resume an in-progress ForgeOS run.
   - **`/takeover`** — onboard an existing/legacy repo before running the engine.

Do not modify the user's source files during init — this step only creates the
`.forgeos/` control-plane.
