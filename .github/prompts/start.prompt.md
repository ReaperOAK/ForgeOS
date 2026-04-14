---
name: start
description: Initialize a new project from scratch with full SDLC planning
agent: 'CTO'
argument-hint: 'Describe your project vision or paste link to project docs'
---

# start — Project Initialization Protocol

This prompt bootstraps a new project from zero. It invokes the CTO agent to produce
all strategic artifacts (PRD, architecture, tickets) so that Ticketer can execute.

Use this when:
- Starting a new project from scratch
- No tickets exist yet
- You have project docs, specs, or a vision but no structured backlog

Do NOT use this when:
- Tickets already exist (use `/continue` instead)
- You want to resume paused work (use `/continue`)
- You want to stop work cleanly (use `/stop`)

---

## Prerequisites

Before running, ensure:
1. Project documentation exists in the workspace (README, specs, design docs, or at minimum a description of what we're building)
2. `.github/` infrastructure is initialized (instructions, guardian, ticket-state directories)
3. The CTO agent file exists at `.github/agents/CTO.agent.md`

---

## Phase 0 — Boot & Safety Check

1. Read `.github/guardian/STOP_ALL` — if contains `STOP`: halt immediately.
2. Read all `.github/instructions/*.instructions.md` (core, sdlc, ticket-system, git-protocol, agent-behavior).
3. Read `.github/agents/CTO.agent.md` — internalize the CTO execution pipeline.
4. Verify CTO Tool Loadout compliance — only use tools listed in the CTO's Assigned Tool Loadout.
5. Invoke `sequentialthinking/sequentialthinking` to plan the initialization pipeline.
6. Run `python3 tickets.py --status --json` — confirm no existing tickets or understand current state.

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
runSubagent("CTO", prompt="
  We are initializing a new project from scratch.
  
  Discovery Brief:
  {insert discovery brief from Phase 1}
  
  User's Project Description:
  {insert user's description or project docs summary}
  
  Execute your full 6-phase pipeline:
  1. Discovery & Context Gathering (expand on the brief above)
  2. Research (delegate to Research Analyst for unknowns)
  3. Product Definition (delegate to Product Manager for PRD)
  4. Architecture Design (delegate to Architect)
  5. Ticket Decomposition (delegate to TODO agent for L0→L1→L2→L3)
  6. Handoff preparation (verify tickets in READY state)
  
  At the end, report:
  - Artifact paths (PRD, architecture doc, ADRs)
  - Ticket statistics (total, READY count, priority breakdown)
  - Confidence level and any known risks
  - Instructions for Ticketer handoff
")
```

---

## Phase 3 — Verify Outputs

After CTO completes, verify:

1. **PRD exists:** `docs/PRD.md` (or equivalent) with features, acceptance criteria, priorities
2. **Architecture exists:** `docs/ARCHITECTURE.md` with diagrams, API contracts, schema design
3. **Tickets exist:** Run `python3 tickets.py --status --json` to confirm tickets in READY
4. **Integrity check:** Run `python3 tickets.py --validate` — zero errors
5. **Memory gate:** `.github/memory-bank/activeContext.md` has CTO initialization entry

If any artifact is missing or incomplete, re-delegate to CTO with specific feedback.

---

## Phase 4 — Handoff to Execution

Once all artifacts are verified:

1. Report to the user:
   - Summary of what was planned
   - Total ticket count and priority breakdown
   - Recommended execution order
   - Any risks or assumptions to be aware of

2. Instruct the user:
   ```
   Project initialization complete.
   
   Artifacts produced:
   - PRD: docs/PRD.md
   - Architecture: docs/ARCHITECTURE.md
   - Tickets: {N} total, {M} in READY state
   
   To begin implementation, run the /continue prompt.
   Ticketer will dispatch agents to execute tickets.
   ```

---

## Rules

- Do NOT implement any code — this prompt is for planning only
- Do NOT skip directly to ticket creation without PRD and architecture
- Do NOT bypass the CTO's 6-phase pipeline
- Do NOT dispatch implementing agents (Backend, Frontend, etc.) — that's Ticketer's job
- Do NOT use tools outside the CTO's Assigned Tool Loadout
- Follow all boot sequence and safety checks from `core.instructions.md`
- Follow scoped git rules — no `git add .` / `git add -A`
