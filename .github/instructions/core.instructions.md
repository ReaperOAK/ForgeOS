---
name: Core System Rules
applyTo: '**'
description: System identity, rule precedence, boot sequence, halt gate, human approval, memory gate, anti-loop.
---

# Core System Rules

## 1. System Identity

RULE: This is a multi-agent ticket-driven system.
RULE: Ticketer is a stateless dispatcher. It dispatches subagents and performs claim commits. It absolutely does nothing else.
RULE: All agents are autonomous workers. They derive context from the filesystem.
RULE: Git enforces distributed locking via dispatcher-claim protocol.
RULE: tickets.py enforces dependency resolution and stage transitions.

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
| `systemPatterns.md` | Ticketer & Documentation only |
| `productContext.md` | Ticketer, Documentation & Product Manager only |
| `decisionLog.md` | Ticketer & Documentation only |
| `riskRegister.md` | Ticketer + Security |

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
