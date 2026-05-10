---
name: Takeover
description: Initialize legacy repository takeover with structured reconstruction using ForgeOS MCP tools only
agent: 'CTO'
argument-hint: 'No arguments needed — invoke /takeover to start legacy repo analysis'

We are entering LEGACY REPOSITORY TAKEOVER MODE using MCP tools only.

This repository was not built under the autonomous orchestration system.`
It may contain:`
- Incomplete features`
- No tickets or roadmap`
- Partial or outdated docs`
- Architectural drift`
- Inconsistent patterns`
- Broken tests`
- Missing validation`
- Technical debt`

You must NOT begin implementing features immediately.`
You must perform structured reconstruction.`

---

# PHASE 0 — BOOT SEQUENCE (MCP-Only)`

Before any work, execute the full boot sequence using MCP tools only:`
1. Read `.github/guardian/STOP_ALL` — if contains `STOP`: halt, zero edits.`
2. Read all `.github/instructions/*.instructions.md` (core, sdlc, ticket-system, git-protocol, agent-behavior).`
3. Call `tickets.payload(ticket_id)` — receive full delegation context from ForgeOS MCP server.`
4. Read your agent file: `.github/agents/{YourAgent}.agent.md` — internalize the Assigned Tool Loadout.`
5. Read `.github/vibecoding/chunks/{YourAgent}.agent/` (all files).`
6. Read `.github/vibecoding/catalog.yml` — load task-relevant chunks.`
7. Invoke `sequentialthinking/sequentialthinking` to plan execution before touching any files.`

All agents operate under strict Tool Loadouts per `AGENTS.md` §0.1. No tool browsing or hallucination outside assigned loadout.`

---

# PHASE 1 — CHAOS DIAGNOSIS (Parallel Discovery)`

Spawn agents in parallel for read-only analysis using MCP tools only:`

**Research Analyst:**`
- Analyze folder structure, main modules, entry points.`
- Identify frameworks, languages, build system.`
- Detect dependency graph and unused dependencies.`
- Summarize current capabilities.`

**Architect:**`
- Review existing architecture docs, diagrams, ADRs.`
- Identify architectural patterns, tech stack, data flow.`
- Detect contradictions between docs and implementation.`
- Produce architecture reconstruction document.`

**Security Engineer:**`
- Scan for hardcoded secrets, weak crypto, injection flaws.`
- Check authentication, authorization, input validation.`
- Run STRIDE threat model, OWASP Top 10 scan.`
- Produce security audit summary.`

**DevOps Engineer:**`
- Review CI/CD pipelines, Docker configs, deployment scripts.`
- Check environment configs, secrets management.`
- Identify operational friction and technical debt.`
- Produce docs and ops audit.`

**Product Manager:**`
- Review PRDs, specs, user stories, acceptance criteria.`
- Identify gaps between documented intent and actual features.`
- Produce reconstructed PRD.`

**Documentation Specialist:**`
- Review README, docs/, inline documentation.`
- Check for stale docs, missing guides, broken links.`
- Produce gap analysis and tech debt report.`

Each agent uses its Assigned Tool Loadout only. No filesystem `tickets.py` commands.`

---

# PHASE 2 — RECONSTRUCTION`

Based on Phase 1 outputs:`

1. **Produce Takeover Artifacts:**`
   - `CHAOS_REPORT.md` — current state, contradictions, breakpoints.`
   - `ARCHITECTURE_RECONSTRUCTION.md` — current architecture, refactor zones.`
   - `GAP_ANALYSIS.md` — gaps by area, missing workstreams.`
   - `TECH_DEBT_REPORT.md` — debt items, payback strategy.`
   - `SECURITY_AUDIT_SUMMARY.md` — verdict, critical/high findings.`
   - `RECONSTRUCTED_PRD.md` — problem statement, goals, functional requirements.`
   - `TARGET_ARCHITECTURE.md` — target state, key changes, phasing.`

2. **Generate Task Plan:**`
   - Create `TODO/tasks/mcp-copilot-cutover.md` with L3 tickets.`
   - Reuse existing tickets (TASK-INT-BE005, TASK-INT-BE010, etc.) where possible.`
   - Add one-click install script and full Dockerization tickets.`

3. **Update Memory Bank:**`
   - Append session summary to `.github/memory-bank/activeContext.md`.`
   - Create `.github/memory-bank/repo/forgeos-mcp-cutover.md` with key lessons.`

---

# PHASE 3 — HANDOFF`

Once Phase 2 artifacts are complete:`

```
runSubagent("Ticketer", prompt="`
  Takeover analysis complete. Tickets are in READY state.`
  Execute Ticketer protocol using MCP tools only:`
    1. Read state via `tickets.next()` and `tickets.list()`
    2. Claim tickets sequentially via `tickets.claim()`
    3. Dispatch workers via `runSubagent` for each claimed ticket`
    4. Advance tickets via `tickets.complete()`
    5. Sync state via `tickets.list()` after each batch`
  
  Focus on tickets from: {list ticket IDs or types}`
  Report: tickets processed, completions, any rework needed.`
")
```

---

## Notes`

- This prompt is for **legacy repo takeover only**.`
- The CTO agent produces the strategic artifacts; Ticketer executes the tactical work.`
- All context flows through MCP tools (`tickets.next`, `tickets.claim`, `tickets.list`, `tickets.complete`, `tickets.payload`).`
- No `python3 tickets.py` commands are used in normal operation.