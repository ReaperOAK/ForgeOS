# Agent Execution Contract (LLM-Optimized)

Machine-priority protocol. Follow exactly. No interpretation layer.

## 0) Rule Precedence

When rules conflict, apply highest first:
1. .github/instructions/core.instructions.md
2. .github/instructions/*.instructions.md
3. .github/agents/*.agent.md (includes Assigned Tool Loadout)
4. This file (agents.md)
5. Delegation prompt

If unresolved conflict remains: STOP and emit NEEDS_INPUT_FROM: Human.

## 0.1) Tool Loadout Protocol (CRITICAL — Prevents Decision Paralysis)

RULE: ALL agents operate under strict Tool Loadouts defined in their `.github/agents/{Agent}.agent.md` file.
RULE: The environment contains 240+ MCP tools. Without loadout restrictions, agents suffer context collapse and decision paralysis.
RULE: Each agent's `Assigned Tool Loadout (CRITICAL)` section is the SOLE authority on which tools that agent may use.
RULE: Universal Tools are available to all agents: `memory/*`, `oraios/serena/*`, `execute/*`, `vscode/*`, `tavily/*`, `github/*`, `sequentialthinking/*`.
RULE: Role-Specific Tools are granted per agent type (see individual agent files).
PROHIBITED: Using or browsing tools outside the agent's Assigned Tool Loadout.
PROHIBITED: Hallucinating tool names or capabilities not explicitly listed.
PROHIBITED: Arbitrarily scanning the full tool list — this causes token exhaustion.

## 1) Required Boot Sequence (run in order, no skips)

1. Read `.github/guardian/STOP_ALL` — if contains `STOP`: halt, zero edits
2. Read all `.github/instructions/*.instructions.md` (core, sdlc, ticket-system, git-protocol, agent-behavior, terminal-management)
3. Call `tickets.payload(ticket_id)` — receive the full delegation context from the ForgeOS MCP server:
   - Ticket JSON (acceptance criteria, file paths, dependencies)
   - Upstream summary from previous stage agent
   - Memory entries relevant to the ticket
   - File scope (authorized read/write paths)
4. Read your agent file: `.github/agents/{YourAgent}.agent.md` — internalize the Assigned Tool Loadout
5. Read `.github/vibecoding/chunks/{YourAgent}.agent/` (all files)
6. Read `.github/vibecoding/catalog.yml` — load task-relevant chunks
7. Invoke `sequentialthinking/sequentialthinking` to plan execution before touching any files

RULE: The `tickets.payload` response is the canonical source for ticket context.
RULE: Agents MUST NOT read ticket JSON from `.github/ticket-state/` or `.github/tickets/` — use MCP.
PROHIBITED: Starting work without completing boot sequence.

## 2) Identity Invariants

- **ForgeOS** is the **orchestrator**: it manages the ticket lifecycle, dispatches agents, and enforces stage transitions via MCP tools (`tickets.claim`, `tickets.complete`, `tickets.reject`). It never reads or writes codebase files directly. It queries `tickets.next` for available work, claims tickets via `tickets.claim`, and dispatches the correct subagent with `ticket_id`.
- **CTO** is a **smart orchestrator**: it reads docs, reasons about the project, and delegates to Research, PM, Architect, and TODO agents to produce the ticket backlog. CTO operates pre-SDLC — once tickets exist, ForgeOS takes over.
- Worker handles exactly one ticket, one SDLC stage per invocation
- Reference but never modify artifacts outside assigned ticket scope
- Every agent must follow its Assigned Tool Loadout — no exceptions
- Ticket state is stored in PostgreSQL and managed exclusively via MCP tools — never the filesystem

## 3) Required Lifecycle

Each ticket type traverses a defined subset of 11 stages:

```
READY > RESEARCH > PM > ARCHITECT > DevOps > BACKEND > UIDesigner > FRONTEND > QA > SECURITY > CI > DOCS  > VALIDATION > DONE
```

Post-implementation chain (strict order): QA → Security → CI → Docs → Validator.

No skip, no merge, no reorder. Failure at any stage -> REWORK (max 3, then ESCALATED).

## 4) Scoped Git (non-negotiable)

- PROHIBITED: `git add .` / `git add -A` / `git add --all`
- Stage explicit files only
- ForgeOS claims tickets via MCP `tickets.claim` (atomic PostgreSQL lock) — no git-based claim commits
- Subagents receive pre-claimed tickets and perform only the WORK commit
- Use `execute/runInTerminal` for git CLI commands or `github/create_or_update_file` for direct file pushes
- Stage transitions happen via MCP `tickets.complete` or `tickets.reject` — not by moving files between directories

## 5) Memory Gate (pre-DONE)

Before DONE, entry must exist in .github/memory-bank/activeContext.md:

### [TICKET-ID] — Summary
- **Artifacts:** file1.ts, file2.ts
- **Decisions:** Chose X over Y because Z
- **Timestamp:** ISO8601

## 6) Human Approval Gate

Require explicit approval before: destructive data ops, force push, production deploy, new external deps, destructive schema migration.

## 7) Anti-Loop Rule

If same failed approach repeats >= 3 times: stop retrying, switch strategy or escalate.

## 8) Evidence Rule

Every TASK_COMPLETED must include: artifact paths, test results (or justified N/A), confidence level.

## 9) Execution SOP (All Agents)

Every agent follows this Standard Operating Procedure:
1. **Plan First:** Invoke `sequentialthinking/sequentialthinking` to map steps and identify the 2-4 specific tools you will use.
2. **Read State:** Use `memory/read_graph` to understand ticket history. Use `tickets.get(ticket_id)` for current ticket state.
3. **Navigate Code:** Use `oraios/serena/find_symbol` and `oraios/serena/find_referencing_symbols` — NEVER generic `read_file` for large files.
4. **Atomic Edits:** Use `oraios/serena/replace_symbol_body` or `oraios/serena/insert_after_symbol`.
5. **Validate:** Use role-specific tools per your Assigned Tool Loadout.
6. **Complete:** Call `tickets.complete` with structured evidence (artifacts, test_results, confidence).
7. **Log State:** Use `memory/add_observations` to record state changes for the next agent.

## 10) Tool Loadout Reference (Agent → Role-Specific Tools)

| Agent | Role-Specific Tools |
|-------|--------------------|
| Architect | `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram` |
| Backend | `mongodb/*`, `microsoft-docs/*`, `io.github.upstash/context7/*` |
| Frontend | `stitch/*`, `com.figma.mcp/*` |
| UIDesigner | `stitch/*`, `com.figma.mcp/*`, `playwright/*` |
| ProductManager | `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram` |
| Research | `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram` |
| QA | `playwright/*`, `browser/*`, `firecrawl/*` |
| Validator | `playwright/*`, `browser/*`, `firecrawl/*` |
| Security | `terraform/*`, `sentry/*`, `containerToolsConfig` |
| DevOps | `terraform/*`, `sentry/*`, `containerToolsConfig` |
| CIReviewer | *(Universal only)* |
| Documentation | `markitdown/*` |
| TODO | `awesome-copilot/*` |
| CTO | `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram`, `firecrawl/*` |
| ForgeOS | `tickets.*` (claim, complete, reject, next, list, get, payload, stats, graph) *(orchestrator-only)* |

## References

- .github/instructions/core.instructions.md
- .github/instructions/sdlc.instructions.md
- .github/instructions/ticket-system.instructions.md
- .github/instructions/git-protocol.instructions.md
- .github/instructions/agent-behavior.instructions.md
- .github/instructions/terminal-management.instructions.md
- .github/tickets.py *(human operator CLI only — agents use MCP tools)*
- .github/agent-runner.py *(human operator runner only)*
