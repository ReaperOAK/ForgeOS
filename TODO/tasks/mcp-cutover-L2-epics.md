# MCP Cutover — L2 Epics / Execution Blocks

Mapped from L1 capabilities into actionable epics (L2). Each epic is an execution block that can be decomposed to L3 tickets.

## Epic A: MCP-First Control Plane (align runtime and prompts)
- Goal: Ensure `tickets.*` MCP tools are the primary APIs for operator flows and prompts; remove normal-path filesystem ticket usage.
- Key outcomes: prompt updates, payload/service changes, payload persistence in control plane.

## Epic B: Secure Identity & Auth Harden (bind ticket mutations to principal)
- Goal: Replace checked-in bearer/default admin flows, enforce authenticated principal for mutations, document operator onboarding steps.
- Key outcomes: auth workflow, session/session-regeneration, operator setup doc updates.

## Epic C: Contract & Drift Guardrails
- Goal: Generate authoritative tool manifest; add CI checks to block reintroduction of legacy references (`python3 tickets.py`, `ticket-state/`).

## Epic D: Operator UX — Quickstart, Doctor, Validation
- Goal: Provide one-command validation, VS Code quickstart, and smoke checks for operator readiness.

## Epic E: Installer & Onboarding (new)
- Goal: Provide a one-click installer script that can install `.github` assets and optionally bring up a local dev MCP stack in an existing repo (safe defaults, no checked-in secrets).

## Epic F: Full Dockerization (new)
- Goal: Containerize ForgeOS MCP and required services (Postgres, PgBouncer, optional local env) and provide compose files, image build scripts, and orchestration/deployment docs.

## Epic G: Migration & Compatibility
- Goal: Provide compatibility mode, migration guide, and CI checks that can be toggled during migration windows.

Notes:
- Existing L3 seeds in `mcp-copilot-cutover.md` cover many backend and docs tasks (prompts, payload, binding, CI guardrails). The new L2 epics E and F are added to cover the user's explicit requirements for installer and dockerization.
