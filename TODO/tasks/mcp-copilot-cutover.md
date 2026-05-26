# MCP and VS Code Copilot Cutover (L3 Tickets)

Source: Takeover analysis on 2026-04-14
Scope: Make ForgeOS MCP useful, safe, and the default operator path in VS Code GitHub Copilot

---

## Reuse Existing Backlog First

Execute or unblock these existing tickets before creating duplicates:

- `TASK-INT-BE005` — rewrite `agent-behavior.instructions.md` for MCP payload context
- `TASK-INT-BE010` — update `agents.md` for MCP-only architecture
- `TASK-INT-BE012` — implement `tickets.list`
- `TASK-INT-BE013` — implement `tickets.payload`

---

# TASK-COP-MCP001: Rewrite Operator Prompt Pack for MCP-Only Flow

**Type:** backend
**Priority:** critical
**Files:** .github/prompts/start.prompt.md, .github/prompts/continue.prompt.md, .github/prompts/takeover.prompt.md, .github/prompts/stop.prompt.md
**Tags:** mcp, copilot, prompts, cutover, operator

## Description

Rewrite the active operator prompts so they use ForgeOS MCP tools for ticket and context operations instead of repo-root `tickets.py`, filesystem ticket state, or legacy claim/move instructions.

## Acceptance Criteria

- [ ] No repo-root `python3 tickets.py` instructions remain in active prompts
- [ ] Active prompts reference MCP tool flow for ticket operations
- [ ] Prompt examples use registered tool names that exist in `forgeos-server/src/tools/index.ts`
- [ ] Prompt guidance matches the actual subagent names available in the current environment

---

# TASK-COP-MCP002: Replace Checked-In Workspace Bearer With Safe Local Setup

**Type:** backend
**Priority:** critical
**Files:** .vscode/mcp.json, README.md, forgeos-server/README.md, infra/scripts/setup.sh
**Tags:** mcp, copilot, auth, setup

## Description

Remove the checked-in development bearer token from the workspace MCP config and replace it with a generated or prompted local setup flow that keeps ForgeOS easy to connect in VS Code without teaching unsafe defaults.

## Acceptance Criteria

- [ ] No committed live admin bearer remains in workspace config
- [ ] Setup flow generates or prompts for local MCP credentials
- [ ] README documents one canonical VS Code setup path
- [ ] A new operator can complete local MCP setup without hand-editing secrets into source-controlled files

---

# TASK-COP-MCP003: Bind Ticket Mutations to Authenticated Principal

**Type:** backend
**Priority:** critical
**Files:** forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/tools/tickets-complete.ts, forgeos-server/src/tools/tickets-update.ts, forgeos-server/src/tools/tickets-release.ts, forgeos-server/src/middleware/auth.ts
**Tags:** mcp, security, identity, auth

## Description

Refactor ticket mutation handlers so mutation authority comes from authenticated request identity instead of caller-supplied agent metadata or stored claim fields alone.

## Acceptance Criteria

- [ ] Caller-supplied actor identity is not a trust anchor for ticket mutations
- [ ] Unknown agent auto-registration and wildcard permission minting removed from runtime mutation path
- [ ] Negative tests cover impersonation and cross-claim mutation attempts
- [ ] Workspace docs describe the new trust boundary clearly

---

# TASK-COP-MCP004: Generate Authoritative MCP Tool Manifest From Registration Code

**Type:** backend
**Priority:** high
**Files:** forgeos-server/src/tools/index.ts, forgeos-server/README.md, README.md, docs/architecture/api/
**Tags:** mcp, docs, contract, tooling

## Description

Generate public tool documentation from the registered tool inventory so README and architectural docs cannot drift from actual MCP tool names and descriptions.

## Acceptance Criteria

- [ ] Published tool list exactly matches registered tool names
- [ ] Tool count and descriptions are generated or verified automatically
- [ ] Contract drift is detected in CI

---

# TASK-COP-MCP005: Align SDK and Runner Contracts With Current MCP Surface

**Type:** backend
**Priority:** high
**Files:** agent-sdk/src/forgeos_sdk/, forgeos-server/src/sdk/
**Tags:** mcp, sdk, contract, copilot

## Description

Update SDK and runner layers to stop calling stale or nonexistent tool names and to prefer MCP-first behavior by default.

## Acceptance Criteria

- [ ] SDK wrappers only call supported tool names
- [ ] Legacy `tickets.status` and heartbeat-style drift removed or replaced
- [ ] Default client behavior does not silently fall back to filesystem state in normal operation
- [ ] Compatibility guidance exists for migration-only workflows

---

# TASK-COP-MCP006: Add MCP Doctor and Smoke Validation for VS Code Operators

**Type:** infra
**Priority:** high
**Files:** Makefile, forgeos-server/scripts/, forgeos-server/README.md
**Tags:** mcp, infra, validation, operator

## Description

Create a single command that verifies ForgeOS MCP readiness for VS Code GitHub Copilot, including server health, auth, tool listing, and config consistency.

## Acceptance Criteria

- [ ] A documented one-command validation flow exists
- [ ] Smoke validation checks `/ready`, auth, and at least one `tickets.*` call
- [ ] Validation output is understandable to a first-time operator
- [ ] Server README and root README both reference the same validation flow

