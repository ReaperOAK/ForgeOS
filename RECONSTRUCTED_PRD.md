# Reconstructed PRD

Title: ForgeOS MCP-First Copilot Cutover
Date: 2026-04-14
Status: Draft

## Problem Statement

ForgeOS already has a capable MCP server, but the repository does not yet ensure that VS Code GitHub Copilot uses it as the default or only operational path.

Operators can still be routed into legacy filesystem and `tickets.py` workflows through prompts, instructions, hooks, and fallback SDK behavior. As a result, ForgeOS MCP is useful but not authoritative.

## Users

### Primary users

- Repo operators using VS Code GitHub Copilot
- Agents and subagents that need ticket, context, and lifecycle access

### Secondary users

- Maintainers of the ForgeOS server and SDKs
- Security reviewers and platform owners

## Goals

1. Make ForgeOS MCP the default operator path in VS Code GitHub Copilot
2. Make MCP useful enough that agents do not need filesystem ticket fallbacks
3. Make MCP safe enough that it can be required for daily orchestration work
4. Prevent reintroduction of legacy operator flows after cutover

## Non-Goals

- Rewriting the entire product architecture
- Replacing PostgreSQL or the current MCP SDK stack
- Mass-refactoring unrelated backend or frontend features

## Functional Requirements

### EARS Requirements

- WHEN an operator opens this workspace in VS Code, THE SYSTEM SHALL provide a clear and working ForgeOS MCP setup path.
- WHEN Copilot executes repo prompts or follows repo instructions, THE SYSTEM SHALL steer it through `tickets.*`, `tickets.payload`, and related MCP tools instead of `tickets.py` and filesystem ticket state.
- WHEN an agent begins work on a ticket, THE SYSTEM SHALL receive its working context from `tickets.payload` or an equivalent MCP-owned context endpoint.
- WHEN ticket lifecycle state changes, THE SYSTEM SHALL persist that state in the MCP control plane rather than filesystem ticket directories.
- IF a client attempts to mutate ticket state, THEN THE SYSTEM SHALL bind the action to the authenticated caller identity.
- IF repo content reintroduces legacy operational references outside approved legacy paths, THEN THE SYSTEM SHALL fail CI or equivalent validation.
- WHEN operators need to verify local readiness, THE SYSTEM SHALL provide a single doctor/smoke workflow that validates server health, auth, and tool availability.

## Non-Functional Requirements

- Security: no checked-in admin bearer as the default operator path
- Reliability: prompt packs and docs must match actual registered tool names
- Operability: one canonical Copilot operator quick start
- Compatibility: cutover should preserve local development while clearly separating legacy migration paths from daily operations

## Feature Set

### F1. MCP-first operator prompts

- Rewrite `/start`, `/continue`, `/takeover`, and `/stop` for MCP-only control flow.

### F2. Safe VS Code MCP configuration

- Replace checked-in dev bearer with generated or prompted config.

### F3. Authenticated mutation model

- Bind `tickets.claim`, `tickets.complete`, `tickets.update`, `tickets.release`, and related mutations to authenticated identity.

### F4. Contract alignment

- Generate public tool inventory from server registration.
- Align SDK wrappers with actual tool names.

### F5. MCP-owned context delivery

- Remove filesystem summary dependency from `tickets.payload` or replace it with a server-owned artifact store.

### F6. Regression guardrails

- Add CI validation for legacy operational references.

### F7. Operator doctor flow

- Add a repeatable verification path for VS Code/Copilot readiness.

## Success Metrics

- 100% of operator-facing prompts use MCP tools for ticket operations
- 0 checked-in default admin bearer tokens in workspace MCP config
- 0 legacy operational references in active prompts and authoritative instructions outside approved legacy/migration files
- SDK clients use only supported tool names
- A first-time operator can verify local ForgeOS MCP readiness in one documented workflow

## Risks

- Existing hidden and top-level ticket stores can cause confusion during cutover
- Prompt/instruction rewrites can drift again without CI enforcement
- Security hardening must land before mandatory adoption

## Evidence

- `README.md`
- `forgeos-server/README.md`
- `.vscode/mcp.json`
- `.github/prompts/start.prompt.md`
- `.github/prompts/continue.prompt.md`
- `.github/prompts/takeover.prompt.md`
- `.github/instructions/core.instructions.md`
- `.github/instructions/agent-behavior.instructions.md`
- `forgeos-server/src/tools/index.ts`