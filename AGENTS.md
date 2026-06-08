# Agent Execution Contract (LLM-Optimized)

Machine-priority protocol. Follow exactly. No interpretation layer.

## 0) Rule Precedence

When rules conflict, apply highest first:
1. .github/instructions/core.instructions.md
2. .github/instructions/*.instructions.md
3. .github/agents/*.agent.md (includes Assigned Tool Loadout)
4. This file (AGENTS.md)
5. Delegation prompt

If unresolved conflict remains: STOP and emit NEEDS_INPUT_FROM: Ticketer.

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

1. Read .github/guardian/STOP_ALL — if contains STOP: halt, zero edits
2. Read .github/instructions/core.instructions.md
3. Read .github/instructions/sdlc.instructions.md
4. Read .github/instructions/ticket-system.instructions.md
5. Read .github/instructions/git-protocol.instructions.md
6. Read .github/instructions/agent-behavior.instructions.md
7. Read your agent file: .github/agents/{YourAgent}.agent.md — internalize the Assigned Tool Loadout
8. Read upstream summary from agent-output/{PreviousAgent}/{ticket-id}.md (if exists)
9. Read .github/vibecoding/chunks/{YourAgent}.agent/ (all files)
10. Read .github/vibecoding/catalog.yml; load task-relevant chunks
11. Invoke `sequentialthinking/sequentialthinking` to plan execution before touching any files

## 2) Identity Invariants

- Ticketer is a **dumb dispatcher**: it never reads or writes codebase files. It ONLY evaluates ticket state via `tickets.py`, launches subagents with scoped toolsets via `runSubagent`, and performs claim/state commits. Its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`.
- CTO is a **smart orchestrator**: it reads docs, reasons about the project, and delegates to Research, PM, Architect, and TODO agents to produce the ticket backlog. CTO operates pre-SDLC — once tickets exist, Ticketer takes over.
- Worker handles exactly one ticket, one SDLC stage per invocation
- Reference but Never modify artifacts outside assigned ticket scope
- Every agent must follow its Assigned Tool Loadout — no exceptions

## 3) Required Lifecycle

Each ticket type traverses a defined subset of 11 stages:

```
READY > RESEARCH > PM > ARCHITECT > DevOps > BACKEND > UIDesigner > FRONTEND > QA > SECURITY > CI > DOCS  > VALIDATION > DONE
```

Post-implementation chain (strict order): QA → Security → CI → Docs → Validator.

No skip, no merge, no reorder. Failure at any stage -> REWORK (max 3, then ESCALATED).

## 4) Scoped Git (non-negotiable)

- PROHIBITED: git add . / git add -A / git add --all
- Stage explicit files only
- Dispatcher-Claim protocol: Ticketer performs CLAIM commit before dispatch, subagent performs WORK commit only
- Use `execute/runInTerminal` for git CLI commands or `github/create_or_update_file` for direct file pushes
- Subagents NEVER perform claim commits — they receive pre-claimed tickets and only execute the work commit

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

Every agent follows this Standard Operating Procedure from `tool_dispatcher.md`:
1. **Plan First:** Invoke `sequentialthinking/sequentialthinking` to map steps and identify tools.
2. **Read State:** Use `memory/read_graph` to understand ticket history.
3. **Navigate Code:** Use `oraios/serena/find_symbol` and `oraios/serena/find_referencing_symbols` — NEVER generic `read_file` for large files.
4. **Atomic Edits:** Use `oraios/serena/replace_symbol_body` or `oraios/serena/insert_after_symbol`.
5. **Validate:** Use role-specific tools per your Assigned Tool Loadout.
6. **Log State:** Use `memory/add_observations` to record state changes for the next agent.

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
| Ticketer | `memory/*`, `execute/*`, `github/*` *(dispatcher-only subset)* |

## References

- .github/instructions/core.instructions.md
- .github/instructions/sdlc.instructions.md
- .github/instructions/ticket-system.instructions.md
- .github/instructions/git-protocol.instructions.md
- .github/instructions/agent-behavior.instructions.md
- .github/instructions/terminal-management.instructions.md
- tickets.py
