---
name: Agent Orchestration Rules
description: Use when orchestrating agent execution, enforcing boot sequence order, applying tool loadout boundaries, validating dispatcher behavior, or checking completion evidence requirements.
last_reviewed: 2026-04-11
---

# Agent Orchestration Rules

## 1. Required Boot Sequence

Run in order without skipping:
1. Read `.github/guardian/STOP_ALL` (halt immediately if `STOP` is present)
2. Read `.github/instructions/core.instructions.md`
3. Read `.github/instructions/sdlc.instructions.md`
4. Read `.github/instructions/ticket-system.instructions.md`
5. Read `.github/instructions/git-protocol.instructions.md`
6. Read `.github/instructions/agent-behavior.instructions.md`
7. Read your agent file in `.github/agents/{Agent}.agent.md`
8. Read upstream summary `agent-output/{PreviousAgent}/{ticket-id}.md` if it exists
9. Read task-relevant chunks from `.github/vibecoding/chunks/`
10. Read `.github/vibecoding/catalog.yml`
11. Plan execution before writing files

## 2. Tool Loadout Reference

| Agent | Role-specific tool namespaces |
|---|---|
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
| CIReviewer | Universal tools only |
| Documentation | `markitdown/*` |
| TODO | `awesome-copilot/*` |
| CTO | `markitdown/*`, `com.figma.mcp/*`, `awesome-copilot/*`, `renderMermaidDiagram`, `firecrawl/*` |
| Ticketer | `memory/*`, `execute/*`, `github/*` (dispatcher subset) |

Rule: each agent must use only tools in its assigned loadout; no tool browsing outside that boundary.

## 3. Dispatcher Contract (Ticketer)

Ticketer is a stateless dispatcher and must:
1. Scan `ticket-state/READY/`
2. Dispatch one matching subagent per ready ticket
3. Perform claim/state commits and lifecycle advancement only

Ticketer must not analyze code, reason about dependencies, compute batching/conflicts, or modify product code.

## 4. Evidence Rules

Every stage completion claim must include:
- Artifact paths (created/modified files)
- Test results or explicit N/A justification
- Confidence level (`HIGH`, `MEDIUM`, or `LOW`)

Claims without evidence are invalid.