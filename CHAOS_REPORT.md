# Chaos Report

Status: `ARCHITECTURE_REWRITE_REQUIRED`
Scope: ForgeOS MCP usefulness and VS Code GitHub Copilot cutover
Date: 2026-04-14

## Executive Summary

ForgeOS MCP is implemented and already useful as a ticket, code, and memory control plane, but it is not the only active control plane in this repository.

The current repo is running a split-brain model:

- The ForgeOS MCP server exposes the real `tickets.*`, `code.*`, `init.*`, and `memory.*` tool surface via HTTP and PostgreSQL.
- The highest-friction Copilot entry points still steer operators and agents through `.github/tickets.py`, filesystem ticket state, and git-era claim workflows.
- The checked-in VS Code MCP config points at the server, but it uses a hardcoded development admin bearer and does not guarantee that operators stay on the MCP path.
- Several security and identity gaps make it unsafe to declare ForgeOS MCP mandatory in its current form.

The repo should not jump to feature work until the orchestration surface is stabilized around one control plane.

## Current-State Findings

### 1. The MCP server is real and already valuable

- `forgeos-server/src/server.ts` serves `/mcp`, `/health`, `/ready`, `/events`, `/dashboard`, and `/api`.
- `forgeos-server/src/tools/index.ts` registers a broad tool surface including `tickets.next`, `tickets.claim`, `tickets.complete`, `tickets.reject`, `tickets.list`, `tickets.get`, `tickets.payload`, `tickets.attach_prompts`, `init.orient`, `init.index`, and code and memory tools.
- `forgeos-server/README.md` documents VS Code setup and a one-click install badge.

### 2. Copilot is still trained to use the wrong path

- `.github/prompts/start.prompt.md`, `.github/prompts/continue.prompt.md`, `.github/prompts/takeover.prompt.md`, and `.github/prompts/stop.prompt.md` still instruct `python3 tickets.py` and filesystem scans.
- The actual script lives at `.github/tickets.py`, so repo-root `python3 tickets.py` is both legacy and brittle.
- `.github/instructions/core.instructions.md`, `.github/instructions/ticket-system.instructions.md`, `.github/instructions/agent-behavior.instructions.md`, and `.github/instructions/git-protocol.instructions.md` still describe filesystem-derived context and ticket movement.

### 3. The repo contains evidence that MCP-only cutover was planned but not completed

- `docs/operations/mcp-cutover-guide.md` says PostgreSQL should be the sole source of truth and agents should use `tickets.get`, `tickets.list`, and `tickets.payload`.
- Existing tickets already target this rewrite, including `.github/ticket-state/READY/TASK-INT-BE005.json` and `.github/tickets/TASK-INT-BE010.json`.
- The current instructions and prompts have not yet converged on that model.

### 4. MCP usefulness is undermined by auth and identity design

- `.vscode/mcp.json` ships `Authorization: Bearer forgeos_admin_CHANGE_ME`.
- `forgeos-server/src/tools/tickets-claim.ts` trusts caller-supplied `agent_name` and auto-registers unknown agent names.
- Security review evidence indicates current mutation handlers are not consistently bound to the authenticated principal.

### 5. Runtime ownership is still ambiguous

- The cutover guide references an orchestrator, but the current startup flow does not clearly make the server the single dispatch owner.
- `tickets.payload` still reads upstream summaries from `.github/agent-output`, so even the MCP plane depends on repo-mounted artifacts.

## Top Breakpoints Blocking “Always Use ForgeOS MCP”

1. Prompt and instruction drift back to `tickets.py`
2. Hardcoded VS Code admin bearer
3. Caller-supplied agent identity in MCP mutation tools
4. Documentation drift between actual registered tool names and published tool names
5. Filesystem artifacts still participating in context delivery
6. Legacy fallback behavior still present in SDK/client layers

## Stabilization Priority

### P0

- Rewrite operator prompts and core instructions to be MCP-only
- Bind mutation tools to authenticated identity
- Remove checked-in admin bearer from workspace config
- Add CI checks that fail on new operational `tickets.py`/`ticket-state` references outside explicitly legacy paths

### P1

- Normalize public tool inventory from code generation
- Move upstream summary storage into the control plane
- Fix SDK contract drift and disable filesystem fallback by default
- Add a VS Code/Copilot doctor flow that verifies MCP health end to end

### P2

- Decide whether dispatch lives in the server or in an external MCP-only runner
- Archive or quarantine legacy cutover and fallback surfaces after migration is complete

## Evidence

- `README.md`
- `forgeos-server/README.md`
- `.vscode/mcp.json`
- `forgeos-server/src/server.ts`
- `forgeos-server/src/tools/index.ts`
- `forgeos-server/src/tools/tickets-claim.ts`
- `forgeos-server/src/tools/tickets-payload.ts`
- `.github/prompts/start.prompt.md`
- `.github/prompts/continue.prompt.md`
- `.github/prompts/takeover.prompt.md`
- `.github/prompts/stop.prompt.md`
- `.github/instructions/core.instructions.md`
- `.github/instructions/ticket-system.instructions.md`
- `.github/instructions/agent-behavior.instructions.md`
- `docs/operations/mcp-cutover-guide.md`
- `.github/ticket-state/READY/TASK-INT-BE005.json`
- `.github/tickets/TASK-INT-BE010.json`