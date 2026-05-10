---
name: start
description: Initialize a new project from scratch with full SDLC planning using ForgeOS MCP tools
agent: 'CTO'
argument-hint: 'Describe your project vision or paste link to project docs'
---

# start — Project Initialization Protocol (MCP-Only)

This prompt bootstraps a new project using ForgeOS MCP tools. It invokes the CTO agent to produce
all strategic artifacts (PRD, architecture, tickets) so that Ticketer can execute.

Use this when:
- Starting a new project from scratch`
- No tickets exist yet`
- You have project docs, specs, or a vision but no structured backlog`

Do NOT use this when:
- Tickets already exist (use `/continue` instead)
- You want to resume paused work (use `/continue`)`
- You want to stop work cleanly (use `/stop`)

---

## Prerequisites

Before running, ensure:
1. Project documentation exists in the workspace (README, specs, design docs, or at minimum a description of what we're building)
2. The CTO agent file exists at `.github/agents/CTO.agent.md`

---

## Phase 0 — Boot & Safety Check (MCP-Only)

1. Read `.github/guardian/STOP_ALL` — if contains `STOP`: halt immediately.`
2. Read all `.github/instructions/*.instructions.md` (core, sdlc, ticket-system, git-protocol, agent-behavior).`
3. Read `.github/agents/CTO.agent.md` — internalize the CTO execution pipeline.`
4. Verify CTO Tool Loadout compliance — only use tools listed in the CTO's Assigned Tool Loadout.`
5. Invoke `sequentialthinking/sequentialthinking` to plan the initialization pipeline.`
6. Call `tickets.next()` — confirm no existing READY tickets.

---

## Phase 1 — Gather Project Context

Scan the workspace for all project-related documentation:

- `README.md`, `docs/`, `specs/`, `design/`, any `.md` files describing the project
- Package manifests: `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, etc.
- Existing code structure (if any partial implementation exists)
- UI designs: `docs/uiux/`, Figma links, Stitch projects
- Reference materials provided by the user

Produce a **Discovery Brief** summarizing:
- What we're building (purpose, target users, core value)
- What already exists (code, docs, infra, designs)
- What's missing (gaps, unknowns, ambiguities)
- Technology landscape (frameworks, constraints, preferences)

If the workspace contains minimal documentation, ask the user to describe the project vision before proceeding.

---

## Phase 2 — Delegate to CTO Agent

Launch the CTO agent with the discovery context:

```
runSubagent("CTO", prompt="`
  We are initializing a new project from scratch.  
  Discovery Brief:
  {insert discovery brief from Phase 1}`
  
  User's Project Description:
  {insert user's description or project docs summary}`
  
  Execute your full 6-phase pipeline using MCP tools only:`
    1. Discovery & Context Gathering (expand on the brief above)`
    2. Research (delegate to Research Analyst for unknowns)`
    3. Product Definition (delegate to Product Manager for PRD)`
    4. Architecture Design (delegate to Architect)`
    5. Ticket Decomposition (delegate to TODO agent for L0→L1→L2→L3)`
    6. Handoff preparation (verify tickets in READY state via `tickets.list()`)`
  
  At the end, report:
    - Artifact paths (PRD, architecture doc, ADRs)`
    - Ticket statistics (total, READY count, priority breakdown)`
    - Confidence level and any known risks`
    - Instructions for Ticketer handoff`
")
```

---

## Phase 3 — Verify Outputs

After CTO completes, verify via MCP tools:
1. PRD exists at `docs/product/PRD-{project}.md``
2. Architecture docs exist in `docs/architecture/``
3. Tickets are in READY state via `tickets.list()` or `tickets.next()``` 
4. Ticket files exist in `.github/tickets/` with proper schema
5. TODO task files exist in `TODO/tasks/`

If any artifact is missing, ask CTO to regenerate it.

---

## Phase 4 — Handoff to Ticketer

Once all artifacts are verified:

```
runSubagent("Ticketer", prompt="`
  CTO initialization complete. Tickets are READY.`
  Execute Ticketer protocol using MCP tools only:`
    1. Read state via `tickets.next()` and `tickets.list()``` 
    2. Claim tickets sequentially via `tickets.claim()``` 
    3. Dispatch workers via `runSubagent` for each claimed ticket``
    4. Advance tickets via `tickets.complete()``` 
    5. Sync state via `tickets.list()` after each batch``
  
  Focus on tickets from: {list ticket IDs or types}`
  Report: tickets processed, completions, any rework needed.`
")
```

---

## Notes

- This prompt is for **new projects only**. If tickets already exist, use `/continue`.
- The CTO agent produces the strategic artifacts; Ticketer executes the tactical work.
- All context flows through MCP tools (`tickets.next`, `tickets.claim`, `tickets.list`, `tickets.complete`, `tickets.payload`).
