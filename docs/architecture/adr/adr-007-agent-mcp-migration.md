---
title: "ADR-007: Agent-MCP Migration Approach"
ticket: CTO-intelligence-architecture
type: architecture
author: Architect
date: 2026-03-12T00:00:00Z
status: PROPOSED
tags: [architecture, adr, migration, cutover, phase1]
---

# ADR-007: Agent-MCP Migration Approach

> **Ticket:** CTO-intelligence-architecture | **Agent:** Architect | **Date:** 2026-03-12  
> **Confidence:** HIGH (88%) | **Status:** PROPOSED

---

## 1. Status

**PROPOSED** — 2026-03-12

---

## 2. Context

ForgeOS agents currently read ticket state from `.github/ticket-state/` directories and write state changes via git commits. The PostgreSQL-backed MCP server already provides atomic ticket operations. The dual source of truth creates race conditions, stale state, and unnecessary git churn. Phase 1 requires eliminating all filesystem-based ticket state management.

**Current filesystem references (audit):**

| Category | File Count | Reference Count |
|----------|-----------|----------------|
| Instruction files (`.github/instructions/`) | 5 | 6 references |
| Agent files (`.github/agents/`) | 14 | 20+ references |
| agents.md | 1 | 2 references |
| tickets.py | 1 | Multiple |
| **Total** | **21** | **28+** |

**Operations being migrated:**

| Filesystem Operation | MCP Replacement |
|---------------------|----------------|
| Read ticket JSON from `ticket-state/STAGE/` | `tickets.get(ticket_id)` |
| Scan `ticket-state/READY/` for available work | `tickets.next(stage)` or `tickets.list(stage, status='READY')` |
| Move JSON between stage directories | `tickets.complete(ticket_id, evidence)` (automatic) |
| Write claim metadata to JSON | `tickets.claim(ticket_id, agent_name, machine_id)` |
| Read upstream summary from `agent-output/` | `tickets.payload(ticket_id, agent_role)` |
| `tickets.py --sync` | Handled automatically by `resolve_dependencies()` on ticket completion |
| `tickets.py --claim` | `tickets.claim()` |
| `tickets.py --advance` | `tickets.complete()` |
| `tickets.py --rework` | `tickets.reject()` |

---

## 3. Alternatives Evaluated

### 3.1 Big Bang Cutover (chosen)

Rewrite all agent and instruction files in a single coordinated effort. Add missing MCP tools first, then update all files, then deprecate the filesystem.

**Pros:**
- Clean break — no dual-mode maintenance
- Simpler agent logic (one code path, not two)
- Fastest path to Phase 2/3 enablement

**Cons:**
- Higher risk of temporary breakage during migration
- Requires all agents to be updated simultaneously

### 3.2 Gradual Migration (dual-mode agents)

Add MCP support alongside filesystem operations. Each agent checks MCP first, falls back to filesystem.

**Pros:**
- Lower risk — rollback is trivial
- Can migrate agent-by-agent

**Cons:**
- Dual-mode code is complex and error-prone
- Race conditions between MCP and filesystem state
- Extends migration timeline indefinitely
- Tests must cover both paths

### 3.3 Proxy Layer (filesystem → MCP shim)

Keep agent instructions unchanged but replace `tickets.py` with a thin shim that translates filesystem operations into MCP calls.

**Pros:**
- Zero changes to agent files
- Transparent migration

**Cons:**
- Still requires filesystem directories to exist (even if empty)
- Agents continue committing ticket JSON (unnecessary git churn)
- Does not enable Phase 2/3 features (agents still think in filesystem terms)
- Masks the architectural improvement from agents

---

## 4. Decision

**Big Bang Cutover** — rewrite all agent and instruction files to use MCP-only workflow after adding the 3 missing MCP tools.

**Rationale:**
1. The MCP server is already proven (10 tools, PostgreSQL stored functions, full test coverage)
2. Agent files are configuration, not application code — rewriting them is low-risk
3. Dual-mode operation creates more risk than a clean cutover
4. Phases 2–4 depend on agents being MCP-native; delaying the cutover delays everything

---

## 5. Migration Sequence

### Step 1: Add Missing MCP Tools (no breaking changes)
1. Implement `tickets.get` — read a ticket by ID
2. Implement `tickets.list` — list tickets with filters
3. Implement `tickets.payload` — get full dispatch payload

### Step 2: Update Agent Boot Sequence
Replace in all 14 agent files:
```diff
- 6. Read ticket JSON from `.github/ticket-state/` or `.github/tickets/`
+ 6. Call tickets.get(ticket_id) via MCP to load ticket data
```

### Step 3: Update Ticket Read Operations
Replace in all 14 agent files:
```diff
- 1. Read ticket JSON from `.github/ticket-state/STAGE/{ticket-id}.json`.
+ 1. Ticket data is provided by the orchestrator via tickets.payload(). No filesystem read needed.
```

### Step 4: Update Ticket Write Operations
Replace in all 14 agent files:
```diff
- 3. Move ticket JSON to `.github/ticket-state/NEXT_STAGE/{ticket-id}.json`
- 4. git add .github/ticket-state/...
+ 3. Call tickets.complete(ticket_id, evidence) via MCP
+ 4. MCP atomically advances stage, releases locks, resolves dependencies
```

### Step 5: Update Instruction Files
- `core.instructions.md`: Replace boot step 6
- `sdlc.instructions.md`: Redefine state as PostgreSQL columns
- `ticket-system.instructions.md`: Remove directory listing, add MCP tool reference
- `git-protocol.instructions.md`: Simplify to single WORK commit (code only)
- `agent-behavior.instructions.md`: Replace Ticketer scan with orchestrator loop

### Step 6: Build ForgeOS Orchestrator Loop
New module: `forgeos-server/src/orchestrator/loop.ts`
- Polls PostgreSQL for READY tickets every 10 seconds
- Dispatches agents via subprocess with MCP connection URL
- Replaces the stateless Ticketer dispatcher

### Step 7: Deprecation
- Mark `.github/ticket-state/` as deprecated (keep read-only for 30 days)
- Mark `tickets.py` as deprecated for agent use (keep for manual CLI)
- Remove after 30-day observation period

---

## 6. Consequences

### Positive
- Single source of truth (PostgreSQL)
- No more git-push contention on ticket state
- Agents are simpler (no filesystem parsing, no git add for tickets)
- Summary handoff stored in ticket metadata (no more `.github/agent-output/` files)
- Enables Phase 2 (blast radius injection) and Phase 3 (memory injection) in dispatch payload

### Negative
- All 14 agent files must be updated simultaneously
- Testing requires the MCP server to be running
- `tickets.py` loses its role as the primary state management tool

### Risks
- Agent files are rewritten incorrectly (mitigated: diff review per-agent; test each agent's boot against MCP server)
- MCP server downtime blocks all agents (mitigated: health checks, auto-restart, SDK reconnection with backoff)

---

## 7. Rollback Plan

If critical issues are discovered post-cutover:
1. Restore agent files from git (pre-migration commit tag: `pre-cutover`)
2. Run `tickets.py --sync` to reconcile filesystem state from PostgreSQL
3. Resume filesystem-based operations

**Time to rollback:** < 5 minutes (git revert + sync command).
