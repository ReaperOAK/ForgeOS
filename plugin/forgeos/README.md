# ForgeOS — Claude Code plugin

An autonomous software-agency engine for Claude Code. ForgeOS turns a product
vision into governed, reviewable, shipped code by running a simulated
engineering organization: **15 specialized agents**, a **14-stage SDLC ticket
lifecycle**, **governance hooks**, and **20+ skills**.

This is the self-contained, portable plugin build — install it once and run it
in **any** project. It does not require Docker, a database, or the ForgeOS MCP
server.

## Install

```bash
# 1. Add the marketplace (from the GitHub repo)
claude plugin marketplace add reaperoak/ForgeOS

# 2. Install the plugin
claude plugin install forgeos@forgeos
```

Or, inside an interactive Claude Code session:

```
/plugin marketplace add reaperoak/ForgeOS
/plugin install forgeos@forgeos
```

## Use

```
cd your-project
claude
```

```
/forgeos:init          # scaffold the engine into ./.forgeos/ (run once per project)
/start <your vision>   # plan: PRD → architecture → tickets
/continue              # resume an in-progress run
```

Other commands: `/takeover` (onboard a legacy repo), `/stop` (structured
shutdown), plus `/figma-to-code`, `/expensify`, `/weekly-history`,
`/ui-ux-pro-max`.

## How it works

- **`/forgeos:init`** scaffolds a `.forgeos/` control-plane into your project:
  the agent contracts, instruction rules, prompts, skills, the `tickets.py` CLI,
  the guardian circuit-breaker, and a fresh memory-bank + 14-stage
  `ticket-state/`. Canonical content is refreshed on every init; your runtime
  state (tickets, memory) is preserved.
- **Agents** (`architect`, `backend`, `frontend`, `devops`, `qa`, `security`,
  `cireviewer`, `documentation`, `validator`, `cto`, `ticketer`, `todo`,
  `research`, `productmanager`, `uidesigner`) are dispatched via the Task tool
  and read their full operating contract from `.forgeos/`.
- **Hooks** enforce the guardian STOP circuit-breaker and scoped-git policy
  (blocks `git add .`/`-A`/`--all`), auto-sync tickets at session start, and
  surface the memory + evidence gates. They stay silent in projects that have
  not run `/forgeos:init`.

## What gets created in your project

```
.forgeos/
├── AGENTS.md                # machine-priority execution contract
├── agents/                  # 15 agent contracts (.agent.md)
├── instructions/            # SDLC / git / ticket / behavior rules
├── prompts/                 # the slash-command protocols
├── skills/                  # the full skill library + catalog
├── hooks/scripts/           # governance scripts (guardian, scoped-git, lint…)
├── guardian/                # STOP_ALL circuit-breaker + loop-detection rules
├── memory-bank/             # durable shared memory (fresh templates)
├── ticket-state/            # 14 SDLC stage folders
├── tickets/                 # ticket JSON files
└── tickets.py               # ticket lifecycle CLI
```

`.forgeos/ticket-state/` and `.forgeos/agent-output/` are added to your
`.gitignore` automatically (runtime churn).

## Uninstall

```bash
claude plugin uninstall forgeos@forgeos
```

Then delete the `./.forgeos/` directory from any project where you ran
`/forgeos:init`.
