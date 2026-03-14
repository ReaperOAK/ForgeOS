---
name: Git Protocol
applyTo: '**'
description: MCP-claimed work commits, scoped git, commit format, MCP-managed leases, failure recovery.
---

# Git Protocol

## 1. Claim + Work Protocol

RULE: Ticket claiming is an atomic MCP operation — NOT a git commit.
RULE: ForgeOS dispatcher calls `tickets.claim` on the MCP server to acquire a lease (PostgreSQL row-level lock).
RULE: Each ticket stage produces exactly one git commit: the WORK commit by the subagent.
RULE: Git carries CODE changes and summary handoff files only — no ticket JSON state.
PROHIBITED: Git-based ticket state changes (ticket JSON is managed by MCP server).
PROHIBITED: Subagents calling `tickets.claim` — ForgeOS dispatcher handles claiming before dispatch.

## 2. Claim (MCP Server — Performed by ForgeOS dispatcher)

RULE: Only ForgeOS dispatcher executes claim operations via the MCP `tickets.claim` tool.
RULE: Claim is an atomic PostgreSQL transaction — no git push race condition.
REQUIRED: ForgeOS dispatcher verifies the MCP server confirms claim success before dispatching.

REQUIRED: MCP claim sets metadata atomically:
- `claimed_by`: agent worker ID
- `machine_id`: hostname
- `operator`: human operator name
- `lease_expiry`: current time + lease duration

RULE: Claim success = lock acquired in PostgreSQL. ForgeOS dispatcher dispatches subagent.
RULE: Claim failure (already claimed / not in expected stage) = MCP returns error. Try another ticket.
PROHIBITED: Any git commits during the claim step.
PROHIBITED: Subagents performing claims — they receive pre-claimed tickets.

## 3. Work Commit (Performed by Subagent)

REQUIRED: Execute agent work for the assigned stage.
REQUIRED: Write summary to `.github/agent-output/{AgentName}/{ticket-id}.md`.
REQUIRED: Delete previous stage summary after reading it.
REQUIRED: Advance ticket to next stage via MCP `tickets.advance` tool (atomic DB operation).

REQUIRED: Stage explicit file list only:
```bash
git add <each-modified-file-explicitly>
git commit -m "[<ticket-id>] <STAGE> complete by <agent> on <machine>"
git push
```

RULE: The work commit contains ONLY code artifacts and summary files — no ticket JSON.
RULE: Ticket state transitions happen via MCP, not via moving JSON files between directories.

## 4. Scoped Git Rules (Hard)

PROHIBITED: `git add .`
PROHIBITED: `git add -A`
PROHIBITED: `git add --all`
PROHIBITED: Wildcard or glob staging.
PROHIBITED: Force pushing.

REQUIRED: Explicit file-by-file staging only.
REQUIRED: Staged files must match ticket scope.
ALLOWED: `CHANGELOG.md` when policy permits.

## 5. Commit Message Format

REQUIRED: Message begins with `[TICKET-ID]`.
REQUIRED: Work commit format: `[TICKET-ID] STAGE complete by AGENT on MACHINE`

## 6. Lease Mechanism (MCP-Managed)

RULE: Default lease duration is 30 minutes (configurable via MCP server).
RULE: Leases are tracked in PostgreSQL with row-level locking.
RULE: Expired leases are released automatically by the MCP server's background process.
RULE: Any ForgeOS dispatcher instance may claim a ticket whose lease has expired.
PROHIBITED: File-based or git-based lease management — MCP server is the sole authority.

## 7. Failure Recovery

| Failure | Recovery |
|---------|----------|
| Crash after MCP claim, before dispatch | Lease expires in DB => any ForgeOS dispatcher reclaims |
| Crash during subagent work | Uncommitted code lost => MCP release + reclaim + restart |
| MCP claim fails (already claimed) | ForgeOS dispatcher skips ticket, tries next READY ticket |
| MCP server unavailable | ForgeOS dispatcher retries with backoff; no git fallback |
| Subagent attempts MCP claim | Protocol violation => abort subagent |
| Rework count > 3 | Escalate to human |

## 8. Summary Handoff Protocol

RULE: Each agent writes exactly one summary file per ticket.
RULE: Filename: `{ticket-id}.md`
RULE: Location: `.github/agent-output/{AgentName}/{ticket-id}.md`
RULE: Agent reads ONLY previous stage summary.
RULE: Agent deletes previous stage summary after reading it.
PROHIBITED: Cross-stage summary reading.
PROHIBITED: Cross-agent summary reading outside the chain.

RULE: Summary directories:
```
.github/agent-output/
    Architect/  
    Research/  
    Backend/  
    Frontend/
    QA/  
    Security/  
    CIReviewer/  
    Documentation/
    Validator/  
    TODO/  
    DevOps/  
    ProductManager/  
    UIDesigner/
```

RULE: Context flows via filesystem (summary handoff) and MCP server (ticket state).
RULE: ForgeOS dispatcher does NOT inject context into subagents.
