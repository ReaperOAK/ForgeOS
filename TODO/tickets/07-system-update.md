# System Update Tickets

## TASK-FOS-07-001: Update Agent Files with MCP Tool References

**Type:** docs
**Priority:** medium
**Dependencies:** TASK-FOS-02-001, TASK-FOS-03-002
**Files:** .github/agents/Backend.agent.md, .github/agents/Frontend.agent.md, .github/agents/QA.agent.md, .github/agents/Security.agent.md, .github/agents/Architect.agent.md, .github/agents/Research.agent.md, .github/agents/Documentation.agent.md, .github/agents/CIReviewer.agent.md, .github/agents/Validator.agent.md, .github/agents/DevOps.agent.md, .github/agents/UIDesigner.agent.md, .github/agents/ProductManager.agent.md, .github/agents/Ticketer.agent.md, .github/agents/TODO.agent.md

### Description
Update all 14 .github/agents/*.agent.md files to reference the new MCP-based ticket operations. Each agent file should document: (1) which MCP tools the agent is authorized to use (based on the RBAC matrix from Architecture §7.2), (2) the MCP server URL configuration (FORGEOS_MCP_URL env var), (3) updated workflow steps using tickets.claim/tickets.complete instead of tickets.py CLI, (4) the filesystem fallback mechanism when MCP is unavailable. Agent files should retain their existing structure (role, stage, scope, forbidden actions) while adding MCP integration sections.

### Acceptance Criteria
- [ ] All 14 agent files updated with MCP tool authorization section listing permitted tools per RBAC matrix
- [ ] Backend agent: authorized for tickets.next(BACKEND), tickets.claim(BACKEND), tickets.complete, tickets.spawn, tickets.release(own), tickets.extend(own)
- [ ] QA agent: authorized for tickets.next(QA), tickets.claim(QA), tickets.complete, tickets.reject, tickets.release(own), tickets.extend(own)
- [ ] Ticketer agent: authorized for tickets.next(all stages), tickets.stats, tickets.graph (no claim/complete)
- [ ] Each agent file documents FORGEOS_MCP_URL and FORGEOS_API_KEY environment variables
- [ ] Workflow steps updated: replace "python3 tickets.py --claim" with "tickets.claim MCP tool call"
- [ ] Fallback mechanism documented: if MCP unreachable, use tickets.py CLI directly
- [ ] Existing agent file structure (role, stage, scope, forbidden actions, references) preserved

---

## TASK-FOS-07-002: Update Instruction Files for New Architecture

**Type:** docs
**Priority:** medium
**Dependencies:** TASK-FOS-07-001
**Files:** .github/instructions/core.instructions.md, .github/instructions/sdlc.instructions.md, .github/instructions/ticket-system.instructions.md, .github/instructions/git-protocol.instructions.md, .github/instructions/agent-behavior.instructions.md

### Description
Update the 5 core instruction files to reflect the new PostgreSQL-backed architecture. Key changes: (1) ticket-system.instructions.md — add MCP-based ticket operations alongside filesystem operations, describe dual-mode operation, document tickets.py backward compatibility bridge; (2) sdlc.instructions.md — update SDLC flows to include PRODUCT_MANAGER and UI_DESIGN stages for the 10 ticket types; (3) git-protocol.instructions.md — document how the two-commit protocol interacts with MCP (claim via MCP, code via Git); (4) core.instructions.md — add MCP server as part of boot sequence verification; (5) agent-behavior.instructions.md — update context derivation to include MCP server.

### Acceptance Criteria
- [ ] ticket-system.instructions.md documents MCP ticket operations as primary method with filesystem as fallback
- [ ] ticket-system.instructions.md describes dual-mode operation and feature flags for gradual cutover
- [ ] sdlc.instructions.md updated SDLC flows for all 10 ticket types including product and design types
- [ ] sdlc.instructions.md stage definitions include PRODUCT_MANAGER, UI_DESIGN as new stages
- [ ] git-protocol.instructions.md explains MCP claim + Git code commit workflow
- [ ] core.instructions.md boot sequence includes MCP server health check step
- [ ] agent-behavior.instructions.md context derivation includes MCP server state
- [ ] All existing rules preserved; new content is additive (no removals that break backward compatibility)

---

## TASK-FOS-07-003: Update Root Documentation Files

**Type:** docs
**Priority:** medium
**Dependencies:** TASK-FOS-07-001
**Files:** agents.md, .github/copilot-instructions.md, README.md

### Description
Update the root-level documentation files to reflect the new ForgeOS architecture. agents.md should reference MCP tools in the Agent Execution Contract. copilot-instructions.md should update the repository structure section to include forgeos-server/ directory and the MCP architecture description. README.md should be updated with: new architecture overview, setup instructions (docker compose up), development workflow, and links to the new dashboard.

### Acceptance Criteria
- [ ] agents.md Updated Required Lifecycle section references MCP tools for claim/advance/release
- [ ] agents.md Required Boot Sequence includes MCP server connectivity check
- [ ] copilot-instructions.md Repository Structure section includes forgeos-server/ directory tree
- [ ] copilot-instructions.md Architecture section describes MCP server + PostgreSQL + dashboard
- [ ] README.md includes quick start: git clone, docker compose up, open dashboard
- [ ] README.md architecture section describes the distributed MCP-based system
- [ ] README.md links to dashboard URL (http://localhost:3000/dashboard)

---

## TASK-FOS-07-004: Update tickets.py for Backward Compatibility Bridge

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-FOS-03-002, TASK-FOS-03-004
**Files:** .github/tickets.py

### Description
Update the existing tickets.py to support dual-mode operation as a backward compatibility bridge. Add a FORGEOS_MODE environment variable with three values: "filesystem" (current behavior, default), "dual" (writes to both filesystem and PostgreSQL via MCP), and "mcp" (PostgreSQL-only via MCP). In dual mode, every claim/advance/release operation first executes against the filesystem (existing code) and then mirrors the operation to the MCP server via HTTP API calls. In mcp mode, all operations go through MCP and filesystem operations are skipped. Include a shadow mode that compares filesystem and MCP results and logs divergences without failing.

### Acceptance Criteria
- [ ] FORGEOS_MODE env var controls behavior: "filesystem" (default), "dual", "mcp"
- [ ] In filesystem mode, all existing behavior is preserved with zero changes
- [ ] In dual mode, --claim calls both filesystem claim and MCP tickets.claim; logs any divergence
- [ ] In dual mode, --advance calls both filesystem advance and MCP tickets.complete; logs any divergence
- [ ] In mcp mode, --claim calls only MCP tickets.claim (skips filesystem operations)
- [ ] In mcp mode, --advance calls only MCP tickets.complete (skips filesystem operations)
- [ ] Shadow comparison logs: "DIVERGENCE: filesystem={state} mcp={state} for ticket {id}" on mismatch
- [ ] MCP calls use FORGEOS_MCP_URL and FORGEOS_API_KEY environment variables
- [ ] If MCP server is unreachable in dual mode, operation continues with filesystem-only and logs WARNING
