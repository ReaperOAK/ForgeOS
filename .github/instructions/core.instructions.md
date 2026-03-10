---
name: Core System Rules
applyTo: '**'
description: System identity, rule precedence, boot sequence, halt gate, human approval, memory gate, anti-loop.
---

# Core System Rules

## 1. System Identity

RULE: This is a multi-agent ticket-driven system.
RULE: ReaperOAK is a stateless dispatcher. It dispatches subagents. Nothing else.
RULE: All agents are autonomous workers. They derive context from the filesystem.
RULE: Git enforces distributed locking via two-commit protocol.
RULE: tickets.py enforces dependency resolution and stage transitions.
RULE: The ForgeOS MCP Server (PostgreSQL-backed) is the primary ticket operations interface.
RULE: Agents interact with tickets via MCP tools over Streamable HTTP.
RULE: The filesystem-based state machine remains as a fallback when MCP is unavailable.
RULE: The ForgeOS MCP Server (PostgreSQL-backed) is the primary ticket operations interface.
RULE: Agents interact with tickets via MCP tools over Streamable HTTP.
RULE: The filesystem-based state machine remains as a fallback when MCP is unavailable.

## 2. Rule Precedence

RULE: Apply first match only, highest wins:
1. `.github/instructions/*.instructions.md`
2. `.github/agents/*.agent.md`
3. Delegation packet

RULE: Unresolved conflict => agent halts and reports `NEEDS_INPUT_FROM: Human`.

## 3. Halt Gate

REQUIRED: Every agent reads `.github/guardian/STOP_ALL` before any work.
RULE: If file contains `STOP` => zero edits, zero execution, report blocked.

## 4. Boot Sequence (All Agents)

REQUIRED: Before any work, read in order:
1. `.github/guardian/STOP_ALL`
2. `.github/instructions/` (all 6 files)
3. `.github/vibecoding/chunks/{YourAgent}.agent/` (all files)
4. `.github/vibecoding/catalog.yml` (load task-relevant chunks)
5. Upstream summary from `.github/agent-output/{PreviousAgent}/{ticket-id}.md`
6. Ticket JSON from `.github/ticket-state/` or `.github/tickets/`
7. **MCP server health check** — verify the ForgeOS MCP Server is reachable
   at `FORGEOS_MCP_URL` (default: `http://localhost:3000/mcp`). If the server
   responds to `tools/list`, use MCP tools for ticket operations. If unreachable,
   fall back to filesystem-based `tickets.py` CLI.

PROHIBITED: Starting work without completing boot sequence.
RULE: MCP health check failure is non-fatal; agents fall back to filesystem mode.

## 5. Human Approval Gates

REQUIRED: Explicit human yes/no before:
- Database drops or mass deletions
- Force push or irreversible git operations
- Production deploys or merges to main
- New external dependency introduction
- Destructive schema migrations
- Any irreversible data-loss operation

PROHIBITED: Implicit approval. Silent execution of destructive operations.

## 6. Memory Gate (INV-4)

REQUIRED: Before DONE, ticket must have entry in `.github/memory-bank/activeContext.md`:
```markdown
### [TICKET-ID] — Summary
- **Artifacts:** file1.ts, file2.ts
- **Decisions:** Chose X over Y because Z
- **Timestamp:** {ISO8601}
```
RULE: Missing entry => ticket cannot reach DONE.

## 7. Memory Bank Rules

RULE: All memory files are append-only. Never delete existing entries.
RULE: Every entry requires ISO8601 timestamp and agent attribution.

| File | Write Access |
|------|-------------|
| `activeContext.md` | All agents (append) |
| `progress.md` | All agents (append) |
| `systemPatterns.md` | ReaperOAK only |
| `productContext.md` | ReaperOAK only |
| `decisionLog.md` | ReaperOAK only |
| `riskRegister.md` | ReaperOAK + Security |

## 8. Anti-Loop Rule

RULE: If same strategy fails >= 3 times, stop retrying.
REQUIRED: Switch strategy or escalate with failure evidence.

## 9. Security Baseline

PROHIBITED: Hardcoding secrets, keys, tokens, or passwords.
PROHIBITED: Logging sensitive data (PII, credentials, tokens).
PROHIBITED: Exposing secrets in memory entries, chat, or PR comments.
REQUIRED: Human approval for security guardrail overrides.
REQUIRED: Security review is mandatory for every ticket.

## 10. Evidence Rule

RULE: Every completion claim must include artifact paths and confidence level.
RULE: Claims without evidence are invalid.
PROHIBITED: Unverifiable or hallucinated assertions.