---

# TASK-COP-MCP007: Move Upstream Summary Delivery Into the Control Plane

**Type:** backend
**Priority:** high
**Files:** forgeos-server/src/tools/tickets-payload.ts, forgeos-server/src/db/, forgeos-server/src/types/
**Tags:** mcp, payload, artifacts, cutover

## Description

Remove `.github/agent-output` from the normal context assembly path by storing and serving stage summaries from the ForgeOS control plane.

## Acceptance Criteria

- [ ] `tickets.payload` no longer depends on repo filesystem summaries for normal operation
- [ ] Stage summaries are persisted in a server-owned store
- [ ] Migration or compatibility behavior is clearly separated from normal runtime behavior

---

# TASK-COP-MCP008: Add CI Guardrail Against Legacy Operational Drift

**Type:** backend
**Priority:** high
**Files:** .github/workflows/, scripts/, prompt and instruction surfaces
**Tags:** mcp, ci, governance, drift

## Description

Add CI checks that fail when active operator prompts, authoritative instructions, or setup docs reintroduce legacy operational references outside explicitly approved migration files.

## Acceptance Criteria

- [ ] CI fails on new active references to repo-root `python3 tickets.py`
- [ ] CI fails on new active references to `ticket-state/` as the normal operator source of truth
- [ ] Allowlist exists for explicit migration or archive files only

---

# TASK-COP-MCP009: Decide and Document Dispatch Ownership

**Type:** architecture
**Priority:** medium
**Files:** docs/operations/, docs/architecture/, forgeos-server/src/index.ts, forgeos-server/src/services/
**Tags:** mcp, orchestrator, architecture

## Description

Choose one dispatch owner for post-cutover operations: an internal server-managed orchestrator or an external MCP-only runner. Document the decision and remove ambiguous wording.

## Acceptance Criteria

- [ ] One dispatch owner is selected and documented
- [ ] Startup docs match runtime behavior
- [ ] No active docs describe multiple normal dispatch paths

---

# TASK-COP-MCP010: Publish a Canonical Copilot Operator Quick Start

**Type:** docs
**Priority:** medium
**Files:** README.md, forgeos-server/README.md, docs/operations/
**Tags:** mcp, copilot, docs, operator

## Description

Create a short, root-level, evidence-backed quick start specifically for VS Code GitHub Copilot operators that makes the ForgeOS MCP path obvious and primary.

## Acceptance Criteria

- [ ] Root README includes a VS Code Copilot operator path
- [ ] Quick start links to one setup flow and one validation flow
- [ ] Legacy CLI instructions are clearly separated from daily operator guidance

---

# TASK-COP-MCP011: Build One-Click Existing-Repo Installer

**Type:** infra
**Priority:** critical
**Files:** scripts/sync-vibecoding.sh, scripts/install-forgeos.sh, README.md, forgeos-server/README.md, .github/prompts/, .github/instructions/, .github/agents/, .vscode/mcp.json
**Tags:** mcp, installer, copilot, existing-repos, onboarding
**Depends on:** TASK-COP-MCP001, TASK-COP-MCP002, TASK-COP-MCP006

## Description

Create a one-click installer that can install the ForgeOS `.github` agent/instruction/prompt stack, MCP configuration, and local bootstrap assets into any existing repository, similar in spirit to `scripts/sync-vibecoding.sh` but suitable for external repo adoption.

## Acceptance Criteria

- [ ] Installer supports a target repository path argument and a dry-run mode
- [ ] Installer copies or updates the required `.github` ForgeOS assets without clobbering unrelated existing repo files
- [ ] Installer creates a safe local MCP setup path without committing live admin secrets
- [ ] Installer validates prerequisites and reports clear next steps
- [ ] README documents one-command install and rollback instructions
- [ ] Installer has regression tests or a smoke test against a temporary sample repo

---

# TASK-COP-MCP012: Fully Dockerize ForgeOS MCP Runtime

**Type:** infra
**Priority:** critical
**Files:** Dockerfile, docker-compose.yml, forgeos-server/Dockerfile, forgeos-server/docker-compose.yml, forgeos-server/docker-compose.standalone.yml, infra/docker-compose.yml, infra/docker-compose.dev.yml, infra/docker/, infra/scripts/, README.md, forgeos-server/README.md
**Tags:** mcp, docker, deployment, infra, onboarding
**Depends on:** TASK-COP-MCP002, TASK-COP-MCP006

## Description

Make ForgeOS MCP fully runnable through Docker for local development and repo adoption, including PostgreSQL, server startup, migrations, health checks, volumes, and VS Code/Copilot connection guidance.

## Acceptance Criteria

- [ ] A documented Docker Compose flow starts the MCP server and required dependencies from a clean checkout
- [ ] Containers include health checks for PostgreSQL and the ForgeOS MCP server
- [ ] Migrations and seed/bootstrap steps are deterministic and documented
- [ ] Secrets are provided through environment files or generated local config, not hardcoded defaults
- [ ] Dockerized setup works with the one-click installer target workflow
- [ ] Smoke validation confirms `/ready` and at least one MCP ticket tool are reachable