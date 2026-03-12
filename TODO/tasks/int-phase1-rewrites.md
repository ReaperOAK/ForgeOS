# Phase 1 — MCP-Only Cutover: Instruction and Agent Rewrites (L3 Tickets)

Source blocks: BLK-INT-01 (Instruction Rewrites), BLK-INT-02 (Agent Rewrites)

---

# TASK-INT-BE001: Rewrite ticket-system.instructions.md for MCP-Only Operations

**Type:** backend
**Priority:** critical
**Files:** .github/instructions/ticket-system.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Rewrite ticket-system.instructions.md to replace all filesystem-based ticket operations with MCP tool calls. Replace directory-based state references with tickets.get/tickets.list tool calls. Update dependency resolution section to reference server-side resolution. Remove references to tickets.py CLI usage by agents (only human operators retain CLI access).

## Acceptance Criteria

- [ ] All references to .github/ticket-state/ directories replaced with MCP tool equivalents
- [ ] tickets.py references scoped to human operator CLI only
- [ ] State transitions described in terms of MCP advance/reject/release tools
- [ ] Dependency resolution described as server-side automatic (not agent computed)
- [ ] Parallelism section updated to reference MCP server locking
- [ ] Document passes markdown lint with zero errors
- [ ] No references to filesystem-based ticket reads by agents remain

---

# TASK-INT-BE002: Rewrite core.instructions.md Boot Sequence for MCP Context

**Type:** backend
**Priority:** critical
**Files:** .github/instructions/core.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Update core.instructions.md boot sequence to add MCP context retrieval step. After reading instruction files, agents call tickets.payload to receive their full delegation context (ticket JSON, upstream summary, memory entries, file scope). Update memory gate to reference MCP-persisted state. Preserve halt gate and human approval gates unchanged.

## Acceptance Criteria

- [ ] Boot sequence step added: call tickets.payload after reading instruction files
- [ ] tickets.payload response described as the canonical context source
- [ ] Memory gate updated to reference MCP-persisted memory entries
- [ ] Halt gate (STOP_ALL) preserved unchanged
- [ ] Human approval gates preserved unchanged
- [ ] Anti-loop rule preserved unchanged
- [ ] Document passes markdown lint with zero errors

---

# TASK-INT-BE003: Rewrite sdlc.instructions.md Stage Transitions for MCP

**Type:** backend
**Priority:** critical
**Files:** .github/instructions/sdlc.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Update sdlc.instructions.md to describe stage transitions via MCP tools instead of filesystem moves. Replace directory-based stage descriptions with MCP advance/reject tool calls. Update rework rules to reference MCP reject tool. Preserve Definition of Done items unchanged.

## Acceptance Criteria

- [ ] Stage transitions described as MCP advance tool calls (not directory moves)
- [ ] Rework described as MCP reject tool call with rejection evidence
- [ ] Stage ownership table preserved unchanged
- [ ] Definition of Done (11 items) preserved unchanged
- [ ] Post-implementation chain order preserved (QA, Security, CI, Docs, Validator)
- [ ] TODO agent decomposition rules preserved unchanged
- [ ] Document passes markdown lint with zero errors

---

# TASK-INT-BE004: Rewrite git-protocol.instructions.md for Simplified Commits

**Type:** backend
**Priority:** critical
**Files:** .github/instructions/git-protocol.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Update git-protocol.instructions.md to remove two-commit protocol (CLAIM+WORK). Replace with single WORK commit model since MCP server handles locking via database. Preserve scoped git rules (no git add .). Update summary handoff to reference MCP-based context delivery instead of filesystem summaries.

## Acceptance Criteria

- [ ] Two-commit protocol replaced with single WORK commit (MCP server handles claims)
- [ ] Claim commit section removed (MCP server creates claims atomically)
- [ ] Scoped git rules preserved (explicit file staging only)
- [ ] Commit message format preserved with ticket ID prefix
- [ ] Summary handoff updated to reference MCP payload delivery
- [ ] Lease mechanism described as server-managed (not filesystem-based)
- [ ] Document passes markdown lint with zero errors

---

# TASK-INT-BE005: Rewrite agent-behavior.instructions.md for MCP Context Derivation

**Type:** backend
**Priority:** critical
**Files:** .github/instructions/agent-behavior.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Update agent-behavior.instructions.md context derivation section. Replace filesystem-derived context with MCP-delivered context via tickets.payload. Update worker model to describe MCP-dispatched agents. Preserve scope enforcement and forbidden actions unchanged.

## Acceptance Criteria

- [ ] Context derivation rule updated: agents receive context via tickets.payload MCP tool
- [ ] Worker model updated: dispatched by orchestrator loop (not stateless Ticketer)
- [ ] Stage ownership table preserved unchanged
- [ ] Scope enforcement rules preserved unchanged
- [ ] Forbidden actions list preserved unchanged
- [ ] Evidence requirements preserved unchanged
- [ ] Document passes markdown lint with zero errors

---

# TASK-INT-BE006: Rewrite terminal-management.instructions.md

**Type:** backend
**Priority:** high
**Files:** .github/instructions/terminal-management.instructions.md
**Tags:** intelligence, cutover, phase1, instructions, BLK-INT-01

## Description

