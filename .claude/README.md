# `.claude/` — Claude Code bridge to the vibecoding system

This directory makes **Claude Code** a first-class operator of the same
multi-agent vibecoding system that GitHub Copilot already drives. It is a thin
**bridge layer**: the canonical infrastructure stays in `.github/` (the single
source of truth), and these files just teach Claude Code how to consume it.

Nothing here duplicates rule content. If a rule changes in `.github/`, the bridge
keeps working — the agents and commands read the live `.github/` files at runtime.

## What maps to what

| Capability          | Copilot (`.github/`)              | Claude Code (`.claude/`)                         |
|---------------------|-----------------------------------|--------------------------------------------------|
| Repo instructions   | `copilot-instructions.md`         | `../CLAUDE.md` (+ this bridge)                    |
| Path-scoped rules   | `instructions/*.instructions.md`  | read at runtime per the boot sequence            |
| Subagents           | `agents/*.agent.md`               | `agents/*.md` (delegate to the `.agent.md`)      |
| Prompts / commands  | `prompts/*.prompt.md`             | `commands/*.md` (slash commands)                 |
| Skills              | `skills/*/SKILL.md`               | `skills` → symlink to `../.github/skills`        |
| Lifecycle hooks     | `hooks/*.json` (VS Code)          | `settings.json` + `hooks/*.sh` adapters          |
| Tool loadouts       | MCP namespaces in `.agent.md`     | `TOOL_MAPPING.md` (Copilot MCP → Claude tools)   |

## Components

- **`agents/`** — 15 subagents (`architect`, `backend`, `frontend`, `devops`,
  `uidesigner`, `productmanager`, `research`, `todo`, `qa`, `security`,
  `cireviewer`, `documentation`, `validator`, `cto`, `ticketer`). Each is a thin
  delegate: it points Claude at `AGENTS.md` + its `.github/agents/<Name>.agent.md`
  contract and gives it a Claude-native tool loadout. Dispatch via the Task tool
  (`subagent_type` = the lowercase name) — this is the `runSubagent(...)` equivalent.
- **`commands/`** — slash commands mirroring the prompts: `/start`, `/continue`,
  `/stop`, `/takeover`, `/figma-to-code`, `/expensify`, `/weekly-history`,
  `/ui-ux-pro-max`. Each reads and executes its `.github/prompts/*.prompt.md`.
- **`skills`** — symlink to `../.github/skills` so Claude auto-discovers all 21
  skills (no copies).
- **`hooks/`** — Bash adapters that call the canonical `.github/hooks/scripts/*.sh`
  and remap exit codes to Claude's convention (Claude **blocks on exit 2**, whereas
  the VS Code scripts use exit 1). Wired up in `settings.json`.
- **`settings.json`** — registers the hooks and denies `git add .` / `-A` / `--all`.
- **`TOOL_MAPPING.md`** — the canonical Copilot-MCP → Claude-Code tool translation.

## Hook behavior (important)

| Event          | Adapter              | Behavior                                                        |
|----------------|----------------------|-----------------------------------------------------------------|
| SessionStart   | `session-start.sh`   | Guardian check (surfaced) + `tickets.py --sync`                 |
| PreToolUse     | `pre-tool.sh`        | **Blocks** (exit 2) on guardian STOP or `git add .`/`-A`/`--all`|
| PostToolUse    | `post-edit.sh`       | Lints changed TS/JS — advisory                                  |
| SubagentStop   | `agent-complete.sh`  | Memory-gate reminder — advisory                                 |
| Stop           | `session-stop.sh`    | Evidence-rule reminder — advisory                               |

Pre-action gates (guardian, scoped-git) are **hard blocks** because they are safe
universally. Post-completion gates (memory, evidence) are **advisory** so ordinary
non-ticket Claude sessions aren't disrupted — flip the trailing `exit 0` to `exit 2`
in `agent-complete.sh` / `session-stop.sh` for hard enforcement.

## Optional: MCP servers

Role-specific tools (`mongodb`, `figma`, `playwright`, `terraform`, `sentry`,
`context7`, …) are optional. To enable them, add a project `.mcp.json` (or run
`claude mcp add <name> …`). Without them, agents fall back to Bash/WebFetch per
`TOOL_MAPPING.md` and note the substitution. The system is fully functional
without any MCP server configured.

## Regenerating

`agents/*.md` and `commands/*.md` are generated thin wrappers. If `.github/agents`
or `.github/prompts` gains/loses an entry, re-run the generators (see git history
for the scripts) or hand-add a matching wrapper following the existing pattern.
