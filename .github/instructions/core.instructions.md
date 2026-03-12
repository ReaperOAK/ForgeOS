---
name: Core System Rules
applyTo: '**'
description: System identity, rule precedence, boot sequence, halt gate, human approval, memory gate, anti-loop.
---

# Core System Rules

## 1. System Identity

RULE: This is a multi-agent ticket-driven system orchestrated by the ForgeOS MCP server.
RULE: ForgeOS is the orchestrator. It manages ticket lifecycle, dispatches agents, and enforces stage transitions via MCP tools.
RULE: All agents are autonomous workers. They derive context from the ForgeOS MCP server.
RULE: The ForgeOS MCP server enforces distributed locking, dependency resolution, and stage transitions.

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

REQUIRED: Before any work, execute in order:
1. `.github/guardian/STOP_ALL` — read and check for halt signal.
2. `.github/instructions/` — read all instruction files.
3. Call `tickets.payload` — receive the full delegation context from ForgeOS MCP server:
   - Ticket JSON (acceptance criteria, file paths, dependencies)
   - Upstream summary from previous stage agent
   - Memory entries relevant to the ticket
   - File scope (authorized read/write paths)
4. `.github/vibecoding/chunks/{YourAgent}.agent/` — read all chunk files.
5. `.github/vibecoding/catalog.yml` — load task-relevant chunks.

RULE: The `tickets.payload` response is the canonical source for ticket context.
RULE: Agents MUST NOT read ticket JSON directly from `.github/ticket-state/` or `.github/tickets/` — use MCP.
PROHIBITED: Starting work without completing boot sequence.

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

REQUIRED: Before DONE, ticket must have a memory entry persisted via `tickets.update`:
```markdown
### [TICKET-ID] — Summary
- **Artifacts:** file1.ts, file2.ts
- **Decisions:** Chose X over Y because Z
- **Timestamp:** {ISO8601}
```
RULE: Memory entries are persisted to the ForgeOS MCP server via `tickets.update`.
RULE: The git-tracked `.github/memory-bank/activeContext.md` serves as a secondary append-only store.
RULE: Missing MCP-persisted entry => ticket cannot reach DONE.

## 7. Memory Bank Rules

RULE: All memory files are append-only. Never delete existing entries.
RULE: Every entry requires ISO8601 timestamp and agent attribution.

| File | Write Access |
|------|-------------|
| `activeContext.md` | All agents (append) |
| `progress.md` | All agents (append) |
| `systemPatterns.md` | ForgeOS & Documentation only |
| `productContext.md` | ForgeOS, Documentation & Product Manager only |
| `decisionLog.md` | ForgeOS & Documentation only |
| `riskRegister.md` | ForgeOS + Security |

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