Review and update terminal-management.instructions.md for compatibility with MCP-only operations. Ensure terminal usage rules do not conflict with MCP tool usage patterns. Update any references to tickets.py CLI that should now use MCP tools.

## Acceptance Criteria

- [ ] All tickets.py references for agent use replaced with MCP tool equivalents
- [ ] Terminal management rules compatible with MCP-only agent workflow
- [ ] Operator CLI access preserved (humans may still use tickets.py directly)
- [ ] No conflicts with MCP tool call patterns
- [ ] Document passes markdown lint with zero errors

---

# TASK-INT-BE007: Rewrite Infrastructure Agent Files for MCP Operations

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE001, TASK-INT-BE002, TASK-INT-BE003, TASK-INT-BE004, TASK-INT-BE005
**Files:** .github/agents/Architect.agent.md, .github/agents/DevOps.agent.md, .github/agents/Research.agent.md, .github/agents/ProductManager.agent.md, .github/agents/TODO.agent.md
**Tags:** intelligence, cutover, phase1, agents, BLK-INT-02

## Description

Rewrite 5 infrastructure agent files (Architect, DevOps, Research, ProductManager, TODO) to use MCP tools for ticket operations. Replace filesystem-based context reading with tickets.payload calls. Update execution SOP to include MCP tool invocations. Preserve role-specific tool loadouts and forbidden actions.

## Acceptance Criteria

- [ ] All 5 agent files updated: Architect, DevOps, Research, ProductManager, TODO
- [ ] Boot sequence uses tickets.payload for context retrieval
- [ ] Execution SOP references MCP tools for state transitions
- [ ] Tool loadouts preserved per agent
- [ ] Forbidden actions preserved per agent
- [ ] Evidence requirements preserved per agent
- [ ] All 5 files pass markdown lint with zero errors

---

# TASK-INT-BE008: Rewrite Implementation Agent Files for MCP Operations

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE001, TASK-INT-BE002, TASK-INT-BE003, TASK-INT-BE004, TASK-INT-BE005
**Files:** .github/agents/Backend.agent.md, .github/agents/Frontend.agent.md, .github/agents/UIDesigner.agent.md
**Tags:** intelligence, cutover, phase1, agents, BLK-INT-02

## Description

Rewrite 3 implementation agent files (Backend, Frontend, UIDesigner) to use MCP tools. Replace filesystem reads with tickets.payload. Update how agents receive upstream summaries (via MCP payload instead of reading .github/agent-output/ files). Preserve role-specific scope and tool restrictions.

## Acceptance Criteria

- [ ] All 3 agent files updated: Backend, Frontend, UIDesigner
- [ ] Upstream summary delivered via tickets.payload (not filesystem read)
- [ ] Work commit is the only git commit (no claim commit by agents)
- [ ] Tool loadouts preserved per agent
- [ ] Forbidden actions preserved per agent
- [ ] File scope rules preserved per agent
- [ ] All 3 files pass markdown lint with zero errors

---

# TASK-INT-BE009: Rewrite Review Agent Files for MCP Operations

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE001, TASK-INT-BE002, TASK-INT-BE003, TASK-INT-BE004, TASK-INT-BE005
**Files:** .github/agents/QA.agent.md, .github/agents/Security.agent.md, .github/agents/CIReviewer.agent.md, .github/agents/Documentation.agent.md, .github/agents/Validator.agent.md, .github/agents/Ticketer.agent.md
**Tags:** intelligence, cutover, phase1, agents, BLK-INT-02

## Description

Rewrite 6 review and dispatch agent files (QA, Security, CIReviewer, Documentation, Validator, Ticketer) for MCP operations. Ticketer becomes the orchestrator loop caller. QA/Security/Validator use MCP reject tool for rework. All agents receive context via tickets.payload.

## Acceptance Criteria

- [ ] All 6 agent files updated: QA, Security, CIReviewer, Documentation, Validator, Ticketer
- [ ] Ticketer rewritten as orchestrator loop invoker (not stateless dispatcher)
- [ ] QA, Security, Validator use MCP reject tool for rework (not filesystem moves)
- [ ] Context delivery via tickets.payload for all agents
- [ ] Tool loadouts preserved per agent
- [ ] Forbidden actions preserved per agent
- [ ] All 6 files pass markdown lint with zero errors

---

# TASK-INT-BE010: Update Root agents.md for MCP-Only Architecture

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE007, TASK-INT-BE008, TASK-INT-BE009
**Files:** agents.md
**Tags:** intelligence, cutover, phase1, agents, BLK-INT-02

## Description

Update root agents.md to reflect MCP-only architecture. Update boot sequence to include tickets.payload call. Update identity invariants (Ticketer as orchestrator invoker, not stateless dispatcher). Update execution SOP to reference MCP tools. Update tool loadout reference table.

## Acceptance Criteria

- [ ] Boot sequence updated with tickets.payload step
- [ ] Identity invariants updated for MCP-only model
- [ ] Ticketer description updated from stateless dispatcher to orchestrator invoker
- [ ] Execution SOP uses MCP tools for state reads
- [ ] Tool loadout table updated to include new MCP tools
- [ ] Scoped git rules preserved (no git add .)
- [ ] Document passes markdown lint with zero errors
